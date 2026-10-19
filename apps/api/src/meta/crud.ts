// Motor genérico de consulta e manutenção de cadastros a partir dos metadados.
import type pg from 'pg';
import {
  normalizarNome,
  somenteDigitos,
  validarCep,
  validarCnpj,
  validarCns,
  validarCpf,
  validarEmail,
  validarTelefone,
} from '../compartilhado/validacao.js';
import { consultar, consultarUm, transacao, type Cliente, type Contexto } from '../db/pool.js';
import { ErroHttp, type Usuario } from '../seguranca/usuario.js';
import { id, tabelaSql } from './esquema.js';
import { campoDe, obterEntidade } from './registro.js';
import type { Campo, Entidade } from './tipos.js';

// ---------------------------------------------------------------------------
// Ganchos de regras de negócio por entidade
// ---------------------------------------------------------------------------
export interface ContextoGancho {
  cliente: pg.PoolClient;
  usuario?: Usuario;
  id?: number;
  atual?: Record<string, any>;
}

export interface Ganchos {
  /** Ajusta/valida os dados antes de gravar. Pode lançar ErroHttp. */
  antesSalvar?(dados: Record<string, any>, ctx: ContextoGancho): Promise<void> | void;
  depoisSalvar?(registro: Record<string, any>, ctx: ContextoGancho): Promise<void> | void;
  antesExcluir?(registro: Record<string, any>, ctx: ContextoGancho): Promise<void> | void;
  /** Restrição adicional de linhas visíveis (ex.: unidades do operador). */
  filtroLeitura?(usuario: Usuario | undefined, alias: string, params: unknown[]): string | null;
}

const ganchos = new Map<string, Ganchos[]>();
export function registrarGanchos(entidade: string, g: Ganchos) {
  ganchos.set(entidade, [...(ganchos.get(entidade) ?? []), g]);
}
const ganchosDe = (e: Entidade) => ganchos.get(e.nome) ?? [];

// ---------------------------------------------------------------------------
// Expressões SQL
// ---------------------------------------------------------------------------
let seqAlias = 0;
const novoAlias = () => `r${++seqAlias}`;

export function exprRotulo(e: Entidade, alias: string, profundidade = 0): string {
  const partes = e.rotulo.map((n) => {
    const c = campoDe(e, n);
    const col = `${alias}.${id(n)}`;
    if (c?.tipo === 'ref' && profundidade < 2) {
      const r = obterEntidade(c.ref!)!;
      const a = novoAlias();
      return `(select ${exprRotulo(r, a, profundidade + 1)} from ${tabelaSql(r)} ${a} where ${a}.id = ${col})`;
    }
    if (c?.tipo === 'data') return `to_char(${col}, 'DD/MM/YYYY')`;
    if (c?.tipo === 'data_hora') return `to_char(${col} at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')`;
    if (c?.tipo === 'opcao' && c.opcoes) {
      return `(case ${col} ${c.opcoes.map(([v, r]) => `when '${v.replace(/'/g, "''")}' then '${r.replace(/'/g, "''")}'`).join(' ')} else ${col}::text end)`;
    }
    return `${col}::text`;
  });
  return partes.length === 1 ? `coalesce(${partes[0]}, '')` : `concat_ws(' - ', ${partes.join(', ')})`;
}

function exprRef(c: Campo, alias: string) {
  const r = obterEntidade(c.ref!)!;
  const a = novoAlias();
  return `(select ${exprRotulo(r, a, 1)} from ${tabelaSql(r)} ${a} where ${a}.id = ${alias}.${id(c.nome)})`;
}

const visivel = (c: Campo, u?: Usuario) =>
  c.tipo !== 'segredo' && (!c.permissaoLeitura || !u || u.administrador || u.permissoes.has(c.permissaoLeitura));

export function colunasSelect(e: Entidade, u?: Usuario, alias = 't'): string {
  const cols = [`${alias}.id`, `${alias}.criado_em`, `${alias}.criado_por`, `${alias}.atualizado_em`, `${alias}.atualizado_por`];
  for (const c of e.campos) {
    if (!visivel(c, u)) continue;
    if (c.sqlCalculado) cols.push(`(${c.sqlCalculado}) as ${id(c.nome)}`);
    else cols.push(`${alias}.${id(c.nome)}`);
    if (c.tipo === 'ref') cols.push(`${exprRef(c, alias)} as ${id(c.nome + '__rotulo')}`);
  }
  cols.push(`${exprRotulo(e, alias)} as __rotulo`);
  cols.push(`(select coalesce(o.nome, o.login) from seg.operador o where o.id = ${alias}.criado_por) as criado_por__rotulo`);
  cols.push(`(select coalesce(o.nome, o.login) from seg.operador o where o.id = ${alias}.atualizado_por) as atualizado_por__rotulo`);
  return cols.join(', ');
}

