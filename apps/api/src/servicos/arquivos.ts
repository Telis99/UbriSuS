import { createHash } from 'node:crypto';
import { consultarUm, pool, type Cliente } from '../db/pool.js';
import { ErroHttp } from '../seguranca/usuario.js';

export const TIPOS_PERMITIDOS = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
  'text/html',
  'application/xml',
  'text/xml',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export async function salvarArquivo(
  nome: string,
  tipoMime: string,
  conteudo: Buffer,
  operadorId?: number | null,
  cliente: Cliente = pool,
): Promise<string> {
  const sha = createHash('sha256').update(conteudo).digest('hex');
  const r = await cliente.query(
    `insert into sis.arquivo (nome, tipo_mime, tamanho, sha256, conteudo, criado_por) values ($1,$2,$3,$4,$5,$6) returning id`,
    [nome, tipoMime, conteudo.length, sha, conteudo, operadorId ?? null],
  );
  return r.rows[0].id;
}

export async function lerArquivo(id: string, cliente: Cliente = pool) {
  const a = await consultarUm<{ id: string; nome: string; tipo_mime: string; tamanho: number; sha256: string; conteudo: Buffer }>(
    `select id, nome, tipo_mime, tamanho, sha256, conteudo from sis.arquivo where id = $1`,
    [id],
    cliente,
  );
  if (!a) throw new ErroHttp(404, 'Arquivo não encontrado.');
  return a;
}
