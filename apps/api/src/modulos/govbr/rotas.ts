// Login Único gov.br (OpenID Connect com PKCE) para operadores e cidadãos (TR 1.1.1.29.5, 1.1.1.29.5.1, 1.1.1.29.5.1.1).
// Fica inativo até a contratante firmar o convênio e informar as credenciais em "integracao.govbr".
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { emProducao } from '../../config.js';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { consultarUm } from '../../db/pool.js';
import { iniciarSessao, logAcesso, vinculoAtivo } from '../../seguranca/rotas.js';
import { NOME_COOKIE } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';

interface ConfigGovbr {
  ativo: boolean;
  /** https://sso.acesso.gov.br (produção) ou https://sso.staging.acesso.gov.br (homologação). */
  urlProvedor: string;
  clientId: string;
  clientSecret: string;
  /** Endereço público do sistema, ex.: https://saude.cabreuva.sp.gov.br */
  urlSistema: string;
  escopos: string;
  /** Nível mínimo da conta gov.br aceito: bronze, prata ou ouro. */
  nivelMinimo: 'bronze' | 'prata' | 'ouro';
}

registrarParametro(
  'integracao.govbr',
  { ativo: false, urlProvedor: 'https://sso.staging.acesso.gov.br', clientId: '', clientSecret: '', urlSistema: '', escopos: 'openid email profile govbr_confiabilidades', nivelMinimo: 'bronze' },
  'Login Único gov.br: credenciais do convênio firmado com o governo federal',
  'TEC',
);

export interface DadosGovbr {
  cpf: string;
  nome: string;
  email?: string;
  telefone?: string;
  nivel: string;
}

/**
 * Destinos do login: o portal do cidadão registra o seu (localiza ou cria a conta do cidadão pelo CPF,
 * dispensando pré-cadastro e aprovação) e devolve o endereço para onde o navegador segue.
 */
type Destino = (req: FastifyRequest, reply: FastifyReply, d: DadosGovbr) => Promise<string>;
const destinos = new Map<string, Destino>();
export function registrarDestinoGovbr(nome: string, fn: Destino) {
  destinos.set(nome, fn);
}

const COOKIE_ESTADO = 'ubrisus_govbr';
const b64url = (b: Buffer) => b.toString('base64url');
const NIVEIS = ['bronze', 'prata', 'ouro'];

// Operador: CPF da conta gov.br igual ao login do operador, autorizado a entrar por gov.br.
registrarDestinoGovbr('operador', async (req, reply, d) => {
  const op = await consultarUm(`select o.* from seg.operador o where o.login = $1`, [d.cpf]);
  if (!op || !op.ativo) {
    await logAcesso(req, 'falha', op?.id ?? null, d.cpf, 'gov.br: operador não cadastrado ou inativo');
    return '/?erro=' + encodeURIComponent('CPF da conta gov.br sem operador ativo no sistema.');
  }
  if (op.bloqueado) return '/?erro=' + encodeURIComponent('Acesso bloqueado. Solicite o desbloqueio ao administrador.');
  if (op.metodos_login?.length && !op.metodos_login.includes('GOVBR')) {
    await logAcesso(req, 'falha', op.id, d.cpf, 'gov.br não autorizado para o operador');
    return '/?erro=' + encodeURIComponent('Este operador não está autorizado a entrar com a conta gov.br.');
  }
  if (op.acesso_ate && new Date(op.acesso_ate) < new Date()) return '/?erro=' + encodeURIComponent('O período de acesso temporário deste operador terminou.');
  if (op.validar_vinculo && op.profissional_id && !(await vinculoAtivo(op.profissional_id)))
    return '/?erro=' + encodeURIComponent('Acesso não permitido: vínculo de trabalho inativo ou período de férias/afastamento.');
  const { token } = await iniciarSessao(req, op.id, op.unidade_padrao_id);
  await logAcesso(req, 'login', op.id, d.cpf, `gov.br (nível ${d.nivel})`);
  reply.setCookie(NOME_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: emProducao });
  return '/';
});

async function jwks(url: string): Promise<any[]> {
  const r = await fetch(`${url}/jwk`);
  if (!r.ok) throw new Error(`gov.br: chaves públicas indisponíveis (${r.status})`);
  return ((await r.json()) as any).keys ?? [];
}

