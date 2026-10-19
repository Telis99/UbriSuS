// Serviços transversais: arquivos, relatórios emitidos, preferências, notificações,
// auditoria, LGPD, parâmetros, consistência da base e dicionário de dados.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../db/pool.js';
import { conferirSenha } from '../seguranca/senha.js';
import {
  ErroHttp,
  contextoDe,
  exigirPermissao,
  exigirUsuario,
  registrarRotina,
  temPermissao,
} from '../seguranca/usuario.js';
import { lerArquivo, salvarArquivo, TIPOS_PERMITIDOS } from './arquivos.js';
import { enviarEmail } from './mensageria.js';
import { emitirEmSegundoPlano, emitirTabela } from './relatorios.js';
import { executarConsistencia } from './consistencia.js';

// Liberações de supervisor válidas por poucos minutos (TR 1.1.1.33.2).
const liberacoes = new Map<string, { rotina: string; supervisorId: number; expira: number }>();
export function liberacaoSupervisorValida(token: string | undefined, rotina: string) {
  if (!token) return false;
  const l = liberacoes.get(token);
  return !!l && l.rotina === rotina && l.expira > Date.now();
}

export async function rotasServicos(app: FastifyInstance) {
  // ---- Arquivos ----
  app.post('/api/arquivos', async (req) => {
    const u = exigirUsuario(req);
    const arq = await req.file();
    if (!arq) throw new ErroHttp(400, 'Nenhum arquivo enviado.');
    if (!TIPOS_PERMITIDOS.has(arq.mimetype)) throw new ErroHttp(415, `Tipo de arquivo não permitido: ${arq.mimetype}`);
    const conteudo = await arq.toBuffer();
    const limite = Number((await consultarUm(`select valor #>> '{}' v from sis.parametro where chave = 'arquivo.tamanho_maximo_mb'`))?.v ?? 20);
    if (conteudo.length > limite * 1024 * 1024) throw new ErroHttp(413, `Arquivo maior que o limite de ${limite} MB.`);
    const id = await salvarArquivo(arq.filename, arq.mimetype, conteudo, u.id);
    return { id, nome: arq.filename, tipo: arq.mimetype, tamanho: conteudo.length };
  });

  app.get('/api/arquivos/:id', async (req, reply) => {
    exigirUsuario(req);
    const a = await lerArquivo((req.params as any).id);
    const inline = (req.query as any).baixar ? 'attachment' : 'inline';
    return reply
      .header('content-type', a.tipo_mime)
      .header('content-disposition', `${inline}; filename="${encodeURIComponent(a.nome)}"`)
      .header('cache-control', 'private, max-age=3600')
      .send(a.conteudo);
  });

  // ---- Relatórios emitidos ----
  // Busca por código único ou por operador (TR 1.1.1.64.19); fila de geração (TR 1.1.1.64.14).
  app.get('/api/relatorios', async (req) => {
    const u = exigirUsuario(req);
    const q = req.query as any;
    const params: unknown[] = [];
    const where: string[] = [];
    if (!temPermissao(u, 'auditoria:consultar')) {
      params.push(u.id);
      where.push(`r.operador_id = $${params.length}`);
    }
    if (q.codigo) {
      params.push(String(q.codigo).trim().toUpperCase());
      where.push(`r.codigo = $${params.length}`);
    }
    if (q.operador) {
      params.push('%' + q.operador + '%');
      where.push(`f_unaccent(o.nome) ilike f_unaccent($${params.length})`);
    }
    if (q.situacao) {
      params.push(q.situacao);
      where.push(`r.situacao = $${params.length}`);
    }
    return consultar(
      `select r.id, r.codigo, r.relatorio, r.titulo, r.formato, r.situacao, r.emitido_em, r.concluido_em, r.filtros, r.erro,
              r.arquivo_id, r.assinado, coalesce(o.nome, o.login) as operador
         from sis.relatorio_emitido r left join seg.operador o on o.id = r.operador_id
        ${where.length ? 'where ' + where.join(' and ') : ''}
        order by r.emitido_em desc limit 200`,
      params,
    );
  });

  // Envio do relatório emitido por e-mail a pessoas do cadastro único (TR 1.1.1.64.15).
  app.post('/api/relatorios/:id/email', async (req) => {
    const u = exigirUsuario(req);
    const { pessoas } = z.object({ pessoas: z.array(z.number().int()).min(1) }).parse(req.body);
    const r = await consultarUm(`select * from sis.relatorio_emitido where id = $1`, [(req.params as any).id]);
    if (!r?.arquivo_id) throw new ErroHttp(404, 'Relatório não encontrado ou ainda em emissão.');
    if (r.operador_id !== u.id && !temPermissao(u, 'auditoria:consultar')) throw new ErroHttp(403, 'Relatório de outro operador.');
    const arq = await lerArquivo(r.arquivo_id);
    const destinos = await consultar(`select nome, email from cad.pessoa where id = any($1) and email is not null`, [pessoas]);
    if (!destinos.length) throw new ErroHttp(400, 'Nenhum dos destinatários possui e-mail no cadastro.');
    for (const d of destinos) {
      await enviarEmail(d.email, r.titulo, `Segue anexo o relatório "${r.titulo}" (código ${r.codigo}), enviado por ${u.nome}.`, [
        { nome: arq.nome, conteudo: arq.conteudo },
      ]);
    }
    await registrarRotina(req, 'relatorio', 'email', { codigo: r.codigo, destinatarios: destinos.map((d) => d.email) });
    return { enviados: destinos.length };
  });

  // Validação pública de autenticidade de documentos (TR 1.1.1.64.18, 1.1.1.56.7).
  app.get('/api/publico/validar/:codigo', { config: { publica: true } }, async (req) => {
    const codigo = String((req.params as any).codigo).toUpperCase();
    const r = await consultarUm(
      `select r.codigo, r.titulo, r.emitido_em, r.situacao, r.assinado, a.sha256, a.tamanho, coalesce(o.nome, o.login) as operador
         from sis.relatorio_emitido r left join sis.arquivo a on a.id = r.arquivo_id left join seg.operador o on o.id = r.operador_id
        where r.codigo = $1`,
      [codigo],
    );
    if (!r) return { valido: false, mensagem: 'Documento não encontrado. Verifique o código informado.' };
    const assinaturas = await consultar(
      `select signatario, modalidade, assinado_em from sis.assinatura where relatorio_codigo = $1 order by assinado_em`,
      [codigo],
    ).catch(() => []);
    return { valido: r.situacao === 'concluido', documento: r, assinaturas };
  });

  app.get('/api/publico/validar/:codigo/arquivo', { config: { publica: true } }, async (req, reply) => {
    const r = await consultarUm(`select arquivo_id from sis.relatorio_emitido where codigo = $1`, [String((req.params as any).codigo).toUpperCase()]);
    if (!r?.arquivo_id) throw new ErroHttp(404, 'Documento não encontrado.');
    const a = await lerArquivo(r.arquivo_id);
    return reply.header('content-type', a.tipo_mime).send(a.conteudo);
  });

  // ---- Preferências de consulta (TR 1.1.1.63, 1.1.2.1.45, 1.1.2.1.64, 1.1.1.64.9) ----
  app.get('/api/preferencias/:chave', async (req) => {
    const u = exigirUsuario(req);
    return consultar(
      `select id, nome, valor, compartilhada, operador_id = $1 as minha from sis.preferencia
        where chave = $2 and (operador_id = $1 or compartilhada) order by nome`,
      [u.id, (req.params as any).chave],
    );
  });

  app.put('/api/preferencias/:chave', async (req) => {
    const u = exigirUsuario(req);
    const { nome, valor, compartilhada } = z
      .object({ nome: z.string().min(1).max(60).default('padrao'), valor: z.any(), compartilhada: z.boolean().default(false) })
      .parse(req.body);
    await pool.query(
      `insert into sis.preferencia (operador_id, chave, nome, valor, compartilhada) values ($1,$2,$3,$4,$5)
       on conflict (operador_id, chave, nome) do update set valor = excluded.valor, compartilhada = excluded.compartilhada`,
      [u.id, (req.params as any).chave, nome, JSON.stringify(valor), compartilhada],
    );
    return { ok: true };
  });

  app.delete('/api/preferencias/:chave/:nome', async (req) => {
    const u = exigirUsuario(req);
    const p = req.params as any;
    await pool.query(`delete from sis.preferencia where operador_id = $1 and chave = $2 and nome = $3`, [u.id, p.chave, p.nome]);
    return { ok: true };
  });

  // ---- Notificações entre operadores (TR 1.1.2.1.47, 1.1.2.1.48) ----
  app.get('/api/notificacoes', async (req) => {
    const u = exigirUsuario(req);
    return consultar(
      `select n.id, n.titulo, n.mensagem, n.anexo_id, n.lida_em, n.criado_em, coalesce(o.nome, 'Sistema') as remetente
         from sis.notificacao_operador n left join seg.operador o on o.id = n.remetente_id
        where n.destinatario_id = $1 and n.excluida_em is null order by n.criado_em desc limit 100`,
      [u.id],
    );
  });

  app.post('/api/notificacoes', async (req) => {
    const u = exigirPermissao(req, 'notificacao:incluir');
    const corpo = z
      .object({
        destinatarios: z.array(z.number().int()).default([]),
        grupos: z.array(z.number().int()).default([]),
        titulo: z.string().min(1).max(120),
        mensagem: z.string().min(1),
        anexoId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const ids = new Set(corpo.destinatarios);
    if (corpo.grupos.length) {
      for (const r of await consultar(`select operador_id from seg.operador_grupo where grupo_id = any($1)`, [corpo.grupos])) ids.add(r.operador_id);
    }
    if (!ids.size) throw new ErroHttp(400, 'Informe ao menos um destinatário.');
    for (const d of ids) {
      await pool.query(
        `insert into sis.notificacao_operador (remetente_id, destinatario_id, titulo, mensagem, anexo_id) values ($1,$2,$3,$4,$5)`,
        [u.id, d, corpo.titulo, corpo.mensagem, corpo.anexoId ?? null],
      );
    }
    return { enviadas: ids.size };
  });

  app.post('/api/notificacoes/:id/lida', async (req) => {
    const u = exigirUsuario(req);
    await pool.query(`update sis.notificacao_operador set lida_em = coalesce(lida_em, now()) where id = $1 and destinatario_id = $2`, [
      (req.params as any).id,
      u.id,
    ]);
    return { ok: true };
  });

  app.delete('/api/notificacoes/:id', async (req) => {
    const u = exigirUsuario(req);
    await pool.query(`update sis.notificacao_operador set excluida_em = now() where id = $1 and destinatario_id = $2`, [
      (req.params as any).id,
      u.id,
    ]);
    return { ok: true };
  });

  // ---- Liberação por supervisor (TR 1.1.1.33.2) ----
  app.post('/api/supervisor/liberar', async (req) => {
    exigirUsuario(req);
    const { login, senha, rotina } = z.object({ login: z.string(), senha: z.string(), rotina: z.string() }).parse(req.body);
    const sup = await consultarUm(`select id, senha_hash, administrador from seg.operador where login = $1 and ativo and not bloqueado`, [login]);
    if (!sup || !(await conferirSenha(senha, sup.senha_hash))) throw new ErroHttp(401, 'Credenciais do supervisor inválidas.');
    const restr = await consultarUm(`select perfil_supervisor_id from seg.restricao_formulario where rotina = $1`, [rotina]);
    if (restr?.perfil_supervisor_id && !sup.administrador) {
      const tem = await consultarUm(`select 1 from seg.operador_perfil where operador_id = $1 and perfil_id = $2`, [sup.id, restr.perfil_supervisor_id]);
      if (!tem) throw new ErroHttp(403, 'O operador informado não possui perfil de supervisor para esta rotina.');
    }
    const token = randomBytes(16).toString('hex');
    liberacoes.set(token, { rotina, supervisorId: sup.id, expira: Date.now() + 5 * 60_000 });
    await registrarRotina(req, rotina, 'liberacao_supervisor', { supervisor: sup.id });
    return { token, expiraEmSegundos: 300 };
  });

  // ---- Auditoria (TR 1.1.1.11, 1.1.1.12, 1.1.1.36 a 1.1.1.38, 1.1.2.1.10) ----
  app.get('/api/auditoria/:tipo', async (req) => {
    exigirPermissao(req, 'auditoria:consultar');
    const tipo = (req.params as any).tipo as string;
    const q = req.query as any;
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (cond: string, v: unknown) => {
      params.push(v);
      where.push(cond.replace('?', `$${params.length}`));
    };
    if (q.de) add('l.data_hora >= ?::date', q.de);
    if (q.ate) add(`l.data_hora < (?::date + 1)`, q.ate);
    if (q.operador_id) add('l.operador_id = ?', Number(q.operador_id));
    const w = () => (where.length ? 'where ' + where.join(' and ') : '');
    switch (tipo) {
      case 'dados':
        if (q.tabela) add('l.tabela = ?', q.tabela);
        if (q.operacao) add('l.operacao = ?', q.operacao);
        if (q.registro_id) add('l.registro_id = ?', Number(q.registro_id));
        return consultar(
          `select l.*, coalesce(o.nome, o.login) as operador from aud.log_dados l left join seg.operador o on o.id = l.operador_id ${w()} order by l.id desc limit 1000`,
          params,
        );
      case 'acessos':
        if (q.evento) add('l.evento = ?', q.evento);
        return consultar(
          `select l.*, coalesce(o.nome, o.login) as operador from aud.log_acesso l left join seg.operador o on o.id = l.operador_id ${w()} order by l.id desc limit 1000`,
          params,
        );
      case 'rotinas':
        if (q.rotina) add('l.rotina ilike ?', '%' + q.rotina + '%');
        return consultar(
          `select l.*, coalesce(o.nome, o.login) as operador from aud.log_rotina l left join seg.operador o on o.id = l.operador_id ${w()} order by l.id desc limit 1000`,
          params,
        );
      case 'erros':
        return consultar(`select l.* from aud.log_erro l ${w()} order by l.id desc limit 500`, params);
      case 'certificados':
        return consultar(
          `select l.*, coalesce(o.nome, o.login) as operador from aud.log_certificado l left join seg.operador o on o.id = l.operador_id ${w()} order by l.id desc limit 1000`,
          params,
        );
      case 'integracoes':
        return consultar(
          `select l.*, coalesce(o.nome, o.login) as operador from aud.log_integracao l left join seg.operador o on o.id = l.operador_id ${w()} order by l.id desc limit 1000`,
          params,
        );
    }
    throw new ErroHttp(404, 'Tipo de log inexistente.');
  });

  // ---- LGPD: relatório de dados pessoais tratados (TR 1.1.1.65) ----
  app.get('/api/lgpd/dados-tratados', async (req, reply) => {
    const u = exigirUsuario(req);
    if (!u.encarregadoDados) throw new ErroHttp(403, 'Relatório restrito ao Encarregado de Proteção de Dados (DPO) do controlador.');
    const q = req.query as any;
    const cpf = q.cpf ? String(q.cpf).replace(/\D/g, '') : null;
    const pessoa = cpf ? await consultarUm(`select id, nome, cpf, cns from cad.pessoa where cpf = $1`, [cpf]) : null;
    if (cpf && !pessoa) throw new ErroHttp(404, 'Nenhuma pessoa com este CPF.');
    const linhas = await consultar(
      pessoa
        ? `select l.data_hora, l.tabela, case l.operacao when 'I' then 'Inclusão' when 'A' then 'Alteração' else 'Exclusão' end as operacao,
                  coalesce(o.nome, l.usuario_banco) as operador, l.rotina, l.ip,
                  (select string_agg(k, ', ') from jsonb_object_keys(coalesce(l.depois, l.antes)) k) as campos
             from aud.log_dados l left join seg.operador o on o.id = l.operador_id
            where (l.tabela = 'cad.pessoa' and l.registro_id = $1)
               or coalesce(l.depois, l.antes) @> jsonb_build_object('pessoa_id', $1::bigint)
               or coalesce(l.depois, l.antes) @> jsonb_build_object('paciente_id', $1::bigint)
            order by l.data_hora`
        : `select l.tabela, count(*) as operacoes, min(l.data_hora) as primeira, max(l.data_hora) as ultima
             from aud.log_dados l group by l.tabela order by l.tabela`,
      pessoa ? [pessoa.id] : [],
    );
    const visualizacoes = pessoa
      ? await consultar(
          `select l.data_hora, coalesce(o.nome, o.login) as operador, l.acao, l.ip from aud.log_rotina l
             left join seg.operador o on o.id = l.operador_id
            where l.rotina = 'paciente' and l.detalhe @> jsonb_build_object('id', $1::bigint) order by l.data_hora`,
          [pessoa.id],
        )
      : [];
    await registrarRotina(req, 'lgpd', 'relatorio_dados_tratados', { cpf });
    if (q.formato) {
      const r = await emitirTabela(
        { relatorio: 'lgpd:dados-tratados', titulo: 'Relatório de dados pessoais tratados', formato: q.formato, filtros: { cpf }, filtrosTexto: pessoa ? [`Titular: ${pessoa.nome} (CPF ${cpf})`] : ['Visão global'] },
        {
          titulo: 'Relatório de dados pessoais tratados',
          colunas: pessoa
            ? [
                { campo: 'data_hora', titulo: 'Data/hora', formato: 'data_hora' },
                { campo: 'tabela', titulo: 'Cadastro' },
                { campo: 'operacao', titulo: 'Operação' },
                { campo: 'operador', titulo: 'Operador' },
                { campo: 'campos', titulo: 'Dados tratados' },
              ]
            : [
                { campo: 'tabela', titulo: 'Cadastro' },
                { campo: 'operacoes', titulo: 'Operações', formato: 'inteiro', total: true },
                { campo: 'primeira', titulo: 'Primeira', formato: 'data_hora' },
                { campo: 'ultima', titulo: 'Última', formato: 'data_hora' },
              ],
          linhas,
        },
        u,
      );
      return reply.header('content-type', r.mime).header('content-disposition', `attachment; filename="${r.nome}"`).send(r.conteudo);
    }
    return { titular: pessoa, tratamentos: linhas, visualizacoes };
  });

  // ---- Aceite da política de cookies (TR 1.1.1.66) ----
  app.post('/api/publico/aceite-cookies', { config: { publica: true } }, async (req) => {
    const { versao, cidadaoId } = z.object({ versao: z.string().max(20), cidadaoId: z.number().optional() }).parse(req.body);
    await pool.query(`insert into sis.aceite (tipo, versao, operador_id, cidadao_id, ip, agente) values ('cookies',$1,$2,$3,$4,$5)`, [
      versao,
      req.usuario?.id ?? null,
      cidadaoId ?? null,
      req.ip,
      req.headers['user-agent'] ?? null,
    ]);
    return { ok: true };
  });

  // ---- Parâmetros ----
  app.get('/api/parametros', async (req) => {
    exigirPermissao(req, 'parametro:consultar');
    return consultar(`select chave, valor, descricao, modulo, atualizado_em from sis.parametro order by modulo, chave`);
  });

  app.get('/api/parametros/publicos', { config: { publica: true } }, async () =>
    Object.fromEntries(
      (await consultar(`select chave, valor from sis.parametro where chave like 'publico.%' or chave in ('entidade.nome','entidade.secretaria')`)).map(
        (r) => [r.chave, r.valor],
      ),
    ),
  );

  app.put('/api/parametros/:chave', async (req) => {
    const u = exigirPermissao(req, 'parametro:alterar');
    const { valor } = z.object({ valor: z.any() }).parse(req.body);
    const chave = (req.params as any).chave;
    await transacao(contextoDe(req, 'parametro'), (c) =>
      c.query(`update sis.parametro set valor = $2, atualizado_em = now(), atualizado_por = $3 where chave = $1`, [chave, JSON.stringify(valor), u.id]),
    );
    await registrarRotina(req, 'parametro', 'alterar', { chave, valor });
    return { ok: true };
  });

  // ---- Consistência da base (TR 1.1.1.14) ----
  app.post('/api/consistencia', async (req) => {
    const u = exigirPermissao(req, 'consistencia:executar');
    const r = await consultarUm(`insert into sis.consistencia_execucao (operador_id) values ($1) returning id`, [u.id]);
    executarConsistencia(r!.id).catch((e) => console.error('consistência:', e));
    return { id: r!.id, mensagem: 'Verificação iniciada em segundo plano.' };
  });

  app.get('/api/consistencia', async (req) => {
    exigirPermissao(req, 'consistencia:executar');
    return consultar(`select * from sis.consistencia_execucao order by id desc limit 20`);
  });

  // ---- Dicionário de dados (TR 1.1.2.1.13.1) ----
  app.get('/api/dicionario-dados', async (req, reply) => {
    const u = exigirPermissao(req, 'auditoria:consultar');
    const linhas = await consultar(`select * from sis.vw_dicionario_dados order by esquema, tabela, posicao`);
    const formato = (req.query as any).formato;
    if (!formato) return linhas;
    const r = await emitirTabela(
      { relatorio: 'dicionario-dados', titulo: 'Dicionário de dados', formato, orientacao: 'landscape' },
      {
        titulo: 'Dicionário de dados',
        agrupar: ['tabela_completa'],
        colunas: [
          { campo: 'tabela_completa', titulo: 'Tabela' },
          { campo: 'coluna', titulo: 'Coluna' },
          { campo: 'tipo', titulo: 'Tipo' },
          { campo: 'obrigatorio', titulo: 'Obrigatório', formato: 'booleano' },
          { campo: 'chave', titulo: 'Chave' },
          { campo: 'referencia', titulo: 'Referência' },
          { campo: 'descricao', titulo: 'Descrição / valores' },
        ],
        linhas,
      },
      u,
    );
    return reply.header('content-type', r.mime).header('content-disposition', `attachment; filename="${r.nome}"`).send(r.conteudo);
  });

  app.post('/api/relatorios/segundo-plano/teste', async (req) => {
    const u = exigirUsuario(req);
    emitirEmSegundoPlano(
      () =>
        emitirTabela(
          { relatorio: 'teste-fila', titulo: 'Teste de fila de relatórios', formato: 'pdf', filtros: { t: Date.now() } },
          { titulo: 'Teste de fila de relatórios', colunas: [{ campo: 'n', titulo: 'Número' }], linhas: [{ n: 1 }] },
          u,
        ),
      u,
      'Teste de fila de relatórios',
    );
    return { ok: true };
  });
}
