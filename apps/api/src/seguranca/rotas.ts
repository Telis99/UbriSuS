// Autenticação, sessões e administração de acesso de operadores.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { emProducao } from '../config.js';
import { consultar, consultarUm, pool, transacao } from '../db/pool.js';
import { forcaSenha, somenteDigitos } from '../compartilhado/validacao.js';
import { enviarEmail } from '../servicos/mensageria.js';
import { conferirSenha, gerarHashSenha, gerarSenhaTemporaria, gerarToken, hashToken } from './senha.js';
import {
  ErroHttp,
  NOME_COOKIE,
  VERSAO_TERMOS,
  contextoDe,
  exigirPermissao,
  exigirUsuario,
  limparCacheSessao,
} from './usuario.js';

const MAX_TENTATIVAS = 3;

export async function logAcesso(req: FastifyRequest, evento: string, operadorId: number | null, login: string, detalhe?: string) {
  await pool.query(`insert into aud.log_acesso (operador_id, login, evento, ip, agente, detalhe) values ($1,$2,$3,$4,$5,$6)`, [
    operadorId,
    login,
    evento,
    req.ip,
    req.headers['user-agent'] ?? null,
    detalhe ?? null,
  ]);
}

/** Valida contrato de trabalho ativo e ausência de férias/afastamento (TR 1.1.1.32.2). */
export async function vinculoAtivo(profissionalId: number): Promise<boolean> {
  const v = await consultarUm(
    `select count(*)::int as n from cad.vinculo
      where profissional_id = $1 and ativo
        and (data_fim is null or data_fim >= current_date)
        and (em_ferias_ate is null or em_ferias_ate < current_date)`,
    [profissionalId],
  );
  return (v?.n ?? 0) > 0;
}

export async function iniciarSessao(req: FastifyRequest, operadorId: number, unidadeId: number | null) {
  const token = gerarToken();
  const s = await consultarUm<{ id: string }>(
    `insert into seg.sessao (token_hash, operador_id, ip, agente, unidade_id) values ($1,$2,$3,$4,$5) returning id`,
    [hashToken(token), operadorId, req.ip, req.headers['user-agent'] ?? null, unidadeId],
  );
  return { token, sessaoId: s!.id };
}

