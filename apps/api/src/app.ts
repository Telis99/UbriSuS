// Aplicação web nativa em camadas: interface no navegador (React, HTML/CSS/JavaScript, sem plugins,
// emuladores ou runtimes no cliente), camada de processamento (esta API) e banco de dados PostgreSQL
// único para todos os módulos, trocando somente JSON compacto.
// TR 1.1.1.2, 1.1.1.2.1, 1.1.1.3, 1.1.1.4, 1.1.1.6, 1.1.1.8, 1.1.1.16, 1.1.2.1, 1.1.2.1.6. Sem limite de operadores, sessões simultâneas ou
// licenças: cada aba/janela é uma sessão de trabalho independente e as transações são concorrentes
// (TR 1.1.1.15, 1.1.2.1.1, 1.1.2.1.2). Gravações confirmadas ficam visíveis em todos os módulos
// imediatamente (TR 1.1.2.1.11, 1.1.2.1.20).
import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { config, emProducao } from './config.js';
import { pool } from './db/pool.js';
import { rotasMeta } from './meta/rotas.js';
import { registrarRotasModulos } from './modulos/rotas.js';
import { rotasSeguranca } from './seguranca/rotas.js';
import { ErroHttp, autenticar } from './seguranca/usuario.js';
import { rotasServicos } from './servicos/rotas.js';
import './modulos/index.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    publica?: boolean;
  }
}

export async function criarApp(opcoes: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opcoes.logger ?? (emProducao ? { level: 'info' } : { level: 'warn' }),
    trustProxy: true,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(cookie, { secret: config.segredoCookie });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://server.arcgisonline.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

  // Autenticação de todas as rotas /api, exceto as marcadas como públicas.
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    req.usuario = await autenticar(req);
    const publica = req.routeOptions.config?.publica || req.url.startsWith('/api/publico/');
    if (!publica && !req.usuario) throw new ErroHttp(401, 'Sessão expirada. Faça login novamente.');
    // Proteção CSRF complementar ao cookie SameSite=strict.
    if (!publica && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'ubrisus') {
      throw new ErroHttp(403, 'Requisição não originada pela aplicação.');
    }
  });

  app.setErrorHandler(async (erro, req, reply) => {
    if (erro instanceof ErroHttp) return reply.status(erro.status).send({ erro: erro.message, detalhes: erro.detalhes });
    if (erro instanceof ZodError) {
      return reply.status(422).send({
        erro: 'Dados inválidos.',
        detalhes: Object.fromEntries(erro.issues.map((i) => [i.path.join('.') || 'corpo', i.message])),
      });
    }
    const status = (erro as any).statusCode;
    if (status && status < 500) return reply.status(status).send({ erro: (erro as Error).message });
    req.log.error(erro);
    await pool
      .query(`insert into aud.log_erro (operador_id, rota, mensagem, pilha) values ($1,$2,$3,$4)`, [
        req.usuario?.id ?? null,
        `${req.method} ${req.url}`.slice(0, 500),
        (erro as Error).message,
        (erro as Error).stack ?? null,
      ])
      .catch(() => {});
    return reply.status(500).send({ erro: 'Erro interno. A ocorrência foi registrada para análise do suporte.' });
  });

  app.get('/api/publico/saude', async () => {
    await pool.query('select 1');
    return { ok: true, versao: process.env.npm_package_version ?? '0.1.0', horario: new Date().toISOString() };
  });

  await rotasSeguranca(app);
  await rotasMeta(app);
  await rotasServicos(app);
  await registrarRotasModulos(app);

  // Interface web (build de produção) com fallback para rotas do SPA.
  if (existsSync(config.diretorioWeb)) {
    await app.register(fastifyStatic, { root: config.diretorioWeb, wildcard: false, maxAge: emProducao ? '1h' : 0 });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ erro: 'Rota inexistente.' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
