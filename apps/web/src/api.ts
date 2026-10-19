// Cliente HTTP da API: JSON, cabeçalho anti-CSRF e tratamento padronizado de erros.

export class ErroApi extends Error {
  constructor(
    public status: number,
    mensagem: string,
    public detalhes?: any,
  ) {
    super(mensagem);
  }
}

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let aoExpirarSessao: (() => void) | null = null;
export function definirAoExpirarSessao(fn: () => void) {
  aoExpirarSessao = fn;
}

let liberacaoSupervisor: string | null = null;
export const definirLiberacaoSupervisor = (t: string | null) => (liberacaoSupervisor = t);

async function requisitar<T>(metodo: Metodo, url: string, corpo?: unknown, opcoes: { bruto?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'ubrisus' };
  let body: BodyInit | undefined;
  if (corpo instanceof FormData) body = corpo;
  else if (corpo !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  if (liberacaoSupervisor) headers['x-liberacao-supervisor'] = liberacaoSupervisor;
  const r = await fetch(url, { method: metodo, headers, body, credentials: 'same-origin' });
  if (r.status === 401 && !url.startsWith('/api/auth/login')) aoExpirarSessao?.();
  if (!r.ok) {
    let dados: any = {};
    try {
      dados = await r.json();
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new ErroApi(r.status, dados.erro ?? `Erro ${r.status}`, dados.detalhes);
  }
  if (opcoes.bruto) return r as unknown as T;
  if (r.status === 204) return undefined as T;
  const tipo = r.headers.get('content-type') ?? '';
  return (tipo.includes('application/json') ? r.json() : r.text()) as Promise<T>;
}

export const api = {
  get: <T = any>(url: string, params?: Record<string, unknown>) => requisitar<T>('GET', url + qs(params)),
  post: <T = any>(url: string, corpo?: unknown) => requisitar<T>('POST', url, corpo ?? {}),
  put: <T = any>(url: string, corpo?: unknown) => requisitar<T>('PUT', url, corpo ?? {}),
  patch: <T = any>(url: string, corpo?: unknown) => requisitar<T>('PATCH', url, corpo ?? {}),
  delete: <T = any>(url: string) => requisitar<T>('DELETE', url),
  /** Requisição que retorna um arquivo (PDF, planilha...) e o baixa ou abre. */
  async arquivo(url: string, corpo?: unknown, acao: 'baixar' | 'abrir' = 'baixar', metodo: Metodo = 'POST') {
    const r = await requisitar<Response>(metodo, url, metodo === 'GET' ? undefined : (corpo ?? {}), { bruto: true });
    const blob = await r.blob();
    const nome = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'arquivo';
    const link = URL.createObjectURL(blob);
    if (acao === 'abrir') window.open(link, '_blank');
    else {
      const a = document.createElement('a');
      a.href = link;
      a.download = decodeURIComponent(nome);
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(link), 60_000);
    return { codigo: r.headers.get('x-codigo-relatorio'), nome };
  },
  async enviarArquivo(arquivo: File | Blob, nome?: string): Promise<{ id: string; nome: string; tipo: string; tamanho: number }> {
    const fd = new FormData();
    fd.append('arquivo', arquivo, nome ?? (arquivo as File).name ?? 'arquivo');
    return requisitar('POST', '/api/arquivos', fd);
  },
};

export function qs(params?: Record<string, unknown>) {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

export const urlArquivo = (id: string) => `/api/arquivos/${id}`;
