// API genérica de cadastros: /api/meta e /api/e/:entidade
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm } from '../db/pool.js';
import { FORMATOS, type Coluna, type Formato } from '../servicos/exportar.js';
import { emitirTabela } from '../servicos/relatorios.js';
import { liberacaoSupervisorValida } from '../servicos/rotas.js';
import {
  ErroHttp,
  contextoDe,
  exigirPermissao,
  exigirUsuario,
  registrarRotina,
  temPermissao,
  type Usuario,
} from '../seguranca/usuario.js';
import { alterar, clonar, excluir, inserir, listar, obter, opcoes, type Filtro } from './crud.js';
import { associarRotinaModulo, listarEntidades, obterEntidade, permissaoDe } from './registro.js';
import { ACOES, type Campo, type Entidade } from './tipos.js';

// Permissões que não correspondem a uma entidade (telas de processo).
const permissoesExtras = new Map<string, { descricao: string; modulo: string; acoes: string[] }>();
export function registrarPermissao(chave: string, descricao: string, modulo: string, acoes: string[] = ['executar']) {
  permissoesExtras.set(chave, { descricao, modulo, acoes });
  associarRotinaModulo(chave, modulo);
}
registrarPermissao('sessao', 'Sessões ativas de operadores', 'TEC', ['consultar', 'excluir']);
registrarPermissao('auditoria', 'Logs de auditoria', 'TEC', ['consultar']);
registrarPermissao('parametro', 'Parâmetros do sistema', 'TEC', ['consultar', 'alterar']);
registrarPermissao('consistencia', 'Verificação de consistência da base', 'TEC', ['executar']);
registrarPermissao('notificacao', 'Envio de notificações a operadores', 'TEC', ['incluir']);

function moduloLiberado(u: Usuario, e: Entidade) {
  return u.administrador || !u.modulos || u.modulos.includes(e.modulo) || ['AGE', 'TEC'].includes(e.modulo);
}

export function entidadeOuErro(req: FastifyRequest): Entidade {
  const e = obterEntidade((req.params as any).nome);
  if (!e) throw new ErroHttp(404, 'Cadastro inexistente.');
  return e;
}

function exigirAcesso(req: FastifyRequest, e: Entidade, acao: string): Usuario {
  const u = exigirPermissao(req, `${permissaoDe(e)}:${acao}`);
  if (!moduloLiberado(u, e)) throw new ErroHttp(403, 'Módulo não liberado para o operador.');
  return u;
}

const campoPublico = (c: Campo) => {
  const { sqlCalculado, ...resto } = c;
  return { ...resto, calculado: !!sqlCalculado };
};

export function metaPublica(e: Entidade, u: Usuario) {
  return {
    nome: e.nome,
    titulo: e.titulo,
    tituloSingular: e.tituloSingular,
    modulo: e.modulo,
    menu: e.menu,
    rotulo: e.rotulo,
    ordemPadrao: e.ordemPadrao,
    abas: e.abas,
    clonavel: e.clonavel,
    filhos: e.filhos,
    somenteLeitura: e.somenteLeitura,
    descricao: e.descricao,
    tr: e.tr,
    campos: e.campos.filter((c) => c.tipo !== 'segredo').map(campoPublico),
    acoes: Object.fromEntries(ACOES.map((a) => [a, temPermissao(u, `${permissaoDe(e)}:${a}`)])),
  };
}

function lerJson<T>(v: unknown, padrao: T): T {
  if (v === undefined || v === null || v === '') return padrao;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    throw new ErroHttp(400, 'Parâmetro JSON inválido.');
  }
}

function parametrosLista(q: any) {
  return {
    filtros: lerJson<Filtro[]>(q.filtros, []),
    fixos: lerJson<Record<string, unknown>>(q.fixos, {}),
    q: q.q as string | undefined,
    ordem: q.ordem as string | undefined,
    pagina: q.pagina ? Number(q.pagina) : undefined,
    tamanho: q.tamanho ? Number(q.tamanho) : undefined,
  };
}

