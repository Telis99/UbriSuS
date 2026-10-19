// Gerador de relatórios e consultas: o operador cria relatórios a partir das estruturas de dados
// (metadados), de instruções SQL de consulta ou da cópia de relatórios existentes, com versões,
// privilégios por perfil e acesso pelo menu de relatórios de cada módulo (TR 1.1.1.64.3 a 1.1.1.64.8).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { listar, registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { listarEntidades, obterEntidade } from '../../meta/registro.js';
import { obterRelatorio, registrarFonteRelatorios, type DefinicaoRelatorio, type FiltroRelatorio, type ResultadoRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';
import { contextoDe, ErroHttp, exigirPermissao, temPermissao, type Usuario } from '../../seguranca/usuario.js';

registrarPermissao('gerador_relatorio', 'Criação de relatórios e consultas personalizados', 'TEC', ['consultar', 'incluir', 'alterar', 'excluir']);

const PREFIXO = 'pers-';

// Versões publicadas não são alteradas: edita-se um rascunho e publica-se (TR 1.1.1.64.8).
registrarGanchos('relatorio_personalizado', {
  async antesSalvar(d, { atual }) {
    if (atual && atual.situacao !== 'RASCUNHO') throw new ErroHttp(422, 'Versão publicada não pode ser alterada: crie uma nova versão.');
    if (!atual) d.situacao = 'RASCUNHO';
    else delete d.situacao;
    const sql = d.sql ?? atual?.sql;
    if ((d.origem ?? atual?.origem) === 'SQL' && sql) await executarSql(sql, {}, 1);
  },
});
// Tabelas e colunas que não podem ser lidas por instruções SQL do operador.
const PROIBIDO = /\b(seg\.(sessao|operador|certificado)|senha|conteudo_cifrado|sis\.arquivo|sis\.parametro|pg_|information_schema|aud\.)\b|;\s*\S/i;

/** Executa a consulta do operador somente leitura, com tempo limite e parâmetros nomeados (:nome). */
export async function executarSql(sql: string, valores: Record<string, unknown>, limite = 50_000) {
  const texto = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(texto)) throw new ErroHttp(422, 'A instrução deve ser uma consulta (SELECT/WITH).');
  if (PROIBIDO.test(texto)) throw new ErroHttp(422, 'A instrução referencia dados protegidos ou contém mais de um comando.');
  const params: unknown[] = [];
  const nomes = new Map<string, number>();
  const final = texto.replace(/(?<!:):([a-z_][a-z0-9_]*)/gi, (_m, nome: string) => {
    if (!nomes.has(nome)) {
      params.push(valores[nome] === '' ? null : (valores[nome] ?? null));
      nomes.set(nome, params.length);
    }
    return `$${nomes.get(nome)}`;
  });
  const c = await pool.connect();
  try {
    await c.query('begin transaction read only');
    await c.query(`set local statement_timeout = 30000`);
    const r = await c.query(`select * from (${final}) consulta limit ${limite}`, params);
    await c.query('rollback');
    return { linhas: r.rows, campos: r.fields.map((f) => f.name) };
  } catch (e: any) {
    await c.query('rollback').catch(() => {});
    if (e instanceof ErroHttp) throw e;
    throw new ErroHttp(422, `Erro na instrução SQL: ${e.message}`);
  } finally {
    c.release();
  }
}

interface Definicao {
  id: number;
  codigo: string;
  versao: number;
  situacao: string;
  titulo: string;
  modulo: string;
  grupo?: string;
  origem: 'ENTIDADE' | 'SQL' | 'RELATORIO';
  entidade?: string;
  relatorio_base?: string;
  sql?: string;
  colunas?: (Coluna & { visivel?: boolean })[];
  filtros?: FiltroRelatorio[];
  agrupar?: string[];
  grafico?: any;
  ordem?: string;
  formato_id?: number;
  perfis?: number[];
}

