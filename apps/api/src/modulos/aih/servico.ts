// Regras do módulo de AIH: numeração por faixas com dígito verificador, aprovação, glosa, arquivamento,
// autorização individual e em massa, cancelamento, internação, saída/óbito e pagamento (TR 1.2.37).
import type pg from 'pg';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { conferirSenha } from '../../seguranca/senha.js';
import { parametro } from '../cadastros/alertas.js';

/** Dígito verificador da AIH/APAC: resto da divisão dos 12 primeiros dígitos por 11 (resto 10 = 0). */
export function digitoVerificador(base12: string) {
  const r = Number(BigInt(base12) % 11n);
  return r === 10 ? '0' : String(r);
}
export const montarNumero = (base12: bigint | string) => {
  const b = String(base12).padStart(12, '0');
  return b + digitoVerificador(b);
};
export function numeroValido(n: string) {
  return /^\d{13}$/.test(n) && digitoVerificador(n.slice(0, 12)) === n[12];
}
/** Base sequencial (12 dígitos) do número informado com ou sem DV. */
export const baseDe = (n: string) => BigInt(String(n).replace(/\D/g, '').slice(0, 12).padEnd(12, '0'));

export interface NumeroDisponivel {
  faixaId: number;
  orgaoEmissorId: number;
  numero: string;
}

/** Próximo número livre de uma faixa válida na data (TR 1.2.37.10). */
export async function proximoNumero(c: pg.PoolClient | pg.Pool, d: { tipo: 'AIH' | 'APAC'; unidadeId?: number | null; data?: string; aPartirDe?: string }): Promise<NumeroDisponivel | null> {
  const data = d.data ?? new Date().toISOString().slice(0, 10);
  const faixas = (
    await c.query(
      `select id, orgao_emissor_id, numero_inicial, quantidade from aih.faixa
        where tipo = $1 and ativo and $2::date between validade_inicio and validade_fim and (unidade_id is null or unidade_id = $3)
        order by (unidade_id is null), validade_inicio, id`,
      [d.tipo, data, d.unidadeId ?? null],
    )
  ).rows;
  const minimo = d.aPartirDe ? baseDe(d.aPartirDe) : null;
  for (const f of faixas) {
    const inicio = baseDe(f.numero_inicial);
    const fim = inicio + BigInt(f.quantidade) - 1n;
    if (minimo !== null && minimo > fim) continue;
    const desde = minimo !== null && minimo > inicio ? minimo : inicio;
    // Números já consumidos (utilizados ou cancelados) desta faixa a partir do ponto inicial.
    const usados = new Set(
      (await c.query(`select substr(numero, 1, 12) b from aih.numero where faixa_id = $1`, [f.id])).rows.map((r) => r.b as string),
    );
    for (let b = desde; b <= fim; b++) {
      const base = String(b).padStart(12, '0');
      if (!usados.has(base)) return { faixaId: f.id, orgaoEmissorId: f.orgao_emissor_id, numero: montarNumero(base) };
    }
  }
  return null;
}

/** Localiza a faixa que contém o número informado e verifica a validade. */
export async function faixaDoNumero(c: pg.PoolClient, tipo: 'AIH' | 'APAC', numero: string, data: string) {
  if (!numeroValido(numero)) throw new ErroHttp(422, `Número ${numero} inválido: são 13 dígitos com dígito verificador ${/^\d{12}/.test(numero) ? digitoVerificador(numero.slice(0, 12)) : '?'} (módulo 11).`);
  const b = baseDe(numero);
  const faixas = (await c.query(`select *, validade_inicio::text vi, validade_fim::text vf from aih.faixa where tipo = $1 and ativo`, [tipo])).rows;
  const f = faixas.find((x) => b >= baseDe(x.numero_inicial) && b < baseDe(x.numero_inicial) + BigInt(x.quantidade));
  if (!f) throw new ErroHttp(422, `O número ${numero} não pertence a nenhuma faixa de ${tipo} cadastrada.`);
  if (data < f.vi || data > f.vf) throw new ErroHttp(422, `A faixa do número ${numero} não está válida em ${data.split('-').reverse().join('/')}.`);
  const usado = (await c.query(`select documento, situacao from aih.numero where numero = $1`, [numero])).rows[0];
  if (usado) throw new ErroHttp(409, `O número ${numero} já foi ${usado.situacao === 'CANCELADO' ? 'cancelado' : 'utilizado'} (${usado.documento ?? ''}).`);
  return f;
}

