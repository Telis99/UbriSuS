import type { FastifyReply, FastifyRequest } from 'fastify';
import { consultar, consultarUm, pool, type Contexto } from '../db/pool.js';
import { config } from '../config.js';
import { hashToken } from './senha.js';
import { moduloDaRotina } from '../meta/registro.js';

export interface Usuario {
  id: number;
  nome: string;
  login: string;
  email: string | null;
  administrador: boolean;
  encarregadoDados: boolean;
  permissoes: Set<string>;
  modulos: string[] | null;
  unidades: number[];
  unidadeAtual: number | null;
  profissionalId: number | null;
  gruposProfissionais: string[];
  sessaoId: string;
  horarioInicio: string | null;
  horarioFim: string | null;
  diasTrabalho: string[] | null;
  precisaTrocarSenha: boolean;
  precisaAceitarTermos: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: Usuario;
  }
}

export const NOME_COOKIE = 'ubrisus_sid';
export const VERSAO_TERMOS = '2026.1';

export class ErroHttp extends Error {
  constructor(
    public status: number,
    mensagem: string,
    public detalhes?: unknown,
  ) {
    super(mensagem);
  }
}

const cache = new Map<string, { usuario: Usuario; expira: number }>();

export function limparCacheSessao(sessaoId?: string) {
  if (sessaoId) cache.delete(sessaoId);
  else cache.clear();
}

/** Monta o usuário autenticado a partir da sessão. */
export async function carregarUsuario(sessaoId: string, operadorId: number, unidadeAtual: number | null): Promise<Usuario> {
  const op = await consultarUm(
    `select o.id, coalesce(o.nome, p.nome) as nome, o.login, p.email, o.administrador, o.oficial_protecao_dados,
            o.modulos, o.profissional_id, o.horario_inicio::text, o.horario_fim::text, o.dias_trabalho,
            o.senha_expirada, o.senha_alterada_em, o.senha_validade_dias, o.senha_validade_data, o.termos_aceitos_em,
            (select valor #>> '{}' from sis.parametro where chave = 'seguranca.versao_termos') as versao_termos_param
       from seg.operador o join cad.pessoa p on p.id = o.pessoa_id where o.id = $1`,
    [operadorId],
  );
  if (!op) throw new ErroHttp(401, 'Operador inexistente.');
  const perfis = await consultar<{ permissoes: string[] | null; grupo_profissional: string | null }>(
    `select pf.permissoes, pf.grupo_profissional from seg.operador_perfil op join seg.perfil pf on pf.id = op.perfil_id
      where op.operador_id = $1 and pf.ativo`,
    [operadorId],
  );
  const permissoes = new Set<string>();
  for (const p of perfis) for (const x of p.permissoes ?? []) permissoes.add(x);
  const unidades = (
    await consultar<{ unidade_id: number }>(`select unidade_id from seg.operador_unidade where operador_id = $1`, [operadorId])
  ).map((r) => r.unidade_id);

  let precisaTrocarSenha = !!op.senha_expirada;
  if (op.senha_validade_data && new Date(op.senha_validade_data) <= new Date()) precisaTrocarSenha = true;
  if (op.senha_validade_dias && op.senha_alterada_em) {
    const limite = new Date(op.senha_alterada_em);
    limite.setDate(limite.getDate() + op.senha_validade_dias);
    if (limite <= new Date()) precisaTrocarSenha = true;
  }

  return {
    id: op.id,
    nome: op.nome,
    login: op.login,
    email: op.email,
    administrador: op.administrador,
    encarregadoDados: op.oficial_protecao_dados,
    permissoes,
    modulos: op.modulos?.length ? op.modulos : null,
    unidades,
    unidadeAtual: unidadeAtual ?? unidades[0] ?? null,
    profissionalId: op.profissional_id,
    gruposProfissionais: [...new Set(perfis.map((p) => p.grupo_profissional).filter(Boolean) as string[])],
    sessaoId,
    horarioInicio: op.horario_inicio,
    horarioFim: op.horario_fim,
    diasTrabalho: op.dias_trabalho,
    precisaTrocarSenha,
    precisaAceitarTermos: !op.termos_aceitos_em,
  };
}

/** Valida o cookie de sessão; encerra sessões inativas além do limite configurado. */
export async function autenticar(req: FastifyRequest): Promise<Usuario | undefined> {
  const token = req.cookies?.[NOME_COOKIE];
  if (!token) return undefined;
  const th = hashToken(token);
  const emCache = cache.get(th);
  if (emCache && emCache.expira > Date.now()) return emCache.usuario;

  const s = await consultarUm(
    `select s.id, s.operador_id, s.ultimo_acesso, s.unidade_id, o.ativo, o.bloqueado
       from seg.sessao s join seg.operador o on o.id = s.operador_id
      where s.token_hash = $1 and s.encerrada_em is null`,
    [th],
  );
  if (!s) return undefined;
  const inativo = Date.now() - new Date(s.ultimo_acesso).getTime() > config.sessao.inatividadeMinutos * 60_000;
  if (inativo || !s.ativo || s.bloqueado) {
    await pool.query(`update seg.sessao set encerrada_em = now(), motivo_encerramento = $2 where id = $1`, [
      s.id,
      inativo ? 'inatividade' : 'operador bloqueado ou inativo',
    ]);
    return undefined;
  }
  await pool.query(`update seg.sessao set ultimo_acesso = now() where id = $1`, [s.id]);
  const usuario = await carregarUsuario(s.id, s.operador_id, s.unidade_id);
  cache.set(th, { usuario, expira: Date.now() + 30_000 });
  return usuario;
}

export function exigirUsuario(req: FastifyRequest): Usuario {
  if (!req.usuario) throw new ErroHttp(401, 'Sessão expirada. Faça login novamente.');
  return req.usuario;
}

export function temPermissao(u: Usuario, permissao: string): boolean {
  if (u.administrador) return true;
  if (u.permissoes.has(permissao) || u.permissoes.has('*')) return true;
  const [rotina, acao] = permissao.split(':');
  if (u.permissoes.has(`${rotina}:*`)) return true;
  // Permissão concedida para todo o módulo: 'MODULO:acao' ou 'MODULO:*'.
  const modulo = moduloDaRotina(rotina);
  return !!modulo && (u.permissoes.has(`${modulo}:${acao}`) || u.permissoes.has(`${modulo}:*`));
}

export function exigirPermissao(req: FastifyRequest, permissao: string): Usuario {
  const u = exigirUsuario(req);
  if (!temPermissao(u, permissao)) throw new ErroHttp(403, 'Operador sem permissão para esta ação.', { permissao });
  return u;
}

export function contextoDe(req: FastifyRequest, rotina?: string): Contexto {
  return { usuarioId: req.usuario?.id ?? null, ip: req.ip, rotina: rotina ?? req.routeOptions?.url ?? null };
}

export async function registrarRotina(req: FastifyRequest, rotina: string, acao: string, detalhe?: unknown) {
  await pool.query(`insert into aud.log_rotina (operador_id, rotina, acao, ip, detalhe) values ($1,$2,$3,$4,$5)`, [
    req.usuario?.id ?? null,
    rotina,
    acao,
    req.ip,
    detalhe ? JSON.stringify(detalhe) : null,
  ]);
}

export function responderErro(reply: FastifyReply, e: ErroHttp) {
  return reply.status(e.status).send({ erro: e.message, detalhes: e.detalhes });
}
