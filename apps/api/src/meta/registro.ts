import type { Campo, Entidade } from './tipos.js';

const entidades = new Map<string, Entidade>();
const modulosRotina = new Map<string, string>();

/** Módulo ao qual pertence uma rotina de permissão (permite perfis com 'MODULO:acao'). */
export function associarRotinaModulo(rotina: string, modulo: string) {
  if (!modulosRotina.has(rotina)) modulosRotina.set(rotina, modulo);
}
export const moduloDaRotina = (rotina: string) => modulosRotina.get(rotina);

export function definirEntidade(e: Entidade): Entidade {
  if (entidades.has(e.nome)) throw new Error(`Entidade duplicada: ${e.nome}`);
  for (const c of e.campos) {
    if (!/^[a-z][a-z0-9_]*$/.test(c.nome)) throw new Error(`Nome de campo inválido: ${e.nome}.${c.nome}`);
  }
  entidades.set(e.nome, e);
  associarRotinaModulo(e.permissao ?? e.nome, e.modulo);
  return e;
}

export function obterEntidade(nome: string): Entidade | undefined {
  return entidades.get(nome);
}

export function listarEntidades(): Entidade[] {
  return [...entidades.values()];
}

export function campoDe(e: Entidade, nome: string): Campo | undefined {
  return e.campos.find((c) => c.nome === nome);
}

export function permissaoDe(e: Entidade) {
  return e.permissao ?? e.nome;
}

// Campos reutilizados em várias entidades.
export const campoAtivo: Campo = { nome: 'ativo', tipo: 'booleano', rotulo: 'Ativo', padrao: true, lista: true };
export const campoNome = (max = 120, extra: Partial<Campo> = {}): Campo => ({
  nome: 'nome',
  tipo: 'texto',
  rotulo: 'Nome',
  obrigatorio: true,
  max,
  lista: true,
  busca: true,
  largura: 8,
  ...extra,
});
export const campoCodigo = (max = 20, extra: Partial<Campo> = {}): Campo => ({
  nome: 'codigo',
  tipo: 'texto',
  rotulo: 'Código',
  max,
  lista: true,
  busca: true,
  largura: 4,
  ...extra,
});