// ---------------------------------------------------------------------------
// Filtros (TR 1.1.1.59: Igual a, Contém, Não contém, Menor que, Maior que, Inicia com, Termina com)
// ---------------------------------------------------------------------------
export const OPERADORES = [
  'igual',
  'diferente',
  'contem',
  'nao_contem',
  'inicia',
  'termina',
  'menor',
  'maior',
  'menor_igual',
  'maior_igual',
  'entre',
  'vazio',
  'preenchido',
  'em',
] as const;
export type Operador = (typeof OPERADORES)[number];

export interface Filtro {
  campo: string;
  op: Operador;
  valor?: unknown;
  valor2?: unknown;
}

const TEXTUAIS = new Set(['texto', 'texto_longo', 'email', 'opcao']);
const DIGITOS = new Set(['cpf', 'cnpj', 'cns', 'cep', 'telefone']);

export function sqlFiltro(e: Entidade, f: Filtro, params: unknown[], alias = 't'): string {
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  let c: Campo | undefined;
  let col: string;
  if (f.campo === 'id') {
    c = { nome: 'id', tipo: 'inteiro', rotulo: 'Código' };
    col = `${alias}.id`;
  } else if (f.campo === '__rotulo') {
    c = { nome: '__rotulo', tipo: 'texto', rotulo: 'Descrição' };
    col = exprRotulo(e, alias);
  } else if (['criado_em', 'atualizado_em'].includes(f.campo)) {
    c = { nome: f.campo, tipo: 'data_hora', rotulo: f.campo };
    col = `${alias}.${f.campo}`;
  } else {
    c = campoDe(e, f.campo);
    if (!c || c.tipo === 'segredo') throw new ErroHttp(400, `Campo de filtro inválido: ${f.campo}`);
    col = c.sqlCalculado ? `(${c.sqlCalculado})` : `${alias}.${id(c.nome)}`;
  }
  if (!OPERADORES.includes(f.op)) throw new ErroHttp(400, `Operador inválido: ${f.op}`);
  if (f.op === 'vazio') return `${col} is null`;
  if (f.op === 'preenchido') return `${col} is not null`;

  let v: any = f.valor;
  if (DIGITOS.has(c.tipo) && typeof v === 'string') v = somenteDigitos(v);

  // Referência: filtro por id ou pela descrição do registro referenciado.
  if (c.tipo === 'ref') {
    if (f.op === 'igual') return `${col} = ${p(Number(v))}`;
    if (f.op === 'diferente') return `${col} is distinct from ${p(Number(v))}`;
    if (f.op === 'em') return `${col} = any(${p((v as unknown[]).map(Number))}::bigint[])`;
    col = exprRef(c, alias);
    c = { ...c, tipo: 'texto' };
  }
  if (c.tipo === 'multi_opcao') {
    if (f.op === 'contem' || f.op === 'igual') return `${p(String(v))} = any(${col})`;
    if (f.op === 'nao_contem' || f.op === 'diferente') return `not (${p(String(v))} = any(coalesce(${col}, '{}')))`;
    throw new ErroHttp(400, 'Operador não suportado para lista de opções.');
  }
  // Opções: o operador digita a descrição ("Feminino") e o filtro usa os códigos correspondentes.
  if (c.tipo === 'opcao' && c.opcoes && ['contem', 'nao_contem', 'igual', 'diferente', 'inicia', 'termina'].includes(f.op)) {
    const s = normalizarNome(String(v ?? ''));
    const casa = (texto: string) => {
      const n = normalizarNome(texto);
      if (f.op === 'igual' || f.op === 'diferente') return n === s;
      if (f.op === 'inicia') return n.startsWith(s);
      if (f.op === 'termina') return n.endsWith(s);
      return n.includes(s);
    };
    const codigos = c.opcoes.filter(([cod, rot]) => casa(rot) || casa(cod)).map(([cod]) => cod);
    const negar = f.op === 'nao_contem' || f.op === 'diferente';
    return negar ? `(${col} is null or not (${col} = any(${p(codigos)}::text[])))` : `${col} = any(${p(codigos)}::text[])`;
  }
  if (TEXTUAIS.has(c.tipo) || DIGITOS.has(c.tipo)) {
    const t = `f_unaccent(${col}::text)`;
    const s = String(v ?? '');
    switch (f.op) {
      case 'igual':
        return `${t} ilike f_unaccent(${p(s)})`;
      case 'diferente':
        return `${t} not ilike f_unaccent(${p(s)})`;
      case 'contem':
        return `${t} ilike f_unaccent(${p('%' + s + '%')})`;
      case 'nao_contem':
        return `coalesce(${t}, '') not ilike f_unaccent(${p('%' + s + '%')})`;
      case 'inicia':
        return `${t} ilike f_unaccent(${p(s + '%')})`;
      case 'termina':
        return `${t} ilike f_unaccent(${p('%' + s)})`;
      case 'em':
        return `${col} = any(${p(v)}::text[])`;
    }
  }
  if (c.tipo === 'booleano') {
    if (f.op === 'igual') return `${col} = ${p(v === true || v === 'true')}`;
    if (f.op === 'diferente') return `${col} is distinct from ${p(v === true || v === 'true')}`;
  }
  const cast = { inteiro: 'bigint', decimal: 'numeric', moeda: 'numeric', data: 'date', data_hora: 'timestamptz', hora: 'time' }[
    c.tipo as string
  ];
  const pc = (x: unknown) => (cast ? `${p(x)}::${cast}` : p(x));
  switch (f.op) {
    case 'igual':
      return c.tipo === 'data_hora' ? `${col}::date = ${p(v)}::date` : `${col} = ${pc(v)}`;
    case 'diferente':
      return `${col} is distinct from ${pc(v)}`;
    case 'menor':
      return `${col} < ${pc(v)}`;
    case 'maior':
      return `${col} > ${pc(v)}`;
    case 'menor_igual':
      return `${col} <= ${pc(v)}`;
    case 'maior_igual':
      return `${col} >= ${pc(v)}`;
    case 'entre':
      return `${col} between ${pc(v)} and ${pc(f.valor2)}`;
    case 'em':
      return `${col} = any(${p(v)}${cast ? `::${cast}[]` : ''})`;
  }
  throw new ErroHttp(400, `Operador ${f.op} não se aplica ao campo ${c.rotulo}.`);
}

