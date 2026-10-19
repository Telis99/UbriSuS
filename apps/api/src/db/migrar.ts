import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { sincronizarEsquema } from '../meta/esquema.js';
import '../modulos/index.js';

const dirMigracoes = new URL('../../migrations', import.meta.url).pathname;

/**
 * Atualização do banco, executada com o papel exclusivo de atualização (TR 1.1.1.21):
 * 1. migrações SQL numeradas (uma única vez cada);
 * 2. sincronização das tabelas definidas por metadados;
 * 3. scripts pós-sincronização idempotentes (visões, funções, gatilhos de negócio);
 * 4. permissões dos papéis de aplicação e consulta.
 */
export async function migrar(log: (m: string) => void = console.log) {
  const cliente = new pg.Client({ connectionString: config.databaseUrlMigrador });
  await cliente.connect();
  try {
    await cliente.query(`create table if not exists public.migracao (nome text primary key, aplicada_em timestamptz not null default now())`);
    const aplicadas = new Set((await cliente.query(`select nome from public.migracao`)).rows.map((r) => r.nome));
    const arquivos = readdirSync(dirMigracoes).filter((f) => f.endsWith('.sql')).sort();
    for (const arq of arquivos) {
      if (aplicadas.has(arq)) continue;
      log(`aplicando migração ${arq}`);
      await cliente.query('begin');
      try {
        await cliente.query(readFileSync(join(dirMigracoes, arq), 'utf8'));
        await cliente.query(`insert into public.migracao (nome) values ($1)`, [arq]);
        await cliente.query('commit');
      } catch (e) {
        await cliente.query('rollback');
        throw new Error(`Falha na migração ${arq}: ${(e as Error).message}`);
      }
    }

    await cliente.query('begin');
    await sincronizarEsquema(cliente as unknown as pg.PoolClient, log);
    await cliente.query('commit');

    const dirPos = join(dirMigracoes, 'pos');
    if (existsSync(dirPos)) {
      for (const arq of readdirSync(dirPos).filter((f) => f.endsWith('.sql')).sort()) {
        log(`executando ${arq}`);
        await cliente.query(readFileSync(join(dirPos, arq), 'utf8'));
      }
    }

    await concederPermissoes(cliente);
  } finally {
    await cliente.end();
  }
}

async function concederPermissoes(c: pg.Client) {
  const papeis = (await c.query(`select rolname from pg_roles where rolname in ('ubrisus_aplicacao','ubrisus_consulta')`)).rows.map(
    (r) => r.rolname,
  );
  const esquemas = (
    await c.query(
      `select nspname from pg_namespace where nspname not like 'pg_%' and nspname not in ('information_schema')`,
    )
  ).rows.map((r) => r.nspname as string);
  for (const s of esquemas) {
    if (papeis.includes('ubrisus_aplicacao')) {
      await c.query(`grant usage on schema "${s}" to ubrisus_aplicacao`);
      if (s === 'aud') {
        // Auditoria: a aplicação só inclui e consulta.
        await c.query(`grant select, insert on all tables in schema aud to ubrisus_aplicacao`);
      } else {
        await c.query(`grant select, insert, update, delete on all tables in schema "${s}" to ubrisus_aplicacao`);
      }
      await c.query(`grant usage, select on all sequences in schema "${s}" to ubrisus_aplicacao`);
      await c.query(`grant execute on all functions in schema "${s}" to ubrisus_aplicacao`);
    }
    if (papeis.includes('ubrisus_consulta') && s !== 'seg') {
      await c.query(`grant usage on schema "${s}" to ubrisus_consulta`);
      await c.query(`grant select on all tables in schema "${s}" to ubrisus_consulta`);
    }
  }
}
