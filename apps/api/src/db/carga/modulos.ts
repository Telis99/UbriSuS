// Cargas iniciais registradas pelos módulos (imunobiológicos, tipos de veículos, etc.).
import type pg from 'pg';

export const cargasModulos: [string, (c: pg.PoolClient) => Promise<void>][] = [];

export function registrarCarga(nome: string, fn: (c: pg.PoolClient) => Promise<void>) {
  cargasModulos.push([nome, fn]);
}

export interface ContextoDemonstracao {
  pacientes: number[];
  profissionais: Record<string, number>;
  unidades: Record<string, number>;
}

export const cargasDemonstracao: [string, (c: pg.PoolClient, ctx: ContextoDemonstracao) => Promise<void>][] = [];

export function registrarCargaDemonstracao(nome: string, fn: (c: pg.PoolClient, ctx: ContextoDemonstracao) => Promise<void>) {
  cargasDemonstracao.push([nome, fn]);
}
