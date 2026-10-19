// Armazenamento local cifrado do aplicativo do ACS (TR 1.2.49.1, 1.2.49.10): IndexedDB com AES-256-GCM.
// A chave dos dados é aleatória e fica guardada cifrada por uma chave derivada da senha do ACS (PBKDF2),
// de modo que os dados coletados off-line só podem ser lidos após a identificação no aparelho.

const BANCO = 'ubrisus-acs';
const TABELA = 'dados';
const ITERACOES = 210_000;

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(TABELA);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}

async function operar<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const t = db.transaction(TABELA, modo);
    const r = fn(t.objectStore(TABELA));
    t.oncomplete = () => ok(r.result as T);
    t.onerror = () => erro(t.error);
  });
}

const lerBruto = <T = any>(chave: string) => operar<T | undefined>('readonly', (s) => s.get(chave));
const gravarBruto = (chave: string, valor: unknown) => operar('readwrite', (s) => s.put(valor, chave));
export const apagarTudo = () => operar('readwrite', (s) => s.clear());

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aleatorio = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function chaveDaSenha(senha: string, sal: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal as BufferSource, iterations: ITERACOES, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

interface Cofre {
  cpf: string;
  nome: string;
  sal: string;
  iv: string;
  chaveCifrada: string;
  criadoEm: string;
  tentativas: number;
}

let chaveDados: CryptoKey | null = null;
export const cofreAberto = () => !!chaveDados;
export const fecharCofre = () => {
  chaveDados = null;
};
export const dadosDoCofre = () => lerBruto<Cofre>('cofre');

async function abrirComSenha(c: Cofre, senha: string) {
  const kek = await chaveDaSenha(senha, deB64(c.sal));
  const bruto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(c.iv) as BufferSource }, kek, deB64(c.chaveCifrada) as BufferSource);
  return crypto.subtle.importKey('raw', bruto, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function protegerChave(cpf: string, nome: string, senha: string, bruto: Uint8Array) {
  const sal = aleatorio(16);
  const iv = aleatorio(12);
  const kek = await chaveDaSenha(senha, sal);
  const cifrada = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, bruto as BufferSource);
  await gravarBruto('cofre', { cpf, nome, sal: b64(sal), iv: b64(iv), chaveCifrada: b64(cifrada), criadoEm: new Date().toISOString(), tentativas: 0 } satisfies Cofre);
}

/**
 * Após o login on-line: abre o cofre existente do mesmo ACS ou cria um novo. Se a senha mudou desde a
 * última vez, a senha anterior é necessária para preservar as pendências ainda não enviadas.
 */
export async function abrirCofreOnline(cpf: string, nome: string, senha: string, senhaAnterior?: string): Promise<'aberto' | 'criado' | 'precisa-senha-anterior'> {
  const c = await dadosDoCofre();
  if (c && c.cpf === cpf) {
    try {
      chaveDados = await abrirComSenha(c, senha);
      await gravarBruto('cofre', { ...c, nome, tentativas: 0 });
      return 'aberto';
    } catch {
      if (senhaAnterior) {
        const antiga = await abrirComSenha(c, senhaAnterior).catch(() => null);
        if (antiga) {
          // Recifra a chave dos dados com a nova senha, sem perder as pendências.
          const bruto = new Uint8Array(await crypto.subtle.exportKey('raw', await reimportarExportavel(c, senhaAnterior)));
          await protegerChave(cpf, nome, senha, bruto);
          chaveDados = antiga;
          return 'aberto';
        }
      }
      const fila = await lerBruto('fila');
      if (fila) return 'precisa-senha-anterior';
    }
  }
  await apagarTudo();
  const bruto = aleatorio(32);
  await protegerChave(cpf, nome, senha, bruto);
  chaveDados = await crypto.subtle.importKey('raw', bruto as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return 'criado';
}

async function reimportarExportavel(c: Cofre, senha: string) {
  const kek = await chaveDaSenha(senha, deB64(c.sal));
  const bruto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(c.iv) as BufferSource }, kek, deB64(c.chaveCifrada) as BufferSource);
  return crypto.subtle.importKey('raw', bruto, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

/** Identificação sem conexão: CPF e senha conferidos contra o cofre local; bloqueio após 5 tentativas (TR 1.2.49.7). */
export async function abrirCofreOffline(cpf: string, senha: string) {
  const c = await dadosDoCofre();
  if (!c || c.cpf !== cpf) throw new Error('Este aparelho ainda não foi preparado para este CPF. Conecte-se à internet para o primeiro acesso.');
  if (c.tentativas >= 5) throw new Error('Acesso off-line bloqueado após tentativas inválidas. Conecte-se à internet para entrar.');
  try {
    chaveDados = await abrirComSenha(c, senha);
    await gravarBruto('cofre', { ...c, tentativas: 0 });
    return c;
  } catch {
    await gravarBruto('cofre', { ...c, tentativas: c.tentativas + 1 });
    throw new Error(`CPF ou senha inválidos. Restam ${4 - c.tentativas} tentativa(s) no modo off-line.`);
  }
}

/** Recifra a chave dos dados após a troca de senha. */
export async function trocarSenhaCofre(senhaAtual: string, novaSenha: string) {
  const c = await dadosDoCofre();
  if (!c) return;
  const k = await reimportarExportavel(c, senhaAtual);
  await protegerChave(c.cpf, c.nome, novaSenha, new Uint8Array(await crypto.subtle.exportKey('raw', k)));
}

export async function gravar(chave: string, valor: unknown) {
  if (!chaveDados) throw new Error('Cofre fechado.');
  if (valor === undefined || valor === null) return operar('readwrite', (s) => s.delete(chave));
  const iv = aleatorio(12);
  const dados = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, chaveDados, new TextEncoder().encode(JSON.stringify(valor)));
  return gravarBruto(chave, { iv: b64(iv), dados: b64(dados) });
}

export async function ler<T>(chave: string): Promise<T | null> {
  if (!chaveDados) throw new Error('Cofre fechado.');
  const r = await lerBruto<{ iv: string; dados: string }>(chave);
  if (!r) return null;
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(r.iv) as BufferSource }, chaveDados, deB64(r.dados) as BufferSource);
  return JSON.parse(new TextDecoder().decode(claro)) as T;
}

export async function sha256(texto: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const novoUuid = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : ([1e7] as any + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: string) => (Number(c) ^ (aleatorio(1)[0] & (15 >> (Number(c) / 4)))).toString(16));
