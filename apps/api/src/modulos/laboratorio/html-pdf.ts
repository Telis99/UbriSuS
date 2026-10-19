// Conversão de HTML simples (gerado pelo editor de modelos) em conteúdo pdfmake: parágrafos,
// títulos, negrito, itálico, sublinhado, tachado, subscrito, sobrescrito, cores, tamanhos,
// alinhamento, tabulações, listas, tabelas e imagens (TR 1.2.47.32.3, 1.2.47.32.4, 1.2.47.32.13,
// 1.2.47.32.14, 1.2.47.33). Sem dependências externas.
import type { Content } from 'pdfmake/interfaces.js';

interface No {
  tag: string;
  attrs: Record<string, string>;
  filhos: (No | string)[];
}

const VAZIAS = new Set(['br', 'img', 'hr', 'meta', 'input', 'col']);
const ENTIDADES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", emsp: ' ', ensp: ' ', ordm: 'º', ordf: 'ª', deg: '°', micro: 'µ', plusmn: '±' };

export function decodificar(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** Analisador tolerante de HTML em árvore. */
export function analisarHtml(html: string): No {
  const raiz: No = { tag: 'raiz', attrs: {}, filhos: [] };
  const pilha: No[] = [raiz];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|[^<]+|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const t = m[0];
    if (t.startsWith('<!--')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      if (t.startsWith('</')) {
        const idx = pilha.map((n) => n.tag).lastIndexOf(tag);
        if (idx > 0) pilha.length = idx;
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of (m[2] ?? '').matchAll(/([^\s=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1].toLowerCase()] = decodificar(a[2] ?? a[3] ?? a[4] ?? '');
      const no: No = { tag, attrs, filhos: [] };
      pilha[pilha.length - 1].filhos.push(no);
      if (!VAZIAS.has(tag) && !t.endsWith('/>')) pilha.push(no);
    } else {
      pilha[pilha.length - 1].filhos.push(decodificar(t));
    }
  }
  return raiz;
}

function estilos(no: No): Record<string, any> {
  const s: Record<string, any> = {};
  const css = no.attrs.style ?? '';
  for (const d of css.split(';')) {
    const [k, ...v] = d.split(':');
    const chave = k?.trim().toLowerCase();
    const valor = v.join(':').trim();
    if (!chave || !valor) continue;
    if (chave === 'color') s.color = valor;
    if (chave === 'background-color') s.background = valor;
    if (chave === 'font-size') {
      const n = parseFloat(valor);
      if (n) s.fontSize = valor.endsWith('px') ? n * 0.75 : valor.endsWith('em') ? n * 9 : n;
    }
    if (chave === 'font-weight' && /bold|[6-9]00/.test(valor)) s.bold = true;
    if (chave === 'font-style' && valor === 'italic') s.italics = true;
    if (chave === 'text-align') s.alignment = valor === 'justify' ? 'justify' : valor;
    if (chave === 'text-decoration' || chave === 'text-decoration-line') {
      if (valor.includes('underline')) s.decoration = 'underline';
      if (valor.includes('line-through')) s.decoration = 'lineThrough';
    }
  }
  if (no.attrs.color) s.color = no.attrs.color;
  if (no.attrs.align) s.alignment = no.attrs.align;
  if (no.tag === 'font' && no.attrs.size) s.fontSize = [0, 7, 8, 9, 11, 14, 18, 24][Number(no.attrs.size)] ?? undefined;
  return s;
}

const BLOCOS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol', 'li', 'hr', 'blockquote', 'pre', 'section', 'header', 'footer']);
const TAM_TITULO: Record<string, number> = { h1: 16, h2: 14, h3: 12, h4: 11, h5: 10, h6: 9 };

type Inline = { text: string | Inline[]; [k: string]: any } | string;

function inlineDe(no: No | string, herdado: Record<string, any>): Inline[] {
  if (typeof no === 'string') {
    const txt = no.replace(/[\r\n]+/g, ' ').replace(/\t/g, '    ');
    return txt ? [{ text: txt, ...herdado }] : [];
  }
  const s = { ...herdado, ...estilos(no) };
  switch (no.tag) {
    case 'b':
    case 'strong':
      s.bold = true;
      break;
    case 'i':
    case 'em':
      s.italics = true;
      break;
    case 'u':
      s.decoration = 'underline';
      break;
    case 's':
    case 'strike':
    case 'del':
      s.decoration = 'lineThrough';
      break;
    case 'sub':
      s.sub = true;
      s.fontSize = (s.fontSize ?? 9) * 0.7;
      break;
    case 'sup':
      s.sup = true;
      s.fontSize = (s.fontSize ?? 9) * 0.7;
      break;
    case 'br':
      return [{ text: '\n', ...herdado }];
  }
  return no.filhos.flatMap((f) => inlineDe(f, s));
}

function imagem(no: No): Content | null {
  const src = no.attrs.src ?? '';
  if (!src.startsWith('data:image/')) return null;
  const largura = parseFloat(no.attrs.width ?? /width:\s*([\d.]+)px/.exec(no.attrs.style ?? '')?.[1] ?? '');
  return { image: src, ...(largura ? { width: largura * 0.75 } : { fit: [250, 200] }), margin: [0, 2, 0, 2] } as Content;
}

function blocos(nos: (No | string)[], herdado: Record<string, any>): Content[] {
  const out: Content[] = [];
  let linha: Inline[] = [];
  const fecharLinha = () => {
    const texto = linha.filter((x) => typeof x !== 'string');
    if (texto.some((x: any) => String(x.text).trim() || x.text === '\n')) out.push({ text: texto as any, preserveLeadingSpaces: true, alignment: herdado.alignment } as Content);
    linha = [];
  };
  for (const n of nos) {
    if (typeof n === 'string' || (!BLOCOS.has(n.tag) && n.tag !== 'img' && !temBloco(n))) {
      linha.push(...inlineDe(n, herdado));
      continue;
    }
    if (n.tag === 'img') {
      fecharLinha();
      const img = imagem(n);
      if (img) out.push(herdado.alignment ? ({ ...(img as any), alignment: herdado.alignment } as Content) : img);
      continue;
    }
    fecharLinha();
    out.push(...bloco(n, herdado));
  }
  fecharLinha();
  return out;
}

function temBloco(n: No): boolean {
  return n.filhos.some((f) => typeof f !== 'string' && (BLOCOS.has(f.tag) || f.tag === 'img' || temBloco(f)));
}

function bloco(n: No, herdado: Record<string, any>): Content[] {
  const s = { ...herdado, ...estilos(n) };
  if (TAM_TITULO[n.tag]) {
    s.fontSize = s.fontSize ?? TAM_TITULO[n.tag];
    s.bold = true;
  }
  switch (n.tag) {
    case 'hr':
      return [{ canvas: [{ type: 'line', x1: 0, y1: 2, x2: 515, y2: 2, lineWidth: 0.5, lineColor: '#999' }], margin: [0, 4, 0, 4] } as Content];
    case 'ul':
    case 'ol': {
      const itens = n.filhos.filter((f): f is No => typeof f !== 'string' && f.tag === 'li').map((li) => ({ stack: blocos(li.filhos, s) }) as Content);
      return [(n.tag === 'ul' ? { ul: itens, margin: [0, 2, 0, 2] } : { ol: itens, margin: [0, 2, 0, 2] }) as Content];
    }
    case 'table':
      return [tabela(n, s)];
    default: {
      const conteudo = blocos(n.filhos, s);
      const margem = ['p', 'h1', 'h2', 'h3', 'h4'].includes(n.tag) ? [0, 0, 0, 4] : [0, 0, 0, 0];
      if (!conteudo.length) return n.tag === 'p' ? [{ text: ' ' } as Content] : [];
      return [{ stack: conteudo, margin: margem } as Content];
    }
  }
}

function tabela(n: No, s: Record<string, any>): Content {
  const linhas: No[] = [];
  const coletar = (x: No) => {
    for (const f of x.filhos) {
      if (typeof f === 'string') continue;
      if (f.tag === 'tr') linhas.push(f);
      else if (['thead', 'tbody', 'tfoot'].includes(f.tag)) coletar(f);
    }
  };
  coletar(n);
  const corpo: any[][] = [];
  let colunas = 0;
  for (const tr of linhas) {
    const celulas: any[] = [];
    for (const td of tr.filhos) {
      if (typeof td === 'string' || !['td', 'th'].includes(td.tag)) continue;
      const est: Record<string, any> = { ...s, ...estilos(td), ...(td.tag === 'th' ? { bold: true } : {}) };
      const span = Number(td.attrs.colspan ?? 1);
      const cel: any = { stack: blocos(td.filhos, est), ...(span > 1 ? { colSpan: span } : {}) };
      if (est.background) cel.fillColor = est.background;
      celulas.push(cel);
      for (let i = 1; i < span; i++) celulas.push({});
    }
    colunas = Math.max(colunas, celulas.length);
    corpo.push(celulas);
  }
  if (!corpo.length) return { text: '' };
  for (const l of corpo) while (l.length < colunas) l.push({ text: '' });
  const borda = n.attrs.border && n.attrs.border !== '0';
  return { table: { widths: Array(colunas).fill('*'), body: corpo }, layout: borda ? undefined : 'noBorders', margin: [0, 2, 0, 4] } as Content;
}

/** Converte o HTML do modelo em conteúdo pdfmake. */
export function htmlParaPdf(html: string): Content[] {
  return blocos(analisarHtml(html).filhos, {});
}

/** Substitui os campos {{chave}} pelos valores (escapando HTML). */
export function preencherModelo(html: string, valores: Record<string, unknown>, html_seguro: Set<string> = new Set()) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, chave: string) => {
    const v = valores[chave];
    if (v === undefined || v === null) return '';
    return html_seguro.has(chave) ? String(v) : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}
