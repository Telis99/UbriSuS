// Rotas do ambulatório de saúde mental (CAPS): painel do usuário com atendimentos e medicamentos
// conforme o nível de acesso, acolhimento, atendimentos de programas/oficinas, sessões de grupo e
// agendas dos programas (TR 1.2.46.1 a 1.2.46.9).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, transacao } from '../../db/pool.js';
import { inserir, registrarGanchos } from '../../meta/crud.js';
import { obterEntidade } from '../../meta/registro.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { contextoDe, ErroHttp, exigirPermissao, registrarRotina, temPermissao } from '../../seguranca/usuario.js';
import { faturarAtendimento, procedimentoPadrao, sincronizarAgendaPrograma } from './servico.js';
import './relatorios.js';

registrarPermissao('caps_prontuario', 'Saúde mental: evolução, escuta e diagnóstico (dados sigilosos)', 'CAPS', ['consultar']);
registrarPermissao('caps_medicamentos', 'Saúde mental: medicamentos prescritos e dispensados', 'CAPS', ['consultar']);

registrarGanchos('caps_atendimento', {
  async antesSalvar(d, { cliente: c, atual }) {
    const final = { ...(atual ?? {}), ...d };
    if (final.data && String(final.data) > new Date().toISOString().slice(0, 10)) throw new ErroHttp(422, 'Data do atendimento no futuro.');
    if (final.oficina_id && !final.programa_id) d.programa_id = (await c.query(`select programa_id from caps.oficina where id = $1`, [final.oficina_id])).rows[0]?.programa_id ?? null;
    if (!final.procedimento_id) d.procedimento_id = await procedimentoPadrao(c, final.tipo ?? 'INDIVIDUAL', final.oficina_id);
    if (final.tipo === 'DOMICILIAR' && !d.local_realizacao && !atual) d.local_realizacao = 'D';
  },
  // Atendimento gera a ação do RAAS psicossocial ou a produção BPA, sem redigitação (TR 1.2.44.5).
  async depoisSalvar(r, { cliente: c, atual }) {
    if (atual) return;
    const data = (await c.query(`select data::text d from caps.atendimento where id = $1`, [r.id])).rows[0].d;
    const f = await faturarAtendimento(c, { ...(r as any), data }, `caps_atendimento:${r.id}`);
    await c.query(`update caps.atendimento set raas_acao_id = $2, producao_id = $3 where id = $1`, [r.id, f.raasAcaoId ?? null, f.producaoId ?? null]);
  },
});

registrarGanchos('caps_acolhimento', {
  antesSalvar(d, { atual }) {
    if (!atual && !d.data_hora) d.data_hora = new Date().toISOString();
  },
  async depoisSalvar(r, { cliente: c, atual }) {
    if (atual) return;
    const proc = await procedimentoPadrao(c, 'ACOLHIMENTO');
    await faturarAtendimento(c, { id: r.id, paciente_id: r.paciente_id, unidade_id: r.unidade_id, data: (await c.query(`select (data_hora at time zone 'America/Sao_Paulo')::date::text d from caps.acolhimento where id = $1`, [r.id])).rows[0].d, profissional_id: r.profissional_id, procedimento_id: proc, cid_id: r.cid_id }, `caps_acolhimento:${r.id}`);
    if (r.conduta === 'INSERCAO' && r.programa_id) {
      await c.query(
        `insert into caps.inscricao (paciente_id, programa_id, profissional_referencia_id, data_inicio, situacao)
         select $1, $2, $3, current_date, 'ATIVO' where not exists (select 1 from caps.inscricao where paciente_id = $1 and programa_id = $2 and situacao = 'ATIVO')`,
        [r.paciente_id, r.programa_id, r.profissional_id],
      );
    }
  },
});

registrarGanchos('caps_agenda', {
  antesSalvar(d, { atual }) {
    const f = { ...(atual ?? {}), ...d };
    if (f.hora_fim <= f.hora_inicio) throw new ErroHttp(422, 'O horário final deve ser posterior ao inicial.', { hora_fim: 'Horário inválido.' });
  },
  async depoisSalvar(r, { cliente: c, usuario }) {
    await sincronizarAgendaPrograma(c, r.id, usuario);
  },
});

registrarGanchos('caps_oficina', {
  async antesSalvar(d, { cliente: c, atual }) {
    const f = { ...(atual ?? {}), ...d };
    if (f.local_id) {
      const l = (await c.query(`select l.capacidade from caps.local l where l.id = $1`, [f.local_id])).rows[0];
      if (l?.capacidade && f.vagas && f.vagas > l.capacidade) throw new ErroHttp(422, `O local comporta ${l.capacidade} pessoas; reduza as vagas da oficina.`);
    }
  },
});

