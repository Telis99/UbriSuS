// Regras da regulação: decisão do regulador sobre a lista de espera regulada (autorizar, negar, devolver,
// reclassificar, alterar o tipo), agendamento nas vagas reservadas obedecendo à classificação, alertas de
// duplicidade e exclusão auditável de requisições de exames (TR 1.2.43.1.3 a 1.2.43.1.14).
import type pg from 'pg';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { agendar } from '../agendamento/servico.js';

export const ORDEM_PRIORIDADE: Record<string, number> = { VERMELHO: 1, AMARELO: 2, AZUL: 3 };

export async function registrarHistorico(
  c: pg.PoolClient,
  h: { pacienteId: number; listaEsperaId?: number | null; solicitacaoExameId?: number | null; acao: string; de?: string | null; para?: string | null; justificativa?: string | null; u: Usuario | null },
) {
  await c.query(
    `insert into reg.historico (paciente_id, lista_espera_id, solicitacao_exame_id, acao, de, para, justificativa, operador_id, regulador_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [h.pacienteId, h.listaEsperaId ?? null, h.solicitacaoExameId ?? null, h.acao, h.de?.slice(0, 200) ?? null, h.para?.slice(0, 200) ?? null, h.justificativa ?? null, h.u?.id ?? null, h.u?.profissionalId ?? null],
  );
}

/** Somente o médico regulador/auditor (cadastro de profissionais) ou o administrador decide sobre a fila. */
export async function exigirRegulador(c: pg.PoolClient | pg.Pool, u: Usuario) {
  if (u.administrador) return;
  const p = u.profissionalId ? (await c.query(`select regulador from cad.profissional where id = $1`, [u.profissionalId])).rows[0] : null;
  if (!p?.regulador) throw new ErroHttp(403, 'Ação restrita ao médico regulador/auditor (atribuição no cadastro de profissionais).');
}

export async function solicitacao(c: pg.PoolClient, id: number) {
  const l = (await c.query(`select * from age.lista_espera where id = $1 for update`, [id])).rows[0];
  if (!l) throw new ErroHttp(404, 'Solicitação não encontrada na lista de espera.');
  if (!l.regulada) throw new ErroHttp(409, 'A solicitação não está na fila da regulação.');
  return l;
}

async function salvarAvaliacao(c: pg.PoolClient, l: any, decisao: string, justificativa: string | null, u: Usuario, extra: { prioridade?: string; agendamentoId?: number } = {}) {
  await c.query(
    `insert into reg.avaliacao (lista_espera_id, paciente_id, decisao, prioridade, justificativa, regulador_id, avaliado_em, agendamento_id)
     values ($1,$2,$3,$4,$5,$6,now(),$7)
     on conflict (lista_espera_id) do update set decisao = excluded.decisao, prioridade = coalesce(excluded.prioridade, reg.avaliacao.prioridade),
        justificativa = coalesce(excluded.justificativa, reg.avaliacao.justificativa), regulador_id = coalesce(excluded.regulador_id, reg.avaliacao.regulador_id),
        avaliado_em = now(), agendamento_id = coalesce(excluded.agendamento_id, reg.avaliacao.agendamento_id)`,
    [l.id, l.paciente_id, decisao, extra.prioridade ?? l.prioridade, justificativa, u.profissionalId, extra.agendamentoId ?? null],
  );
  await c.query(`update age.lista_espera set regulador_id = coalesce($2, regulador_id), avaliado_em = now() where id = $1`, [l.id, u.profissionalId]);
}

/** Classificação por cores (azul, amarelo, vermelho) que ordena a fila regulada. */
export async function classificar(c: pg.PoolClient, id: number, prioridade: string, justificativa: string | null, u: Usuario) {
  const l = await solicitacao(c, id);
  if (!ORDEM_PRIORIDADE[prioridade]) throw new ErroHttp(422, 'Classificação inválida.');
  await c.query(`update age.lista_espera set prioridade = $2, prioridade_ordem = $3 where id = $1`, [id, prioridade, ORDEM_PRIORIDADE[prioridade]]);
  await salvarAvaliacao(c, { ...l, prioridade }, (await c.query(`select decisao from reg.avaliacao where lista_espera_id = $1`, [id])).rows[0]?.decisao ?? 'PENDENTE', justificativa, u, { prioridade });
  await registrarHistorico(c, { pacienteId: l.paciente_id, listaEsperaId: id, acao: 'CLASSIFICACAO', de: l.prioridade, para: prioridade, justificativa, u });
}

export async function autorizar(c: pg.PoolClient, id: number, justificativa: string | null, u: Usuario) {
  const l = await solicitacao(c, id);
  if (l.situacao !== 'AGUARDANDO') throw new ErroHttp(409, `Solicitação na situação ${l.situacao}.`);
  await salvarAvaliacao(c, l, 'AUTORIZADO', justificativa, u);
  await registrarHistorico(c, { pacienteId: l.paciente_id, listaEsperaId: id, acao: 'AUTORIZACAO', para: 'AUTORIZADO', justificativa, u });
}

export async function negar(c: pg.PoolClient, id: number, motivo: string, u: Usuario) {
  const l = await solicitacao(c, id);
  if (l.situacao !== 'AGUARDANDO') throw new ErroHttp(409, `Solicitação na situação ${l.situacao}.`);
  await c.query(`update age.lista_espera set situacao = 'CANCELADO', motivo = $2 where id = $1`, [id, `Negado pela regulação: ${motivo}`.slice(0, 250)]);
  if (l.encaminhamento_id) await c.query(`update amb.encaminhamento set situacao = 'CANCELADO' where id = $1`, [l.encaminhamento_id]);
  await salvarAvaliacao(c, l, 'NEGADO', motivo, u);
  await registrarHistorico(c, { pacienteId: l.paciente_id, listaEsperaId: id, acao: 'NEGATIVA', de: l.situacao, para: 'CANCELADO', justificativa: motivo, u });
}

/** Devolução ao solicitante informando os motivos (TR 1.2.43.1.8). */
export async function devolver(c: pg.PoolClient, id: number, motivo: string, u: Usuario) {
  const l = await solicitacao(c, id);
  if (l.situacao !== 'AGUARDANDO') throw new ErroHttp(409, `Solicitação na situação ${l.situacao}.`);
  await c.query(`update age.lista_espera set situacao = 'DEVOLVIDO', motivo = $2 where id = $1`, [id, motivo.slice(0, 250)]);
  if (l.encaminhamento_id) await c.query(`update amb.encaminhamento set situacao = 'PENDENTE' where id = $1`, [l.encaminhamento_id]);
  await salvarAvaliacao(c, l, 'DEVOLVIDO', motivo, u);
  await registrarHistorico(c, { pacienteId: l.paciente_id, listaEsperaId: id, acao: 'DEVOLUCAO', de: 'AGUARDANDO', para: 'DEVOLVIDO', justificativa: motivo, u });
}

/** Alteração do tipo de consulta ou exame da solicitação para um novo tipo (TR 1.2.43.1.6). */
export async function alterarTipo(c: pg.PoolClient, id: number, d: { especialidadeId?: number | null; procedimentoId?: number | null; justificativa: string }, u: Usuario) {
  const l = await solicitacao(c, id);
  if (l.situacao !== 'AGUARDANDO') throw new ErroHttp(409, 'Somente solicitações aguardando podem ter o tipo alterado.');
  if (!d.especialidadeId && !d.procedimentoId) throw new ErroHttp(422, 'Informe a nova especialidade ou o novo exame/procedimento.');
  const nome = async (tabela: 'especialidade' | 'procedimento', v: number | null) =>
    v ? ((await c.query(`select ${tabela === 'procedimento' ? `codigo || ' - ' || nome` : 'nome'} n from cad.${tabela} where id = $1`, [v])).rows[0]?.n ?? String(v)) : null;
  const de = [await nome('especialidade', l.especialidade_id), await nome('procedimento', l.procedimento_id)].filter(Boolean).join(' / ');
  const novaEsp = d.especialidadeId !== undefined ? (d.especialidadeId ?? null) : l.especialidade_id;
  const novoProc = d.procedimentoId !== undefined ? (d.procedimentoId ?? null) : l.procedimento_id;
  await c.query(`update age.lista_espera set especialidade_id = $2, procedimento_id = $3 where id = $1`, [id, novaEsp, novoProc]);
  if (l.solicitacao_item_id && d.procedimentoId) await c.query(`update amb.solicitacao_exame_item set procedimento_id = $2 where id = $1`, [l.solicitacao_item_id, d.procedimentoId]);
  if (l.encaminhamento_id && d.especialidadeId) await c.query(`update amb.encaminhamento set especialidade_id = $2 where id = $1`, [l.encaminhamento_id, d.especialidadeId]);
  const para = [await nome('especialidade', novaEsp), await nome('procedimento', novoProc)].filter(Boolean).join(' / ');
  await registrarHistorico(c, { pacienteId: l.paciente_id, listaEsperaId: id, acao: 'ALTERACAO_TIPO', de, para, justificativa: d.justificativa, u });
}

/** Vagas reservadas para a regulação compatíveis com a solicitação (TR 1.2.43.1.4). */
export async function vagasRegulacao(c: pg.PoolClient | pg.Pool, l: { especialidade_id: number | null; procedimento_id: number | null }, limite = 60) {
  return (
    await c.query(
      `select h.id, h.data::text data, to_char(h.hora, 'HH24:MI') hora, a.id agenda_id, a.nome agenda, u.nome unidade, pf.nome profissional
         from age.horario h join age.agenda a on a.id = h.agenda_id join cad.unidade u on u.id = a.unidade_id left join cad.profissional pf on pf.id = a.profissional_id
        where h.situacao = 'LIVRE' and h.tipo_vaga = 'REGULACAO' and h.data >= current_date and a.ativo
          and (($1::bigint is not null and a.especialidade_id = $1) or ($2::bigint is not null and exists (select 1 from age.agenda_procedimento ap where ap.agenda_id = a.id and ap.procedimento_id = $2)))
        order by h.data, h.hora limit $3`,
      [l.especialidade_id, l.procedimento_id, limite],
    )
  ).rows;
}

/** Solicitações autorizadas à frente (classificação e data) na mesma fila. */
async function aFrente(c: pg.PoolClient, l: any) {
  return (
    await c.query(
      `select x.id, p.nome, x.prioridade from age.lista_espera x join reg.avaliacao r on r.lista_espera_id = x.id and r.decisao = 'AUTORIZADO' join cad.pessoa p on p.id = x.paciente_id
        where x.situacao = 'AGUARDANDO' and x.regulada and x.id <> $1
          and coalesce(x.especialidade_id, 0) = coalesce($2, 0) and coalesce(x.procedimento_id, 0) = coalesce($3, 0)
          and (x.prioridade_ordem < $4 or (x.prioridade_ordem = $4 and x.incluido_em < $5))
        order by x.prioridade_ordem, x.incluido_em limit 5`,
      [l.id, l.especialidade_id, l.procedimento_id, l.prioridade_ordem, l.incluido_em],
    )
  ).rows;
}

/**
 * Agendamento a partir da lista regulada, priorizado pelo médico auditor e obedecendo à classificação:
 * agendar alguém à frente de solicitações mais prioritárias exige confirmação com justificativa (TR 1.2.43.1.3).
 */
export async function agendarRegulado(c: pg.PoolClient, id: number, d: { horarioId: number; justificativa?: string | null; confirmarAvisos?: boolean }, u: Usuario) {
  const l = await solicitacao(c, id);
  if (l.situacao !== 'AGUARDANDO') throw new ErroHttp(409, `Solicitação na situação ${l.situacao}.`);
  const av = (await c.query(`select decisao from reg.avaliacao where lista_espera_id = $1`, [id])).rows[0];
  if (av?.decisao !== 'AUTORIZADO') throw new ErroHttp(409, 'A solicitação precisa ser autorizada pelo regulador antes do agendamento.');
  const frente = await aFrente(c, l);
  if (frente.length && !d.confirmarAvisos)
    throw new ErroHttp(409, `Há ${frente.length} solicitação(ões) autorizada(s) com classificação/antiguidade à frente (${frente.map((f) => `${f.nome} - ${f.prioridade}`).join('; ')}). Agendar fora da ordem?`, { exigeConfirmacao: true, aFrente: frente });
  if (frente.length && !d.justificativa?.trim()) throw new ErroHttp(422, 'Informe a justificativa para agendar fora da ordem de classificação.');
  const item = l.solicitacao_item_id ? (await c.query(`select solicitacao_id, quantidade from amb.solicitacao_exame_item where id = $1`, [l.solicitacao_item_id])).rows[0] : null;
  const ag = await agendar(
    c,
    {
      horarioId: d.horarioId,
      pacienteId: l.paciente_id,
      origem: 'REGULACAO',
      urgente: l.prioridade === 'VERMELHO',
      procedimentos: l.procedimento_id ? [{ procedimentoId: l.procedimento_id, quantidade: item?.quantidade ?? 1, solicitacaoItemId: l.solicitacao_item_id ?? undefined }] : undefined,
      requisicaoId: item?.solicitacao_id ?? undefined,
      unidadeSolicitanteId: l.unidade_solicitante_id ?? undefined,
      profissionalSolicitanteId: l.profissional_solicitante_id ?? undefined,
      listaEsperaId: l.id,
      observacao: `Agendado pela regulação${d.justificativa ? ` (fora da ordem: ${d.justificativa})` : ''}.`,
      confirmarAvisos: true,
    },
    u,
  );
  if (l.encaminhamento_id) await c.query(`update amb.encaminhamento set situacao = 'AGENDADO' where id = $1`, [l.encaminhamento_id]);
  await c.query(`update age.agendamento set autorizador_id = $2 where id = $1`, [ag.id, u.id]);
  await salvarAvaliacao(c, l, 'AGENDADO', null, u, { agendamentoId: ag.id });
  const quando = (await c.query(`select to_char(data, 'DD/MM/YYYY') d, to_char(hora, 'HH24:MI') h from age.agendamento where id = $1`, [ag.id])).rows[0];
  await registrarHistorico(c, { pacienteId: l.paciente_id, listaEsperaId: id, acao: 'AGENDAMENTO', para: `${quando.d} ${quando.h ?? ''} - protocolo ${ag.senha}`, justificativa: d.justificativa ?? null, u });
  return { id: ag.id as number, senha: ag.senha as string, data: quando.d as string, hora: quando.h as string | null };
}

/** Agenda as solicitações autorizadas da fila na ordem da classificação, nas próximas vagas de regulação. */
export async function agendarEmOrdem(c: pg.PoolClient, f: { especialidadeId?: number | null; procedimentoId?: number | null; quantidade: number }, u: Usuario) {
  const fila = (
    await c.query(
      `select x.id from age.lista_espera x join reg.avaliacao r on r.lista_espera_id = x.id and r.decisao = 'AUTORIZADO'
        where x.situacao = 'AGUARDANDO' and x.regulada and coalesce(x.especialidade_id, 0) = coalesce($1, 0) and coalesce(x.procedimento_id, 0) = coalesce($2, 0)
        order by x.prioridade_ordem, x.incluido_em limit $3`,
      [f.especialidadeId ?? null, f.procedimentoId ?? null, f.quantidade],
    )
  ).rows;
  const agendados: any[] = [];
  for (const { id } of fila) {
    const vaga = (await vagasRegulacao(c, { especialidade_id: f.especialidadeId ?? null, procedimento_id: f.procedimentoId ?? null }, 1))[0];
    if (!vaga) break;
    const ag = await agendarRegulado(c, id, { horarioId: vaga.id, confirmarAvisos: true, justificativa: null }, u);
    agendados.push({ listaEsperaId: id, data: ag.data, hora: ag.hora, senha: ag.senha });
  }
  return { agendados, semVagas: agendados.length < fila.length };
}

/** Requisições/agendamentos existentes do paciente para o mesmo procedimento ou especialidade (TR 1.2.43.1.13). */
export async function duplicidades(c: pg.PoolClient | pg.Pool, pacienteId: number, procedimentoId: number | null, especialidadeId: number | null) {
  return (
    await c.query(
      `select 'REQUISITADO' situacao, s.numero documento, s.data::text data, pr.nome item from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id
         join cad.procedimento pr on pr.id = i.procedimento_id where s.paciente_id = $1 and i.procedimento_id = $2 and i.situacao = 'REQUISITADO'
       union all
       select 'AGENDADO', a.senha, a.data::text, coalesce(pr.nome, e.nome) from age.agendamento a left join age.agendamento_procedimento ap on ap.agendamento_id = a.id
         left join cad.procedimento pr on pr.id = ap.procedimento_id left join cad.especialidade e on e.id = a.especialidade_id
        where a.paciente_id = $1 and a.situacao in ('AGENDADO','CONFIRMADO','SOLICITADO') and a.data >= current_date
          and (($2::bigint is not null and ap.procedimento_id = $2) or ($3::bigint is not null and a.especialidade_id = $3))
       union all
       select 'REQUISITADO', 'lista de espera', l.incluido_em::date::text, coalesce(pr.nome, e.nome) from age.lista_espera l left join cad.procedimento pr on pr.id = l.procedimento_id
         left join cad.especialidade e on e.id = l.especialidade_id
        where l.paciente_id = $1 and l.situacao = 'AGUARDANDO' and l.solicitacao_item_id is null
          and (($2::bigint is not null and l.procedimento_id = $2) or ($3::bigint is not null and l.especialidade_id = $3 and l.procedimento_id is null))`,
      [pacienteId, procedimentoId, especialidadeId],
    )
  ).rows as { situacao: 'REQUISITADO' | 'AGENDADO'; documento: string; data: string; item: string }[];
}

/** Exclusão de requisição de exames com justificativa no histórico de cancelamentos do paciente (TR 1.2.43.1.14). */
export async function excluirRequisicao(c: pg.PoolClient, requisicaoId: number, justificativa: string, u: Usuario) {
  const s = (await c.query(`select * from amb.solicitacao_exame where id = $1 for update`, [requisicaoId])).rows[0];
  if (!s) throw new ErroHttp(404, 'Requisição não encontrada.');
  if (s.situacao === 'CANCELADO') throw new ErroHttp(409, 'Requisição já excluída.');
  const realizados = (await c.query(`select count(*)::int n from amb.solicitacao_exame_item where solicitacao_id = $1 and situacao in ('COLETADO','REALIZADO','AVALIADO')`, [requisicaoId])).rows[0].n;
  if (realizados) throw new ErroHttp(409, 'Requisição com exames já coletados/realizados não pode ser excluída.');
  const itens = (await c.query(`select string_agg(pr.codigo || ' - ' || pr.nome, '; ') d from amb.solicitacao_exame_item i join cad.procedimento pr on pr.id = i.procedimento_id where i.solicitacao_id = $1`, [requisicaoId])).rows[0].d;
  await c.query(`update amb.solicitacao_exame set situacao = 'CANCELADO', motivo_cancelamento = $2 where id = $1`, [requisicaoId, justificativa.slice(0, 250)]);
  await c.query(`update amb.solicitacao_exame_item set situacao = 'CANCELADO' where solicitacao_id = $1 and situacao in ('REQUISITADO','AGENDADO')`, [requisicaoId]);
  await c.query(
    `update age.lista_espera set situacao = 'CANCELADO', motivo = $2 where solicitacao_item_id in (select id from amb.solicitacao_exame_item where solicitacao_id = $1) and situacao = 'AGUARDANDO'`,
    [requisicaoId, `Requisição excluída: ${justificativa}`.slice(0, 250)],
  );
  await registrarHistorico(c, { pacienteId: s.paciente_id, solicitacaoExameId: requisicaoId, acao: 'EXCLUSAO_REQUISICAO', de: `${s.numero}: ${itens ?? ''}`, para: 'CANCELADO', justificativa, u });
}
