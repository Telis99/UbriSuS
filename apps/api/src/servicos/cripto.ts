// Cifragem simétrica (AES-256-GCM) de segredos armazenados: certificados A1,
// senhas de integrações e dados coletados offline (TR 1.2.49.10).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Chave mestra: variável CHAVE_CRIPTOGRAFIA em produção (cofre de segredos); em desenvolvimento,
 * arquivo local gerado uma única vez, para que os dados cifrados sobrevivam a reinícios.
 */
let mestra: Buffer | null = null;
const chave = () => {
  if (mestra) return mestra;
  let segredo = process.env.CHAVE_CRIPTOGRAFIA;
  if (!segredo) {
    const arq = resolve(process.env.ARQUIVO_CHAVE ?? '.dados/chave-criptografia');
    if (!existsSync(arq)) {
      mkdirSync(dirname(arq), { recursive: true });
      writeFileSync(arq, randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    segredo = readFileSync(arq, 'utf8').trim();
  }
  mestra = createHash('sha256').update(segredo).digest();
  return mestra;
};

export function cifrar(dados: Buffer | string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(), iv);
  const enc = Buffer.concat([c.update(typeof dados === 'string' ? Buffer.from(dados) : dados), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decifrar(texto: string): Buffer {
  const [v, iv, tag, enc] = texto.split('.');
  if (v !== 'v1') throw new Error('Formato de dado cifrado desconhecido.');
  const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]);
}