export async function consumirNumero(c: pg.PoolClient, faixaId: number, numero: string, documento: string) {
  await c.query(`insert into aih.numero (faixa_id, numero, documento, situacao) values ($1,$2,$3,'UTILIZADO')`, [faixaId, numero, documento]);
}

export async function historico(c: pg.PoolClient, laudoId: number, acao: string, anterior: string | null, nova: string | null, detalhe: string | null, operadorId: number | null, liberadorId: number | null = null) {
  await c.query(
    `insert into aih.historico (laudo_id, acao, situacao_anterior, situacao_nova, detalhe, operador_id, liberador_id) values ($1,$2,$3,$4,$5,$6,$7)`,
    [laudoId, acao, anterior, nova, detalhe?.slice(0, 400) ?? null, operadorId, liberadorId],
  );
}

async function laudoParaAtualizar(c: pg.PoolClient, id: number) {
  const l = (await c.query(`select *, data_hora::date::text data_solicitacao, data_internacao::text data_internacao_txt from aih.laudo where id = $1 for update`, [id])).rows[0];
  if (!l) throw new ErroHttp(404, 'Laudo de AIH não encontrado.');
  return l;
}

/** Aprovação do laudo com data, hora e usuário (TR 1.2.37.7). */
export async function aprovar(c: pg.PoolClient, id: number, u: Usuario) {
  const l = await laudoParaAtualizar(c, id);
  if (!['SOLICITADO', 'GLOSADO'].includes(l.situacao)) throw new ErroHttp(409, `Laudo na situação ${l.situacao} não pode ser aprovado.`);
  await c.query(`update aih.laudo set situacao = 'APROVADO', aprovado_em = now(), aprovado_por = $2 where id = $1`, [id, u.id]);
  await historico(c, id, 'APROVACAO', l.situacao, 'APROVADO', null, u.id);
}

/** Glosa após a aprovação: retorna a "não aprovado" com data, hora e usuário (TR 1.2.37.8). */
export async function glosar(c: pg.PoolClient, id: number, motivo: string, u: Usuario) {
  const l = await laudoParaAtualizar(c, id);
  if (l.situacao !== 'APROVADO') throw new ErroHttp(409, 'Somente laudos aprovados (e ainda não autorizados) podem ser glosados.');
  await c.query(`update aih.laudo set situacao = 'GLOSADO', glosado_em = now(), glosado_por = $2, motivo_glosa = $3 where id = $1`, [id, u.id, motivo]);
  await historico(c, id, 'GLOSA', l.situacao, 'GLOSADO', motivo, u.id);
}

/** Arquivamento após a aprovação, com data, hora e usuário (TR 1.2.37.9). */
export async function arquivar(c: pg.PoolClient, id: number, motivo: string | null, u: Usuario) {
  const l = await laudoParaAtualizar(c, id);
  if (!['APROVADO', 'AUTORIZADO'].includes(l.situacao)) throw new ErroHttp(409, 'Somente laudos aprovados podem ser arquivados.');
  await c.query(`update aih.laudo set situacao = 'ARQUIVADO', arquivado_em = now(), arquivado_por = $2 where id = $1`, [id, u.id]);
  await historico(c, id, 'ARQUIVAMENTO', l.situacao, 'ARQUIVADO', motivo, u.id);
}