registrarGanchos('caps_inscricao', {
  async antesSalvar(d, { cliente: c, atual }) {
    const f = { ...(atual ?? {}), ...d };
    if (f.oficina_id) {
      const o = (await c.query(`select programa_id, vagas, (select count(*)::int from caps.inscricao i where i.oficina_id = o.id and i.situacao = 'ATIVO' and i.id <> coalesce($2, 0)) ocupadas from caps.oficina o where o.id = $1`, [f.oficina_id, atual?.id ?? null])).rows[0];
      if (o && o.programa_id !== Number(f.programa_id)) throw new ErroHttp(422, 'A oficina não pertence ao programa selecionado.');
      if (o?.vagas && f.situacao === 'ATIVO' && o.ocupadas >= o.vagas) throw new ErroHttp(409, `Oficina sem vagas (${o.vagas} ocupadas).`);
    }
    if (f.situacao !== 'ATIVO' && !f.data_fim) d.data_fim = new Date().toISOString().slice(0, 10);
  },
});

export default async function rotasSaudeMental(app: FastifyInstance) {
  // Painel do usuário: atendimentos e medicamentos prescritos conforme o nível de acesso (TR 1.2.46.1, 1.2.46.2).
  app.get('/api/caps/pacientes/:id/painel', async (req) => {
    const u = exigirPermissao(req, 'caps_atendimento:consultar');
    const id = Number((req.params as any).id);
    const sigilo = temPermissao(u, 'caps_prontuario:consultar');
    const medicamentos = temPermissao(u, 'caps_medicamentos:consultar') || temPermissao(u, 'prescricao:consultar');
    const atendimentos = await consultar(
      `select a.id, a.data::text data, to_char(a.hora, 'HH24:MI') hora, a.tipo, p.nome programa, o.nome oficina, pf.nome profissional, pr.codigo || ' - ' || pr.nome procedimento,
              a.local_realizacao, ${sigilo ? `a.evolucao, (select codigo || ' - ' || nome from cad.cid where id = a.cid_id) cid` : `null evolucao, null cid`}
         from caps.atendimento a left join caps.programa p on p.id = a.programa_id left join caps.oficina o on o.id = a.oficina_id
         left join cad.profissional pf on pf.id = a.profissional_id left join cad.procedimento pr on pr.id = a.procedimento_id
        where a.paciente_id = $1 order by a.data desc, a.id desc limit 300`,
      [id],
    );
    const outros = await consultar(
      `select a.entrada_em, u.nome unidade, pf.nome profissional, e.nome especialidade, a.tipo_unidade, ${sigilo ? `(select codigo || ' - ' || nome from cad.cid where id = a.cid_id) cid, a.avaliacao` : `null cid, null avaliacao`}
         from amb.atendimento a join cad.unidade u on u.id = a.unidade_id left join cad.profissional pf on pf.id = a.profissional_id left join cad.especialidade e on e.id = a.especialidade_id
        where a.paciente_id = $1 order by a.entrada_em desc limit 100`,
      [id],
    );
    const acolhimentos = await consultar(
      `select a.id, a.data_hora, a.demanda, a.motivo, a.risco, a.conduta, pf.nome profissional, ${sigilo ? 'a.escuta' : 'null escuta'}
         from caps.acolhimento a left join cad.profissional pf on pf.id = a.profissional_id where a.paciente_id = $1 order by a.data_hora desc`,
      [id],
    );
    const inscricoes = await consultar(
      `select i.id, p.nome programa, o.nome oficina, i.data_inicio::text data_inicio, i.data_fim::text data_fim, i.situacao, r.nome referencia
         from caps.inscricao i join caps.programa p on p.id = i.programa_id left join caps.oficina o on o.id = i.oficina_id left join cad.profissional r on r.id = i.profissional_referencia_id
        where i.paciente_id = $1 order by i.situacao, i.data_inicio desc`,
      [id],
    );
    const pts = await consultar(
      `select t.id, t.data_elaboracao::text data_elaboracao, t.data_reavaliacao::text data_reavaliacao, t.situacao, r.nome referencia, t.objetivos, t.intervencoes, t.frequencia
         from caps.pts t left join cad.profissional r on r.id = t.profissional_referencia_id where t.paciente_id = $1 order by t.data_elaboracao desc`,
      [id],
    );
    const prescritos = medicamentos
      ? await consultar(
          `select r.data::text data, r.numero, r.tipo_receita, r.situacao, pf.nome prescritor, coalesce(i.descricao, pr.nome) medicamento, i.quantidade, i.posologia, i.uso_continuo, i.quantidade_dispensada
             from amb.prescricao r join amb.prescricao_item i on i.prescricao_id = r.id left join far.produto pr on pr.id = i.produto_id left join cad.profissional pf on pf.id = r.profissional_id
            where r.paciente_id = $1 order by r.data desc limit 200`,
          [id],
        )
      : [];
    await registrarRotina(req, 'caps_prontuario', 'consultar', { paciente: id, sigilo, medicamentos });
    return { acesso: { sigilo, medicamentos }, atendimentos, outros, acolhimentos, inscricoes, pts, prescritos };
  });

  // Participantes inscritos em uma oficina (lista de presença).
  app.get('/api/caps/oficinas/:id/participantes', async (req) => {
    exigirPermissao(req, 'caps_atendimento:consultar');
    return consultar(
      `select i.paciente_id, pa.nome, pa.cns, i.data_inicio::text data_inicio from caps.inscricao i join cad.pessoa pa on pa.id = i.paciente_id
        where i.oficina_id = $1 and i.situacao = 'ATIVO' order by pa.nome`,
      [Number((req.params as any).id)],
    );
  });

  // Sessão de oficina/grupo: um atendimento por participante presente (TR 1.2.46.7).
  app.post('/api/caps/oficinas/:id/sessao', async (req) => {
    const u = exigirPermissao(req, 'caps_atendimento:incluir');
    const b = z
      .object({
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hora: z.string().nullish(),
        profissionalId: z.number(),
        evolucaoGrupo: z.string().nullish(),
        participantes: z.array(z.object({ pacienteId: z.number(), evolucao: z.string().nullish() })).min(1),
      })
      .parse(req.body);
    const oficinaId = Number((req.params as any).id);
    const e = obterEntidade('caps_atendimento')!;
    return transacao(contextoDe(req, 'caps:sessao'), async (c) => {
      const o = (await c.query(`select o.*, p.unidade_id from caps.oficina o join caps.programa p on p.id = o.programa_id where o.id = $1`, [oficinaId])).rows[0];
      if (!o) throw new ErroHttp(404, 'Oficina não encontrada.');
      const criados = [];
      for (const p of b.participantes) {
        criados.push(
          await inserir(
            e,
            {
              paciente_id: p.pacienteId,
              unidade_id: o.unidade_id,
              data: b.data,
              hora: b.hora ?? null,
              profissional_id: b.profissionalId,
              tipo: 'GRUPO',
              programa_id: o.programa_id,
              oficina_id: o.id,
              local_id: o.local_id,
              evolucao: [b.evolucaoGrupo, p.evolucao].filter(Boolean).join('\n') || null,
            },
            contextoDe(req),
            u,
            c,
          ),
        );
      }
      return { registrados: criados.length };
    });
  });

  // Visão das próximas sessões dos programas (agendas geradas na agenda da rede).
  app.get('/api/caps/agenda', async (req) => {
    exigirPermissao(req, 'caps_programa:consultar');
    const q = req.query as any;
    return consultar(
      `select h.data::text data, to_char(min(h.hora), 'HH24:MI') hora, p.nome programa, o.nome oficina, l.nome local, pf.nome profissional, ag.id caps_agenda_id, ag.vagas,
              count(*) filter (where h.situacao = 'OCUPADO')::int ocupadas, bool_or(h.situacao = 'BLOQUEADO') bloqueado
         from caps.agenda ag join caps.programa p on p.id = ag.programa_id left join caps.oficina o on o.id = ag.oficina_id left join caps.local l on l.id = ag.local_id
         left join cad.profissional pf on pf.id = ag.profissional_id join age.horario h on h.agenda_id = ag.agenda_id
        where h.data between coalesce($1::date, current_date) and coalesce($2::date, current_date + 14) and ag.ativo
        group by 1, 3, 4, 5, 6, 7, 8 order by 1, 2`,
      [q.de || null, q.ate || null],
    );
  });

  app.get('/api/caps/resumo', async (req) => {
    exigirPermissao(req, 'caps_atendimento:consultar');
    return consultar(
      `select p.id, p.nome programa, p.vagas, (select count(*)::int from caps.inscricao i where i.programa_id = p.id and i.situacao = 'ATIVO') inscritos,
              (select count(*)::int from caps.oficina o where o.programa_id = p.id and o.ativo) oficinas,
              (select count(*)::int from caps.atendimento a where a.programa_id = p.id and a.data >= date_trunc('month', current_date)) atendimentos_mes
         from caps.programa p where p.ativo order by p.nome`,
    );
  });
}