export function sqlBuscaRapida(e: Entidade, q: string, params: unknown[], alias = 't'): string | null {
  const termo = q.trim();
  if (!termo) return null;
  const partes: string[] = [];
  const digitos = somenteDigitos(termo);
  for (const c of e.campos) {
    if (!c.busca || c.sqlCalculado) continue;
    if (DIGITOS.has(c.tipo)) {
      if (digitos.length >= 3) {
        params.push(digitos + '%');
        partes.push(`${alias}.${id(c.nome)} like $${params.length}`);
      }
    } else {
      params.push('%' + termo + '%');
      partes.push(`f_unaccent(${alias}.${id(c.nome)}::text) ilike f_unaccent($${params.length})`);
    }
  }
  if (/^\d+$/.test(termo)) {
    params.push(Number(termo));
    partes.push(`${alias}.id = $${params.length}`);
  }
  return partes.length ? `(${partes.join(' or ')})` : null;
}

function sqlOrdem(e: Entidade, ordem?: string): string {
  const padrao = e.ordemPadrao ?? 'id desc';
  const lista = (ordem || padrao).split(',').map((s) => s.trim()).filter(Boolean);
  return lista
    .map((item) => {
      const [nome, dir = 'asc'] = item.split(/\s+/);
      const d = dir.toLowerCase() === 'desc' ? 'desc' : 'asc';
      if (nome === 'id' || nome === 'criado_em' || nome === 'atualizado_em') return `t.${nome} ${d}`;
      if (nome === '__rotulo') return `__rotulo ${d}`;
      const c = campoDe(e, nome);
      if (!c || !visivel(c)) throw new ErroHttp(400, `Ordenação inválida: ${nome}`);
      if (c.tipo === 'ref') return `${id(nome + '__rotulo')} ${d} nulls last`;
      if (c.sqlCalculado) return `${id(c.nome)} ${d} nulls last`;
      return `t.${id(nome)} ${d} nulls last`;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
export interface ParametrosLista {
  filtros?: Filtro[];
  q?: string;
  ordem?: string;
  pagina?: number;
  tamanho?: number;
  /** Filtro fixo por campo = valor (ex.: registros filhos). */
  fixos?: Record<string, unknown>;
}

function montarWhere(e: Entidade, p: ParametrosLista, u: Usuario | undefined, params: unknown[]) {
  const where: string[] = [];
  for (const f of p.filtros ?? []) where.push(sqlFiltro(e, f, params));
  for (const [campo, valor] of Object.entries(p.fixos ?? {})) {
    where.push(valor === null ? `t.${id(campo)} is null` : sqlFiltro(e, { campo, op: 'igual', valor }, params));
  }
  if (p.q) {
    const b = sqlBuscaRapida(e, p.q, params);
    if (b) where.push(b);
  }
  for (const g of ganchosDe(e)) {
    const extra = g.filtroLeitura?.(u, 't', params);
    if (extra) where.push(extra);
  }
  return where.length ? `where ${where.join(' and ')}` : '';
}

export async function listar(e: Entidade, p: ParametrosLista, u?: Usuario, cliente?: Cliente) {
  const params: unknown[] = [];
  const where = montarWhere(e, p, u, params);
  const tamanho = Math.min(Math.max(p.tamanho ?? 50, 1), 5000);
  const pagina = Math.max(p.pagina ?? 1, 1);
  const sql = `select ${colunasSelect(e, u)}, count(*) over() as __total
                 from ${tabelaSql(e)} t ${where}
                order by ${sqlOrdem(e, p.ordem)}
                limit ${tamanho} offset ${(pagina - 1) * tamanho}`;
  const linhas = await consultar(sql, params, cliente);
  const total = linhas[0]?.__total ?? 0;
  for (const l of linhas) delete l.__total;
  return { total: Number(total), pagina, tamanho, linhas };
}

export async function obter(e: Entidade, registroId: number, u?: Usuario, cliente?: Cliente) {
  const params: unknown[] = [registroId];
  let extra = '';
  for (const g of ganchosDe(e)) {
    const f = g.filtroLeitura?.(u, 't', params);
    if (f) extra += ` and ${f}`;
  }
  const r = await consultarUm(`select ${colunasSelect(e, u)} from ${tabelaSql(e)} t where t.id = $1${extra}`, params, cliente);
  if (!r) throw new ErroHttp(404, `${e.tituloSingular} não encontrado(a).`);
  return r;
}

/** Opções para autocompletar campos de referência (TR 1.1.1.58, 1.1.2.1.16). */
export async function opcoes(e: Entidade, q: string, u?: Usuario, filtrosFixos: Record<string, unknown> = {}, limite = 30) {
  const params: unknown[] = [];
  const where: string[] = [];
  const b = sqlBuscaRapida(e, q, params);
  if (b) where.push(b);
  if (e.campoAtivo ?? campoDe(e, 'ativo')) where.push(`t.${id(e.campoAtivo ?? 'ativo')} is not false`);
  for (const [campo, valor] of Object.entries(filtrosFixos)) where.push(sqlFiltro(e, { campo, op: 'igual', valor }, params));
  for (const g of ganchosDe(e)) {
    const f = g.filtroLeitura?.(u, 't', params);
    if (f) where.push(f);
  }
  return consultar(
    `select t.id, ${exprRotulo(e, 't')} as rotulo from ${tabelaSql(e)} t
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by ${sqlOrdem(e)} limit ${Math.min(limite, 200)}`,
    params,
  );
}

// ---------------------------------------------------------------------------
// Validação e normalização de entrada
// ---------------------------------------------------------------------------
export function normalizarEntrada(e: Entidade, entrada: Record<string, any>, inclusao: boolean) {
  const saida: Record<string, any> = {};
  const erros: Record<string, string> = {};
  for (const c of e.campos) {
    if (c.sqlCalculado || c.tipo === 'segredo' || c.somenteLeitura) continue;
    if (!(c.nome in entrada)) {
      if (inclusao && c.obrigatorio && c.padrao === undefined && !c.oculto) erros[c.nome] = `${c.rotulo} é obrigatório.`;
      continue;
    }
    let v = entrada[c.nome];
    if (v === '' || v === undefined) v = null;
    try {
      v = converter(c, v);
    } catch (err) {
      erros[c.nome] = (err as Error).message;
      continue;
    }
    if (v === null && c.obrigatorio && !c.oculto) {
      erros[c.nome] = `${c.rotulo} é obrigatório.`;
      continue;
    }
    saida[c.nome] = v;
  }
  if (Object.keys(erros).length) throw new ErroHttp(422, 'Verifique os campos destacados.', erros);
  return saida;
}

function converter(c: Campo, v: any): any {
  if (v === null) return null;
  switch (c.tipo) {
    case 'texto':
    case 'texto_longo':
    case 'cor': {
      let s = String(v).trim();
      if (c.maiusculo) s = s.toUpperCase().replace(/\s+/g, ' ');
      if (c.max && s.length > c.max) throw new Error(`${c.rotulo}: máximo de ${c.max} caracteres.`);
      return s || null;
    }
    case 'email': {
      const s = String(v).trim().toLowerCase();
      if (!validarEmail(s)) throw new Error('E-mail inválido.');
      return s;
    }
    case 'inteiro': {
      const n = Number(v);
      if (!Number.isInteger(n)) throw new Error(`${c.rotulo}: informe um número inteiro.`);
      if (c.min !== undefined && n < c.min) throw new Error(`${c.rotulo}: mínimo ${c.min}.`);
      if (c.max !== undefined && n > c.max) throw new Error(`${c.rotulo}: máximo ${c.max}.`);
      return n;
    }
    case 'decimal':
    case 'moeda': {
      const n = typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v);
      if (!Number.isFinite(n)) throw new Error(`${c.rotulo}: valor numérico inválido.`);
      return n;
    }
    case 'data': {
      const s = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw new Error(`${c.rotulo}: data inválida.`);
      return s;
    }
    case 'data_hora': {
      const d = new Date(v);
      if (isNaN(d.getTime())) throw new Error(`${c.rotulo}: data e hora inválidas.`);
      return d.toISOString();
    }
    case 'hora': {
      const s = String(v);
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) throw new Error(`${c.rotulo}: hora inválida (HH:MM).`);
      return s;
    }
    case 'booleano':
      return v === true || v === 'true' || v === 1 || v === 'S';
    case 'opcao': {
      const s = String(v);
      if (c.opcoes && !c.opcoes.some(([o]) => o === s)) throw new Error(`${c.rotulo}: opção inválida.`);
      return s;
    }
    case 'multi_opcao': {
      const arr = Array.isArray(v) ? v.map(String) : String(v).split(',').filter(Boolean);
      if (c.opcoes) for (const x of arr) if (!c.opcoes.some(([o]) => o === x)) throw new Error(`${c.rotulo}: opção inválida (${x}).`);
      return arr;
    }
    case 'ref': {
      const n = Number(typeof v === 'object' ? v.id : v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`${c.rotulo}: seleção inválida.`);
      return n;
    }
    case 'cpf': {
      const d = somenteDigitos(v);
      if (!validarCpf(d)) throw new Error('CPF inválido.');
      return d;
    }
    case 'cnpj': {
      const d = somenteDigitos(v);
      if (!validarCnpj(d)) throw new Error('CNPJ inválido.');
      return d;
    }
    case 'cns': {
      const d = somenteDigitos(v);
      if (!validarCns(d)) throw new Error('Cartão Nacional de Saúde inválido.');
      return d;
    }
    case 'cep': {
      const d = somenteDigitos(v);
      if (!validarCep(d)) throw new Error('CEP deve ter 8 dígitos.');
      return d;
    }
    case 'telefone': {
      const d = somenteDigitos(v);
      if (!validarTelefone(d)) throw new Error(`${c.rotulo}: informe DDD + número.`);
      return d;
    }
    case 'json':
      return typeof v === 'string' ? JSON.parse(v) : v;
    case 'arquivo': {
      const s = String(typeof v === 'object' ? v.id : v);
      if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error(`${c.rotulo}: arquivo inválido.`);
      return s;
    }
    default:
      return v;
  }
}

function paraSql(c: Campo | undefined, v: unknown) {
  if (c?.tipo === 'json' && v !== null) return JSON.stringify(v);
  return v;
}

// ---------------------------------------------------------------------------
// Escrita (transacional, com auditoria pelos gatilhos do banco)
// ---------------------------------------------------------------------------
function traduzirErroBanco(e: Entidade, err: any, exclusao = false): never {
  if (err instanceof ErroHttp) throw err;
  if (err?.code === '23503') {
    if (exclusao) {
      throw new ErroHttp(409, `Não é possível excluir: este(a) ${e.tituloSingular.toLowerCase()} possui vínculos com outros registros ativos.`);
    }
    throw new ErroHttp(422, 'Registro relacionado inexistente.', { detalhe: err.detail });
  }
  if (err?.code === '23505') {
    const m = /\(([^)]+)\)=/.exec(err.detail ?? '');
    const campos = m?.[1]?.split(',').map((s: string) => s.trim().replace(/"/g, '')) ?? [];
    const rotulos = campos.map((n: string) => campoDe(e, n)?.rotulo ?? n);
    throw new ErroHttp(409, `Já existe ${e.tituloSingular.toLowerCase()} com o mesmo valor em: ${rotulos.join(', ')}.`, {
      campos: Object.fromEntries(campos.map((n: string) => [n, 'Valor já cadastrado.'])),
    });
  }
  if (err?.code === '23514' || err?.code === '23502') throw new ErroHttp(422, 'Dados inválidos: ' + (err.detail ?? err.message));
  throw err;
}

export async function inserir(e: Entidade, entrada: Record<string, any>, ctx: Contexto, u?: Usuario, cliente?: pg.PoolClient) {
  const executar = async (c: pg.PoolClient) => {
    const dados = normalizarEntrada(e, entrada, true);
    for (const g of ganchosDe(e)) await g.antesSalvar?.(dados, { cliente: c, usuario: u });
    const nomes = Object.keys(dados);
    const sql = nomes.length
      ? `insert into ${tabelaSql(e)} (${nomes.map(id).join(',')}) values (${nomes.map((_, i) => `$${i + 1}`).join(',')}) returning id`
      : `insert into ${tabelaSql(e)} default values returning id`;
    try {
      const r = await c.query(sql, nomes.map((n) => paraSql(campoDe(e, n), dados[n])));
      const novo = await obter(e, r.rows[0].id, u, c);
      for (const g of ganchosDe(e)) await g.depoisSalvar?.(novo, { cliente: c, usuario: u, id: novo.id });
      return novo;
    } catch (err) {
      traduzirErroBanco(e, err);
    }
  };
  return cliente ? executar(cliente) : transacao(ctx, executar);
}

export async function alterar(
  e: Entidade,
  registroId: number,
  entrada: Record<string, any>,
  ctx: Contexto,
  u?: Usuario,
  cliente?: pg.PoolClient,
) {
  const executar = async (c: pg.PoolClient) => {
    const atual = await consultarUm(`select * from ${tabelaSql(e)} where id = $1 for update`, [registroId], c);
    if (!atual) throw new ErroHttp(404, `${e.tituloSingular} não encontrado(a).`);
    const dados = normalizarEntrada(e, entrada, false);
    for (const g of ganchosDe(e)) await g.antesSalvar?.(dados, { cliente: c, usuario: u, id: registroId, atual });
    const nomes = Object.keys(dados);
    try {
      if (nomes.length) {
        await c.query(
          `update ${tabelaSql(e)} set ${nomes.map((n, i) => `${id(n)} = $${i + 2}`).join(', ')} where id = $1`,
          [registroId, ...nomes.map((n) => paraSql(campoDe(e, n), dados[n]))],
        );
      }
      const novo = await obter(e, registroId, u, c);
      for (const g of ganchosDe(e)) await g.depoisSalvar?.(novo, { cliente: c, usuario: u, id: registroId, atual });
      return novo;
    } catch (err) {
      traduzirErroBanco(e, err);
    }
  };
  return cliente ? executar(cliente) : transacao(ctx, executar);
}

export async function excluir(e: Entidade, registroId: number, ctx: Contexto, u?: Usuario) {
  return transacao(ctx, async (c) => {
    const atual = await consultarUm(`select * from ${tabelaSql(e)} where id = $1 for update`, [registroId], c);
    if (!atual) throw new ErroHttp(404, `${e.tituloSingular} não encontrado(a).`);
    for (const g of ganchosDe(e)) await g.antesExcluir?.(atual, { cliente: c, usuario: u, id: registroId, atual });
    try {
      await c.query(`delete from ${tabelaSql(e)} where id = $1`, [registroId]);
    } catch (err) {
      traduzirErroBanco(e, err, true);
    }
    return { ok: true };
  });
}

/** Duplica um registro para facilitar a inclusão de outro semelhante (TR 1.2.4.6, 1.2.20.1.8). */
export async function clonar(e: Entidade, registroId: number, ctx: Contexto, u?: Usuario) {
  const atual = await obter(e, registroId, u);
  const copia: Record<string, any> = {};
  for (const c of e.campos) {
    if (c.unico || c.sqlCalculado || c.somenteLeitura || c.tipo === 'segredo') continue;
    if (atual[c.nome] !== null && atual[c.nome] !== undefined) copia[c.nome] = atual[c.nome];
  }
  return { rascunho: copia };
}

export { normalizarNome };
