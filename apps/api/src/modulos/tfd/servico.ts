// Fluxo do processo de TFD: numeração, trâmites e decisões sobre o laudo e o tratamento,
// sempre com registro automático de data, hora, usuário e motivo (TR 1.2.35.4 a 1.2.35.18).
import type pg from 'pg';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';

export const ROTULO_SITUACAO: Record<string, string> = {
  ABERTO: 'Aberto',
  APROVADO: 'Aprovado',
  GLOSADO: 'Glosado',
  ARQUIVADO: 'Arquivado',
  NEGADO: 'Negado',
  AUTORIZADO: 'Autorizado',
};

/** Situação atual do processo (laudo e tratamento) para telas e relatórios. */
export const SQL_SITUACAO_ATUAL = (a = 'l') => `(case ${a}.situacao when 'ABERTO' then 'Aberto' when 'APROVADO' then 'Aprovado' when 'GLOSADO' then 'Glosado'
  when 'ARQUIVADO' then 'Arquivado' when 'NEGADO' then 'Negado' when 'AUTORIZADO' then 'Autorizado' else ${a}.situacao end
  || case when ${a}.situacao in ('APROVADO','AUTORIZADO') then ' · tratamento ' || lower(case ${a}.situacao_tratamento when 'PENDENTE' then 'pendente' when 'AUTORIZADO' then 'autorizado' when 'NEGADO' then 'negado' else '' end) else '' end)`;

export async function registrarTramite(c: pg.PoolClient, laudoId: number, acao: string, descricao: string | null, situacao: string | null, u?: Usuario | null) {
  await c.query(`insert into tfd.laudo_tramite (laudo_id, data_hora, acao, descricao, situacao, operador_id) values ($1, now(), $2, $3, $4, $5)`, [laudoId, acao, descricao, situacao, u?.id ?? null]);
}

/** Próximo número do laudo no formato AAAA/NNNNN. */
export async function proximoNumero(c: pg.PoolClient, data?: string | null) {
  const ano = (data ?? new Date().toISOString()).slice(0, 4);
  await c.query(`select pg_advisory_xact_lock(hashtext('tfd.laudo.numero'))`);
  const r = await c.query(`select coalesce(max(split_part(numero, '/', 2)::int), 0) + 1 n from tfd.laudo where numero like $1`, [`${ano}/%`]);
  return `${ano}/${String(r.rows[0].n).padStart(5, '0')}`;
}

export type AcaoLaudo =
  | 'aprovar'
  | 'glosar'
  | 'arquivar'
  | 'negar'
  | 'autorizar'
  | 'cancelar-autorizacao'
  | 'negar-tratamento'
  | 'autorizar-tratamento'
  | 'cancelar-tratamento'
  | 'reapresentar'
  | 'agendar';

export interface DadosAcao {
  motivo?: string | null;
  localTratamentoId?: number | null;
  dataHoraAgendamento?: string | null;
}

const exigirMotivo = (d: DadosAcao, oque: string) => {
  if (!d.motivo || d.motivo.trim().length < 3) throw new ErroHttp(422, `Informe o motivo ${oque}.`, { motivo: 'Obrigatório.' });
  return d.motivo.trim();
};

