import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { emitirDocumento, emitirTabela } from '../../servicos/relatorios.js';
import type { Coluna, Formato } from '../../servicos/exportar.js';
import { contextoDe, ErroHttp, exigirPermissao, registrarRotina } from '../../seguranca/usuario.js';
import { idadeTexto } from '../../compartilhado/validacao.js';
import {
  agendar,
  aplicarFeriado,
  calendario,
  cancelar,
  cotasProcedimentos,
  gerarHorarios,
  incluirListaEspera,
  notificarEvento,
  primeiraData,
  processarBloqueio,
  proximoHorarioLivre,
  transferir,
  validarCargaHoraria,
} from './servico.js';

registrarPermissao('agendar', 'Agendar consultas e exames', 'AGE', ['executar']);

registrarGanchos('agenda', {
  async antesSalvar(d, { cliente, atual }) {
    const f = { ...(atual ?? {}), ...d };
    if (f.hora_inicio && f.hora_fim && f.hora_fim <= f.hora_inicio) throw new ErroHttp(422, 'O horário final deve ser posterior ao inicial.', { hora_fim: 'Horário inválido.' });
    if (f.tipo === 'CONSULTA' && !f.profissional_id) throw new ErroHttp(422, 'Informe o profissional da agenda de consultas.', { profissional_id: 'Obrigatório.' });
    if (!d.nome && !atual?.nome) {
      const prof = f.profissional_id ? (await cliente.query(`select nome from cad.profissional where id = $1`, [f.profissional_id])).rows[0]?.nome : null;
      const esp = f.especialidade_id ? (await cliente.query(`select nome from cad.especialidade where id = $1`, [f.especialidade_id])).rows[0]?.nome : null;
      const un = (await cliente.query(`select coalesce(sigla, nome) n from cad.unidade where id = $1`, [f.unidade_id])).rows[0]?.n;
      d.nome = [esp, prof, un].filter(Boolean).join(' - ').slice(0, 120);
    }
    await validarCargaHoraria(cliente, f);
  },
  async depoisSalvar(r, { cliente }) {
    await gerarHorarios(cliente, r.id);
  },
});

registrarGanchos('bloqueio_agenda', {
  antesSalvar(d, { atual }) {
    const f = { ...(atual ?? {}), ...d };
    if (!f.profissional_id && !f.agenda_id) throw new ErroHttp(422, 'Informe o profissional ou a agenda.');
    if (f.data_fim < f.data_inicio) throw new ErroHttp(422, 'Data final anterior à inicial.');
  },
  async depoisSalvar(r, { cliente, usuario }) {
    if (!r.processado_em) await processarBloqueio(cliente, r.id, usuario);
  },
});

registrarGanchos('feriado', {
  async depoisSalvar(r, { cliente }) {
    await aplicarFeriado(cliente, r);
  },
});

registrarGanchos('lista_espera', {
  antesSalvar(d) {
    if (d.prioridade) d.prioridade_ordem = { VERMELHO: 1, AMARELO: 2, AZUL: 3 }[d.prioridade as string] ?? 3;
    if (!d.incluido_em) d.incluido_em = new Date().toISOString();
  },
});

const fmtData = (d: string) => d?.slice(0, 10).split('-').reverse().join('/');