export async function rotasSeguranca(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { publica: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const corpo = z.object({ login: z.string().min(1), senha: z.string().min(1) }).parse(req.body);
    const login = somenteDigitos(corpo.login) || corpo.login.trim();
    const op = await consultarUm(
      `select o.*, p.email from seg.operador o join cad.pessoa p on p.id = o.pessoa_id where o.login = $1`,
      [login],
    );
    if (!op) {
      await logAcesso(req, 'falha', null, login, 'login inexistente');
      throw new ErroHttp(401, 'Login ou senha inválidos.');
    }
    if (!op.ativo) {
      await logAcesso(req, 'falha', op.id, login, 'operador inativo');
      throw new ErroHttp(403, 'Operador inativo. Procure o administrador do sistema.');
    }
    if (op.bloqueado) {
      await logAcesso(req, 'falha', op.id, login, 'operador bloqueado');
      throw new ErroHttp(423, 'Acesso bloqueado após tentativas inválidas. Solicite o desbloqueio ao administrador ou recupere a senha.');
    }
    if (op.metodos_login?.length && !op.metodos_login.includes('SENHA')) {
      throw new ErroHttp(403, 'Este operador não está autorizado a entrar com CPF e senha.');
    }
    if (!(await conferirSenha(corpo.senha, op.senha_hash))) {
      const tentativas = (op.tentativas_invalidas ?? 0) + 1;
      const bloquear = tentativas >= MAX_TENTATIVAS;
      await transacao({ usuarioId: op.id, ip: req.ip, rotina: 'login' }, (c) =>
        c.query(`update seg.operador set tentativas_invalidas = $2, bloqueado = $3 where id = $1`, [op.id, tentativas, bloquear]),
      );
      await logAcesso(req, bloquear ? 'bloqueio' : 'falha', op.id, login, `tentativa ${tentativas}`);
      throw new ErroHttp(
        401,
        bloquear
          ? 'Acesso bloqueado após 3 tentativas inválidas.'
          : `Login ou senha inválidos. Restam ${MAX_TENTATIVAS - tentativas} tentativa(s) antes do bloqueio.`,
      );
    }
    if (op.acesso_ate && new Date(op.acesso_ate) < new Date()) {
      await logAcesso(req, 'falha', op.id, login, 'acesso temporário expirado');
      throw new ErroHttp(403, 'O período de acesso temporário deste operador terminou.');
    }
    if (op.validar_vinculo && op.profissional_id && !(await vinculoAtivo(op.profissional_id))) {
      await logAcesso(req, 'falha', op.id, login, 'sem vínculo ativo ou em férias');
      throw new ErroHttp(403, 'Acesso não permitido: vínculo de trabalho inativo ou período de férias/afastamento.');
    }
    await transacao({ usuarioId: op.id, ip: req.ip, rotina: 'login' }, (c) =>
      c.query(`update seg.operador set tentativas_invalidas = 0 where id = $1 and tentativas_invalidas <> 0`, [op.id]),
    );
    const { token } = await iniciarSessao(req, op.id, op.unidade_padrao_id);
    await logAcesso(req, 'login', op.id, login);
    reply.setCookie(NOME_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: emProducao, signed: false });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const u = req.usuario;
    if (u) {
      await pool.query(`update seg.sessao set encerrada_em = now(), motivo_encerramento = 'logout' where id = $1`, [u.sessaoId]);
      await logAcesso(req, 'logout', u.id, u.login);
    }
    limparCacheSessao();
    reply.clearCookie(NOME_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/eu', async (req) => {
    const u = exigirUsuario(req);
    const unidades = await consultar(
      u.administrador && !u.unidades.length
        ? `select id, nome from cad.unidade where ativo order by nome`
        : `select id, nome from cad.unidade where id = any($1) order by nome`,
      u.administrador && !u.unidades.length ? [] : [u.unidades],
    );
    const termos = await consultarUm(`select valor from sis.parametro where chave = 'seguranca.termos_uso'`);
    return {
      id: u.id,
      nome: u.nome,
      login: u.login,
      email: u.email,
      administrador: u.administrador,
      encarregadoDados: u.encarregadoDados,
      permissoes: [...u.permissoes],
      modulos: u.modulos,
      unidades,
      unidadeAtual: u.unidadeAtual,
      profissionalId: u.profissionalId,
      gruposProfissionais: u.gruposProfissionais,
      precisaTrocarSenha: u.precisaTrocarSenha,
      precisaAceitarTermos: u.precisaAceitarTermos,
      termosUso: u.precisaAceitarTermos ? (termos?.valor ?? null) : undefined,
    };
  });

  app.post('/api/auth/unidade', async (req) => {
    const u = exigirUsuario(req);
    const { unidadeId } = z.object({ unidadeId: z.number().int() }).parse(req.body);
    if (!u.administrador && !u.unidades.includes(unidadeId)) throw new ErroHttp(403, 'Unidade não autorizada para o operador.');
    await pool.query(`update seg.sessao set unidade_id = $2 where id = $1`, [u.sessaoId, unidadeId]);
    limparCacheSessao();
    return { ok: true };
  });

  // Termos e condições de uso no primeiro login (TR 1.1.1.35).
  app.post('/api/auth/aceitar-termos', async (req) => {
    const u = exigirUsuario(req);
    await transacao(contextoDe(req, 'termos'), async (c) => {
      await c.query(`update seg.operador set termos_aceitos_em = now() where id = $1`, [u.id]);
      await c.query(`insert into sis.aceite (tipo, versao, operador_id, ip, agente) values ('termos_uso', $1, $2, $3, $4)`, [
        VERSAO_TERMOS,
        u.id,
        req.ip,
        req.headers['user-agent'] ?? null,
      ]);
    });
    limparCacheSessao();
    return { ok: true };
  });

  app.post('/api/auth/trocar-senha', async (req) => {
    const u = exigirUsuario(req);
    const { senhaAtual, novaSenha } = z.object({ senhaAtual: z.string(), novaSenha: z.string().min(8) }).parse(req.body);
    const op = await consultarUm(`select senha_hash from seg.operador where id = $1`, [u.id]);
    if (!(await conferirSenha(senhaAtual, op?.senha_hash))) throw new ErroHttp(400, 'Senha atual incorreta.');
    if (forcaSenha(novaSenha) === 'fraca') throw new ErroHttp(400, 'Senha fraca: use letras maiúsculas e minúsculas, números e símbolos.');
    if (await conferirSenha(novaSenha, op?.senha_hash)) throw new ErroHttp(400, 'A nova senha deve ser diferente da atual.');
    const hash = await gerarHashSenha(novaSenha);
    await transacao(contextoDe(req, 'trocar-senha'), (c) =>
      c.query(`update seg.operador set senha_hash = $2, senha_expirada = false, senha_alterada_em = now() where id = $1`, [u.id, hash]),
    );
    limparCacheSessao();
    return { ok: true };
  });

  // Recuperação de senha a partir da tela de login (TR 1.1.2.1.40).
  app.post('/api/auth/recuperar-senha', { config: { publica: true, rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
    const { login } = z.object({ login: z.string() }).parse(req.body);
    const op = await consultarUm(
      `select o.id, p.email, coalesce(o.nome, p.nome) nome from seg.operador o join cad.pessoa p on p.id = o.pessoa_id
        where o.login = $1 and o.ativo`,
      [somenteDigitos(login) || login],
    );
    if (op?.email) await redefinirEEnviar(op.id, op.email, op.nome, { usuarioId: op.id, ip: req.ip, rotina: 'recuperar-senha' });
    // Resposta idêntica para não revelar quais logins existem.
    return { ok: true, mensagem: 'Se o login estiver cadastrado, uma senha temporária foi enviada ao e-mail do operador.' };
  });

  // ---- Administração ----

  // Redefinição pelo administrador com envio de senha temporária por e-mail (TR 1.1.1.30).
  app.post('/api/admin/operadores/:id/redefinir-senha', async (req) => {
    exigirPermissao(req, 'operador:alterar');
    const id = Number((req.params as any).id);
    const op = await consultarUm(
      `select o.id, p.email, coalesce(o.nome, p.nome) nome from seg.operador o join cad.pessoa p on p.id = o.pessoa_id where o.id = $1`,
      [id],
    );
    if (!op) throw new ErroHttp(404, 'Operador não encontrado.');
    if (!op.email) throw new ErroHttp(400, 'A pessoa vinculada ao operador não possui e-mail cadastrado.');
    await redefinirEEnviar(op.id, op.email, op.nome, contextoDe(req, 'operador:redefinir-senha'));
    return { ok: true };
  });

  app.post('/api/admin/operadores/:id/definir-senha', async (req) => {
    exigirPermissao(req, 'operador:alterar');
    const id = Number((req.params as any).id);
    const { senha, expirada } = z.object({ senha: z.string().min(8), expirada: z.boolean().default(true) }).parse(req.body);
    const hash = await gerarHashSenha(senha);
    await transacao(contextoDe(req, 'operador:definir-senha'), (c) =>
      c.query(
        `update seg.operador set senha_hash = $2, senha_expirada = $3, senha_alterada_em = now(), bloqueado = false, tentativas_invalidas = 0 where id = $1`,
        [id, hash, expirada],
      ),
    );
    limparCacheSessao();
    return { ok: true };
  });

  app.post('/api/admin/operadores/:id/desbloquear', async (req) => {
    exigirPermissao(req, 'operador:alterar');
    const id = Number((req.params as any).id);
    await transacao(contextoDe(req, 'operador:desbloquear'), (c) =>
      c.query(`update seg.operador set bloqueado = false, tentativas_invalidas = 0 where id = $1`, [id]),
    );
    return { ok: true };
  });

  // Sessões ativas e encerramento pelo administrador (TR 1.1.1.9, 1.1.1.10).
  app.get('/api/admin/sessoes', async (req) => {
    exigirPermissao(req, 'sessao:consultar');
    return consultar(
      `select s.id, o.id as operador_id, coalesce(o.nome, p.nome) as operador, o.login, s.inicio, s.ultimo_acesso, s.ip, s.agente,
              extract(epoch from (now() - s.inicio))::int as duracao_segundos, u.nome as unidade
         from seg.sessao s join seg.operador o on o.id = s.operador_id join cad.pessoa p on p.id = o.pessoa_id
         left join cad.unidade u on u.id = s.unidade_id
        where s.encerrada_em is null order by s.inicio`,
    );
  });

  app.delete('/api/admin/sessoes/:id', async (req) => {
    const u = exigirPermissao(req, 'sessao:excluir');
    const id = (req.params as any).id;
    const s = await consultarUm(
      `update seg.sessao set encerrada_em = now(), motivo_encerramento = $2 where id = $1 and encerrada_em is null returning operador_id`,
      [id, `encerrada pelo administrador ${u.login}`],
    );
    if (s) await logAcesso(req, 'sessao_encerrada', s.operador_id, '', `por ${u.login}`);
    limparCacheSessao();
    return { ok: !!s };
  });
}

async function redefinirEEnviar(operadorId: number, email: string, nome: string, ctx: Parameters<typeof transacao>[0]) {
  const temporaria = gerarSenhaTemporaria();
  const hash = await gerarHashSenha(temporaria);
  await transacao(ctx, (c) =>
    c.query(
      `update seg.operador set senha_hash = $2, senha_expirada = true, senha_alterada_em = now(), bloqueado = false, tentativas_invalidas = 0 where id = $1`,
      [operadorId, hash],
    ),
  );
  limparCacheSessao();
  await enviarEmail(
    email,
    'Senha temporária de acesso',
    `Olá, ${nome}.\n\nSua senha temporária é: ${temporaria}\n\nEla deverá ser alterada no próximo acesso.\n`,
  );
}
