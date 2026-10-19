// Autenticação do cidadão no aplicativo/portal: sessão própria (cookie separado do operador),
// política de senha (TR 1.2.41.4), bloqueio após tentativas inválidas (TR 1.2.41.5) e
// controle de acesso aos dados do próprio cidadão e de seus dependentes (TR 1.2.41.6).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { emProducao } from '../../config.js';
import { consultar, consultarUm, pool } from '../../db/pool.js';
import { gerarToken, hashToken } from '../../seguranca/senha.js';
import { ErroHttp } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';

export const COOKIE_CIDADAO = 'ubrisus_cidadao';

export interface Cidadao {
  contaId: number;
  pessoaId: number;
  nome: string;
  sessaoId: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    cidadao?: Cidadao;
  }
}

export async function iniciarSessaoCidadao(req: FastifyRequest, reply: FastifyReply, contaId: number) {
  const token = gerarToken();
  await pool.query(
    `insert into portal.sessao (token_hash, conta_id, inicio, ultimo_acesso, ip, agente) values ($1,$2,now(),now(),$3,$4)`,
    [hashToken(token), contaId, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300)],
  );
  await pool.query(`update portal.conta set ultimo_acesso_em = now(), tentativas_invalidas = 0 where id = $1`, [contaId]);
  reply.setCookie(COOKIE_CIDADAO, token, { path: '/api/cidadao', httpOnly: true, sameSite: 'strict', secure: emProducao });
}

export async function encerrarSessaoCidadao(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies?.[COOKIE_CIDADAO];
  if (token) await pool.query(`update portal.sessao set encerrada_em = now() where token_hash = $1 and encerrada_em is null`, [hashToken(token)]);
  reply.clearCookie(COOKIE_CIDADAO, { path: '/api/cidadao' });
}

/** Valida o cookie do cidadão; encerra sessões inativas além do limite parametrizado. */
export async function autenticarCidadao(req: FastifyRequest): Promise<Cidadao | undefined> {
  const token = req.cookies?.[COOKIE_CIDADAO];
  if (!token) return undefined;
  const s = await consultarUm(
    `select s.id, s.conta_id, s.ultimo_acesso, c.situacao, c.pessoa_id, p.nome
       from portal.sessao s join portal.conta c on c.id = s.conta_id left join cad.pessoa p on p.id = c.pessoa_id
      where s.token_hash = $1 and s.encerrada_em is null`,
    [hashToken(token)],
  );
  if (!s) return undefined;
  const limite = await parametro<number>('portal.sessao_inatividade_min', 30);
  if (Date.now() - new Date(s.ultimo_acesso).getTime() > limite * 60_000 || s.situacao !== 'ATIVA' || !s.pessoa_id) {
    await pool.query(`update portal.sessao set encerrada_em = now() where id = $1`, [s.id]);
    return undefined;
  }
  await pool.query(`update portal.sessao set ultimo_acesso = now() where id = $1`, [s.id]);
  return { contaId: s.conta_id, pessoaId: s.pessoa_id, nome: s.nome, sessaoId: s.id };
}

export function exigirCidadao(req: FastifyRequest): Cidadao {
  if (!req.cidadao) throw new ErroHttp(401, 'Sessão expirada. Entre novamente no aplicativo.');
  return req.cidadao;
}

export interface MembroFamilia {
  id: number;
  nome: string;
  sexo: string;
  nascimento: string;
  parentesco: string | null;
  situacao: string;
  cns: string | null;
  titular: boolean;
}

/** Titular e, quando responsável familiar, os integrantes da família (TR 1.2.41.6.1, 1.2.41.7.5). */
export async function membrosDaConta(c: Cidadao): Promise<MembroFamilia[]> {
  return consultar<MembroFamilia>(
    `with titular as (select id, familia_id from cad.pessoa where id = $1)
     select p.id, p.nome, p.sexo, p.data_nascimento::text nascimento, p.parentesco, p.situacao, p.cns, p.id = t.id titular
       from titular t join cad.pessoa p on p.id = t.id
         or (p.familia_id = t.familia_id and exists (select 1 from cad.familia f where f.id = t.familia_id and f.responsavel_id = t.id))
      where p.situacao <> 'FALECIDO'
      order by (p.id = t.id) desc, p.data_nascimento`,
    [c.pessoaId],
  );
}

/**
 * Pessoa sobre a qual o cidadão está agindo (ele próprio ou um dependente). Integrantes em
 * pré-cadastro têm todas as funcionalidades bloqueadas até a validação na unidade (TR 1.2.41.6.3).
 */
export async function pessoaPermitida(req: FastifyRequest, pessoaId?: number | string | null): Promise<MembroFamilia> {
  const c = exigirCidadao(req);
  const id = pessoaId ? Number(pessoaId) : c.pessoaId;
  const m = (await membrosDaConta(c)).find((x) => x.id === id);
  if (!m) throw new ErroHttp(403, 'Pessoa não vinculada à sua conta ou família.');
  if (m.situacao === 'PRE_CADASTRO') {
    throw new ErroHttp(423, 'Cadastro em validação: compareça à unidade de saúde mais próxima com um documento do integrante para confirmar o cadastro e liberar as funcionalidades.', { preCadastro: true });
  }
  return m;
}

type Manipulador = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/**
 * Registra uma rota do cidadão em /api/cidadao/*. A rota é pública para o hook de operadores
 * e autenticada aqui pela sessão do cidadão, com a mesma proteção CSRF do restante da API.
 */
export function rotaCidadao(app: FastifyInstance, metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, fn: Manipulador, opcoes: { anonima?: boolean; limite?: number } = {}) {
  app.route({
    method: metodo,
    url,
    config: { publica: true, ...(opcoes.limite ? { rateLimit: { max: opcoes.limite, timeWindow: '15 minutes' } } : {}) } as any,
    handler: async (req, reply) => {
      if (metodo !== 'GET' && req.headers['x-requested-with'] !== 'ubrisus') throw new ErroHttp(403, 'Requisição não originada pela aplicação.');
      req.cidadao = await autenticarCidadao(req);
      if (!opcoes.anonima && !req.cidadao) throw new ErroHttp(401, 'Sessão expirada. Entre novamente no aplicativo.');
      return fn(req, reply);
    },
  });
}