/** Executa uma decisão sobre o laudo ou o tratamento, validando a situação atual. */
export async function executarAcao(c: pg.PoolClient, id: number, acao: AcaoLaudo, d: DadosAcao, u: Usuario) {
  const l = (await c.query(`select * from tfd.laudo where id = $1 for update`, [id])).rows[0];
  if (!l) throw new ErroHttp(404, 'Laudo não encontrado.');
  const exigir = (situacoes: string[], msg: string) => {
    if (!situacoes.includes(l.situacao)) throw new ErroHttp(422, `${msg} (situação atual: ${ROTULO_SITUACAO[l.situacao] ?? l.situacao}).`);
  };
  const atualizar = async (sql: string, params: unknown[]) => c.query(`update tfd.laudo set ${sql} where id = $1`, [id, ...params]);
  switch (acao) {
    // Aprovação do laudo após a inclusão (TR 1.2.35.7).
    case 'aprovar':
      exigir(['ABERTO'], 'Somente laudos abertos podem ser aprovados');
      await atualizar(`situacao = 'APROVADO', situacao_tratamento = 'PENDENTE', aprovado_em = now(), aprovado_por = $2, motivo_decisao = null`, [u.id]);
      await registrarTramite(c, id, 'Laudo aprovado', d.motivo ?? null, 'APROVADO', u);
      break;
    // Glosa com motivo (TR 1.2.35.8).
    case 'glosar': {
      exigir(['ABERTO', 'APROVADO'], 'O laudo não pode ser glosado');
      const m = exigirMotivo(d, 'da glosa');
      await atualizar(`situacao = 'GLOSADO', motivo_decisao = $2`, [m]);
      await registrarTramite(c, id, 'Laudo glosado', m, 'GLOSADO', u);
      break;
    }
    // Arquivamento com motivo (TR 1.2.35.9).
    case 'arquivar': {
      if (l.situacao === 'ARQUIVADO') throw new ErroHttp(422, 'Laudo já arquivado.');
      const m = exigirMotivo(d, 'do arquivamento');
      await atualizar(`situacao = 'ARQUIVADO', motivo_decisao = $2`, [m]);
      await registrarTramite(c, id, 'Laudo arquivado', m, 'ARQUIVADO', u);
      break;
    }
    // Negação do laudo após a aprovação (TR 1.2.35.10).
    case 'negar': {
      exigir(['APROVADO'], 'Somente laudos aprovados podem ser negados');
      const m = exigirMotivo(d, 'da negação');
      await atualizar(`situacao = 'NEGADO', motivo_decisao = $2`, [m]);
      await registrarTramite(c, id, 'Laudo negado', m, 'NEGADO', u);
      break;
    }
    // Autorização do laudo após a aprovação (TR 1.2.35.11).
    case 'autorizar':
      exigir(['APROVADO'], 'Somente laudos aprovados podem ser autorizados');
      await atualizar(`situacao = 'AUTORIZADO', autorizado_em = now(), autorizado_por = $2, motivo_decisao = null`, [u.id]);
      await registrarTramite(c, id, 'Laudo autorizado (pedido de TFD liberado para impressão)', d.motivo ?? null, 'AUTORIZADO', u);
      break;
    // Cancelamento da autorização do pedido (TR 1.2.35.13).
    case 'cancelar-autorizacao': {
      exigir(['AUTORIZADO'], 'O laudo não está autorizado');
      const m = exigirMotivo(d, 'do cancelamento da autorização');
      await atualizar(`situacao = 'APROVADO', autorizado_em = null, autorizado_por = null, motivo_decisao = $2`, [m]);
      await registrarTramite(c, id, 'Autorização do pedido de TFD cancelada', m, 'APROVADO', u);
      break;
    }
    // Negação do tratamento após a aprovação (TR 1.2.35.14).
    case 'negar-tratamento': {
      exigir(['APROVADO', 'AUTORIZADO'], 'O tratamento só pode ser avaliado após a aprovação do laudo');
      if (l.situacao_tratamento !== 'PENDENTE') throw new ErroHttp(422, 'O tratamento já foi avaliado; cancele a autorização antes.');
      const m = exigirMotivo(d, 'da negação do tratamento');
      await atualizar(`situacao_tratamento = 'NEGADO', motivo_decisao = $2`, [m]);
      await registrarTramite(c, id, 'Tratamento negado', m, 'TRATAMENTO NEGADO', u);
      break;
    }
    // Autorização do tratamento com local e motivo obrigatórios (TR 1.2.35.15).
    case 'autorizar-tratamento': {
      exigir(['APROVADO', 'AUTORIZADO'], 'O tratamento só pode ser autorizado após a aprovação do laudo');
      if (l.situacao_tratamento === 'AUTORIZADO') throw new ErroHttp(422, 'Tratamento já autorizado.');
      if (!d.localTratamentoId) throw new ErroHttp(422, 'Informe o local de tratamento.', { localTratamentoId: 'Obrigatório.' });
      const m = exigirMotivo(d, 'da autorização do tratamento');
      const local = (await c.query(`select ld.nome, m.nome municipio from tra.local_destino ld join cad.municipio m on m.id = ld.municipio_id where ld.id = $1`, [d.localTratamentoId])).rows[0];
      if (!local) throw new ErroHttp(404, 'Local de tratamento não encontrado.');
      await atualizar(
        `situacao_tratamento = 'AUTORIZADO', local_tratamento_id = $2, motivo_tratamento = $3, tratamento_autorizado_em = now(), tratamento_autorizado_por = $4,
         agendamento_data_hora = coalesce($5::timestamptz, agendamento_data_hora), motivo_decisao = null`,
        [d.localTratamentoId, m, u.id, d.dataHoraAgendamento ?? null],
      );
      await registrarTramite(c, id, 'Tratamento autorizado', `Local: ${local.nome} (${local.municipio}). Motivo: ${m}`, 'TRATAMENTO AUTORIZADO', u);
      break;
    }
    // Cancelamento da autorização do tratamento; agendamentos de transporte futuros são cancelados (TR 1.2.35.16).
    case 'cancelar-tratamento': {
      if (l.situacao_tratamento !== 'AUTORIZADO') throw new ErroHttp(422, 'O tratamento não está autorizado.');
      const m = exigirMotivo(d, 'do cancelamento da autorização do tratamento');
      await atualizar(`situacao_tratamento = 'PENDENTE', tratamento_autorizado_em = null, tratamento_autorizado_por = null, motivo_decisao = $2`, [m]);
      const r = await c.query(
        `update tra.viagem_passageiro vp set situacao = 'CANCELADO', observacao = concat_ws(' | ', vp.observacao, 'Autorização do TFD cancelada') from tra.viagem v
          where v.id = vp.viagem_id and vp.tfd_laudo_id = $1 and vp.situacao in ('AGENDADO','CONFIRMADO') and v.situacao in ('ABERTA','CONFIRMADA')`,
        [id],
      );
      await registrarTramite(c, id, 'Autorização do tratamento cancelada', m + (r.rowCount ? ` (${r.rowCount} agendamento(s) de transporte cancelado(s))` : ''), 'TRATAMENTO PENDENTE', u);
      break;
    }
    // Reapresentação do laudo glosado após correção.
    case 'reapresentar':
      exigir(['GLOSADO'], 'Somente laudos glosados podem ser reapresentados');
      await atualizar(`situacao = 'ABERTO', motivo_decisao = null`, []);
      await registrarTramite(c, id, 'Laudo reapresentado após correção', d.motivo ?? null, 'ABERTO', u);
      break;
    // Data e hora do atendimento agendado no destino (base do relatório por destino, TR 1.2.35.20).
    case 'agendar': {
      if (l.situacao_tratamento !== 'AUTORIZADO') throw new ErroHttp(422, 'Autorize o tratamento antes de registrar o agendamento no destino.');
      if (!d.dataHoraAgendamento || isNaN(Date.parse(d.dataHoraAgendamento))) throw new ErroHttp(422, 'Informe a data e hora do atendimento.');
      await atualizar(`agendamento_data_hora = $2`, [d.dataHoraAgendamento]);
      await registrarTramite(c, id, 'Atendimento agendado no destino', new Date(d.dataHoraAgendamento).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), null, u);
      break;
    }
    default:
      throw new ErroHttp(404, 'Ação inexistente.');
  }
  return (await c.query(`select id, numero, situacao, situacao_tratamento from tfd.laudo where id = $1`, [id])).rows[0];
}
