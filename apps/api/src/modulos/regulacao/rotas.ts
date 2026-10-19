// Rotas da regulação: fila regulada por classificação, detalhes da solicitação e do encaminhamento,
// prontuário e histórico de exames do paciente, autorização/negativa/devolução, alteração do tipo,
// agendamento nas vagas da regulação, impressão da requisição e exclusão auditável (TR 1.2.43.1).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { PERIODO, registrarRelatorio } from '../../servicos/catalogo.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { contextoDe, ErroHttp, exigirPermissao, registrarRotina } from '../../seguranca/usuario.js';
import { incluirListaEspera } from '../agendamento/servico.js';
import { agendarEmOrdem, agendarRegulado, alterarTipo, autorizar, classificar, devolver, duplicidades, excluirRequisicao, exigirRegulador, negar, registrarHistorico, vagasRegulacao } from './servico.js';

registrarPermissao('regulacao', 'Regular solicitações (médico regulador/auditor)', 'REG', ['consultar', 'executar']);

const idDe = (req: FastifyRequest) => Number((req.params as any).id);
const fmt = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const n = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

registrarRelatorio({
  id: 'reg-fila-situacao',
  modulo: 'REG',
  grupo: 'Regulação',
  permissao: 'regulacao:consultar',
  titulo: 'Solicitações reguladas por decisão e classificação',
  tr: ['1.2.43.1.2', '1.2.43.1.5'],
  filtros: [...PERIODO],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(e.nome, pr.codigo || ' - ' || pr.nome, '-') tipo, coalesce(r.decisao, 'PENDENTE') decisao, l.prioridade, count(*)::int solicitacoes,
              round(avg(extract(epoch from (coalesce(r.avaliado_em, now()) - l.incluido_em)) / 86400)::numeric, 1) dias_espera
         from age.lista_espera l left join reg.avaliacao r on r.lista_espera_id = l.id left join cad.especialidade e on e.id = l.especialidade_id
         left join cad.procedimento pr on pr.id = l.procedimento_id
        where l.regulada and l.incluido_em::date between $1 and $2 group by 1, 2, 3 order by 1, 2, 3`,
      [f.de, f.ate],
    );
    return {
      linhas,
      agrupar: ['tipo'],
      colunas: [
        { campo: 'tipo', titulo: 'Especialidade / exame' },
        { campo: 'decisao', titulo: 'Decisão' },
        { campo: 'prioridade', titulo: 'Classificação' },
        { campo: 'solicitacoes', titulo: 'Solicitações', formato: 'inteiro', total: true },
        { campo: 'dias_espera', titulo: 'Espera média (dias)', formato: 'decimal' },
      ],
    };
  },
});

registrarRelatorio({
  id: 'reg-cancelamentos',
  modulo: 'REG',
  grupo: 'Regulação',
  permissao: 'regulacao:consultar',
  titulo: 'Histórico de cancelamentos e exclusões de requisições (auditoria)',
  tr: ['1.2.43.1.14'],
  filtros: [...PERIODO, { nome: 'pacienteId', rotulo: 'Paciente', tipo: 'ref', ref: 'paciente' }],
  async gerar(f) {
    const linhas = await consultar(
      `select h.criado_em::date::text data, p.nome paciente, h.acao, h.de, h.justificativa, coalesce(o.nome, o.login) operador
         from reg.historico h join cad.pessoa p on p.id = h.paciente_id left join seg.operador o on o.id = h.operador_id
        where h.acao in ('EXCLUSAO_REQUISICAO','NEGATIVA','DEVOLUCAO') and h.criado_em::date between $1 and $2 and ($3::bigint is null or h.paciente_id = $3) order by h.id`,
      [f.de, f.ate, f.pacienteId || null],
    );
    return {
      linhas,
      colunas: [
        { campo: 'data', titulo: 'Data', formato: 'data' },
        { campo: 'paciente', titulo: 'Paciente' },
        { campo: 'acao', titulo: 'Ação' },
        { campo: 'de', titulo: 'Requisição / solicitação' },
        { campo: 'justificativa', titulo: 'Justificativa' },
        { campo: 'operador', titulo: 'Operador' },
      ],
    };
  },
});

export default async function rotasRegulacao(app: FastifyInstance) {
  // Fila regulada na ordem da classificação (vermelho, amarelo, azul) e da antiguidade.
  app.get('/api/regulacao/fila', async (req) => {
    exigirPermissao(req, 'regulacao:consultar');
    const q = req.query as any;
    return consultar(
      `select l.id, l.paciente_id, p.nome paciente, p.cns, extract(year from age(p.data_nascimento))::int idade, l.prioridade, l.prioridade_ordem, l.incluido_em, l.origem, l.situacao, l.motivo,
              l.especialidade_id, e.nome especialidade, l.procedimento_id, pr.codigo || ' - ' || pr.nome procedimento, us.nome unidade_solicitante, ps.nome profissional_solicitante,
              coalesce(r.decisao, 'PENDENTE') decisao, rg.nome regulador, r.avaliado_em, (current_date - l.incluido_em::date) dias_espera
         from age.lista_espera l join cad.pessoa p on p.id = l.paciente_id left join cad.especialidade e on e.id = l.especialidade_id
         left join cad.procedimento pr on pr.id = l.procedimento_id left join cad.unidade us on us.id = l.unidade_solicitante_id
         left join cad.profissional ps on ps.id = l.profissional_solicitante_id left join reg.avaliacao r on r.lista_espera_id = l.id left join cad.profissional rg on rg.id = r.regulador_id
        where l.regulada and ($1::text is null or l.situacao = $1) and ($2::bigint is null or l.especialidade_id = $2) and ($3::bigint is null or l.procedimento_id = $3)
          and ($4::text is null or coalesce(r.decisao, 'PENDENTE') = $4) and ($5::text is null or l.prioridade = $5)
        order by l.prioridade_ordem, l.incluido_em limit 500`,
      [q.situacao === 'TODAS' ? null : (q.situacao ?? 'AGUARDANDO'), n(q.especialidadeId), n(q.procedimentoId), q.decisao || null, q.prioridade || null],
    );
  });

  // Detalhes da solicitação e do encaminhamento, duplicidades e histórico (TR 1.2.43.1.9, 1.2.43.1.13).
  app.get('/api/regulacao/solicitacoes/:id', async (req) => {
    exigirPermissao(req, 'regulacao:consultar');
    const id = idDe(req);
    const l = await consultarUm(
      `select l.*, l.incluido_em, p.nome paciente, e.nome especialidade, pr.codigo || ' - ' || pr.nome procedimento, us.nome unidade_solicitante, ps.nome profissional_solicitante,
              ps.conselho || ' ' || coalesce(ps.registro_conselho, '') registro_solicitante, r.decisao, r.justificativa parecer, rg.nome regulador, r.avaliado_em
         from age.lista_espera l join cad.pessoa p on p.id = l.paciente_id left join cad.especialidade e on e.id = l.especialidade_id left join cad.procedimento pr on pr.id = l.procedimento_id
         left join cad.unidade us on us.id = l.unidade_solicitante_id left join cad.profissional ps on ps.id = l.profissional_solicitante_id
         left join reg.avaliacao r on r.lista_espera_id = l.id left join cad.profissional rg on rg.id = r.regulador_id where l.id = $1`,
      [id],
    );
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada.');
    const encaminhamento = l.encaminhamento_id
      ? await consultarUm(
          `select en.data::text data, en.urgencia, en.prioritario, en.justificativa_prioridade, en.investigacao, en.diagnostico, en.referencia, en.subespecialidade, en.situacao,
                  c.codigo || ' - ' || c.nome cid, te.nome tipo, pf.nome profissional
             from amb.encaminhamento en left join cad.cid c on c.id = en.cid_id left join cad.tipo_encaminhamento te on te.id = en.tipo_encaminhamento_id
             left join cad.profissional pf on pf.id = en.profissional_id where en.id = $1`,
          [l.encaminhamento_id],
        )
      : null;
    const requisicao = l.solicitacao_item_id
      ? await consultarUm(
          `select s.id, s.numero, s.data::text data, s.dados_clinicos, s.justificativa, s.prioridade, s.situacao, i.material, i.estrutura, i.quantidade, pf.nome profissional
             from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id left join cad.profissional pf on pf.id = s.profissional_id where i.id = $1`,
          [l.solicitacao_item_id],
        )
      : null;
    const historico = await consultar(
      `select h.criado_em, h.acao, h.de, h.para, h.justificativa, coalesce(o.nome, o.login) operador from reg.historico h left join seg.operador o on o.id = h.operador_id
        where h.lista_espera_id = $1 or (h.solicitacao_exame_id is not null and h.solicitacao_exame_id = $2) order by h.id`,
      [id, requisicao?.id ?? null],
    );
    const outras = (await duplicidades(pool, l.paciente_id, l.procedimento_id, l.especialidade_id)).filter((d) => d.documento !== 'lista de espera' || d.data !== new Date(l.incluido_em).toISOString().slice(0, 10));
    return { solicitacao: l, encaminhamento, requisicao, historico, duplicidades: outras };
  });

  for (const [acao, fn] of [
    ['autorizar', (c: any, id: number, b: any, u: any) => autorizar(c, id, b.justificativa ?? null, u)],
    ['negar', (c: any, id: number, b: any, u: any) => negar(c, id, b.motivo, u)],
    ['devolver', (c: any, id: number, b: any, u: any) => devolver(c, id, b.motivo, u)],
    ['classificar', (c: any, id: number, b: any, u: any) => classificar(c, id, b.prioridade, b.justificativa ?? null, u)],
  ] as const) {
    app.post(`/api/regulacao/solicitacoes/:id/${acao}`, async (req) => {
      const u = exigirPermissao(req, 'regulacao:executar');
      const b = z.object({ motivo: z.string().min(3).optional(), justificativa: z.string().nullish(), prioridade: z.enum(['AZUL', 'AMARELO', 'VERMELHO']).optional() }).parse(req.body ?? {});
      if ((acao === 'negar' || acao === 'devolver') && !b.motivo) throw new ErroHttp(422, 'Informe o motivo.', { motivo: 'Obrigatório.' });
      if (acao === 'classificar' && !b.prioridade) throw new ErroHttp(422, 'Informe a classificação.');
      await transacao(contextoDe(req, `regulacao:${acao}`), async (c) => {
        await exigirRegulador(c, u);
        await fn(c, idDe(req), b, u);
      });
      return { ok: true };
    });
  }

  // Alteração do tipo da consulta/exame (TR 1.2.43.1.6).
  app.post('/api/regulacao/solicitacoes/:id/alterar-tipo', async (req) => {
    const u = exigirPermissao(req, 'regulacao:executar');
    const b = z.object({ especialidadeId: z.number().nullish(), procedimentoId: z.number().nullish(), justificativa: z.string().min(3) }).parse(req.body);
    await transacao(contextoDe(req, 'regulacao:alterar-tipo'), async (c) => {
      await exigirRegulador(c, u);
      await alterarTipo(c, idDe(req), b, u);
    });
    return { ok: true };
  });

  app.get('/api/regulacao/solicitacoes/:id/vagas', async (req) => {
    exigirPermissao(req, 'regulacao:consultar');
    const l = await consultarUm(`select especialidade_id, procedimento_id from age.lista_espera where id = $1`, [idDe(req)]);
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada.');
    return vagasRegulacao(pool, l);
  });

  // Agendamento priorizado a partir da fila regulada (TR 1.2.43.1.3).
  app.post('/api/regulacao/solicitacoes/:id/agendar', async (req) => {
    const u = exigirPermissao(req, 'regulacao:executar');
    const b = z.object({ horarioId: z.number(), justificativa: z.string().nullish(), confirmarAvisos: z.boolean().optional() }).parse(req.body);
    return transacao(contextoDe(req, 'regulacao:agendar'), async (c) => {
      await exigirRegulador(c, u);
      return agendarRegulado(c, idDe(req), b, u);
    });
  });

  app.post('/api/regulacao/agendar-em-ordem', async (req) => {
    const u = exigirPermissao(req, 'regulacao:executar');
    const b = z.object({ especialidadeId: z.number().nullish(), procedimentoId: z.number().nullish(), quantidade: z.number().int().min(1).max(100) }).parse(req.body);
    return transacao(contextoDe(req, 'regulacao:agendar-ordem'), async (c) => {
      await exigirRegulador(c, u);
      return agendarEmOrdem(c, b, u);
    });
  });

  // Consulta ao prontuário do paciente pelo regulador, registrada para auditoria (TR 1.2.43.1.7).
  app.get('/api/regulacao/pacientes/:id/prontuario', async (req) => {
    const u = exigirPermissao(req, 'regulacao:consultar');
    const id = idDe(req);
    const atendimentos = await consultar(
      `select a.id, a.entrada_em, u.nome unidade, pr.nome profissional, e.nome especialidade, a.queixa, a.subjetivo, a.objetivo, a.avaliacao, a.plano, a.desfecho,
              c.codigo || ' - ' || c.nome cid, (select row_to_json(s) from (select pa_sistolica, pa_diastolica, peso, altura, imc from amb.sinais_vitais s where s.atendimento_id = a.id limit 1) s) sinais
         from amb.atendimento a join cad.unidade u on u.id = a.unidade_id left join cad.profissional pr on pr.id = a.profissional_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.cid c on c.id = a.cid_id
        where a.paciente_id = $1 order by a.entrada_em desc limit 50`,
      [id],
    );
    const encaminhamentos = await consultar(
      `select en.data::text data, es.nome especialidade, en.urgencia, en.diagnostico, en.situacao, pf.nome profissional from amb.encaminhamento en
         left join cad.especialidade es on es.id = en.especialidade_id left join cad.profissional pf on pf.id = en.profissional_id where en.paciente_id = $1 order by en.data desc limit 50`,
      [id],
    );
    await registrarRotina(req, 'regulacao', 'consultar-prontuario', { paciente: id });
    await transacao(contextoDe(req, 'regulacao:prontuario'), (c) => registrarHistorico(c, { pacienteId: id, acao: 'CONSULTA_PRONTUARIO', u }));
    return { atendimentos, encaminhamentos };
  });

  // Histórico dos exames do paciente com resultados (TR 1.2.43.1.10).
  app.get('/api/regulacao/pacientes/:id/exames', async (req) => {
    exigirPermissao(req, 'regulacao:consultar');
    return consultar(
      `select s.id requisicao_id, s.numero, s.data::text data, pr.codigo || ' - ' || pr.nome exame, i.situacao, i.resultado_liberado_em, i.resultado_texto, i.resultado_arquivo_id,
              pf.nome solicitante, un.nome prestador, s.motivo_cancelamento
         from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id join cad.procedimento pr on pr.id = i.procedimento_id
         left join cad.profissional pf on pf.id = s.profissional_id left join cad.unidade un on un.id = i.prestador_id
        where s.paciente_id = $1 order by s.data desc, s.id desc limit 300`,
      [idDe(req)],
    );
  });

  // Histórico de cancelamentos do paciente para auditoria (TR 1.2.43.1.14).
  app.get('/api/regulacao/pacientes/:id/cancelamentos', async (req) => {
    exigirPermissao(req, 'regulacao:consultar');
    return consultar(
      `select h.criado_em data, 'Regulação: ' || h.acao tipo, h.de documento, h.justificativa, coalesce(o.nome, o.login) operador from reg.historico h left join seg.operador o on o.id = h.operador_id
        where h.paciente_id = $1 and h.acao in ('EXCLUSAO_REQUISICAO','NEGATIVA','DEVOLUCAO')
       union all
       select s.atualizado_em, 'Requisição de exames cancelada', s.numero, s.motivo_cancelamento, (select coalesce(o.nome, o.login) from seg.operador o where o.id = s.atualizado_por)
         from amb.solicitacao_exame s where s.paciente_id = $1 and s.situacao = 'CANCELADO'
          and not exists (select 1 from reg.historico h where h.solicitacao_exame_id = s.id and h.acao = 'EXCLUSAO_REQUISICAO')
       union all
       select a.atualizado_em, 'Agendamento cancelado', a.senha, a.motivo, (select coalesce(o.nome, o.login) from seg.operador o where o.id = a.atualizado_por)
         from age.agendamento a where a.paciente_id = $1 and a.situacao = 'CANCELADO'
       order by 1 desc`,
      [idDe(req)],
    );
  });

  // Exclusão de requisição de exames com justificativa (TR 1.2.43.1.14).
  app.post('/api/regulacao/requisicoes/:id/excluir', async (req) => {
    const u = exigirPermissao(req, 'regulacao:executar');
    const { justificativa } = z.object({ justificativa: z.string().min(5) }).parse(req.body);
    await transacao(contextoDe(req, 'regulacao:excluir-requisicao'), (c) => excluirRequisicao(c, idDe(req), justificativa, u));
    return { ok: true };
  });

  // Impressão da requisição de exames com a autorização da regulação e campo de carimbo e assinatura do solicitante (TR 1.2.43.1.11, 1.2.43.1.12).
  app.get('/api/regulacao/requisicoes/:id/pdf', async (req, reply) => {
    const u = exigirPermissao(req, 'regulacao:consultar');
    const id = idDe(req);
    const s = await consultarUm(
      `select s.*, s.data::text dt, p.nome paciente, p.cns, p.data_nascimento::text nasc, p.sexo, pr.nome profissional, pr.conselho, pr.registro_conselho, un.nome unidade
         from amb.solicitacao_exame s join cad.pessoa p on p.id = s.paciente_id left join cad.profissional pr on pr.id = s.profissional_id left join cad.unidade un on un.id = s.unidade_id where s.id = $1`,
      [id],
    );
    if (!s) throw new ErroHttp(404, 'Requisição não encontrada.');
    const itens = await consultar(
      `select pr.codigo, pr.nome, i.material, i.estrutura, i.quantidade, i.situacao, coalesce(r.decisao, case when l.id is null then 'NÃO REGULADO' else 'PENDENTE' end) decisao, rg.nome regulador, to_char(r.avaliado_em, 'DD/MM/YYYY') avaliado
         from amb.solicitacao_exame_item i join cad.procedimento pr on pr.id = i.procedimento_id left join age.lista_espera l on l.solicitacao_item_id = i.id
         left join reg.avaliacao r on r.lista_espera_id = l.id left join cad.profissional rg on rg.id = r.regulador_id where i.solicitacao_id = $1`,
      [id],
    );
    const doc = await emitirDocumento(
      { relatorio: 'regulacao:requisicao', titulo: 'Requisição de exames - regulação', filtros: { requisicao: id, emissao: Date.now() } },
      [
        { columns: [{ text: `Requisição nº ${s.numero}`, bold: true, fontSize: 12 }, { image: await codigoBarras(s.numero), width: 160, alignment: 'right' }] },
        { text: `Prioridade: ${s.prioridade}${s.situacao === 'CANCELADO' ? ' - REQUISIÇÃO EXCLUÍDA: ' + (s.motivo_cancelamento ?? '') : ''}`, fontSize: 8 },
        { text: `Paciente: ${s.paciente}   CNS: ${s.cns ?? '-'}   Nascimento: ${fmt(s.nasc)}   Sexo: ${s.sexo}`, margin: [0, 6, 0, 6] },
        {
          table: {
            headerRows: 1,
            widths: [60, '*', 80, 25, 110],
            body: [
              ['Código', 'Exame', 'Material / estrutura', 'Qtd', 'Regulação'].map((t) => ({ text: t, style: 'th' })),
              ...itens.map((i) => [i.codigo, i.nome, i.material ?? i.estrutura ?? '', String(i.quantidade), `${i.decisao}${i.regulador ? ` - ${i.regulador} ${i.avaliado ?? ''}` : ''}`].map((t) => ({ text: t, style: 'td' }))),
            ],
          },
        },
        ...(s.dados_clinicos ? [{ text: 'Dados clínicos:', bold: true, margin: [0, 8, 0, 0] }, { text: s.dados_clinicos }] : []),
        ...(s.justificativa ? [{ text: 'Justificativa:', bold: true, margin: [0, 6, 0, 0] }, { text: s.justificativa }] : []),
        { text: `${s.unidade ?? ''} - ${fmt(s.dt)}`, margin: [0, 18, 0, 0] },
        {
          columns: [
            { stack: [{ text: ' ', margin: [0, 40, 0, 0] }, { text: '______________________________________', alignment: 'center' }, { text: `${s.profissional ?? ''} ${s.conselho ?? ''} ${s.registro_conselho ?? ''}`, alignment: 'center', fontSize: 8 }, { text: 'Carimbo e assinatura do médico solicitante', alignment: 'center', fontSize: 7 }] },
            { stack: [{ text: ' ', margin: [0, 40, 0, 0] }, { text: '______________________________________', alignment: 'center' }, { text: 'Médico regulador / auditor', alignment: 'center', fontSize: 8 }, { text: 'Carimbo e assinatura', alignment: 'center', fontSize: 7 }] },
          ],
        },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  app.get('/api/regulacao/duplicidade', async (req) => {
    exigirPermissao(req, 'regulacao:consultar');
    const q = req.query as any;
    return duplicidades(pool, Number(q.pacienteId), n(q.procedimentoId), n(q.especialidadeId));
  });

  // Nova solicitação regulada com alerta de requisição existente (requisitado/agendado) (TR 1.2.43.1.13).
  app.post('/api/regulacao/solicitacoes', async (req) => {
    const u = exigirPermissao(req, 'lista_espera:incluir');
    const b = z
      .object({ pacienteId: z.number(), especialidadeId: z.number().nullish(), procedimentoId: z.number().nullish(), prioridade: z.enum(['AZUL', 'AMARELO', 'VERMELHO']).default('AZUL'), justificativa: z.string().min(3), confirmarAvisos: z.boolean().optional() })
      .parse(req.body);
    if (!b.especialidadeId && !b.procedimentoId) throw new ErroHttp(422, 'Informe a especialidade ou o exame/procedimento.');
    return transacao(contextoDe(req, 'regulacao:solicitacao'), async (c) => {
      const dup = await duplicidades(c, b.pacienteId, b.procedimentoId ?? null, b.especialidadeId ?? null);
      if (dup.length && !b.confirmarAvisos)
        throw new ErroHttp(409, `O paciente já possui requisição para o mesmo procedimento: ${dup.map((d) => `${d.item} - ${d.situacao === 'AGENDADO' ? 'Agendado' : 'Requisitado'} em ${fmt(d.data)} (${d.documento})`).join('; ')}.`, { exigeConfirmacao: true, duplicidades: dup });
      const id = await incluirListaEspera(c, { pacienteId: b.pacienteId, especialidadeId: b.especialidadeId ?? null, procedimentoId: b.procedimentoId ?? null, unidadeSolicitanteId: u.unidadeAtual, profissionalSolicitanteId: u.profissionalId, origem: 'SOLICITACAO', justificativa: b.justificativa, regulada: true, prioridade: b.prioridade });
      await registrarHistorico(c, { pacienteId: b.pacienteId, listaEsperaId: id, acao: 'INCLUSAO', para: b.prioridade, justificativa: b.justificativa, u });
      return { id, duplicidades: dup };
    });
  });
}