async function conferirAutorizador(c: pg.PoolClient, autorizadorId: number) {
  const p = (await c.query(`select id, nome, autorizador_aih, ativo from cad.profissional where id = $1`, [autorizadorId])).rows[0];
  if (!p) throw new ErroHttp(422, 'Profissional autorizador não encontrado.');
  if (!p.autorizador_aih || !p.ativo) throw new ErroHttp(422, `${p.nome} não está habilitado como autorizador de AIH no cadastro de profissionais.`);
  return p;
}

/** Autorização individual: número informado ou o próximo disponível da faixa (TR 1.2.37.10). */
export async function autorizar(c: pg.PoolClient, id: number, d: { numero?: string | null; autorizadorId: number; data?: string | null }, u: Usuario | null, origemDireta = false) {
  const l = await laudoParaAtualizar(c, id);
  if (!origemDireta && l.situacao !== 'APROVADO') throw new ErroHttp(409, `Laudo ${l.numero_laudo} precisa estar aprovado para ser autorizado (situação atual: ${l.situacao}).`);
  if (l.numero_aih) throw new ErroHttp(409, `Laudo ${l.numero_laudo} já autorizado com a AIH ${l.numero_aih}.`);
  await conferirAutorizador(c, d.autorizadorId);
  const data = d.data ?? new Date().toISOString().slice(0, 10);
  let numero = d.numero ? d.numero.replace(/\D/g, '') : null;
  let faixa: { id: number; orgao_emissor_id: number };
  if (numero) {
    if (numero.length === 12) numero = montarNumero(numero);
    faixa = await faixaDoNumero(c, 'AIH', numero, data);
  } else {
    const prox = await proximoNumero(c, { tipo: 'AIH', unidadeId: l.unidade_executante_id, data });
    if (!prox) throw new ErroHttp(422, 'Não há números de AIH disponíveis em faixa válida. Cadastre uma nova faixa numérica.');
    numero = prox.numero;
    faixa = { id: prox.faixaId, orgao_emissor_id: prox.orgaoEmissorId };
  }
  await consumirNumero(c, faixa.id, numero, `laudo ${l.numero_laudo}`);
  await c.query(
    `update aih.laudo set situacao = 'AUTORIZADO', numero_aih = $2, faixa_id = $3, orgao_emissor_id = $4, autorizador_id = $5,
            autorizado_em = $6::date + localtime, autorizado_por = $7, aprovado_em = coalesce(aprovado_em, now()), aprovado_por = coalesce(aprovado_por, $7),
            competencia = coalesce(competencia, to_char($6::date, 'YYYYMM'))
      where id = $1`,
    [id, numero, faixa.id, faixa.orgao_emissor_id, d.autorizadorId, data, u?.id ?? null],
  );
  await historico(c, id, 'AUTORIZACAO', l.situacao, 'AUTORIZADO', `AIH ${numero}`, u?.id ?? null);
  return { id, numero };
}

/** Autorização em massa a partir do primeiro número informado (TR 1.2.37.11). */
export async function autorizarLote(c: pg.PoolClient, ids: number[], d: { primeiroNumero?: string | null; autorizadorId: number; data?: string | null }, u: Usuario) {
  const data = d.data ?? new Date().toISOString().slice(0, 10);
  let atual = d.primeiroNumero ? d.primeiroNumero.replace(/\D/g, '') : null;
  if (atual && atual.length === 12) atual = montarNumero(atual);
  if (atual) await faixaDoNumero(c, 'AIH', atual, data);
  const resultado: { id: number; numero: string }[] = [];
  for (const id of ids) {
    const l = (await c.query(`select unidade_executante_id from aih.laudo where id = $1`, [id])).rows[0];
    const prox = await proximoNumero(c, { tipo: 'AIH', unidadeId: l?.unidade_executante_id, data, aPartirDe: atual ?? undefined });
    if (!prox) throw new ErroHttp(422, `Números de AIH insuficientes na faixa para autorizar ${ids.length} laudo(s): ${resultado.length} autorizado(s) antes de esgotar.`);
    resultado.push(await autorizar(c, id, { numero: prox.numero, autorizadorId: d.autorizadorId, data }, u));
    atual = montarNumero(baseDe(prox.numero) + 1n);
  }
  return resultado;
}

