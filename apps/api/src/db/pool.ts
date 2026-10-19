import pg from 'pg';
import { config } from '../config.js';

// Tipos retornados como valores JS simples: datas como 'AAAA-MM-DD', bigint e numeric como number.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type Cliente = pg.PoolClient | pg.Pool;

/** Contexto do operador propagado ao banco para os logs de auditoria (TR 1.1.1.11, 1.1.1.37). */
export interface Contexto {
  usuarioId?: number | null;
  ip?: string | null;
  rotina?: string | null;
}

export async function consultar<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
  cliente: Cliente = pool,
): Promise<T[]> {
  const r = await cliente.query<T>(sql, params as any[]);
  return r.rows;
}

export async function consultarUm<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
  cliente: Cliente = pool,
): Promise<T | undefined> {
  const r = await cliente.query<T>(sql, params as any[]);
  return r.rows[0];
}

/**
 * Executa `fn` em uma transação ACID: tudo é gravado ou nada é gravado (TR 1.1.1.19, 1.1.2.1.12).
 * Define variáveis locais lidas pelos gatilhos de auditoria.
 */
export async function transacao<T>(ctx: Contexto, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.usuario_id', $1, true), set_config('app.ip', $2, true), set_config('app.rotina', $3, true)`,
      [ctx.usuarioId != null ? String(ctx.usuarioId) : '', ctx.ip ?? '', ctx.rotina ?? ''],
    );
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
