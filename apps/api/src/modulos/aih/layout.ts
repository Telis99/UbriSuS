// Gerador genérico de registros de largura fixa a partir de um layout documentado (nome, tamanho, tipo),
// usado nos arquivos SISAIH01, CIHA01, APAC, RAAS e HIPERDIA. Cada layout fica declarado como tabela
// de campos, o que documenta as posições e permite a leitura (importação) do mesmo arquivo.
import { alfa, num } from '../faturamento/bpa.js';

export type TipoCampoLayout = 'N' | 'A';
export type CampoLayout = [nome: string, tamanho: number, tipo: TipoCampoLayout, descricao?: string];

/** Monta uma linha de largura fixa; campos ausentes ficam em branco (A) ou zerados (N). */
export function montarLinha(layout: CampoLayout[], valores: Record<string, unknown>): string {
  return layout
    .map(([nome, tam, tipo]) => {
      const v = valores[nome];
      if (tipo === 'N') return v === undefined || v === null || v === '' ? '0'.repeat(tam) : num(v, tam);
      return alfa(v, tam);
    })
    .join('');
}

/** Lê uma linha de largura fixa conforme o layout. */
export function lerLinha(layout: CampoLayout[], linha: string): Record<string, string> {
  const r: Record<string, string> = {};
  let pos = 0;
  for (const [nome, tam] of layout) {
    r[nome] = linha.slice(pos, pos + tam).trim();
    pos += tam;
  }
  return r;
}

export const tamanhoLayout = (layout: CampoLayout[]) => layout.reduce((s, [, t]) => s + t, 0);

/** Tabela de posições (para documentação e conferência do layout). */
export function posicoes(layout: CampoLayout[]) {
  let inicio = 1;
  return layout.map(([nome, tamanho, tipo, descricao]) => {
    const r = { nome, tamanho, tipo, inicio, fim: inicio + tamanho - 1, descricao: descricao ?? '' };
    inicio += tamanho;
    return r;
  });
}

export const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
export const aaaammdd = (v: unknown) => (v ? String(v).slice(0, 10).replace(/-/g, '') : '');