/** Gera o resultado conforme a origem dos dados e aplica o layout definido pelo operador. */
async function gerarPersonalizado(d: Definicao, f: Record<string, any>, u: Usuario): Promise<ResultadoRelatorio> {
  let linhas: Record<string, any>[] = [];
  let colunasBase: Coluna[] = [];
  let agrupar = d.agrupar ?? [];
  let grafico = d.grafico ?? undefined;
  if (d.origem === 'SQL') {
    const r = await executarSql(d.sql ?? '', f);
    linhas = r.linhas;
    colunasBase = r.campos.map((c) => ({ campo: c, titulo: c }));
  } else if (d.origem === 'ENTIDADE') {
    const e = obterEntidade(d.entidade ?? '');
    if (!e) throw new ErroHttp(422, 'Estrutura de dados inexistente.');
    if (!temPermissao(u, `${e.permissao ?? e.nome}:consultar`)) throw new ErroHttp(403, 'Operador sem acesso a esta estrutura de dados.');
    const filtros = (d.filtros ?? [])
      .filter((x) => f[x.nome] !== undefined && f[x.nome] !== '' && f[x.nome] !== null)
      .map((x) => {
        const [campo, op] = x.nome.split('__');
        return { campo, op: op ?? (x.tipo === 'texto' ? 'contem' : 'igual'), valor: f[x.nome] };
      });
    const r = await listar(e, { filtros: filtros as any, ordem: d.ordem, tamanho: 5000 }, u);
    linhas = r.linhas.map((l) => {
      const o: Record<string, any> = {};
      for (const c of e.campos) o[c.nome] = c.tipo === 'ref' ? (l[`${c.nome}__rotulo`] ?? l[c.nome]) : l[c.nome];
      return o;
    });
    colunasBase = e.campos.filter((c) => !c.oculto && c.tipo !== 'segredo').map((c) => ({ campo: c.nome, titulo: c.rotulo }));
  } else {
    const base = obterRelatorio(d.relatorio_base ?? '');
    if (!base) throw new ErroHttp(422, 'Relatório de origem inexistente.');
    const r = await base.gerar(f, u);
    linhas = r.linhas;
    colunasBase = r.colunas;
    if (!d.agrupar?.length) agrupar = r.agrupar ?? [];
    grafico = d.grafico ?? r.grafico;
  }
  const colunas = d.colunas?.length ? d.colunas.filter((c) => c.visivel !== false).map(({ visivel: _v, ...c }) => ({ ...colunasBase.find((b) => b.campo === c.campo), ...c })) : colunasBase;
  return { linhas, colunas, agrupar: agrupar.filter((a) => colunas.some((c) => c.campo === a)), grafico: grafico?.x ? grafico : undefined, formatoId: d.formato_id ?? null };
}

function comoDefinicao(d: Definicao, rascunho = false): DefinicaoRelatorio {
  const base = d.origem === 'RELATORIO' ? obterRelatorio(d.relatorio_base ?? '') : undefined;
  return {
    id: rascunho ? `${PREFIXO}${d.codigo}@${d.versao}` : `${PREFIXO}${d.codigo}`,
    modulo: d.modulo,
    grupo: d.grupo || 'Relatórios personalizados',
    titulo: d.titulo,
    permissao: 'livre',
    filtros: d.filtros?.length ? d.filtros : (base?.filtros ?? []),
    gerar: (f, u) => gerarPersonalizado(d, f, u),
  };
}

/** Privilégio: perfis definidos no relatório ou acesso ao módulo (TR 1.1.1.64.7). */
async function podeUsar(d: Definicao, u: Usuario) {
  if (u.administrador) return true;
  if (d.perfis?.length) {
    const r = await consultarUm(`select 1 from seg.operador_perfil where operador_id = $1 and perfil_id = any($2::bigint[])`, [u.id, d.perfis]);
    return !!r;
  }
  return !u.modulos || u.modulos.includes(d.modulo);
}

registrarFonteRelatorios({
  async listar(u) {
    const defs = await consultar<Definicao>(`select * from sis.relatorio_personalizado where situacao = 'PUBLICADO' and ativo`).catch(() => []);
    const out: DefinicaoRelatorio[] = [];
    for (const d of defs) if (await podeUsar(d, u)) out.push({ ...comoDefinicao(d), permissao: 'livre' });
    return out;
  },
  async obter(id, u) {
    if (!id.startsWith(PREFIXO)) return null;
    const [codigo, versao] = id.slice(PREFIXO.length).split('@');
    const d = versao
      ? await consultarUm<Definicao>(`select * from sis.relatorio_personalizado where codigo = $1 and versao = $2`, [codigo, Number(versao)])
      : await consultarUm<Definicao>(`select * from sis.relatorio_personalizado where codigo = $1 and situacao = 'PUBLICADO' and ativo`, [codigo]);
    if (!d) return null;
    if (versao && !temPermissao(u, 'gerador_relatorio:consultar')) throw new ErroHttp(403, 'Somente o editor de relatórios pode testar versões em rascunho.');
    if (!(await podeUsar(d, u))) throw new ErroHttp(403, 'Operador sem privilégio para este relatório.');
    return { ...comoDefinicao(d, !!versao), permissao: 'livre' };
  },
});

