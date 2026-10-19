// Script temporário de desenvolvimento (removido ao final): valida as entidades e cargas dos módulos novos
// contra o banco de desenvolvimento dentro de uma transação desfeita (ou confirmada com --gravar).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../index.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pastas = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const p of pastas) for (const f of ['_entidades.ts', 'entidades.ts']) if (existsSync(join(raiz, p, f))) await import(pathToFileURL(join(raiz, p, f)).href);
const { cargasModulos, cargasDemonstracao } = await import('../../db/carga/modulos.js');
const antesC = cargasModulos.length;
const antesD = cargasDemonstracao.length;
for (const p of pastas) for (const f of ['_carga.ts', 'carga.ts']) if (existsSync(join(raiz, p, f))) await import(pathToFileURL(join(raiz, p, f)).href);
if (process.argv.includes('--rotas')) for (const p of pastas) for (const f of ['_rotas.ts', 'rotas.ts']) if (existsSync(join(raiz, p, f))) await import(pathToFileURL(join(raiz, p, f)).href);
const { pool } = await import('../../db/pool.js');
const { sincronizarEsquema } = await import('../../meta/esquema.js');
const c = await pool.connect();
try {
  await c.query('begin');
  // Só executa DDL dos esquemas dos módulos validados; consultas passam direto.
  const esquemas = (process.argv.find((a) => a.startsWith('--esquemas='))?.slice(11) ?? '').split(',').filter(Boolean);
  const filtrado = esquemas.length
    ? (new Proxy(c, {
        get(alvo, prop) {
          if (prop !== 'query') return (alvo as any)[prop];
          return (sql: any, params?: any) => {
            const texto = String(typeof sql === 'string' ? sql : sql.text).trim();
            if (/^select/i.test(texto) || esquemas.some((e) => texto.includes(`"${e}"`))) return alvo.query(sql, params);
            return Promise.resolve({ rows: [], rowCount: 0 });
          };
        },
      }) as typeof c)
    : c;
  await sincronizarEsquema(filtrado, (m) => console.log(' ', m));
  console.log('esquema ok');
  if (process.argv.includes('--carga')) {
    for (const [nome, fn] of cargasModulos.slice(antesC)) {
      console.log('carga:', nome);
      await fn(c);
    }
    const ctx = {
      pacientes: (await c.query(`select id from cad.pessoa where id not in (select pessoa_id from seg.operador) order by id`)).rows.map((r) => r.id),
      profissionais: Object.fromEntries((await c.query(`select o.login, o.profissional_id from seg.operador o where o.profissional_id is not null`)).rows.map((r) => [r.login, r.profissional_id])),
      unidades: Object.fromEntries(
        (
          await c.query(`select k, (select id from cad.unidade where nome ilike v || '%' order by id limit 1) id from (values ('usf','USF'),('usf2','USF IRM'),('upa','UPA'),('cem','CEM'),('ceo','CEO'),('almox','ALMOX'),('sms','SECRETARIA'),('caps','CAPS')) x(k, v)`)
        ).rows.map((r) => [r.k, r.id]),
      ),
    };
    for (const [nome, fn] of cargasDemonstracao.slice(antesD)) {
      console.log('demonstração:', nome);
      await fn(c, ctx);
    }
  }
  await c.query(process.argv.includes('--gravar') ? 'commit' : 'rollback');
  console.log(process.argv.includes('--gravar') ? 'GRAVADO' : 'desfeito (rollback)');
} catch (e) {
  await c.query('rollback');
  console.error('ERRO', e);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
