// Cargas iniciais registradas pelos módulos (imunobiológicos, tipos de veículos, etc.).
import type pg from 'pg';

export const cargasModulos: [string, (c: pg.PoolClient) => Promise<void>][] = [];

export function registrarCarga(nome: string, fn: (c: pg.PoolClient) => Promise<void>) {
  cargasModulos.push([nome, fn]);
}