export async function rotasAgendamento(app: FastifyInstance) {
  // Unidades prestadoras, especialidades e profissionais com horários disponíveis (TR 1.2.12.32 a 1.2.12.35).
  app.get('/api/agendamento/disponibilidade', async (req) => {
    exigirPermissao(req, 'agendamento:consultar');
    const q = req.query as any;
    return consultar(
      `select a.id as agenda_id, a.nome, a.tipo, a.unidade_id, u.nome as unidade, a.profissional_id, p.nome as profissional,
              a.especialidade_id, e.nome as especialidade, a.convenio_id, c.nome as convenio, a.cor, a.local, a.por_ordem_chegada,
              (select min(h.data)::text from age.horario h where h.agenda_id = a.id and h.situacao = 'LIVRE' and h.data >= current_date and h.tipo_vaga = 'ELETIVA') as primeira_data,
              (select min(h.data)::text from age.horario h where h.agenda_id = a.id and h.situacao = 'LIVRE' and h.data >= current_date and h.tipo_vaga = 'URGENCIA') as primeira_urgencia
         from age.agenda a join cad.unidade u on u.id = a.unidade_id left join cad.profissional p on p.id = a.profissional_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.convenio c on c.id = a.convenio_id
        where a.ativo and (a.vigencia_fim is null or a.vigencia_fim >= current_date)
          and ($1::text is null or a.tipo = $1) and ($2::bigint is null or a.unidade_id = $2) and ($3::bigint is null or a.especialidade_id = $3)
          and ($4::bigint is null or a.profissional_id = $4) and ($5::bigint is null or coalesce(a.convenio_id, 0) = $5 or a.convenio_id is null)
          and ($6::bigint is null or exists (select 1 from age.agenda_procedimento ap where ap.agenda_id = a.id and ap.procedimento_id = $6))
        order by e.nome, p.nome`,
      [q.tipo ?? null, q.unidadeId ? Number(q.unidadeId) : null, q.especialidadeId ? Number(q.especialidadeId) : null, q.profissionalId ? Number(q.profissionalId) : null, q.convenioId ? Number(q.convenioId) : null, q.procedimentoId ? Number(q.procedimentoId) : null],
    );
  });

  app.get('/api/agendamento/calendario', async (req) => {
    exigirPermissao(req, 'agendamento:consultar');
    const q = req.query as any;
    const n = (v: any) => (v ? Number(v) : undefined);
    const filtro = { agendaId: n(q.agendaId), profissionalId: n(q.profissionalId), especialidadeId: n(q.especialidadeId), unidadeId: n(q.unidadeId), tipo: q.tipo, tipoVaga: q.tipoVaga };
    const dias = await calendario({ ...filtro, mes: q.mes ?? new Date().toISOString().slice(0, 7) });
    const feriados = await consultar(`select data::text, descricao from cad.feriado where to_char(data, 'YYYY-MM') = $1`, [q.mes ?? new Date().toISOString().slice(0, 7)]);
    return { dias, feriados, primeiraEletiva: (await primeiraData(filtro))?.data, primeiraUrgencia: (await primeiraData({ ...filtro, tipoVaga: 'URGENCIA' }))?.data };
  });

  // Horários do dia com pacientes já agendados (TR 1.2.12.15, 1.2.12.41).
  app.get('/api/agendamento/horarios', async (req) => {
    const u = exigirPermissao(req, 'agendamento:consultar');
    const q = req.query as any;
    if (!q.data) throw new ErroHttp(400, 'Informe a data.');
    const linhas = await consultar(
      `select h.id, h.data::text, to_char(h.hora,'HH24:MI') hora, h.ordem, h.tipo_vaga, h.situacao, h.motivo_bloqueio, a.id agenda_id, a.nome agenda, a.cor,
              a.especial, a.descricao_especial, ag.id agendamento_id, ag.senha, ag.situacao situacao_agendamento, ag.encaixe, ag.urgente, ag.tipo,
              p.id paciente_id, p.nome paciente, p.celular, p.data_nascimento::text nascimento, pr.nome profissional, e.nome especialidade,
              us.nome unidade_solicitante, ps.nome profissional_solicitante
         from age.horario h join age.agenda a on a.id = h.agenda_id
         left join age.agendamento ag on ag.horario_id = h.id and ag.situacao not in ('CANCELADO','TRANSFERIDO')
         left join cad.pessoa p on p.id = ag.paciente_id left join cad.profissional pr on pr.id = a.profissional_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.unidade us on us.id = ag.unidade_solicitante_id
         left join cad.profissional ps on ps.id = ag.profissional_solicitante_id
        where h.data = $1 and ($2::bigint is null or a.id = $2) and ($3::bigint is null or a.profissional_id = $3)
          and ($4::bigint is null or a.especialidade_id = $4) and ($5::bigint is null or a.unidade_id = $5)
        order by a.nome, h.hora, h.ordem`,
      [q.data, q.agendaId ? Number(q.agendaId) : null, q.profissionalId ? Number(q.profissionalId) : null, q.especialidadeId ? Number(q.especialidadeId) : null, q.unidadeId ? Number(q.unidadeId) : null],
    );
    const cotas = q.agendaId ? await cotasProcedimentos(pool, Number(q.agendaId), q.data) : [];
    await registrarRotina(req, 'agendamento', 'consultar_horarios', { data: q.data });
    void u;
    return { horarios: linhas, cotas };
  });

  app.post('/api/agendamento', async (req, reply) => {
    const u = exigirPermissao(req, 'agendamento:incluir');
    const p = z
      .object({
        horarioId: z.number().optional(),
        agendaId: z.number().optional(),
        data: z.string().optional(),
        hora: z.string().optional(),
        pacienteId: z.number(),
        tipo: z.string().optional(),
        origem: z.string().optional(),
        urgente: z.boolean().optional(),
        procedimentos: z.array(z.object({ procedimentoId: z.number(), quantidade: z.number().optional(), estrutura: z.string().optional(), solicitacaoItemId: z.number().optional() })).optional(),
        requisicaoId: z.number().optional(),
        unidadeSolicitanteId: z.number().optional(),
        profissionalSolicitanteId: z.number().optional(),
        listaEsperaId: z.number().optional(),
        observacao: z.string().optional(),
        confirmarAvisos: z.boolean().optional(),
      })
      .parse(req.body);
    const ag = await transacao(contextoDe(req, 'agendamento:incluir'), (c) => agendar(c, p, u));
    return reply.status(201).send(ag);
  });

  app.post('/api/agendamento/:id/cancelar', async (req) => {
    exigirPermissao(req, 'agendamento:alterar');
    const { motivo, incluirListaEspera } = z.object({ motivo: z.string().min(3), incluirListaEspera: z.boolean().default(true) }).parse(req.body);
    return transacao(contextoDe(req, 'agendamento:cancelar'), (c) => cancelar(c, Number((req.params as any).id), motivo, incluirListaEspera));
  });

  // Exclusão: estorna a cota e libera o horário (TR 1.2.8.5.1).
  app.delete('/api/agendamento/:id/excluir', async (req) => {
    exigirPermissao(req, 'agendamento:excluir');
    const id = Number((req.params as any).id);
    return transacao(contextoDe(req, 'agendamento:excluir'), async (c) => {
      const ag = (await c.query(`select horario_id from age.agendamento where id = $1`, [id])).rows[0];
      if (!ag) throw new ErroHttp(404, 'Agendamento não encontrado.');
      await c.query(`delete from age.agendamento_procedimento where agendamento_id = $1`, [id]);
      await c.query(`update age.lista_espera set agendamento_id = null, situacao = 'AGUARDANDO' where agendamento_id = $1`, [id]);
      await c.query(`update age.agendamento set agendamento_origem_id = null where agendamento_origem_id = $1`, [id]);
      await c.query(`delete from age.agendamento where id = $1`, [id]);
      if (ag.horario_id) await c.query(`update age.horario set situacao = 'LIVRE' where id = $1`, [ag.horario_id]);
      return { ok: true };
    });
  });

  app.post('/api/agendamento/:id/transferir', async (req) => {
    const u = exigirPermissao(req, 'agendamento:alterar');
    const b = z.object({ horarioId: z.number().optional(), agendaId: z.number().optional(), data: z.string().optional(), motivo: z.string().min(3) }).parse(req.body);
    return transacao(contextoDe(req, 'agendamento:transferir'), (c) => transferir(c, Number((req.params as any).id), b, b.motivo, u));
  });

  // Transferência de vários pacientes para outro profissional, com encaixe ou lista de espera (TR 1.2.12.43).
  app.post('/api/agendamento/transferir-lote', async (req) => {
    const u = exigirPermissao(req, 'agendamento:alterar');
    const b = z.object({ ids: z.array(z.number()).min(1), profissionalDestinoId: z.number(), motivo: z.string().min(3), criarEncaixe: z.boolean().default(true) }).parse(req.body);
    return transacao(contextoDe(req, 'agendamento:transferir-lote'), async (c) => {
      const r = { transferidos: 0, encaixes: 0, listaEspera: 0 };
      for (const id of b.ids) {
        const ag = (await c.query(`select * from age.agendamento where id = $1`, [id])).rows[0];
        const h = await proximoHorarioLivre(c, { profissionalId: b.profissionalDestinoId, especialidadeId: ag.especialidade_id, aPartirDe: ag.data.toISOString?.().slice(0, 10) ?? String(ag.data) });
        if (h) {
          await transferir(c, id, { horarioId: h.id }, b.motivo, u);
          r.transferidos++;
          continue;
        }
        const agendaDestino = (await c.query(`select id from age.agenda where profissional_id = $1 and especialidade_id = $2 and ativo limit 1`, [b.profissionalDestinoId, ag.especialidade_id])).rows[0];
        if (b.criarEncaixe && agendaDestino) {
          await transferir(c, id, { agendaId: agendaDestino.id, data: String(ag.data).slice(0, 10) }, b.motivo, u);
          r.encaixes++;
        } else {
          await cancelar(c, id, b.motivo, true);
          r.listaEspera++;
        }
      }
      return r;
    });
  });

  // Falta ou atraso: registra justificativa e libera a vaga para encaixe (TR 1.2.15.20, 1.2.15.21).
  app.post('/api/agendamento/:id/falta', async (req) => {
    exigirPermissao(req, 'agendamento:alterar');
    const b = z.object({ tipo: z.enum(['FALTA', 'ATRASO']).default('FALTA'), justificativa: z.string().optional(), justificada: z.boolean().default(false) }).parse(req.body);
    const id = Number((req.params as any).id);
    return transacao(contextoDe(req, 'agendamento:falta'), async (c) => {
      const ag = (await c.query(`update age.agendamento set situacao = $2, justificativa_falta = $3, falta_justificada = $4 where id = $1 returning horario_id`, [id, b.tipo, b.justificativa ?? null, b.justificada])).rows[0];
      if (ag?.horario_id && b.tipo === 'FALTA') await c.query(`update age.horario set situacao = 'LIVRE', tipo_vaga = 'ENCAIXE' where id = $1`, [ag.horario_id]);
      return { ok: true };
    });
  });

  // Falta registrada indevidamente pode voltar a "realizado" (TR 1.2.43.1.16).
  app.post('/api/agendamento/:id/realizado', async (req) => {
    exigirPermissao(req, 'agendamento:alterar');
    await transacao(contextoDe(req, 'agendamento:realizado'), (c) => c.query(`update age.agendamento set situacao = 'ATENDIDO' where id = $1 and situacao in ('FALTA','ATRASO','PRESENTE','CONFIRMADO','AGENDADO')`, [(req.params as any).id]));
    return { ok: true };
  });

  app.post('/api/agendamento/:id/confirmar-presenca', async (req) => {
    exigirPermissao(req, 'agendamento:alterar');
    await transacao(contextoDe(req, 'agendamento:confirmar'), (c) => c.query(`update age.agendamento set situacao = 'CONFIRMADO' where id = $1 and situacao in ('AGENDADO','SOLICITADO')`, [(req.params as any).id]));
    return { ok: true };
  });

  // Histórico do paciente: últimos agendamentos e absenteísmos (TR 1.2.10.20, 1.2.10.26, 1.2.10.27, 1.2.12.26, 1.2.12.27).
  app.get('/api/agendamento/paciente/:id', async (req) => {
    exigirPermissao(req, 'agendamento:consultar');
    const id = Number((req.params as any).id);
    const ultimos = await consultar(
      `select a.id, a.data::text, to_char(a.hora,'HH24:MI') hora, a.situacao, a.tipo, a.senha, u.nome unidade, c.nome convenio, e.nome especialidade, p.nome profissional, a.motivo
         from age.agendamento a left join cad.unidade u on u.id = a.unidade_id left join cad.convenio c on c.id = a.convenio_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.profissional p on p.id = a.profissional_id
        where a.paciente_id = $1 order by a.data desc, a.hora desc limit 20`,
      [id],
    );
    return {
      ultimos,
      absenteismos: ultimos.filter((x) => ['FALTA', 'ATRASO'].includes(x.situacao)),
      pendentes: ultimos.filter((x) => ['AGENDADO', 'CONFIRMADO', 'SOLICITADO'].includes(x.situacao) && x.data >= new Date().toISOString().slice(0, 10)),
      listaEspera: await consultar(
        `select l.id, l.incluido_em, l.situacao, l.prioridade, e.nome especialidade, p.nome procedimento from age.lista_espera l
           left join cad.especialidade e on e.id = l.especialidade_id left join cad.procedimento p on p.id = l.procedimento_id
          where l.paciente_id = $1 and l.situacao = 'AGUARDANDO'`,
        [id],
      ),
    };
  });

  // Comprovante com senha em código de barras e preparo dos procedimentos (TR 1.2.7.5, 1.2.10.28, 1.2.10.29, 1.2.12.44).
  app.get('/api/agendamento/:id/comprovante', async (req, reply) => {
    const u = exigirPermissao(req, 'agendamento:consultar');
    const id = Number((req.params as any).id);
    const a = await consultarUm(
      `select a.*, a.data::text dt, to_char(a.hora,'HH24:MI') hr, p.nome paciente, p.sexo, p.data_nascimento::text nasc, p.cns,
              coalesce((select numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id and pp.unidade_id = a.unidade_id), p.prontuario) prontuario,
              u.nome unidade, u.telefone, (select concat_ws(' ', l.tipo_abreviatura, l.nome) from cad.logradouro l where l.id = u.logradouro_id) logradouro, u.numero,
              (select m.nome from cad.municipio m where m.id = u.municipio_id) cidade, ag.local, c.nome convenio, e.nome especialidade, pr.nome profissional,
              us.nome unidade_solicitante, ps.nome profissional_solicitante, o.nome atendente, sx.numero requisicao
         from age.agendamento a join cad.pessoa p on p.id = a.paciente_id join age.agenda ag on ag.id = a.agenda_id
         left join cad.unidade u on u.id = a.unidade_id left join cad.convenio c on c.id = a.convenio_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.profissional pr on pr.id = a.profissional_id
         left join cad.unidade us on us.id = a.unidade_solicitante_id left join cad.profissional ps on ps.id = a.profissional_solicitante_id
         left join seg.operador o on o.id = a.operador_id left join amb.solicitacao_exame sx on sx.id = a.requisicao_id
        where a.id = $1`,
      [id],
    );
    if (!a) throw new ErroHttp(404, 'Agendamento não encontrado.');
    const procs = await consultar(
      `select pr.codigo, pr.nome, ap.quantidade, ap.estrutura, pr.preparo from age.agendamento_procedimento ap join cad.procedimento pr on pr.id = ap.procedimento_id where ap.agendamento_id = $1`,
      [id],
    );
    const barras = await codigoBarras(a.senha);
    const linha = (r: string, v: any) => [{ text: r, bold: true, fontSize: 9 }, { text: v ?? '-', fontSize: 9 }];
    const r = await emitirDocumento(
      { relatorio: 'agendamento:comprovante', titulo: 'Comprovante de agendamento', filtros: { agendamento: id } },
      [
        { columns: [{ image: barras, width: 180 }, { text: `Senha: ${a.senha}`, fontSize: 14, bold: true, alignment: 'right' }] },
        { text: 'Agendamento', style: 'h2' },
        {
          table: {
            widths: [130, '*'],
            body: [
              linha('Data e horário', `${fmtData(a.dt)} ${a.hr ?? '(por ordem de chegada)'}${a.encaixe ? ' - ENCAIXE' : ''}`),
              linha('Convênio', a.convenio ?? 'SUS'),
              linha('Unidade prestadora', a.unidade),
              linha('Local do atendimento', a.local ?? '-'),
              linha('Endereço', `${a.logradouro ?? ''}, ${a.numero ?? ''} - ${a.cidade ?? ''}`),
              linha('Telefone', a.telefone),
              linha(a.especialidade ? 'Especialidade / profissional' : 'Profissional', [a.especialidade, a.profissional].filter(Boolean).join(' - ')),
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { text: 'Paciente', style: 'h2' },
        {
          table: {
            widths: [130, '*'],
            body: [
              linha('Nome', a.paciente),
              linha('Sexo / idade', `${a.sexo === 'F' ? 'Feminino' : a.sexo === 'M' ? 'Masculino' : '-'} / ${idadeTexto(a.nasc)}`),
              linha('Prontuário', a.prontuario),
              linha('Cartão SUS', a.cns),
              linha('Unidade solicitante', a.unidade_solicitante),
              linha('Requisição', a.requisicao),
              linha('Profissional solicitante', a.profissional_solicitante),
            ],
          },
          layout: 'lightHorizontalLines',
        },
        ...(procs.length
          ? [
              { text: 'Procedimentos', style: 'h2' },
              {
                table: {
                  widths: [70, '*', 40, 120],
                  body: [
                    [{ text: 'Código', style: 'th' }, { text: 'Procedimento', style: 'th' }, { text: 'Qtd.', style: 'th' }, { text: 'Estrutura / órgão', style: 'th' }],
                    ...procs.map((p) => [p.codigo, p.nome, String(p.quantidade), p.estrutura ?? '']),
                  ],
                },
              },
              ...procs
                .filter((p) => p.preparo)
                .flatMap((p) => [{ text: `Preparo - ${p.nome}`, bold: true, margin: [0, 8, 0, 2] }, { text: p.preparo }]),
            ]
          : []),
        { text: `Atendente: ${a.atendente ?? '-'} · Agendado em ${new Date(a.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, fontSize: 8, margin: [0, 10, 0, 0] },
        { text: 'Em caso de impossibilidade de comparecimento, cancele com antecedência para liberar a vaga a outro paciente.', fontSize: 8, italics: true },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
  });

  // Agenda impressa do profissional/unidade por data (TR 1.2.10.30, 1.2.12.46).
  app.get('/api/agendamento/agenda-impressa', async (req, reply) => {
    const u = exigirPermissao(req, 'agendamento:consultar');
    const q = req.query as any;
    const linhas = await consultar(
      `select coalesce(pr.nome, a.nome) agenda, to_char(h.hora,'HH24:MI') hora, h.tipo_vaga, p.nome paciente, p.data_nascimento::text nasc, p.celular telefone,
              coalesce((select numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id and pp.unidade_id = a.unidade_id), p.prontuario) prontuario,
              ag.situacao, ag.tipo
         from age.horario h join age.agenda a on a.id = h.agenda_id left join cad.profissional pr on pr.id = a.profissional_id
         left join age.agendamento ag on ag.horario_id = h.id and ag.situacao not in ('CANCELADO','TRANSFERIDO') left join cad.pessoa p on p.id = ag.paciente_id
        where h.data = $1 and ($2::bigint is null or a.profissional_id = $2) and ($3::bigint is null or a.unidade_id = $3) and ($4::bigint is null or a.id = $4)
        order by 1, h.hora, h.ordem`,
      [q.data, q.profissionalId ? Number(q.profissionalId) : null, q.unidadeId ? Number(q.unidadeId) : null, q.agendaId ? Number(q.agendaId) : null],
    );
    const r = await emitirTabela(
      { relatorio: 'agendamento:agenda-dia', titulo: `Agenda do dia ${fmtData(q.data)}`, formato: (q.formato ?? 'pdf') as Formato, filtros: q },
      {
        titulo: `Agenda do dia ${fmtData(q.data)}`,
        agrupar: ['agenda'],
        colunas: [
          { campo: 'agenda', titulo: 'Agenda' },
          { campo: 'hora', titulo: 'Hora', largura: 40 },
          { campo: 'paciente', titulo: 'Paciente' },
          { campo: 'prontuario', titulo: 'Prontuário', largura: 60 },
          { campo: 'telefone', titulo: 'Telefone', largura: 70 },
          { campo: 'tipo', titulo: 'Tipo', largura: 60 },
          { campo: 'situacao', titulo: 'Situação', largura: 70 },
        ],
        linhas,
      },
      u,
    );
    return reply.header('content-type', r.mime).header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
  });

  // Lista de espera por especialidade/procedimento (alerta no agendamento, TR 1.2.12.39).
  app.get('/api/lista-espera/resumo', async (req) => {
    exigirPermissao(req, 'lista_espera:consultar');
    const q = req.query as any;
    return consultar(
      `select l.id, l.paciente_id, p.nome paciente, l.prioridade, l.incluido_em, l.origem, l.justificativa, e.nome especialidade, pr.nome procedimento, l.regulada
         from age.lista_espera l join cad.pessoa p on p.id = l.paciente_id left join cad.especialidade e on e.id = l.especialidade_id
         left join cad.procedimento pr on pr.id = l.procedimento_id
        where l.situacao = 'AGUARDANDO' and ($1::bigint is null or l.especialidade_id = $1) and ($2::bigint is null or l.procedimento_id = $2)
          and ($3::boolean is null or l.regulada = $3)
        order by l.prioridade_ordem, l.incluido_em limit 500`,
      [q.especialidadeId ? Number(q.especialidadeId) : null, q.procedimentoId ? Number(q.procedimentoId) : null, q.regulada === undefined ? null : q.regulada === 'true'],
    );
  });

  app.post('/api/lista-espera', async (req) => {
    const u = exigirPermissao(req, 'lista_espera:incluir');
    const b = z
      .object({ pacienteId: z.number(), especialidadeId: z.number().optional(), procedimentoId: z.number().optional(), justificativa: z.string().optional(), prioridade: z.string().optional(), regulada: z.boolean().optional() })
      .parse(req.body);
    const id = await transacao(contextoDe(req, 'lista_espera'), (c) => incluirListaEspera(c, { ...b, origem: 'SOLICITACAO', unidadeSolicitanteId: u.unidadeAtual }));
    return { id };
  });

  // Relatórios de agendamentos (TR 1.2.11.1 a 1.2.11.7).
  app.get('/api/agendamento/relatorio/:tipo', async (req, reply) => {
    const u = exigirPermissao(req, 'agendamento:exportar');
    const tipo = (req.params as any).tipo as string;
    const q = req.query as any;
    const params = [q.de ?? '1900-01-01', q.ate ?? '2999-12-31'];
    const base = `from age.agendamento a join age.agendamento_procedimento ap on ap.agendamento_id = a.id join cad.procedimento pr on pr.id = ap.procedimento_id
                  join cad.pessoa p on p.id = a.paciente_id left join cad.unidade u on u.id = a.unidade_id left join cad.unidade us on us.id = a.unidade_solicitante_id
                  left join cad.profissional ps on ps.id = a.profissional_solicitante_id left join cad.convenio c on c.id = a.convenio_id
                  where a.data between $1 and $2 and a.situacao not in ('CANCELADO','TRANSFERIDO')`;
    const analitico = `select u.nome prestador, us.nome solicitante, ps.nome profissional_solicitante, c.nome convenio, a.data::text data, to_char(a.hora,'HH24:MI') hora,
                              p.nome paciente, p.prontuario, p.nome_mae, p.cns, p.data_nascimento::text nascimento, p.celular, pr.codigo || ' - ' || pr.nome procedimento, ap.quantidade ${base}`;
    const defs: Record<string, { titulo: string; sql: string; colunas: Coluna[]; agrupar?: string[] }> = {
      'analitico-periodo': {
        titulo: 'Agendamentos por período (analítico)',
        sql: `${analitico} order by 1, 5, 6`,
        agrupar: ['prestador'],
        colunas: [
          { campo: 'prestador', titulo: 'Prestador' },
          { campo: 'data', titulo: 'Data', formato: 'data' },
          { campo: 'hora', titulo: 'Hora' },
          { campo: 'paciente', titulo: 'Paciente' },
          { campo: 'prontuario', titulo: 'Prontuário' },
          { campo: 'procedimento', titulo: 'Procedimento' },
          { campo: 'solicitante', titulo: 'Unidade solicitante' },
          { campo: 'profissional_solicitante', titulo: 'Profissional solicitante' },
          { campo: 'quantidade', titulo: 'Qtd.', formato: 'inteiro', total: true },
        ],
      },
      'sintetico-prestador': {
        titulo: 'Agendamentos por prestador (sintético)',
        sql: `select u.nome prestador, sum(ap.quantidade)::int quantidade, round(100.0 * sum(ap.quantidade) / sum(sum(ap.quantidade)) over (), 2) percentual ${base} group by 1 order by 2 desc`,
        colunas: [
          { campo: 'prestador', titulo: 'Unidade prestadora' },
          { campo: 'quantidade', titulo: 'Procedimentos', formato: 'inteiro', total: true },
          { campo: 'percentual', titulo: '% do total', formato: 'percentual' },
        ],
      },
      'analitico-procedimento': {
        titulo: 'Agendamentos por procedimento (analítico)',
        sql: `${analitico} order by 1, 4, 13, 5`,
        agrupar: ['prestador', 'convenio', 'procedimento'],
        colunas: [
          { campo: 'prestador', titulo: 'Prestador' },
          { campo: 'convenio', titulo: 'Convênio' },
          { campo: 'procedimento', titulo: 'Procedimento' },
          { campo: 'data', titulo: 'Data', formato: 'data' },
          { campo: 'paciente', titulo: 'Paciente' },
          { campo: 'nome_mae', titulo: 'Mãe' },
          { campo: 'cns', titulo: 'CNS' },
          { campo: 'nascimento', titulo: 'Nascimento', formato: 'data' },
          { campo: 'celular', titulo: 'Telefone' },
          { campo: 'solicitante', titulo: 'Unidade solicitante' },
          { campo: 'quantidade', titulo: 'Qtd.', formato: 'inteiro', total: true },
        ],
      },
      'sintetico-procedimento': {
        titulo: 'Agendamentos por procedimento (sintético)',
        sql: `select pr.codigo || ' - ' || pr.nome procedimento, sum(ap.quantidade)::int quantidade, round(100.0 * sum(ap.quantidade) / sum(sum(ap.quantidade)) over (), 2) percentual ${base} group by 1 order by 2 desc`,
        colunas: [
          { campo: 'procedimento', titulo: 'Procedimento' },
          { campo: 'quantidade', titulo: 'Quantidade', formato: 'inteiro', total: true },
          { campo: 'percentual', titulo: '% do total', formato: 'percentual' },
        ],
      },
      'analitico-solicitante': {
        titulo: 'Agendamentos por profissional solicitante (analítico)',
        sql: `${analitico} order by 4, 1, 3, 13, 5`,
        agrupar: ['convenio', 'prestador', 'profissional_solicitante'],
        colunas: [
          { campo: 'convenio', titulo: 'Convênio' },
          { campo: 'prestador', titulo: 'Prestador' },
          { campo: 'profissional_solicitante', titulo: 'Profissional solicitante' },
          { campo: 'procedimento', titulo: 'Procedimento' },
          { campo: 'data', titulo: 'Data', formato: 'data' },
          { campo: 'hora', titulo: 'Hora' },
          { campo: 'paciente', titulo: 'Paciente' },
          { campo: 'solicitante', titulo: 'Unidade solicitante' },
          { campo: 'quantidade', titulo: 'Qtd.', formato: 'inteiro', total: true },
        ],
      },
    };
    const d = defs[tipo];
    if (!d) throw new ErroHttp(404, 'Relatório inexistente.');
    const linhas = await consultar(d.sql, params);
    const r = await emitirTabela(
      { relatorio: `agendamento:${tipo}`, titulo: d.titulo, formato: (q.formato ?? 'pdf') as Formato, filtros: q, filtrosTexto: [`Período: ${fmtData(params[0])} a ${fmtData(params[1])}`] },
      { titulo: d.titulo, colunas: d.colunas, linhas, agrupar: d.agrupar },
      u,
    );
    return reply.header('content-type', r.mime).header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
  });

  // Exportação de agendamentos para prestadores terceiros via web service (TR 1.2.10.31).
  app.get('/api/integracao/prestador/agendamentos', async (req) => {
    const u = exigirPermissao(req, 'agendamento:consultar');
    const q = req.query as any;
    return consultar(
      `select a.senha protocolo, a.data::text data, to_char(a.hora,'HH24:MI') hora, a.situacao, p.nome paciente, p.cns, p.cpf, p.data_nascimento::text nascimento,
              p.sexo, (select json_agg(json_build_object('codigo', pr.codigo, 'nome', pr.nome, 'quantidade', ap.quantidade)) from age.agendamento_procedimento ap
                       join cad.procedimento pr on pr.id = ap.procedimento_id where ap.agendamento_id = a.id) procedimentos
         from age.agendamento a join cad.pessoa p on p.id = a.paciente_id
        where a.unidade_id = $1 and a.data between $2 and $3 order by a.data, a.hora`,
      [Number(q.unidadeId ?? u.unidadeAtual), q.de ?? new Date().toISOString().slice(0, 10), q.ate ?? '2999-12-31'],
    );
  });
}

/** Rotina diária: estende os horários das agendas e envia lembretes (TR 1.2.2.8). */
export async function rotinaDiariaAgendamento() {
  const agendas = await consultar(`select id from age.agenda where ativo and (vigencia_fim is null or vigencia_fim >= current_date)`);
  for (const a of agendas) await transacao({ rotina: 'rotina-diaria' }, (c) => gerarHorarios(c, a.id));
  const lembretes = await consultar(
    `select distinct a.id from age.agendamento a join age.criterio_notificacao cr on cr.ativo and 'LEMBRETE' = any(cr.eventos)
      where a.situacao in ('AGENDADO','CONFIRMADO') and a.data = current_date + coalesce(cr.dias_antecedencia, 1)
        and not exists (select 1 from sis.mensagem m where m.referencia = 'agendamento:' || a.id and m.evento = 'lembrete')`,
  );
  for (const l of lembretes) await transacao({ rotina: 'lembrete' }, (c) => notificarEvento(c, l.id, 'LEMBRETE'));
}
