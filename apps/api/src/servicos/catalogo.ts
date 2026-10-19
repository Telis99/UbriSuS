// Catálogo de relatórios: cada módulo registra seus relatórios com filtros declarativos; a mesma
// rota emite em qualquer formato (com código de validação) ou devolve os dados para a tela com gráfico.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErroHttp, exigirUsuario, temPermissao, type Usuario } from '../seguranca/usuario.js';
import { emitirEmSegundoPlano, emitirTabela } from './relatorios.js';
import { FORMATOS, type Coluna, type Formato } from './exportar.js';
import type { Grafico } from './grafico.js';

export interface FiltroRelatorio {
  nome: string;
  rotulo: string;
  tipo: 'data' | 'ref' | 'opcao' | 'texto' | 'inteiro' | 'booleano' | 'mes';
  ref?: string;
  opcoes?: [string, string][];
  obrigatorio?: boolean;
  padrao?: unknown;
}

export interface ResultadoRelatorio {
  colunas: Coluna[];
  linhas: Record<string, any>[];
  agrupar?: string[];
  grafico?: Grafico;
  filtrosTexto?: string[];
  orientacao?: 'portrait' | 'landscape';
  formatoId?: number | null;
}

export interface DefinicaoRelatorio {
  id: string;
  modulo: string;
  grupo?: string;
  titulo: string;
  descricao?: string;
  tr?: string[];
  permissao: string;
  filtros: FiltroRelatorio[];
  gerar: (f: Record<string, any>, u: Usuario) => Promise<ResultadoRelatorio>;
}

const catalogo = new Map<string, DefinicaoRelatorio>();
export function registrarRelatorio(d: DefinicaoRelatorio) {
  catalogo.set(d.id, d);
}
export const listarRelatorios = () => [...catalogo.values()];
export const obterRelatorio = (id: string) => catalogo.get(id);

/** Fontes de relatórios criados em tempo de execução (gerador de relatórios do operador). */
type Fonte = { listar: (u: Usuario) => Promise<DefinicaoRelatorio[]>; obter: (id: string, u: Usuario) => Promise<DefinicaoRelatorio | null> };
const fontes: Fonte[] = [];
export function registrarFonteRelatorios(f: Fonte) {
  fontes.push(f);
}
async function localizar(id: string, u: Usuario) {
  const d = catalogo.get(id);
  if (d) return d;
  for (const f of fontes) {
    const r = await f.obter(id, u);
    if (r) return r;
  }
  return null;
}

/** Filtros de período usados por quase todos os relatórios. */
export const PERIODO: FiltroRelatorio[] = [
  { nome: 'de', rotulo: 'De', tipo: 'data', obrigatorio: true, padrao: 'inicio_mes' },
  { nome: 'ate', rotulo: 'Até', tipo: 'data', obrigatorio: true, padrao: 'hoje' },
];
export const fmtData = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

export async function rotasCatalogo(app: FastifyInstance) {
  app.get('/api/catalogo-relatorios', async (req) => {
    const u = exigirUsuario(req);
    const modulo = (req.query as any).modulo as string | undefined;
    const dinamicos = (await Promise.all(fontes.map((f) => f.listar(u)))).flat();
    return [...listarRelatorios(), ...dinamicos]
      .filter((r) => (!modulo || r.modulo === modulo) && (r.permissao === 'livre' || temPermissao(u, r.permissao)))
      .map(({ gerar: _g, ...r }) => r);
  });

  app.post('/api/catalogo-relatorios/:id', async (req, reply) => {
    const u = exigirUsuario(req);
    const d = await localizar((req.params as any).id, u);
    if (!d) throw new ErroHttp(404, 'Relatório inexistente.');
    if (d.permissao !== 'livre' && !temPermissao(u, d.permissao)) throw new ErroHttp(403, 'Operador sem permissão para este relatório.');
    const b = z
      .object({ filtros: z.record(z.any()).default({}), formato: z.enum([...FORMATOS, 'json'] as [string, ...string[]]).default('pdf'), segundoPlano: z.boolean().default(false), zebrado: z.boolean().optional() })
      .parse(req.body);
    for (const f of d.filtros) if (f.obrigatorio && (b.filtros[f.nome] === undefined || b.filtros[f.nome] === '' || b.filtros[f.nome] === null)) throw new ErroHttp(422, `Informe o filtro "${f.rotulo}".`);
    const r = await d.gerar(b.filtros, u);
    if (b.formato === 'json') return { titulo: d.titulo, ...r };
    const filtrosTexto =
      r.filtrosTexto ??
      d.filtros
        .filter((f) => b.filtros[f.nome] !== undefined && b.filtros[f.nome] !== '' && b.filtros[f.nome] !== null)
        .map((f) => `${f.rotulo}: ${f.tipo === 'data' ? fmtData(b.filtros[f.nome]) : (b.filtros[`${f.nome}__rotulo`] ?? b.filtros[f.nome])}`);
    const emitir = () =>
      emitirTabela(
        { relatorio: d.id, titulo: d.titulo, formato: b.formato as Formato, filtros: b.filtros, filtrosTexto, orientacao: r.orientacao, formatoId: r.formatoId },
        { titulo: d.titulo, colunas: r.colunas, linhas: r.linhas, agrupar: r.agrupar, grafico: r.grafico, zebrado: b.zebrado },
        u,
      );
    if (b.segundoPlano) {
      emitirEmSegundoPlano(emitir, u, d.titulo);
      return reply.status(202).send({ mensagem: 'Relatório em emissão; você será notificado ao concluir.' });
    }
    const res = await emitir();
    return reply.header('content-type', res.mime).header('x-codigo-relatorio', res.codigo).header('content-disposition', `inline; filename="${res.nome}"`).send(res.conteudo);
  });
}