export default async function rotasGerador(app: FastifyInstance) {
  // Estruturas de dados disponíveis e seus campos, para seleção pelo operador (TR 1.1.1.64.5).
  app.get('/api/gerador/estruturas', async (req) => {
    const u = exigirPermissao(req, 'gerador_relatorio:consultar');
    return listarEntidades()
      .filter((e) => temPermissao(u, `${e.permissao ?? e.nome}:consultar`))
      .map((e) => ({ nome: e.nome, titulo: e.titulo, modulo: e.modulo, campos: e.campos.filter((c) => !c.oculto && c.tipo !== 'segredo').map((c) => ({ nome: c.nome, rotulo: c.rotulo, tipo: c.tipo, ref: c.ref, opcoes: c.opcoes })) }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo));
  });

  // Relatórios padrão que podem servir de base para cópia de layout (TR 1.1.1.64.4).
  app.get('/api/gerador/relatorios-base', async (req) => {
    exigirPermissao(req, 'gerador_relatorio:consultar');
    const { listarRelatorios } = await import('../../servicos/catalogo.js');
    return listarRelatorios().map((r) => ({ id: r.id, titulo: r.titulo, modulo: r.modulo, filtros: r.filtros }));
  });

  app.post('/api/gerador/testar-sql', async (req) => {
    exigirPermissao(req, 'gerador_relatorio:incluir');
    const b = z.object({ sql: z.string().min(6), valores: z.record(z.any()).default({}) }).parse(req.body);
    const r = await executarSql(b.sql, b.valores, 50);
    return { campos: r.campos, amostra: r.linhas.slice(0, 20) };
  });

  // Pré-visualização de uma versão em edição sem afetar a versão publicada (TR 1.1.1.64.8).
  app.post('/api/gerador/:id/previa', async (req) => {
    const u = exigirPermissao(req, 'gerador_relatorio:consultar');
    const d = await consultarUm<Definicao>(`select * from sis.relatorio_personalizado where id = $1`, [Number((req.params as any).id)]);
    if (!d) throw new ErroHttp(404, 'Relatório não encontrado.');
    const r = await gerarPersonalizado(d, (req.body as any)?.filtros ?? {}, u);
    return { titulo: d.titulo, ...r, linhas: r.linhas.slice(0, 500) };
  });

  // Publica a versão: a anterior é arquivada e os operadores passam a usar a nova.
  app.post('/api/gerador/:id/publicar', async (req) => {
    exigirPermissao(req, 'gerador_relatorio:alterar');
    const id = Number((req.params as any).id);
    return transacao(contextoDe(req, 'gerador:publicar'), async (c) => {
      const d = (await c.query(`select * from sis.relatorio_personalizado where id = $1 for update`, [id])).rows[0];
      if (!d) throw new ErroHttp(404, 'Relatório não encontrado.');
      await c.query(`update sis.relatorio_personalizado set situacao = 'ARQUIVADO' where codigo = $1 and situacao = 'PUBLICADO' and id <> $2`, [d.codigo, id]);
      await c.query(`update sis.relatorio_personalizado set situacao = 'PUBLICADO' where id = $1`, [id]);
      return { ok: true, id: `${PREFIXO}${d.codigo}` };
    });
  });

  // Nova versão (rascunho) ou cópia com novo identificador, a partir de qualquer versão existente.
  app.post('/api/gerador/:id/copiar', async (req) => {
    exigirPermissao(req, 'gerador_relatorio:incluir');
    const b = z.object({ novoCodigo: z.string().regex(/^[a-z0-9_-]{3,40}$/i).optional() }).parse(req.body ?? {});
    return transacao(contextoDe(req, 'gerador:copiar'), async (c) => {
      const d = (await c.query(`select * from sis.relatorio_personalizado where id = $1`, [Number((req.params as any).id)])).rows[0];
      if (!d) throw new ErroHttp(404, 'Relatório não encontrado.');
      const codigo = b.novoCodigo ?? d.codigo;
      const versao = b.novoCodigo ? 1 : Number((await c.query(`select max(versao) v from sis.relatorio_personalizado where codigo = $1`, [codigo])).rows[0].v) + 1;
      return (
        await c.query(
          `insert into sis.relatorio_personalizado (codigo, versao, situacao, titulo, modulo, grupo, origem, entidade, relatorio_base, sql, colunas, filtros, agrupar, grafico, ordem, formato_id, perfis, ativo)
           select $2, $3, 'RASCUNHO', titulo || case when $4 then ' (cópia)' else '' end, modulo, grupo, origem, entidade, relatorio_base, sql, colunas, filtros, agrupar, grafico, ordem, formato_id, perfis, true
             from sis.relatorio_personalizado where id = $1 returning id, codigo, versao`,
          [d.id, codigo, versao, !!b.novoCodigo],
        )
      ).rows[0];
    });
  });
}