/**
 * Cancelamento da autorização com data, hora e operador; o número fica cancelado (não reaproveitado) e,
 * conforme parâmetro, exige a senha de um operador liberador (TR 1.2.37.13, 1.2.37.14).
 */
export async function cancelarAutorizacao(c: pg.PoolClient, id: number, d: { motivo: string; liberadorLogin?: string | null; liberadorSenha?: string | null }, u: Usuario) {
  const l = await laudoParaAtualizar(c, id);
  if (!l.numero_aih) throw new ErroHttp(409, 'O laudo não possui autorização a cancelar.');
  if (l.situacao_internacao === 'ALTA' && l.lote_id) throw new ErroHttp(409, 'AIH já exportada ao SISAIH01 com saída registrada não pode ter a autorização cancelada.');
  let liberadorId: number | null = null;
  if (await parametro<boolean>('aih.cancelamento_exige_liberador', true)) {
    if (!d.liberadorLogin || !d.liberadorSenha) throw new ErroHttp(428, 'O cancelamento da autorização exige a senha de um operador liberador.', { exigeLiberador: true });
    const op = (await c.query(`select id, senha_hash, administrador, ativo, bloqueado from seg.operador where login = $1`, [d.liberadorLogin])).rows[0];
    if (!op || !op.ativo || op.bloqueado || !(await conferirSenha(d.liberadorSenha, op.senha_hash))) throw new ErroHttp(401, 'Credenciais do operador liberador inválidas.');
    if (op.id === u.id && !op.administrador) throw new ErroHttp(403, 'O liberador deve ser um operador diferente do solicitante do cancelamento.');
    if (!op.administrador) {
      const perm = (
        await c.query(
          `select bool_or(pf.permissoes && array['*','AIH:*','aih_liberacao:executar','aih_liberacao:*']::text[]) ok from seg.operador_perfil op join seg.perfil pf on pf.id = op.perfil_id where op.operador_id = $1 and pf.ativo`,
          [op.id],
        )
      ).rows[0];
      if (!perm?.ok) throw new ErroHttp(403, 'O operador informado não tem permissão de liberador de AIH.');
    }
    liberadorId = op.id;
  }
  await c.query(`update aih.numero set situacao = 'CANCELADO' where numero = $1`, [l.numero_aih]);
  await c.query(
    `update aih.laudo set situacao = 'APROVADO', numero_aih = null, faixa_id = null, autorizado_em = null, autorizador_id = null,
            cancelado_em = now(), cancelado_por = $2, motivo_cancelamento = $3 where id = $1`,
    [id, u.id, d.motivo],
  );
  await historico(c, id, 'CANCELAMENTO_AUTORIZACAO', 'AUTORIZADO', 'APROVADO', `AIH ${l.numero_aih} cancelada: ${d.motivo}`, u.id, liberadorId);
}

export async function internar(c: pg.PoolClient, id: number, d: { data: string; enfermaria?: string | null; leito?: string | null }, u: Usuario) {
  const l = await laudoParaAtualizar(c, id);
  if (l.situacao !== 'AUTORIZADO') throw new ErroHttp(409, 'A internação só pode ser registrada após a autorização da AIH.');
  await c.query(`update aih.laudo set situacao_internacao = 'INTERNADO', data_internacao = $2, enfermaria = coalesce($3, enfermaria), leito = coalesce($4, leito) where id = $1`, [id, d.data, d.enfermaria ?? null, d.leito ?? null]);
  await historico(c, id, 'INTERNACAO', l.situacao_internacao, 'INTERNADO', `Internação em ${d.data.split('-').reverse().join('/')}`, u.id);
}

