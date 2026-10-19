// Descoberta automática dos módulos: cada pasta em src/modulos pode conter entidades.ts, rotas.ts
// (export default async function (app)), carga.ts e relatorios.ts, carregados sem registro manual.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const pastas = readdirSync(dir)
  .filter((d) => statSync(join(dir, d)).isDirectory())
  .sort();

/** Importa o arquivo do módulo (.ts em desenvolvimento, .js no build) e devolve o módulo carregado. */
export async function importarDosModulos(arquivo: string): Promise<{ pasta: string; modulo: any }[]> {
  const out = [];
  for (const pasta of pastas) {
    for (const ext of ['.ts', '.js']) {
      const f = join(dir, pasta, arquivo + ext);
      if (existsSync(f)) {
        // Um módulo com falha de carga é registrado no log e não impede a subida dos demais.
        try {
          out.push({ pasta, modulo: await import(pathToFileURL(f).href) });
        } catch (e) {
          console.error(`[módulos] falha ao carregar ${pasta}/${arquivo}:`, (e as Error).message);
        }
        break;
      }
    }
  }
  return out;
}