/** Restrições configuradas para impressão/extração do formulário (TR 1.1.1.33). */
async function conferirRestricaoFormulario(req: FastifyRequest, rotina: string, justificativa?: string) {
  const r = await consultarUm(`select * from seg.restricao_formulario where rotina = $1 and ativo`, [rotina]);
  if (!r) return;
  if (r.exige_justificativa_impressao && !justificativa?.trim()) {
    throw new ErroHttp(428, 'Informe a justificativa para impressão ou extração deste formulário.', { exigeJustificativa: true });
  }
  if (r.exige_supervisor && !liberacaoSupervisorValida(req.headers['x-liberacao-supervisor'] as string | undefined, rotina)) {
    throw new ErroHttp(428, 'Esta ação exige liberação de um supervisor.', { exigeSupervisor: true, rotina });
  }
}

export async function rotasMeta(app: FastifyInstance) {
  app.get('/api/meta', async (req) => {
    const u = exigirUsuario(req);
    return listarEntidades()
      .filter((e) => moduloLiberado(u, e) && temPermissao(u, `${permissaoDe(e)}:consultar`))
      .map((e) => metaPublica(e, u));
  });

  app.get('/api/meta/:nome', async (req) => {
    const u = exigirUsuario(req);
    return metaPublica(entidadeOuErro(req), u);
  });

  app.get('/api/permissoes/catalogo', async (req) => {
    exigirUsuario(req);
    const entidades = listarEntidades().map((e) => ({
      chave: permissaoDe(e),
      descricao: e.titulo,
      modulo: e.modulo,
      acoes: [...ACOES] as string[],
    }));
    const unicos = new Map(entidades.map((e) => [e.chave, e]));
    for (const [chave, p] of permissoesExtras) unicos.set(chave, { chave, ...p });
    return [...unicos.values()].sort((a, b) => a.modulo.localeCompare(b.modulo) || a.descricao.localeCompare(b.descricao));
  });

  app.get('/api/e/:nome', async (req) => {
    const e = entidadeOuErro(req);
    const u = exigirAcesso(req, e, 'consultar');
    return listar(e, parametrosLista(req.query), u);
  });

  app.get('/api/e/:nome/opcoes', async (req) => {
    const e = entidadeOuErro(req);
    const u = exigirUsuario(req);
    if (['paciente', 'operador'].includes(e.nome)) exigirAcesso(req, e, 'consultar');
    const q = req.query as any;
    return opcoes(e, q.q ?? '', u, lerJson(q.filtro, {}), q.limite ? Number(q.limite) : 30);
  });

  app.get('/api/e/:nome/:id', async (req) => {
    const e = entidadeOuErro(req);
    const u = exigirAcesso(req, e, 'consultar');
    const registroId = Number((req.params as any).id);
    const r = await obter(e, registroId, u);
    if (e.nome === 'paciente') await registrarRotina(req, 'paciente', 'visualizar', { id: registroId });
    return r;
  });

  app.post('/api/e/:nome', async (req, reply) => {
    const e = entidadeOuErro(req);
    if (e.somenteLeitura) throw new ErroHttp(403, 'Tabela oficial: inclusão somente por importação.');
    const u = exigirAcesso(req, e, 'incluir');
    const r = await inserir(e, (req.body as any) ?? {}, contextoDe(req, `${e.nome}:incluir`), u);
    return reply.status(201).send(r);
  });

  app.put('/api/e/:nome/:id', async (req) => {
    const e = entidadeOuErro(req);
    const u = exigirAcesso(req, e, 'alterar');
    return alterar(e, Number((req.params as any).id), (req.body as any) ?? {}, contextoDe(req, `${e.nome}:alterar`), u);
  });

  app.delete('/api/e/:nome/:id', async (req) => {
    const e = entidadeOuErro(req);
    if (e.somenteLeitura) throw new ErroHttp(403, 'Tabela oficial: exclusão não permitida.');
    const u = exigirAcesso(req, e, 'excluir');
    return excluir(e, Number((req.params as any).id), contextoDe(req, `${e.nome}:excluir`), u);
  });

  app.post('/api/e/:nome/:id/clonar', async (req) => {
    const e = entidadeOuErro(req);
    const u = exigirAcesso(req, e, 'incluir');
    return clonar(e, Number((req.params as any).id), contextoDe(req), u);
  });

  // Histórico de alterações de um registro, comparando antes e depois (TR 1.1.1.38).
  app.get('/api/e/:nome/:id/historico', async (req) => {
    const e = entidadeOuErro(req);
    const u = exigirUsuario(req);
    if (!temPermissao(u, 'auditoria:consultar') && !temPermissao(u, `${permissaoDe(e)}:alterar`))
      throw new ErroHttp(403, 'Operador sem permissão para consultar o histórico.');
    return consultar(
      `select l.id, l.data_hora, l.operacao, l.ip, l.rotina, l.usuario_banco, l.antes, l.depois,
              coalesce(o.nome, o.login) as operador
         from aud.log_dados l left join seg.operador o on o.id = l.operador_id
        where l.tabela = $1 and l.registro_id = $2 order by l.data_hora desc limit 500`,
      [e.tabela, Number((req.params as any).id)],
    );
  });

  // Exportação do resultado da consulta (TR 1.1.1.60, 1.1.1.62, 1.1.2.1.44).
  app.post('/api/e/:nome/exportar', async (req, reply) => {
    const e = entidadeOuErro(req);
    const u = exigirAcesso(req, e, 'exportar');
    const corpo = z
      .object({
        formato: z.enum(FORMATOS),
        titulo: z.string().max(150).optional(),
        colunas: z.array(z.object({ campo: z.string(), titulo: z.string() })).optional(),
        filtros: z.any().optional(),
        q: z.string().optional(),
        ordem: z.string().optional(),
        zebrado: z.boolean().optional(),
        justificativa: z.string().optional(),
        filtrosTexto: z.array(z.string()).optional(),
      })
      .parse(req.body);
    await conferirRestricaoFormulario(req, `entidade:${e.nome}`, corpo.justificativa);
    const dados = await listar(e, { filtros: lerJson(corpo.filtros, []), q: corpo.q, ordem: corpo.ordem, tamanho: 5000 }, u);
    const porNome = new Map(e.campos.map((c) => [c.nome, c]));
    const colunas: Coluna[] = (corpo.colunas ?? e.campos.filter((c) => c.lista).map((c) => ({ campo: c.nome, titulo: c.rotulo }))).map(
      (col) => {
        const c = porNome.get(col.campo);
        const campo = c?.tipo === 'ref' ? col.campo + '__rotulo' : col.campo;
        const formato = c ? formatoColuna(c) : undefined;
        return { campo, titulo: col.titulo, formato };
      },
    );
    const linhas = dados.linhas.map((l) => {
      const o: Record<string, any> = { ...l };
      for (const c of e.campos) if (c.tipo === 'opcao' && c.opcoes) o[c.nome] = c.opcoes.find(([v]) => v === l[c.nome])?.[1] ?? l[c.nome];
      return o;
    });
    const r = await emitirTabela(
      { relatorio: `consulta:${e.nome}`, titulo: corpo.titulo || e.titulo, formato: corpo.formato as Formato, filtros: { filtros: corpo.filtros, q: corpo.q }, filtrosTexto: corpo.filtrosTexto },
      { titulo: corpo.titulo || e.titulo, colunas, linhas, zebrado: corpo.zebrado ?? true },
      u,
    );
    await registrarRotina(req, e.nome, 'exportar', { formato: corpo.formato, codigo: r.codigo, justificativa: corpo.justificativa });
    return reply
      .header('content-type', r.mime)
      .header('content-disposition', `attachment; filename="${r.nome}"`)
      .header('x-codigo-relatorio', r.codigo)
      .send(r.conteudo);
  });
}

export function formatoColuna(c: Campo): Coluna['formato'] {
  switch (c.tipo) {
    case 'inteiro':
      return 'inteiro';
    case 'decimal':
      return 'decimal';
    case 'moeda':
      return 'moeda';
    case 'data':
      return 'data';
    case 'data_hora':
      return 'data_hora';
    case 'booleano':
      return 'booleano';
    default:
      return 'texto';
  }
}