/**
 * Saída do paciente; em alta por óbito registra o falecimento e altera a situação do cadastro do
 * paciente para falecido, com a data e o usuário da operação (TR 1.2.37.16).
 */
export async function registrarSaida(
  c: pg.PoolClient,
  id: number,
  d: { data: string; motivo: string; procedimentoRealizadoId?: number | null; declaracaoObito?: string | null; dataObito?: string | null },
  u: Usuario,
) {
  const l = await laudoParaAtualizar(c, id);
  if (l.situacao !== 'AUTORIZADO' && l.situacao !== 'ARQUIVADO') throw new ErroHttp(409, 'A saída só pode ser registrada para AIH autorizada.');
  const inicio: string | null = l.data_internacao_txt;
  if (inicio && d.data < inicio) throw new ErroHttp(422, 'A data de saída não pode ser anterior à internação.');
  const obito = d.motivo.startsWith('4');
  await c.query(
    `update aih.laudo set situacao_internacao = 'ALTA', data_internacao = coalesce(data_internacao, $2::date), data_saida = $2, motivo_saida = $3,
            procedimento_realizado_id = coalesce($4, procedimento_realizado_id, procedimento_id), numero_declaracao_obito = $5,
            saida_registrada_por = $6, saida_registrada_em = now() where id = $1`,
    [id, d.data, d.motivo, d.procedimentoRealizadoId ?? null, obito ? (d.declaracaoObito ?? null) : null, u.id],
  );
  if (obito) {
    const dataObito = d.dataObito ?? d.data;
    await c.query(`update cad.pessoa set situacao = 'FALECIDO', data_obito = $2 where id = $1`, [l.paciente_id, dataObito]);
    await historico(c, id, 'OBITO', l.situacao_internacao, 'ALTA', `Óbito em ${dataObito.split('-').reverse().join('/')}${d.declaracaoObito ? ` - DO ${d.declaracaoObito}` : ''}; cadastro do paciente alterado para FALECIDO`, u.id);
  } else {
    await historico(c, id, 'SAIDA', l.situacao_internacao, 'ALTA', `Saída ${d.motivo} em ${d.data.split('-').reverse().join('/')}`, u.id);
  }
  // Procedimento principal realizado entra na lista de procedimentos da AIH, se ainda não houver.
  const tem = (await c.query(`select 1 from aih.procedimento where laudo_id = $1 and tipo = 'PRINCIPAL'`, [id])).rowCount;
  if (!tem) {
    await c.query(
      `insert into aih.procedimento (laudo_id, procedimento_id, data, quantidade, profissional_id, tipo, valor)
       select l.id, coalesce(l.procedimento_realizado_id, l.procedimento_id), $2, 1, coalesce(l.profissional_executante_id, l.profissional_solicitante_id), 'PRINCIPAL',
              coalesce(p.valor_sh, 0) + coalesce(p.valor_sp, 0)
         from aih.laudo l join cad.procedimento p on p.id = coalesce(l.procedimento_realizado_id, l.procedimento_id) where l.id = $1`,
      [id, inicio ?? d.data],
    );
  }
}

/** Identificação manual das AIHs pagas (TR 1.2.37.6). */
export async function marcarPaga(c: pg.PoolClient, id: number, paga: boolean, u: Usuario) {
  const l = await laudoParaAtualizar(c, id);
  if (!l.numero_aih) throw new ErroHttp(409, 'Somente AIHs autorizadas podem ser identificadas como pagas.');
  await c.query(`update aih.laudo set paga = $2, paga_em = case when $2 then now() end, paga_por = case when $2 then $3::bigint end where id = $1`, [id, paga, u.id]);
  await historico(c, id, paga ? 'PAGAMENTO' : 'ESTORNO_PAGAMENTO', null, null, paga ? 'AIH identificada como paga' : 'Identificação de pagamento desfeita', u.id);
}
