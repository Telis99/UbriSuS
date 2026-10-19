import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idadeDetalhada, idadeTexto } from '../../compartilhado/validacao.js';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario, registrarRotina, temPermissao } from '../../seguranca/usuario.js';
import { gerarAlertas, parametro, registrarProvedorAlerta } from '../cadastros/alertas.js';
import { lancarProducao, preValidarProcedimento } from '../faturamento/producao.js';
import {
  atendimentoOuErro,
  conferirHorarioTrabalho,
  encaminhar,
  finalizar,
  framingham,
  prescrever,
  PRIORIDADE_RISCO,
  proximaSenha,
  registrarSinaisVitais,
  requisitarExames,
} from './servico.js';

registrarPermissao('recepcao', 'Recepção de pacientes e filas', 'AMB', ['executar']);
registrarPermissao('triagem', 'Acolhimento e classificação de risco', 'AMB', ['executar']);
registrarPermissao('atendimento_clinico', 'Registro de atendimento clínico (SOAP)', 'PEP', ['executar']);
registrarPermissao('prontuario', 'Visualização e impressão do prontuário', 'PEP', ['consultar', 'exportar']);
registrarPermissao('sigiloso', 'Registros sigilosos (quando liberados)', 'PEP', ['consultar']);

registrarGanchos('painel_chamada', {
  antesSalvar(d, { atual }) {
    if (!atual?.chave_acesso && !d.chave_acesso) d.chave_acesso = randomUUID();
  },
});

// Rastreamento de câncer de colo do útero e de mama (TR 1.2.10.22, 1.2.10.23).
registrarProvedorAlerta(async (p) => {
  if (p.sexo !== 'F' || !p.data_nascimento) return [];
  const idade = idadeDetalhada(p.data_nascimento).anos;
  const alertas = [];
  for (const [chave, codigo, nome] of [
    ['alerta.preventivo', '0203010019', 'exame preventivo (citopatológico)'],
    ['alerta.mamografia', '0204030188', 'mamografia de rastreamento'],
  ] as const) {
    const cfg = await parametro<{ idadeInicial: number; idadeFinal: number; intervaloMeses: number }>(chave, { idadeInicial: 25, idadeFinal: 64, intervaloMeses: 36 });
    if (idade < cfg.idadeInicial || idade > cfg.idadeFinal) continue;
    const ultimo = await consultarUm(
      `select max(d) d from (
         select pr.data d from fat.producao pr join cad.procedimento x on x.id = pr.procedimento_id where pr.paciente_id = $1 and x.codigo = $2
         union all select s.data from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id
           join cad.procedimento x on x.id = i.procedimento_id where s.paciente_id = $1 and x.codigo = $2 and i.situacao in ('REALIZADO','AVALIADO')
       ) t`,
      [p.id, codigo],
    );
    const limite = new Date();
    limite.setMonth(limite.getMonth() - cfg.intervaloMeses);
    if (!ultimo?.d || new Date(ultimo.d) < limite)
      alertas.push({ tipo: chave.split('.')[1], nivel: 'aviso' as const, mensagem: `Paciente com ${nome} em atraso${ultimo?.d ? ` (último em ${String(ultimo.d).slice(0, 10).split('-').reverse().join('/')})` : ''}.` });
  }
  return alertas;
});

const fmt = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');
const fmtData = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');

async function cabecalhoPaciente(pacienteId: number, unidadeId: number | null) {
  return consultarUm(
    `select p.id, p.nome, p.nome_social, p.data_nascimento::text nascimento, p.sexo, p.cns, p.cpf, p.nome_mae, p.nome_pai, p.foto_id, p.condicoes_saude, p.dum::text dum,
            m.nome municipio, coalesce((select numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id and pp.unidade_id = $2), p.prontuario) prontuario,
            (select coalesce(json_agg(json_build_object('substancia', a.substancia, 'gravidade', a.gravidade)), '[]') from cad.pessoa_alergia a where a.pessoa_id = p.id) alergias,
            exists (select 1 from amb.gestacao g where g.paciente_id = p.id and g.situacao = 'EM_ACOMPANHAMENTO') gestante
       from cad.pessoa p left join cad.municipio m on m.id = p.municipio_id where p.id = $1`,
    [pacienteId, unidadeId],
  );
}

