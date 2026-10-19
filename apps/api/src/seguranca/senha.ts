import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (s: string, salt: Buffer, len: number, opt: object) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;

/** Senhas armazenadas apenas como hash scrypt com sal aleatório (TR 1.1.1.29.4). */
export async function gerarHashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(senha, sal, 64, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function conferirSenha(senha: string, armazenado: string | null | undefined): Promise<boolean> {
  if (!armazenado) return false;
  const [alg, n, r, p, sal, hash] = armazenado.split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const obtido = await scrypt(senha, Buffer.from(sal, 'base64'), esperado.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(esperado, obtido);
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const gerarToken = () => randomBytes(32).toString('base64url');

/** Senha temporária que atende à política (letras, número e caractere especial). */
export function gerarSenhaTemporaria(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const especiais = '@#$%&*!?';
  let s = '';
  for (let i = 0; i < 7; i++) s += letras[randomInt(letras.length)];
  s += numeros[randomInt(numeros.length)];
  s += numeros[randomInt(numeros.length)];
  s += especiais[randomInt(especiais.length)];
  return s
    .split('')
    .sort(() => randomInt(3) - 1)
    .join('');
}
