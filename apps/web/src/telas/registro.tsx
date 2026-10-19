// Registro das telas do sistema e resolução de caminhos (usado pelas abas/janelas).
import type { ReactNode } from 'react';

export interface ParametrosTela {
  params: Record<string, string>;
  query: URLSearchParams;
  caminho: string;
}

export interface Tela {
  id: string;
  titulo: string;
  /** Caminho no menu, ex.: 'Atendimento/Recepção'. Vazio = não aparece no menu. */
  menu?: string;
  /** Padrão do caminho, ex.: '/t/agenda' ou '/t/atendimento/:id'. */
  padrao: string;
  permissao?: string;
  modulo?: string;
  palavras?: string[];
  ordem?: number;
  render: (p: ParametrosTela) => ReactNode;
}

const telas: Tela[] = [];
export function registrarTela(t: Tela) {
  if (!telas.some((x) => x.id === t.id)) telas.push(t);
}
export const listarTelas = () => telas;

function casar(padrao: string, caminho: string): Record<string, string> | null {
  const a = padrao.split('/').filter(Boolean);
  const b = caminho.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function resolverTela(chave: string): { tela: Tela; parametros: ParametrosTela } | null {
  const [caminho, busca = ''] = chave.split('?');
  for (const t of telas) {
    const params = casar(t.padrao, caminho);
    if (params) return { tela: t, parametros: { params, query: new URLSearchParams(busca), caminho } };
  }
  return null;
}