export async function rotasAtendimento(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // Recepção
  // ---------------------------------------------------------------------------
  app.post('/api/recepcao', async (req, reply) => {
    const u = exigirPermissao(req, 'recepcao:executar');
    const b = z
      .object({
        pacienteId: z.number(),
        filaId: z.number(),
        unidadeId: z.number().optional(),
        agendamentoId: z.number().optional(),
        profissionalId: z.number().optional(),
        especialidadeId: z.number().optional(),
        salaId: z.number().optional(),
        localDestino: z.string().optional(),
        motivo: z.string().optional(),
        queixa: z.string().optional(),
        sintomas: z.string().optional(),
        preClassificacao: z.string().optional(),
        tipoUnidade: z.string().optional(),
      })
      .parse(req.body);
    const unidadeId = b.unidadeId ?? u.unidadeAtual;
    if (!unidadeId) throw new ErroHttp(422, 'Selecione a unidade de trabalho.');
    const bloqueios = (await gerarAlertas(b.pacienteId, { usuario: u, unidadeId })).filter((a) => a.bloqueante);
    if (bloqueios.length) throw new ErroHttp(422, bloqueios.map((a) => a.mensagem).join(' '), { alertas: bloqueios });
    const at = await transacao(contextoDe(req, 'recepcao'), async (c) => {
      const fila = (await c.query(`select * from amb.fila where id = $1`, [b.filaId])).rows[0];
      if (!fila) throw new ErroHttp(404, 'Fila não encontrada.');
      const aberto = (
        await c.query(`select id from amb.atendimento where paciente_id = $1 and unidade_id = $2 and situacao in ('AGUARDANDO_TRIAGEM','AGUARDANDO','CHAMADO','EM_ATENDIMENTO') and entrada_em::date = current_date`, [b.pacienteId, unidadeId])
      ).rows[0];
      if (aberto) throw new ErroHttp(409, 'O paciente já está em uma fila de atendimento desta unidade.', { atendimentoId: aberto.id });
      const senha = await proximaSenha(c, unidadeId, fila.prefixo_senha ?? 'A');
      const ag = b.agendamentoId ? (await c.query(`select * from age.agendamento where id = $1`, [b.agendamentoId])).rows[0] : null;
      const tipoUnidade = b.tipoUnidade ?? (fila.tipo === 'URGENCIA' ? 'UPA' : fila.tipo === 'ODONTOLOGIA' ? 'ODONTOLOGIA' : 'AMBULATORIO');
      const r = (
        await c.query(
          `insert into amb.atendimento (paciente_id, unidade_id, fila_id, agendamento_id, senha, entrada_em, situacao, profissional_id, especialidade_id, sala_id,
                                        local_destino, recepcionista_id, motivo, queixa, sintomas, pre_classificacao, prioridade, tipo_unidade, tipo_atendimento_sia)
           values ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
          [
            b.pacienteId,
            unidadeId,
            fila.id,
            b.agendamentoId ?? null,
            senha,
            fila.exige_triagem ? 'AGUARDANDO_TRIAGEM' : 'AGUARDANDO',
            b.profissionalId ?? ag?.profissional_id ?? null,
            b.especialidadeId ?? ag?.especialidade_id ?? null,
            b.salaId ?? null,
            b.localDestino ?? null,
            u.id,
            b.motivo ?? null,
            b.queixa ?? null,
            b.sintomas ?? null,
            b.preClassificacao ?? null,
            PRIORIDADE_RISCO[b.preClassificacao ?? ''] ?? 9,
            tipoUnidade,
            ag ? '01' : '02',
          ],
        )
      ).rows[0];
      if (ag) await c.query(`update age.agendamento set situacao = 'PRESENTE' where id = $1`, [ag.id]);
      return r;
    });
    return reply.status(201).send(at);
  });

  // Visão de todas as filas da unidade em tempo real (TR 1.2.15.26, 1.2.42.1.19).
  app.get('/api/filas/visao', async (req) => {
    const u = exigirUsuario(req);
    const unidadeId = Number((req.query as any).unidadeId ?? u.unidadeAtual);
    return consultar(
      `select f.id, f.nome, f.tipo, f.prefixo_senha,
              count(a.id) filter (where a.situacao in ('AGUARDANDO_TRIAGEM','AGUARDANDO','CHAMADO'))::int aguardando,
              count(a.id) filter (where a.situacao = 'AGUARDANDO_TRIAGEM')::int aguardando_triagem,
              count(a.id) filter (where a.situacao in ('EM_ATENDIMENTO'))::int em_atendimento,
              count(a.id) filter (where a.situacao = 'EM_OBSERVACAO')::int em_observacao,
              count(a.id) filter (where a.situacao = 'FINALIZADO')::int atendidos,
              round(avg(extract(epoch from (coalesce(a.inicio_em, now()) - a.entrada_em)) / 60) filter (where a.situacao <> 'CANCELADO'))::int espera_media_min
         from amb.fila f left join amb.atendimento a on a.fila_id = f.id and a.entrada_em::date = current_date
        where f.unidade_id = $1 and f.ativo group by f.id order by f.nome`,
      [unidadeId],
    );
  });

  // Lista de pacientes da fila: prioridade por risco, idade < 2 e > 60 destacadas, filtros por etapa (TR 1.2.16, 1.2.17, 1.2.31.3 a 1.2.31.15).
  app.get('/api/atendimentos/fila', async (req) => {
    const u = exigirUsuario(req);
    const q = req.query as any;
    const unidadeId = Number(q.unidadeId ?? u.unidadeAtual);
    const filtros: Record<string, string> = {
      aguardando: `a.situacao in ('AGUARDANDO_TRIAGEM','AGUARDANDO','CHAMADO','EM_ATENDIMENTO')`,
      nao_triados: `a.situacao = 'AGUARDANDO_TRIAGEM'`,
      triados: `a.triagem_em is not null`,
      nao_atendidos: `a.situacao in ('AGUARDANDO','CHAMADO','AGUARDANDO_TRIAGEM')`,
      atendidos: `a.situacao = 'FINALIZADO'`,
      observacao: `a.situacao = 'EM_OBSERVACAO'`,
      encaminhados: `exists (select 1 from amb.encaminhamento e where e.atendimento_id = a.id)`,
      agendados: `a.agendamento_id is not null`,
      nao_realizados: `a.situacao in ('NAO_ATENDIDO','EVADIDO')`,
      todos: 'true',
    };
    const cond = filtros[q.filtro ?? 'aguardando'] ?? filtros.aguardando;
    const fila = await consultarUm(`select ordenacao, ordenacao_fixa from amb.fila where id = $1`, [q.filaId ? Number(q.filaId) : 0]);
    const ordemPedida = fila?.ordenacao_fixa ? (fila.ordenacao === 'CHEGADA' ? 'data' : 'risco') : (q.ordem ?? (fila?.ordenacao === 'CHEGADA' ? 'data' : 'risco'));
    const ordem: Record<string, string> = {
      risco: `coalesce(a.prioridade, 9), a.entrada_em`,
      data: `a.entrada_em`,
      hora: `coalesce(ag.hora, a.entrada_em::time), a.entrada_em`,
      idade: `p.data_nascimento`,
    };
    const linhas = await consultar(
      `select a.id, a.senha, a.situacao, a.entrada_em, a.triagem_em, a.inicio_em, a.fim_em, a.classificacao_risco, a.pre_classificacao, a.motivo, a.queixa,
              a.fila_id, f.nome fila, a.profissional_id, pr.nome profissional, e.nome especialidade, a.local_destino, ag.hora::text hora_agendada,
              p.id paciente_id, p.nome, p.nome_social, p.data_nascimento::text nascimento, p.sexo, p.foto_id, p.condicoes_saude,
              extract(year from age(p.data_nascimento))::int idade,
              (age(p.data_nascimento) < interval '2 years' or age(p.data_nascimento) > interval '60 years') destaque,
              exists (select 1 from amb.gestacao g where g.paciente_id = p.id and g.situacao = 'EM_ACOMPANHAMENTO') gestante,
              round(extract(epoch from (now() - a.entrada_em)) / 60)::int espera_min
         from amb.atendimento a join cad.pessoa p on p.id = a.paciente_id left join amb.fila f on f.id = a.fila_id
         left join cad.profissional pr on pr.id = a.profissional_id left join cad.especialidade e on e.id = a.especialidade_id
         left join age.agendamento ag on ag.id = a.agendamento_id
        where a.unidade_id = $1 and (a.entrada_em::date = current_date or a.situacao in ('EM_OBSERVACAO')) and ${cond}
          and ($2::bigint is null or a.fila_id = $2) and ($3::text is null or cad.fn_normalizar(p.nome) like '%' || cad.fn_normalizar($3) || '%')
          and ($4::boolean is not true or a.profissional_id is null or a.profissional_id = $5)
        order by ${ordem[ordemPedida] ?? ordem.risco} limit 300`,
      [unidadeId, q.filaId ? Number(q.filaId) : null, q.nome || null, q.meus === 'true', u.profissionalId],
    );
    return { ordem: ordemPedida, ordemFixa: !!fila?.ordenacao_fixa, linhas };
  });

  // Chamada no painel (TR 1.2.17.6, 1.2.31.10, 1.2.42.2.7).
  app.post('/api/atendimentos/:id/chamar', async (req) => {
    const u = exigirUsuario(req);
    const b = z.object({ local: z.string().min(1), salaId: z.number().optional(), corFaixa: z.string().optional(), tipo: z.string().default('CONSULTORIO') }).parse(req.body);
    const id = Number((req.params as any).id);
    return transacao(contextoDe(req, 'chamada'), async (c) => {
      const a = (await c.query(`select a.*, p.nome, p.nome_social from amb.atendimento a join cad.pessoa p on p.id = a.paciente_id where a.id = $1`, [id])).rows[0];
      if (!a) throw new ErroHttp(404, 'Atendimento não encontrado.');
      const prof = u.profissionalId ? (await c.query(`select nome from cad.profissional where id = $1`, [u.profissionalId])).rows[0]?.nome : u.nome;
      const ch = (
        await c.query(
          `insert into amb.chamada (unidade_id, atendimento_id, fila_id, tipo, nome, senha, local, profissional, cor_faixa, chamado_em) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) returning *`,
          [a.unidade_id, a.id, a.fila_id, b.tipo, a.nome_social ?? a.nome, a.senha, b.local, prof, b.corFaixa ?? null],
        )
      ).rows[0];
      if (['AGUARDANDO', 'AGUARDANDO_TRIAGEM'].includes(a.situacao)) await c.query(`update amb.atendimento set situacao = 'CHAMADO', local_destino = $2 where id = $1`, [id, b.local]);
      return ch;
    });
  });

  // ---------------------------------------------------------------------------
  // Acolhimento e triagem
  // ---------------------------------------------------------------------------
  app.post('/api/atendimentos/:id/triagem', async (req) => {
    const u = exigirPermissao(req, 'triagem:executar');
    conferirHorarioTrabalho(u);
    const id = Number((req.params as any).id);
    const b = z
      .object({
        sinais: z.record(z.any()).default({}),
        classificacaoRisco: z.string().optional(),
        queixa: z.string().optional(),
        sintomas: z.string().optional(),
        avaliacao: z.string().optional(),
        encaminharFilaId: z.number().optional(),
        profissionalId: z.number().optional(),
        especialidadeId: z.number().optional(),
        localDestino: z.string().optional(),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'triagem'), async (c) => {
      const at = (await c.query(`select * from amb.atendimento where id = $1 for update`, [id])).rows[0];
      if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
      const sv = await registrarSinaisVitais(c, at, b.sinais, u.profissionalId);
      await c.query(
        `update amb.atendimento set triagem_em = coalesce(triagem_em, now()), profissional_triagem_id = coalesce(profissional_triagem_id, $2),
                classificacao_risco = coalesce($3, classificacao_risco), prioridade = coalesce($4, prioridade), queixa = coalesce($5, queixa),
                sintomas = coalesce($6, sintomas), avaliacao_triagem = coalesce($7, avaliacao_triagem), situacao = 'AGUARDANDO',
                fila_id = coalesce($8, fila_id), profissional_id = coalesce($9, profissional_id), especialidade_id = coalesce($10, especialidade_id),
                local_destino = coalesce($11, local_destino)
          where id = $1`,
        [id, u.profissionalId, b.classificacaoRisco ?? null, b.classificacaoRisco ? PRIORIDADE_RISCO[b.classificacaoRisco] : null, b.queixa ?? null, b.sintomas ?? null, b.avaliacao ?? null, b.encaminharFilaId ?? null, b.profissionalId ?? null, b.especialidadeId ?? null, b.localDestino ?? null],
      );
      // Produção do acolhimento com classificação de risco (TR 1.2.16.26).
      if (!at.triagem_em && b.classificacaoRisco)
        await lancarProducao(c, { data: new Date(), unidadeId: at.unidade_id, profissionalId: u.profissionalId, pacienteId: at.paciente_id, procedimentoCodigo: '0301060118', origem: 'ACOLHIMENTO', referencia: `atendimento:${id}` });
      return { ok: true, sinaisVitais: sv };
    });
  });

  // Registro avulso de sinais vitais (enfermagem, observação, pré-consulta).
  app.post('/api/atendimentos/:id/sinais-vitais', async (req) => {
    const u = exigirPermissao(req, 'triagem:executar');
    const at = await atendimentoOuErro(Number((req.params as any).id));
    return transacao(contextoDe(req, 'sinais-vitais'), (c) => registrarSinaisVitais(c, at, (req.body as any) ?? {}, u.profissionalId));
  });

  app.post('/api/atendimentos/:id/nao-atendido', async (req) => {
    exigirUsuario(req);
    const { motivo, evasao } = z.object({ motivo: z.string().min(3), evasao: z.boolean().default(false) }).parse(req.body);
    await transacao(contextoDe(req, 'nao-atendido'), async (c) => {
      const at = (await c.query(`update amb.atendimento set situacao = $2, motivo_nao_atendimento = $3, fim_em = now() where id = $1 returning agendamento_id`, [(req.params as any).id, evasao ? 'EVADIDO' : 'NAO_ATENDIDO', motivo])).rows[0];
      if (at?.agendamento_id) await c.query(`update age.agendamento set situacao = 'NAO_ATENDIDO', motivo = $2 where id = $1`, [at.agendamento_id, motivo]);
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Atendimento clínico
  // ---------------------------------------------------------------------------
  app.post('/api/atendimentos/:id/iniciar', async (req) => {
    const u = exigirPermissao(req, 'atendimento_clinico:executar');
    conferirHorarioTrabalho(u);
    const id = Number((req.params as any).id);
    await transacao(contextoDe(req, 'atendimento:iniciar'), (c) =>
      c.query(
        `update amb.atendimento set situacao = case when situacao = 'EM_OBSERVACAO' then situacao else 'EM_ATENDIMENTO' end,
                inicio_em = coalesce(inicio_em, now()), profissional_id = coalesce(profissional_id, $2) where id = $1`,
        [id, u.profissionalId],
      ),
    );
    return { ok: true };
  });

  // Dados completos para a tela de atendimento.
  app.get('/api/atendimentos/:id/completo', async (req) => {
    const u = exigirUsuario(req);
    const id = Number((req.params as any).id);
    const at = await consultarUm(
      `select a.*, f.nome fila, pr.nome profissional, e.nome especialidade, u.nome unidade, c.codigo cid_codigo, c.nome cid_nome, ci.codigo ciap_codigo, ci.nome ciap_nome,
              pt.nome profissional_triagem
         from amb.atendimento a left join amb.fila f on f.id = a.fila_id left join cad.profissional pr on pr.id = a.profissional_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.unidade u on u.id = a.unidade_id
         left join cad.cid c on c.id = a.cid_id left join cad.ciap ci on ci.id = a.ciap_id left join cad.profissional pt on pt.id = a.profissional_triagem_id
        where a.id = $1`,
      [id],
    );
    if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
    const paciente = await cabecalhoPaciente(at.paciente_id, at.unidade_id);
    const sinais = await consultar(`select * from amb.sinais_vitais where atendimento_id = $1 order by data_hora desc`, [id]);
    const ultimo = sinais[0] ?? (await consultarUm(`select * from amb.sinais_vitais where paciente_id = $1 order by data_hora desc limit 1`, [at.paciente_id]));
    const condicoes: string[] = paciente?.condicoes_saude ?? [];
    let risco = null;
    if (ultimo?.pa_sistolica && paciente?.nascimento) {
      const idade = idadeDetalhada(paciente.nascimento).anos;
      if (idade >= 30 && idade <= 74)
        risco = framingham({
          sexo: paciente.sexo,
          idade,
          pas: ultimo.pa_sistolica,
          tratado: condicoes.includes('hipertensao'),
          fumante: ultimo.fumante ?? condicoes.includes('fumante'),
          diabetico: condicoes.includes('diabetes'),
          colesterol: ultimo.colesterol_total,
          hdl: ultimo.hdl,
          imc: ultimo.imc,
        });
    }
    const [prescricoes, exames, encaminhamentos, documentos, observacoes, administracoes] = await Promise.all([
      consultar(
        `select r.*, (select json_agg(i order by i.id) from amb.prescricao_item i where i.prescricao_id = r.id) itens from amb.prescricao r where r.atendimento_id = $1 order by r.id`,
        [id],
      ),
      consultar(
        `select s.*, (select json_agg(json_build_object('id', i.id, 'procedimento', pr.codigo || ' - ' || pr.nome, 'material', i.material, 'situacao', i.situacao, 'resultado', i.resultado_texto, 'arquivo', i.resultado_arquivo_id) order by i.id)
                      from amb.solicitacao_exame_item i join cad.procedimento pr on pr.id = i.procedimento_id where i.solicitacao_id = s.id) itens
           from amb.solicitacao_exame s where s.atendimento_id = $1 order by s.id`,
        [id],
      ),
      consultar(`select e.*, es.nome especialidade from amb.encaminhamento e left join cad.especialidade es on es.id = e.especialidade_id where e.atendimento_id = $1`, [id]),
      consultar(`select * from amb.documento_clinico where atendimento_id = $1 order by id`, [id]),
      consultar(`select o.*, p.nome profissional from amb.registro_observacao o left join cad.profissional p on p.id = o.profissional_id where o.atendimento_id = $1 order by o.data_hora desc`, [id]),
      consultar(`select m.*, p.nome profissional from amb.administracao_medicamento m left join cad.profissional p on p.id = m.profissional_id where m.atendimento_id = $1 order by m.data_hora desc`, [id]),
    ]);
    const alertas = await gerarAlertas(at.paciente_id, { usuario: u, unidadeId: at.unidade_id, rotina: 'atendimento' });
    await registrarRotina(req, 'prontuario', 'atendimento', { atendimento: id, paciente: at.paciente_id });
    return {
      atendimento: at,
      paciente: { ...paciente, idade: paciente?.nascimento ? idadeDetalhada(paciente.nascimento) : null },
      sinais,
      ultimoSinais: ultimo,
      framingham: risco,
      prescricoes,
      exames,
      encaminhamentos,
      documentos,
      observacoes,
      administracoes,
      alertas,
    };
  });

  // Registro SOAP com gravação parcial (TR 1.2.32.30).
  app.put('/api/atendimentos/:id/soap', async (req) => {
    exigirPermissao(req, 'atendimento_clinico:executar');
    const b = z
      .object({
        subjetivo: z.string().nullish(),
        objetivo: z.string().nullish(),
        avaliacao: z.string().nullish(),
        plano: z.string().nullish(),
        cidId: z.number().nullish(),
        ciapId: z.number().nullish(),
        cidsSecundarios: z.array(z.number()).nullish(),
        carater: z.string().nullish(),
        tipoAtendimentoSia: z.string().nullish(),
        epidemiaSituacao: z.string().nullish(),
        epidemiaId: z.number().nullish(),
        epidemiaEscore: z.number().nullish(),
        nasfDesfecho: z.array(z.string()).nullish(),
        odontograma: z.any().optional(),
        saudeBucal: z.array(z.string()).nullish(),
        materialOdonto: z.any().optional(),
      })
      .parse(req.body);
    const mapa: Record<string, string> = {
      subjetivo: 'subjetivo',
      objetivo: 'objetivo',
      avaliacao: 'avaliacao',
      plano: 'plano',
      cidId: 'cid_id',
      ciapId: 'ciap_id',
      cidsSecundarios: 'cids_secundarios',
      carater: 'carater',
      tipoAtendimentoSia: 'tipo_atendimento_sia',
      epidemiaSituacao: 'epidemia_situacao',
      epidemiaId: 'epidemia_id',
      epidemiaEscore: 'epidemia_escore',
      nasfDesfecho: 'nasf_desfecho',
      odontograma: 'odontograma',
      saudeBucal: 'saude_bucal',
      materialOdonto: 'material_odonto',
    };
    const sets: string[] = [];
    const vals: unknown[] = [Number((req.params as any).id)];
    for (const [k, col] of Object.entries(mapa)) {
      if ((b as any)[k] === undefined) continue;
      let v = (b as any)[k];
      if (['cids_secundarios', 'odontograma', 'material_odonto'].includes(col) && v != null) v = JSON.stringify(v);
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    }
    if (sets.length) await transacao(contextoDe(req, 'atendimento:soap'), (c) => c.query(`update amb.atendimento set ${sets.join(', ')} where id = $1`, vals));
    return { ok: true };
  });

  app.post('/api/atendimentos/:id/prescricoes', async (req) => {
    const u = exigirPermissao(req, 'atendimento_clinico:executar');
    const at = await atendimentoOuErro(Number((req.params as any).id));
    const b = z
      .object({
        itens: z.array(
          z.object({
            produtoId: z.number().nullish(),
            descricao: z.string().optional(),
            quantidade: z.number().optional(),
            posologia: z.string().optional(),
            via: z.string().optional(),
            dose: z.string().optional(),
            intervaloHoras: z.number().optional(),
            duracaoDias: z.number().optional(),
            usoContinuo: z.boolean().optional(),
            tipoReceita: z.string().optional(),
          }),
        ),
        usoInterno: z.boolean().optional(),
        orientacoes: z.string().optional(),
        confirmarAlergia: z.boolean().optional(),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'prescricao'), (c) => prescrever(c, at, u.profissionalId, b.itens, b));
  });

  // Renovação de receita de uso contínuo a partir do histórico (TR 1.2.32.52).
  app.get('/api/pacientes/:id/uso-continuo', async (req) => {
    exigirUsuario(req);
    return consultar(
      `select distinct on (coalesce(i.produto_id::text, i.descricao)) i.*, r.data::text data_receita, r.tipo_receita
         from amb.prescricao_item i join amb.prescricao r on r.id = i.prescricao_id
        where r.paciente_id = $1 and i.uso_continuo and r.situacao <> 'CANCELADA'
        order by coalesce(i.produto_id::text, i.descricao), r.data desc`,
      [Number((req.params as any).id)],
    );
  });

  app.post('/api/atendimentos/:id/exames', async (req) => {
    const u = exigirPermissao(req, 'atendimento_clinico:executar');
    const at = await atendimentoOuErro(Number((req.params as any).id));
    const b = z
      .object({
        itens: z.array(z.object({ procedimentoId: z.number(), material: z.string().optional(), estrutura: z.string().optional(), quantidade: z.number().optional() })),
        dadosClinicos: z.string().optional(),
        justificativa: z.string().optional(),
        prioridade: z.string().optional(),
        usoInterno: z.boolean().optional(),
        confirmarAvisos: z.boolean().optional(),
      })
      .parse(req.body);
    // A regulação exige peso e altura do paciente na requisição (TR 1.2.43.1.15).
    if (await parametro<boolean>('exames.exigir_peso_altura', false)) {
      const sv = await consultarUm(`select peso, altura from amb.sinais_vitais where paciente_id = $1 and peso is not null and altura is not null order by data_hora desc limit 1`, [at.paciente_id]);
      if (!sv) throw new ErroHttp(422, 'Informe peso e altura do paciente antes de concluir a requisição.');
    }
    return transacao(contextoDe(req, 'exames'), (c) => requisitarExames(c, at, u.profissionalId, b.itens, b));
  });

  app.post('/api/solicitacoes-exame/:id/cancelar', async (req) => {
    exigirUsuario(req);
    const { justificativa } = z.object({ justificativa: z.string().min(3) }).parse(req.body);
    await transacao(contextoDe(req, 'exames:cancelar'), async (c) => {
      await c.query(`update amb.solicitacao_exame set situacao = 'CANCELADO', motivo_cancelamento = $2 where id = $1`, [(req.params as any).id, justificativa]);
      await c.query(`update amb.solicitacao_exame_item set situacao = 'CANCELADO' where solicitacao_id = $1 and situacao = 'REQUISITADO'`, [(req.params as any).id]);
      await c.query(`update age.lista_espera set situacao = 'CANCELADO', motivo = $2 where solicitacao_item_id in (select id from amb.solicitacao_exame_item where solicitacao_id = $1) and situacao = 'AGUARDANDO'`, [(req.params as any).id, justificativa]);
    });
    return { ok: true };
  });

  // Exames avaliados pelo profissional (indicador e-SUS: solicitados x avaliados) (TR 1.2.32.60).
  app.post('/api/solicitacoes-exame/itens/:id/avaliado', async (req) => {
    exigirUsuario(req);
    await transacao(contextoDe(req, 'exames:avaliado'), (c) => c.query(`update amb.solicitacao_exame_item set situacao = 'AVALIADO' where id = $1`, [(req.params as any).id]));
    return { ok: true };
  });

  app.post('/api/atendimentos/:id/encaminhamentos', async (req) => {
    const u = exigirPermissao(req, 'atendimento_clinico:executar');
    const at = await atendimentoOuErro(Number((req.params as any).id));
    return transacao(contextoDe(req, 'encaminhamento'), (c) => encaminhar(c, at, u.profissionalId, (req.body as any) ?? {}));
  });

  app.post('/api/atendimentos/:id/finalizar', async (req) => {
    const u = exigirPermissao(req, 'atendimento_clinico:executar');
    conferirHorarioTrabalho(u);
    const b = z.object({ desfecho: z.string(), procedimentos: z.array(z.object({ procedimentoId: z.number(), quantidade: z.number().optional() })).optional(), retornoDias: z.number().optional() }).parse(req.body);
    return transacao(contextoDe(req, 'atendimento:finalizar'), (c) => finalizar(c, Number((req.params as any).id), b, u));
  });

  app.get('/api/procedimentos/:id/validar', async (req) => {
    const u = exigirUsuario(req);
    const q = req.query as any;
    return preValidarProcedimento(Number((req.params as any).id), q.pacienteId ? Number(q.pacienteId) : null, u.profissionalId, u.unidadeAtual);
  });

  // ---------------------------------------------------------------------------
  // Prontuário do paciente (TR 1.2.16.25, 1.2.6.31 a 1.2.6.60)
  // ---------------------------------------------------------------------------
  app.get('/api/pacientes/:id/prontuario', async (req) => {
    const u = exigirPermissao(req, 'prontuario:consultar');
    const id = Number((req.params as any).id);
    const restrito = !temPermissao(u, 'atendimento_clinico:executar');
    const atendimentos = await consultar(
      `select a.id, a.entrada_em, a.triagem_em, a.inicio_em, a.fim_em, a.situacao, a.tipo_unidade, a.classificacao_risco, a.queixa, a.sintomas, a.motivo, a.desfecho,
              ${restrito ? 'null subjetivo, null objetivo, null avaliacao, null plano' : 'a.subjetivo, a.objetivo, a.avaliacao, a.plano'},
              u.nome unidade, pr.nome profissional, pr.conselho || ' ' || coalesce(pr.registro_conselho, '') registro, e.nome especialidade,
              pt.nome profissional_triagem, pt.conselho || ' ' || coalesce(pt.registro_conselho, '') registro_triagem,
              c.codigo || ' - ' || c.nome cid, ci.codigo || ' - ' || ci.nome ciap,
              (select row_to_json(s) from amb.sinais_vitais s where s.atendimento_id = a.id order by s.data_hora limit 1) triagem,
              (select json_agg(pc.codigo || ' - ' || pc.nome) from fat.producao fp join cad.procedimento pc on pc.id = fp.procedimento_id where fp.referencia = 'atendimento:' || a.id) procedimentos,
              (select json_agg(pc.nome) from amb.solicitacao_exame_item si join amb.solicitacao_exame s on s.id = si.solicitacao_id join cad.procedimento pc on pc.id = si.procedimento_id where s.atendimento_id = a.id) exames,
              (select json_agg(coalesce(es.nome, 'Encaminhamento')) from amb.encaminhamento en left join cad.especialidade es on es.id = en.especialidade_id where en.atendimento_id = a.id) encaminhamentos,
              (select json_agg(i.descricao || coalesce(' - ' || i.posologia, '')) from amb.prescricao_item i join amb.prescricao r on r.id = i.prescricao_id where r.atendimento_id = a.id) prescricoes,
              (select json_agg(d.tipo) from amb.documento_clinico d where d.atendimento_id = a.id) documentos
         from amb.atendimento a join cad.unidade u on u.id = a.unidade_id left join cad.profissional pr on pr.id = a.profissional_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.profissional pt on pt.id = a.profissional_triagem_id
         left join cad.cid c on c.id = a.cid_id left join cad.ciap ci on ci.id = a.ciap_id
        where a.paciente_id = $1 order by a.entrada_em desc limit 200`,
      [id],
    );
    await registrarRotina(req, 'prontuario', 'consultar', { paciente: id });
    return { atendimentos };
  });

  // Histórico consolidado do paciente para as abas de visualização (TR 1.2.6.31 a 1.2.6.59, 1.2.15.6).
  app.get('/api/pacientes/:id/historico/:secao', async (req) => {
    exigirPermissao(req, 'paciente:consultar');
    const id = Number((req.params as any).id);
    const secao = (req.params as any).secao as string;
    const sql: Record<string, string> = {
      medicamentos: `select d.data_hora, u.nome unidade, pr.nome || coalesce(' ' || pr.concentracao, '') produto, di.quantidade, d.prescritor, d.tipo_receita, di.termino_previsto
                       from far.dispensacao_item di join far.dispensacao d on d.id = di.dispensacao_id join far.produto pr on pr.id = di.produto_id
                       join cad.unidade u on u.id = d.unidade_id where d.paciente_id = $1 and d.situacao = 'EFETIVADA' order by d.data_hora desc limit 300`,
      receitas: `select r.data, r.numero, r.tipo_receita, r.situacao, p.nome profissional, i.descricao, i.quantidade, i.posologia, i.uso_continuo
                   from amb.prescricao r join amb.prescricao_item i on i.prescricao_id = r.id left join cad.profissional p on p.id = r.profissional_id
                  where r.paciente_id = $1 order by r.data desc limit 300`,
      exames: `select s.data, s.numero, pr.codigo || ' - ' || pr.nome exame, i.situacao, i.resultado_liberado_em, i.resultado_texto, i.resultado_arquivo_id, p.nome solicitante
                 from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id join cad.procedimento pr on pr.id = i.procedimento_id
                 left join cad.profissional p on p.id = s.profissional_id where s.paciente_id = $1 order by s.data desc limit 300`,
      agendamentos: `select a.data, to_char(a.hora,'HH24:MI') hora, a.tipo, a.situacao, a.motivo, a.justificativa_falta, u.nome unidade, e.nome especialidade, p.nome profissional
                       from age.agendamento a left join cad.unidade u on u.id = a.unidade_id left join cad.especialidade e on e.id = a.especialidade_id
                       left join cad.profissional p on p.id = a.profissional_id where a.paciente_id = $1 order by a.data desc limit 300`,
      lista_espera: `select l.incluido_em, l.situacao, l.prioridade, e.nome especialidade, pr.nome procedimento, l.origem, l.motivo
                       from age.lista_espera l left join cad.especialidade e on e.id = l.especialidade_id left join cad.procedimento pr on pr.id = l.procedimento_id
                      where l.paciente_id = $1 order by l.incluido_em desc`,
      procedimentos: `select fp.data, pc.codigo || ' - ' || pc.nome procedimento, fp.quantidade, u.nome unidade, p.nome profissional, fp.origem
                        from fat.producao fp join cad.procedimento pc on pc.id = fp.procedimento_id join cad.unidade u on u.id = fp.unidade_id
                        left join cad.profissional p on p.id = fp.profissional_id where fp.paciente_id = $1 order by fp.data desc limit 300`,
      vacinas: `select v.data, i.sigla || ' - ' || i.nome imunobiologico, d.sigla dose, v.tipo, coalesce(l.lote, v.lote_texto) lote, u.nome unidade
                  from imu.vacinacao v join imu.imunobiologico i on i.id = v.imunobiologico_id left join imu.dose d on d.id = v.dose_id
                  left join far.estoque_lote l on l.id = v.lote_id left join cad.unidade u on u.id = v.unidade_id
                 where v.paciente_id = $1 and v.tipo in ('APLICACAO','RESGATE') order by v.data desc`,
      doencas: `select a.entrada_em data, c.codigo || ' - ' || c.nome cid, p.nome profissional from amb.atendimento a join cad.cid c on c.id = a.cid_id
                  left join cad.profissional p on p.id = a.profissional_id where a.paciente_id = $1 order by a.entrada_em desc`,
      agravos: `select n.data_hora, c.codigo || ' - ' || c.nome agravo, n.situacao from amb.notificacao_agravo n join cad.cid c on c.id = n.cid_id where n.paciente_id = $1 order by n.data_hora desc`,
      familia: `select p.id, p.nome, p.parentesco, p.data_nascimento, p.situacao from cad.pessoa p
                 where p.familia_id = (select familia_id from cad.pessoa where id = $1) and p.familia_id is not null order by p.data_nascimento`,
      contatos: `select data_hora, setor, meio, assunto, descricao from cad.pessoa_contato where pessoa_id = $1 order by data_hora desc`,
      avisos: `select criado_em, texto, avisado, avisado_em, ativo from cad.pessoa_aviso where pessoa_id = $1 order by criado_em desc`,
      aih: `select * from aih.laudo where paciente_id = $1 order by id desc`,
      tfd: `select l.numero, l.data_abertura, pr.nome procedimento, l.situacao, l.situacao_tratamento, ld.nome local_tratamento
              from tfd.laudo l left join cad.procedimento pr on pr.id = l.procedimento_id left join tra.local_destino ld on ld.id = l.local_tratamento_id
             where l.paciente_id = $1 order by l.id desc`,
      transporte: `select v.data_saida, r.nome rota, vp.situacao, vp.local_destino from tra.viagem_passageiro vp join tra.viagem v on v.id = vp.viagem_id
                     left join tra.rota r on r.id = v.rota_id where vp.paciente_id = $1 order by v.data_saida desc`,
    };
    if (!sql[secao]) throw new ErroHttp(404, 'Seção inexistente.');
    try {
      return await consultar(sql[secao], [id]);
    } catch (e: any) {
      if (e.code === '42P01') return [];
      throw e;
    }
  });

  // Evolução das medidas para os gráficos (TR 1.2.6.58, 1.2.17.25, 1.2.32.22).
  app.get('/api/pacientes/:id/evolucao', async (req) => {
    exigirPermissao(req, 'paciente:consultar');
    return consultar(`select * from amb.sinais_vitais where paciente_id = $1 order by data_hora`, [Number((req.params as any).id)]);
  });

  // Registros sigilosos: visíveis ao autor e aos profissionais liberados (TR 1.2.32.33, 1.2.32.34).
  app.get('/api/pacientes/:id/sigilosos', async (req) => {
    const u = exigirUsuario(req);
    return consultar(
      `select s.id, s.data_hora, s.texto, s.autor_id, p.nome autor, s.liberado_para from amb.registro_sigiloso s left join cad.profissional p on p.id = s.autor_id
        where s.paciente_id = $1 and (s.autor_id = $2 or s.liberado_para @> to_jsonb($2::bigint) or $3) order by s.data_hora desc`,
      [Number((req.params as any).id), u.profissionalId ?? -1, temPermissao(u, 'sigiloso:consultar') && u.administrador],
    );
  });

  app.post('/api/pacientes/:id/sigilosos', async (req) => {
    const u = exigirPermissao(req, 'atendimento_clinico:executar');
    const { texto, atendimentoId } = z.object({ texto: z.string().min(1), atendimentoId: z.number().optional() }).parse(req.body);
    return transacao(contextoDe(req, 'sigiloso'), async (c) =>
      (
        await c.query(`insert into amb.registro_sigiloso (paciente_id, atendimento_id, autor_id, data_hora, texto, liberado_para) values ($1,$2,$3,now(),$4,'[]') returning id`, [
          Number((req.params as any).id),
          atendimentoId ?? null,
          u.profissionalId,
          texto,
        ])
      ).rows[0],
    );
  });

  app.post('/api/sigilosos/:id/liberar', async (req) => {
    const u = exigirUsuario(req);
    const { profissionalId } = z.object({ profissionalId: z.number() }).parse(req.body);
    const r = await consultarUm(`select autor_id from amb.registro_sigiloso where id = $1`, [(req.params as any).id]);
    if (!r || r.autor_id !== u.profissionalId) throw new ErroHttp(403, 'Somente o profissional autor pode liberar o acesso.');
    await transacao(contextoDe(req, 'sigiloso:liberar'), (c) =>
      c.query(`update amb.registro_sigiloso set liberado_para = coalesce(liberado_para, '[]') || to_jsonb($2::bigint) where id = $1`, [(req.params as any).id, profissionalId]),
    );
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Painel de chamadas (acesso pelo televisor da unidade com chave do painel)
  // ---------------------------------------------------------------------------
  app.get('/api/publico/painel/:chave', async (req) => {
    const p = await consultarUm(`select * from amb.painel_chamada where chave_acesso = $1 and ativo`, [(req.params as any).chave]);
    if (!p) throw new ErroHttp(404, 'Painel não encontrado.');
    const q = req.query as any;
    const desde = q.desde ? Number(q.desde) : null;
    const tipos: string[] = p.tipos_chamada ?? [];
    const chamadas = await consultar(
      `select c.id, c.nome, c.senha, c.local, c.profissional, c.cor_faixa, c.chamado_em, c.tipo, f.ordenacao from amb.chamada c left join amb.fila f on f.id = c.fila_id
        where c.unidade_id = $1 and c.chamado_em::date = current_date and ($2::text[] is null or cardinality($2::text[]) = 0 or c.tipo = any($2))
          and ($3::bigint is null or c.id > $3) and ($4::boolean or c.chamado_em >= now() - interval '1 minute' or $3 is not null)
        order by c.id desc limit 20`,
      [p.unidade_id, tipos, desde, p.mostrar_anteriores],
    );
    const est = await consultarUm(
      `select count(*) filter (where situacao in ('AGUARDANDO','AGUARDANDO_TRIAGEM','CHAMADO'))::int aguardando, count(*) filter (where situacao = 'FINALIZADO')::int atendidos,
              round(avg(extract(epoch from (coalesce(inicio_em, now()) - entrada_em)) / 60))::int tempo_medio
         from amb.atendimento where unidade_id = $1 and entrada_em::date = current_date`,
      [p.unidade_id],
    );
    const unidade = await consultarUm(`select nome from cad.unidade where id = $1`, [p.unidade_id]);
    return {
      painel: { ...p, chave_acesso: undefined, unidade: unidade?.nome },
      chamadas: chamadas.map((c) => ({
        ...c,
        nome: c.ordenacao === 'CHEGADA' && !p.exibir_nome_senha ? null : c.nome,
        senha: c.ordenacao !== 'CHEGADA' && !p.exibir_senha_nome ? null : c.senha,
        profissional: p.exibir_profissional ? c.profissional : null,
      })),
      estatisticas: est,
    };
  });

  // ---------------------------------------------------------------------------
  // Documentos impressos
  // ---------------------------------------------------------------------------
  app.get('/api/documentos/receita/:id', async (req, reply) => {
    const u = exigirUsuario(req);
    const id = Number((req.params as any).id);
    const r = await consultarUm(
      `select r.*, r.data::text dt, r.validade::text val, p.nome paciente, p.cns, p.data_nascimento::text nasc, p.sexo,
              (select concat_ws(' ', l.tipo_abreviatura, l.nome) || ', ' || coalesce(p.numero, 's/n') from cad.logradouro l where l.id = p.logradouro_id) endereco,
              pr.nome profissional, pr.conselho, pr.registro_conselho, pr.uf_conselho, un.nome unidade, un.telefone
         from amb.prescricao r join cad.pessoa p on p.id = r.paciente_id left join cad.profissional pr on pr.id = r.profissional_id
         left join cad.unidade un on un.id = r.unidade_id where r.id = $1`,
      [id],
    );
    if (!r) throw new ErroHttp(404, 'Receita não encontrada.');
    const itens = await consultar(`select * from amb.prescricao_item where prescricao_id = $1 order by id`, [id]);
    const cfg = await parametro<{ cabecalho: boolean; rodape: boolean; logoSus: boolean; duasVias: boolean; textoCabecalho: string }>('receita.impressao', {
      cabecalho: true,
      rodape: true,
      logoSus: true,
      duasVias: false,
      textoCabecalho: '',
    });
    const barras = await codigoBarras(r.numero);
    const titulo = { BASICA: 'RECEITUÁRIO', BRANCA_C: 'RECEITUÁRIO DE CONTROLE ESPECIAL', AZUL_B: 'NOTIFICAÇÃO DE RECEITA B', AMARELA_A: 'NOTIFICAÇÃO DE RECEITA A', ANTIMICROBIANO: 'RECEITA DE ANTIMICROBIANO', OUTROS: 'OUTROS MEDICAMENTOS E RECOMENDAÇÕES' }[r.tipo_receita as string] ?? 'RECEITUÁRIO';
    const via = (nome: string) => [
      { columns: [{ text: titulo, bold: true, fontSize: 13 }, { image: barras, width: 150, alignment: 'right' }] },
      ...(cfg.textoCabecalho ? [{ text: cfg.textoCabecalho, fontSize: 8 }] : []),
      { text: nome, fontSize: 7, alignment: 'right', color: '#777' },
      { text: `Paciente: ${r.paciente}`, bold: true, margin: [0, 6, 0, 0] },
      { text: `CNS: ${r.cns ?? '-'}   Idade: ${idadeTexto(r.nasc)}${['BRANCA_C', 'AZUL_B', 'AMARELA_A'].includes(r.tipo_receita) ? `   Endereço: ${r.endereco ?? '-'}` : ''}`, fontSize: 8 },
      { text: r.uso_interno ? 'USO INTERNO' : 'USO EXTERNO', bold: true, margin: [0, 8, 0, 4] },
      {
        ol: itens.map((i) => ({
          stack: [{ text: `${i.descricao}${i.quantidade ? ` ........ ${Number(i.quantidade).toLocaleString('pt-BR')}` : ''}`, bold: true }, { text: [i.posologia, i.dose ? `Dose: ${i.dose}` : '', i.uso_continuo ? '(uso contínuo)' : ''].filter(Boolean).join(' - ') }],
          margin: [0, 2, 0, 4],
        })),
      },
      ...(r.orientacoes ? [{ text: 'Orientações:', bold: true, margin: [0, 6, 0, 0] }, { text: r.orientacoes }] : []),
      { text: `Data: ${fmtData(r.dt)}   Validade: ${fmtData(r.val)}`, margin: [0, 16, 0, 0], fontSize: 8 },
      { text: '_______________________________________', alignment: 'center', margin: [0, 24, 0, 0] },
      { text: `${r.profissional ?? ''} - ${r.conselho ?? ''} ${r.registro_conselho ?? ''}/${r.uf_conselho ?? ''}`, alignment: 'center', fontSize: 8 },
      { text: 'Carimbo e assinatura', alignment: 'center', fontSize: 7, color: '#777' },
    ];
    const conteudo: any[] = cfg.duasVias ? [...via('1ª via - farmácia'), { text: '', pageBreak: 'after' }, ...via('2ª via - paciente')] : via('');
    const doc = await emitirDocumento({ relatorio: 'documento:receita', titulo: titulo, filtros: { receita: id } }, conteudo, { semCabecalho: !cfg.cabecalho, semRodape: !cfg.rodape, tamanho: 'A5' as any }, u);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // Requisição de exames com campo para carimbo e assinatura (TR 1.2.18.2, 1.2.18.3).
  app.get('/api/documentos/requisicao/:id', async (req, reply) => {
    const u = exigirUsuario(req);
    const id = Number((req.params as any).id);
    const s = await consultarUm(
      `select s.*, s.data::text dt, p.nome paciente, p.cns, p.data_nascimento::text nasc, p.sexo, pr.nome profissional, pr.conselho, pr.registro_conselho, un.nome unidade
         from amb.solicitacao_exame s join cad.pessoa p on p.id = s.paciente_id left join cad.profissional pr on pr.id = s.profissional_id
         left join cad.unidade un on un.id = s.unidade_id where s.id = $1`,
      [id],
    );
    if (!s) throw new ErroHttp(404, 'Requisição não encontrada.');
    const itens = await consultar(
      `select pr.codigo, pr.nome, i.material, i.estrutura, i.quantidade from amb.solicitacao_exame_item i join cad.procedimento pr on pr.id = i.procedimento_id where i.solicitacao_id = $1`,
      [id],
    );
    const barras = await codigoBarras(s.numero);
    const doc = await emitirDocumento(
      { relatorio: 'documento:requisicao-exames', titulo: 'Requisição de exames', filtros: { requisicao: id } },
      [
        { columns: [{ text: `Requisição nº ${s.numero}`, bold: true, fontSize: 12 }, { image: barras, width: 160, alignment: 'right' }] },
        { text: `${s.uso_interno ? 'USO INTERNO - ' : ''}Prioridade: ${s.prioridade}`, fontSize: 8 },
        { text: `Paciente: ${s.paciente}   CNS: ${s.cns ?? '-'}   Idade: ${idadeTexto(s.nasc)}   Sexo: ${s.sexo}`, margin: [0, 6, 0, 6] },
        { table: { widths: [70, '*', 100, 30], body: [[{ text: 'Código', style: 'th' }, { text: 'Exame', style: 'th' }, { text: 'Material / estrutura', style: 'th' }, { text: 'Qtd', style: 'th' }], ...itens.map((i) => [i.codigo, i.nome, i.material ?? i.estrutura ?? '', String(i.quantidade)])] } },
        ...(s.dados_clinicos ? [{ text: 'Dados clínicos:', bold: true, margin: [0, 8, 0, 0] }, { text: s.dados_clinicos }] : []),
        ...(s.justificativa ? [{ text: 'Justificativa:', bold: true, margin: [0, 6, 0, 0] }, { text: s.justificativa }] : []),
        { text: `${s.unidade ?? ''} - ${fmtData(s.dt)}`, margin: [0, 20, 0, 0] },
        { text: '_______________________________________', alignment: 'center', margin: [0, 24, 0, 0] },
        { text: `${s.profissional ?? ''} ${s.conselho ?? ''} ${s.registro_conselho ?? ''}`, alignment: 'center', fontSize: 8 },
        { text: 'Carimbo e assinatura do solicitante', alignment: 'center', fontSize: 7, color: '#777' },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // Atestados, declarações de comparecimento, CAT e resumo de atendimento (TR 1.2.32.72 a 1.2.32.75).
  app.post('/api/atendimentos/:id/documentos', async (req, reply) => {
    const u = exigirPermissao(req, 'atendimento_clinico:executar');
    const at = await atendimentoOuErro(Number((req.params as any).id));
    const b = z
      .object({ tipo: z.string(), diasAfastamento: z.number().optional(), periodo: z.string().optional(), acompanhante: z.string().optional(), cidId: z.number().optional(), texto: z.string().optional(), dadosCat: z.any().optional() })
      .parse(req.body);
    const p = await cabecalhoPaciente(at.paciente_id, at.unidade_id);
    const prof = u.profissionalId ? await consultarUm(`select nome, conselho, registro_conselho, uf_conselho from cad.profissional where id = $1`, [u.profissionalId]) : null;
    const un = await consultarUm(`select nome from cad.unidade where id = $1`, [at.unidade_id]);
    const cid = b.cidId ? await consultarUm(`select codigo, nome from cad.cid where id = $1`, [b.cidId]) : null;
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const titulos: Record<string, string> = {
      ATESTADO_MEDICO: 'ATESTADO MÉDICO',
      ATESTADO_ODONTO: 'ATESTADO ODONTOLÓGICO',
      COMPARECIMENTO: 'DECLARAÇÃO DE COMPARECIMENTO',
      COMPARECIMENTO_ACOMPANHANTE: 'DECLARAÇÃO DE COMPARECIMENTO DE ACOMPANHANTE',
      CAT: 'COMUNICAÇÃO DE ACIDENTE DE TRABALHO - CAT (atestado médico)',
      RESUMO: 'RESUMO DE ATENDIMENTO',
      OUTRO: 'DOCUMENTO',
    };
    let corpo: string;
    switch (b.tipo) {
      case 'ATESTADO_MEDICO':
      case 'ATESTADO_ODONTO':
        corpo = `Atesto, para os devidos fins, que ${p?.nome} esteve sob meus cuidados profissionais nesta data, necessitando de ${b.diasAfastamento ?? 1} dia(s) de afastamento de suas atividades a partir de ${hoje}.${cid ? `\n\nCID: ${cid.codigo} (informado com autorização do paciente).` : ''}`;
        break;
      case 'COMPARECIMENTO':
        corpo = `Declaro, para os devidos fins, que ${p?.nome} compareceu a esta unidade de saúde (${un?.nome}) em ${hoje}${b.periodo ? `, no período ${b.periodo}` : ''}, para atendimento.`;
        break;
      case 'COMPARECIMENTO_ACOMPANHANTE':
        corpo = `Declaro, para os devidos fins, que ${b.acompanhante ?? '__________'} compareceu a esta unidade de saúde (${un?.nome}) em ${hoje}${b.periodo ? `, no período ${b.periodo}` : ''}, como acompanhante de ${p?.nome}.`;
        break;
      case 'RESUMO':
        corpo = [`Paciente: ${p?.nome}`, `Queixa: ${at.queixa ?? '-'}`, `Avaliação: ${at.avaliacao ?? '-'}`, `Plano: ${at.plano ?? '-'}`].join('\n\n');
        break;
      default:
        corpo = b.texto ?? '';
    }
    if (b.texto && b.tipo !== 'OUTRO') corpo += `\n\n${b.texto}`;
    const doc = await emitirDocumento(
      { relatorio: `documento:${b.tipo.toLowerCase()}`, titulo: titulos[b.tipo] ?? 'Documento', filtros: { atendimento: at.id } },
      [
        { text: titulos[b.tipo] ?? 'DOCUMENTO', bold: true, fontSize: 14, alignment: 'center', margin: [0, 10, 0, 20] },
        { text: corpo, fontSize: 11, lineHeight: 1.5, alignment: 'justify' },
        ...(b.tipo === 'CAT' && b.dadosCat ? [{ text: 'Dados da CAT', style: 'h2' }, { text: Object.entries(b.dadosCat).map(([k, v]) => `${k}: ${v}`).join('\n') }] : []),
        { text: `${un?.nome ?? ''}, ${hoje}.`, margin: [0, 30, 0, 0] },
        { text: '_______________________________________', alignment: 'center', margin: [0, 40, 0, 0] },
        { text: `${prof?.nome ?? u.nome}${prof ? ` - ${prof.conselho ?? ''} ${prof.registro_conselho ?? ''}/${prof.uf_conselho ?? ''}` : ''}`, alignment: 'center' },
      ] as any,
      {},
      u,
    );
    await transacao(contextoDe(req, 'documento'), (c) =>
      c.query(
        `insert into amb.documento_clinico (paciente_id, atendimento_id, profissional_id, data, tipo, dias_afastamento, periodo, acompanhante, cid_id, texto, dados_cat, codigo_emissao)
         values ($1,$2,$3,current_date,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [at.paciente_id, at.id, u.profissionalId, b.tipo, b.diasAfastamento ?? null, b.periodo ?? null, b.acompanhante ?? null, b.cidId ?? null, b.texto ?? null, b.dadosCat ? JSON.stringify(b.dadosCat) : null, doc.codigo],
      ),
    );
    return reply.header('content-type', 'application/pdf').header('x-codigo-relatorio', doc.codigo).header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // Ficha de atendimento ambulatorial (FAA) em branco, com procedimento pré-definido ou preenchida (TR 1.2.15.17, 1.2.15.18, 1.2.17.26, 1.2.32.69).
  app.get('/api/documentos/faa', async (req, reply) => {
    const u = exigirUsuario(req);
    const q = req.query as any;
    const at = q.atendimentoId ? await atendimentoOuErro(Number(q.atendimentoId)) : null;
    const p = at ? await cabecalhoPaciente(at.paciente_id, at.unidade_id) : q.pacienteId ? await cabecalhoPaciente(Number(q.pacienteId), u.unidadeAtual) : null;
    const sv = at ? await consultarUm(`select * from amb.sinais_vitais where atendimento_id = $1 order by data_hora limit 1`, [at.id]) : null;
    const proc = q.procedimentoId ? await consultarUm(`select codigo, nome from cad.procedimento where id = $1`, [Number(q.procedimentoId)]) : null;
    const v = (x: any) => (x == null || x === '' ? '_______' : String(x));
    const linha = (rot: string, val: any) => [{ text: rot, bold: true, fontSize: 8 }, { text: v(val), fontSize: 9 }];
    const doc = await emitirDocumento(
      { relatorio: 'documento:faa', titulo: 'Ficha de Atendimento Ambulatorial - FAA', filtros: q },
      [
        {
          table: {
            widths: [110, '*', 90, '*'],
            body: [
              [...linha('Paciente', p?.nome), ...linha('Prontuário', p?.prontuario)],
              [...linha('Nascimento', p?.nascimento ? fmtData(p.nascimento) : null), ...linha('Sexo', p?.sexo)],
              [...linha('CNS', p?.cns), ...linha('Município', p?.municipio)],
              [...linha('Mãe', p?.nome_mae), ...linha('Entrada', at ? fmt(at.entrada_em) : null)],
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { text: 'Acolhimento / pré-consulta', style: 'h2' },
        {
          table: {
            widths: ['*', '*', '*', '*', '*', '*'],
            body: [
              ['Peso', 'Altura', 'PA', 'Temp.', 'FC', 'SpO₂'].map((t) => ({ text: t, style: 'th' })),
              [v(sv?.peso), v(sv?.altura), sv?.pa_sistolica ? `${sv.pa_sistolica}/${sv.pa_diastolica}` : '_______', v(sv?.temperatura), v(sv?.frequencia_cardiaca), v(sv?.saturacao)],
            ],
          },
        },
        { text: `Classificação de risco: ${v(at?.classificacao_risco)}`, margin: [0, 6, 0, 0] },
        { text: `Queixa principal: ${at?.queixa ?? ''}`, margin: [0, 6, 0, 0] },
        { text: 'Anamnese / exame físico', style: 'h2' },
        { text: at?.subjetivo || at?.objetivo ? `${at.subjetivo ?? ''}\n${at.objetivo ?? ''}` : '\n\n\n\n\n\n' },
        { text: 'Diagnóstico / conduta', style: 'h2' },
        { text: at?.avaliacao || at?.plano ? `${at.avaliacao ?? ''}\n${at.plano ?? ''}` : '\n\n\n\n' },
        { text: `Procedimento: ${proc ? `${proc.codigo} - ${proc.nome}` : '__________________________________'}`, margin: [0, 8, 0, 0] },
        { text: 'CID: ________    Assinatura e carimbo do profissional: ______________________________', margin: [0, 20, 0, 0] },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // Impressão do prontuário eletrônico com o nome de quem o disponibilizou (TR 1.2.6.60).
  app.get('/api/documentos/prontuario/:pacienteId', async (req, reply) => {
    const u = exigirPermissao(req, 'prontuario:exportar');
    const pid = Number((req.params as any).pacienteId);
    const p = await cabecalhoPaciente(pid, u.unidadeAtual);
    if (!p) throw new ErroHttp(404, 'Paciente não encontrado.');
    const ats = await consultar(
      `select a.*, u.nome unidade, pr.nome profissional, pr.conselho, pr.registro_conselho, e.nome especialidade, c.codigo cid_codigo, c.nome cid_nome
         from amb.atendimento a join cad.unidade u on u.id = a.unidade_id left join cad.profissional pr on pr.id = a.profissional_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.cid c on c.id = a.cid_id
        where a.paciente_id = $1 and a.situacao in ('FINALIZADO','EM_OBSERVACAO','EM_ATENDIMENTO') order by a.entrada_em desc`,
      [pid],
    );
    const blocos: any[] = [
      { text: `${p.nome}`, fontSize: 13, bold: true },
      { text: `Nascimento: ${fmtData(p.nascimento)} (${idadeTexto(p.nascimento)})   Sexo: ${p.sexo}   CNS: ${p.cns ?? '-'}   Prontuário: ${p.prontuario ?? '-'}`, fontSize: 8 },
      { text: `Mãe: ${p.nome_mae ?? '-'}   Município: ${p.municipio ?? '-'}`, fontSize: 8 },
      { text: `Alergias: ${(p.alergias as any[]).map((a) => a.substancia).join(', ') || 'nenhuma registrada'}`, fontSize: 8, color: '#b00', margin: [0, 0, 0, 8] },
    ];
    for (const a of ats) {
      const sv = await consultarUm(`select * from amb.sinais_vitais where atendimento_id = $1 order by data_hora limit 1`, [a.id]);
      blocos.push(
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 520, y2: 0, lineWidth: 0.5, lineColor: '#999' }], margin: [0, 6, 0, 4] },
        { text: `${fmt(a.entrada_em)} - ${a.unidade} - ${a.especialidade ?? ''}`, bold: true },
        { text: `Profissional: ${a.profissional ?? '-'} ${a.conselho ?? ''} ${a.registro_conselho ?? ''}   Triagem: ${fmt(a.triagem_em)}   Início: ${fmt(a.inicio_em)}   Conclusão: ${fmt(a.fim_em)}`, fontSize: 7 },
        ...(sv ? [{ text: `Peso ${sv.peso ?? '-'} kg · Altura ${sv.altura ?? '-'} cm · IMC ${sv.imc ?? '-'} · PA ${sv.pa_sistolica ?? '-'}/${sv.pa_diastolica ?? '-'} · Temp ${sv.temperatura ?? '-'} · FC ${sv.frequencia_cardiaca ?? '-'} · FR ${sv.frequencia_respiratoria ?? '-'} · SpO₂ ${sv.saturacao ?? '-'} · Glicemia ${sv.glicemia ?? '-'}`, fontSize: 8 }] : []),
        ...(a.queixa ? [{ text: [{ text: 'Queixa: ', bold: true }, a.queixa], fontSize: 8 }] : []),
        ...['subjetivo', 'objetivo', 'avaliacao', 'plano'].filter((k) => a[k]).map((k) => ({ text: [{ text: `${k[0].toUpperCase()}: `, bold: true }, a[k]], fontSize: 8 })),
        ...(a.cid_codigo ? [{ text: `CID: ${a.cid_codigo} - ${a.cid_nome}`, fontSize: 8 }] : []),
      );
    }
    const doc = await emitirDocumento({ relatorio: 'documento:prontuario', titulo: 'Prontuário eletrônico do paciente', filtros: { paciente: pid }, filtrosTexto: [`Disponibilizado por ${u.nome}`] }, blocos, {}, u);
    await registrarRotina(req, 'prontuario', 'imprimir', { paciente: pid, codigo: doc.codigo });
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });
}