/** Valida a assinatura RS256 e as declarações do id_token emitido pelo gov.br. */
async function validarIdToken(cfg: ConfigGovbr, idToken: string, nonce: string) {
  const [h, p, s] = idToken.split('.');
  const cab = JSON.parse(Buffer.from(h, 'base64url').toString());
  const dados = JSON.parse(Buffer.from(p, 'base64url').toString());
  const chave = (await jwks(cfg.urlProvedor)).find((k) => !cab.kid || k.kid === cab.kid);
  if (!chave) throw new Error('gov.br: chave de assinatura não encontrada');
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: chave, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('gov.br: assinatura do token inválida');
  if (dados.aud !== cfg.clientId && !(Array.isArray(dados.aud) && dados.aud.includes(cfg.clientId))) throw new Error('gov.br: token emitido para outro sistema');
  if (!String(dados.iss ?? '').startsWith(cfg.urlProvedor)) throw new Error('gov.br: emissor inesperado');
  if (dados.exp * 1000 < Date.now()) throw new Error('gov.br: token expirado');
  if (dados.nonce !== nonce) throw new Error('gov.br: nonce inválido');
  return dados;
}

/** Nível da conta (bronze/prata/ouro) a partir das confiabilidades informadas pelo gov.br. */
async function nivelConta(cfg: ConfigGovbr, cpf: string, accessToken: string) {
  try {
    const r = await fetch(`${cfg.urlProvedor.replace('sso.', 'api.')}/confiabilidades/v3/contas/${cpf}/niveis?response-type=ids`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return 'bronze';
    const ids = ((await r.json()) as any[]).map((n) => String(n.id ?? n));
    return ids.includes('3') ? 'ouro' : ids.includes('2') ? 'prata' : 'bronze';
  } catch {
    return 'bronze';
  }
}

export default async function rotasGovbr(app: FastifyInstance) {
  app.get('/api/auth/govbr', { config: { publica: true } }, async (req, reply) => {
    const cfg = await parametro<ConfigGovbr>('integracao.govbr', {} as ConfigGovbr);
    const destino = String((req.query as any).destino ?? 'operador');
    if (!cfg.ativo || !cfg.clientId || !destinos.has(destino))
      return reply.redirect((destino === 'cidadao' ? '/cidadao' : '/') + '?erro=' + encodeURIComponent('Login com gov.br indisponível: depende de convênio do Município com o governo federal.'));
    const estado = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const verificador = b64url(randomBytes(48));
    // Retorno vem de outro site: o cookie do estado precisa ser SameSite=Lax.
    reply.setCookie(COOKIE_ESTADO, JSON.stringify({ estado, nonce, verificador, destino }), {
      path: '/api/auth/govbr',
      httpOnly: true,
      sameSite: 'lax',
      secure: emProducao,
      signed: true,
      maxAge: 600,
    });
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      scope: cfg.escopos,
      redirect_uri: `${cfg.urlSistema}/api/auth/govbr/retorno`,
      nonce,
      state: estado,
      code_challenge: b64url(createHash('sha256').update(verificador).digest()),
      code_challenge_method: 'S256',
    });
    return reply.redirect(`${cfg.urlProvedor}/authorize?${q}`);
  });

  app.get('/api/auth/govbr/retorno', { config: { publica: true } }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const bruto = req.cookies[COOKIE_ESTADO];
    const lido = bruto ? req.unsignCookie(bruto) : null;
    reply.clearCookie(COOKIE_ESTADO, { path: '/api/auth/govbr' });
    const st = lido?.valid && lido.value ? JSON.parse(lido.value) : null;
    const falhar = (msg: string) => reply.redirect((st?.destino === 'cidadao' ? '/cidadao' : '/') + '?erro=' + encodeURIComponent(msg));
    if (!st || st.estado !== q.state) return falhar('Sessão de login gov.br inválida ou expirada. Tente novamente.');
    if (q.error || !q.code) return falhar('Login gov.br cancelado.');
    const cfg = await parametro<ConfigGovbr>('integracao.govbr', {} as ConfigGovbr);
    try {
      const r = await fetch(`${cfg.urlProvedor}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64') },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: `${cfg.urlSistema}/api/auth/govbr/retorno`, code_verifier: st.verificador }),
      });
      if (!r.ok) throw new Error(`gov.br recusou o código (${r.status})`);
      const t = (await r.json()) as { id_token: string; access_token: string };
      const dados = await validarIdToken(cfg, t.id_token, st.nonce);
      const cpf = String(dados.sub).replace(/\D/g, '');
      const nivel = await nivelConta(cfg, cpf, t.access_token);
      if (NIVEIS.indexOf(nivel) < NIVEIS.indexOf(cfg.nivelMinimo ?? 'bronze')) return falhar(`É necessária conta gov.br nível ${cfg.nivelMinimo} ou superior.`);
      const destino = destinos.get(st.destino)!;
      return reply.redirect(await destino(req, reply, { cpf, nome: dados.name, email: dados.email_verified ? dados.email : undefined, telefone: dados.phone_number, nivel }));
    } catch (e) {
      req.log.error(e);
      return falhar('Não foi possível concluir o login com gov.br. Tente novamente ou use CPF e senha.');
    }
  });
}
