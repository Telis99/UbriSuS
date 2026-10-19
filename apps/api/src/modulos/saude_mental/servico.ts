// Regras do ambulatório de saúde mental: procedimento padrão por tipo de atendimento, lançamento automático
// no RAAS psicossocial (ou na produção BPA), agendas dos programas na agenda da rede e sessões de oficina.
import type pg from 'pg';
import { alterar, inserir } from '../../meta/crud.js';
import { obterEntidade } from '../../meta/registro.js';
import type { Usuario } from '../../seguranca/usuario.js';
import { ErroHttp } from '../../seguranca/usuario.js';
import { gerarHorarios } from '../agendamento/servico.js';
import { lancarProducao } from '../faturamento/producao.js';
import { registrarAcaoRaas, tipoRaasDoProcedimento } from '../raas/servico.js';

export const PROCEDIMENTO_POR_TIPO: Record<string, string> = {
  INDIVIDUAL: '0301080208',
  GRUPO: '0301080216',
  FAMILIAR: '0301080224',
  DOMICILIAR: '0301080240',
  CRISE: '0301080291',
  ARTICULACAO: '0301080259',
  REABILITACAO: '0301080348',
  ACOLHIMENTO: '0301080232',
};

export async function procedimentoPadrao(c: pg.PoolClient, tipo: string, oficinaId?: number | null) {
  if (oficinaId) {
    const o = (await c.query(`select procedimento_id from caps.oficina where id = $1`, [oficinaId])).rows[0];
    if (o?.procedimento_id) return o.procedimento_id as number;
  }
  const codigo = PROCEDIMENTO_POR_TIPO[tipo];
  return codigo ? (((await c.query(`select id from cad.procedimento where codigo = $1`, [codigo])).rows[0]?.id as number | undefined) ?? null) : null;
}

/**
 * Registra o atendimento no instrumento correto, sem redigitação: procedimentos de RAAS psicossocial
 * viram ações do RAAS do usuário; os demais entram na produção ambulatorial (BPA).
 */
export async function faturarAtendimento(c: pg.PoolClient, at: { id: number; paciente_id: number; unidade_id: number; data: string; profissional_id: number | null; procedimento_id: number | null; local_realizacao?: string | null; cid_id?: number | null }, origem: string) {
  if (!at.procedimento_id) return {};
  const data = String(at.data).slice(0, 10);
  const tipo = await tipoRaasDoProcedimento(c, at.procedimento_id);
  if (tipo) {
    const id = await registrarAcaoRaas(c, {
      tipo,
      unidadeId: at.unidade_id,
      pacienteId: at.paciente_id,
      data,
      procedimentoId: at.procedimento_id,
      profissionalId: at.profissional_id,
      local: (at.local_realizacao as 'C' | 'T' | 'D') ?? 'C',
      origem,
      cidId: at.cid_id ?? null,
    });
    return { raasAcaoId: id };
  }
  const cid = at.cid_id ? (await c.query(`select codigo from cad.cid where id = $1`, [at.cid_id])).rows[0]?.codigo : null;
  const p = await lancarProducao(c, { data, unidadeId: at.unidade_id, profissionalId: at.profissional_id, procedimentoId: at.procedimento_id, pacienteId: at.paciente_id, cidCodigo: cid ?? null, origem: 'ATENDIMENTO', referencia: origem });
  return { producaoId: p?.id ?? null };
}

/** Cria ou atualiza a agenda da rede (tipo grupo) correspondente à agenda do programa (TR 1.2.46.4). */
export async function sincronizarAgendaPrograma(c: pg.PoolClient, agendaProgramaId: number, u: Usuario | undefined) {
  const a = (
    await c.query(
      `select ag.*, p.nome programa, p.unidade_id, o.nome oficina, l.nome local from caps.agenda ag join caps.programa p on p.id = ag.programa_id
         left join caps.oficina o on o.id = ag.oficina_id left join caps.local l on l.id = ag.local_id where ag.id = $1`,
      [agendaProgramaId],
    )
  ).rows[0];
  if (!a) return;
  const e = obterEntidade('agenda');
  if (!e) throw new ErroHttp(500, 'Cadastro de agendas indisponível.');
  const dados = {
    nome: `CAPS - ${a.programa}${a.oficina ? ' - ' + a.oficina : ''}`.slice(0, 120),
    tipo: 'GRUPO',
    unidade_id: a.unidade_id,
    local: a.local ?? null,
    profissional_id: a.profissional_id ?? null,
    vigencia_inicio: a.vigencia_inicio,
    vigencia_fim: a.vigencia_fim ?? null,
    dias_semana: a.dias_semana,
    intervalo_semanas: 1,
    hora_inicio: String(a.hora_inicio).slice(0, 5),
    hora_fim: String(a.hora_fim).slice(0, 5),
    vagas: a.vagas,
    ativo: a.ativo,
    descricao_especial: `Programa ${a.programa}`.slice(0, 80),
    especial: true,
  };
  const ctx = { usuarioId: u?.id ?? null, ip: 'caps', rotina: 'caps:agenda' };
  let agendaId = a.agenda_id as number | null;
  if (agendaId) await alterar(e, agendaId, dados, ctx, u, c);
  else {
    agendaId = (await inserir(e, dados, ctx, u, c)).id as number;
    await c.query(`update caps.agenda set agenda_id = $2 where id = $1`, [agendaProgramaId, agendaId]);
  }
  // Horários dos encontros (idempotente: datas já geradas são mantidas).
  await gerarHorarios(c, agendaId);
}
