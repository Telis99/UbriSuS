// Exportação de resultados de consultas e relatórios nos formatos exigidos
// (TR 1.1.1.62: .pdf, .docx, .doc, .xlsx, .xls, .csv, .xml, .html e .txt).
import ExcelJS from 'exceljs';
import { AlignmentType, Document, HeadingLevel, Packer, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { Content, TableCell as PdfCell } from 'pdfmake/interfaces.js';
import { documentoPadrao, gerarPdf, type Identidade, type OpcoesDocumento } from './pdf.js';
import { svgGrafico, type Grafico } from './grafico.js';

export const FORMATOS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'xml', 'html', 'txt'] as const;
export type Formato = (typeof FORMATOS)[number];

export const MIME: Record<Formato, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  xml: 'application/xml',
  html: 'text/html',
  txt: 'text/plain',
};

export interface Coluna {
  campo: string;
  titulo: string;
  formato?: 'texto' | 'inteiro' | 'decimal' | 'moeda' | 'data' | 'data_hora' | 'booleano' | 'percentual';
  total?: boolean;
  largura?: number | '*' | 'auto';
}

export interface Tabela {
  titulo: string;
  colunas: Coluna[];
  linhas: Record<string, any>[];
  /** Campos de quebra com subtotais a cada grupo e total geral (TR 1.1.2.1.21). */
  agrupar?: string[];
  zebrado?: boolean;
  totalizarRegistros?: boolean;
  /** Gráfico exibido acima da tabela no PDF e na tela. */
  grafico?: Grafico;
}

export function formatarValor(v: any, f?: Coluna['formato']): string {
  if (v === null || v === undefined || v === '') return '';
  switch (f) {
    case 'moeda':
      return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    case 'decimal':
      return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
    case 'percentual':
      return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
    case 'inteiro':
      return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    case 'data':
      return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10).split('-').reverse().join('/') : String(v);
    case 'data_hora':
      return new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    case 'booleano':
      return v ? 'Sim' : 'Não';
    default:
      if (Array.isArray(v)) return v.join(', ');
      if (v instanceof Date) return v.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      return String(v);
  }
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escXml = escHtml;

interface Segmento {
  tipo: 'linha' | 'subtotal' | 'cabecalho_grupo' | 'total';
  valores: Record<string, any>;
  rotulo?: string;
  nivel?: number;
}

/** Linhas com cabeçalhos de grupo, subtotais por quebra e total geral. */
export function segmentar(t: Tabela): Segmento[] {
  const somaveis = t.colunas.filter((c) => c.total);
  const soma = (linhas: Record<string, any>[]) =>
    Object.fromEntries(somaveis.map((c) => [c.campo, linhas.reduce((s, l) => s + (Number(l[c.campo]) || 0), 0)]));
  const out: Segmento[] = [];
  const grupos = t.agrupar ?? [];
  const recursivo = (linhas: Record<string, any>[], nivel: number) => {
    if (nivel >= grupos.length) {
      for (const l of linhas) out.push({ tipo: 'linha', valores: l });
      return;
    }
    const campo = grupos[nivel];
    const mapa = new Map<string, Record<string, any>[]>();
    for (const l of linhas) {
      const k = String(l[campo] ?? '(não informado)');
      mapa.set(k, [...(mapa.get(k) ?? []), l]);
    }
    for (const [k, ls] of mapa) {
      const col = t.colunas.find((c) => c.campo === campo);
      out.push({ tipo: 'cabecalho_grupo', valores: {}, rotulo: `${col?.titulo ?? campo}: ${k}`, nivel });
      recursivo(ls, nivel + 1);
      if (somaveis.length || t.totalizarRegistros !== false)
        out.push({ tipo: 'subtotal', valores: soma(ls), rotulo: `Subtotal ${k} (${ls.length} registro(s))`, nivel });
    }
  };
  recursivo(t.linhas, 0);
  out.push({ tipo: 'total', valores: soma(t.linhas), rotulo: `Total geral: ${t.linhas.length} registro(s)` });
  return out;
}

export async function exportarTabela(t: Tabela, formato: Formato, ident: Identidade, opcoes: OpcoesDocumento): Promise<Buffer> {
  const colunas = t.colunas.filter((c) => !t.agrupar?.includes(c.campo));
  const segs = segmentar(t);
  const celula = (s: Segmento, c: Coluna, i: number) =>
    s.tipo === 'linha' ? formatarValor(s.valores[c.campo], c.formato) : c.total ? formatarValor(s.valores[c.campo], c.formato) : i === 0 ? (s.rotulo ?? '') : '';

  switch (formato) {
    case 'csv':
    case 'txt': {
      const sep = formato === 'csv' ? ';' : '\t';
      const q = (v: string) => (formato === 'csv' && /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const linhas = [colunas.map((c) => q(c.titulo)).join(sep)];
      for (const s of segs) {
        if (s.tipo === 'cabecalho_grupo') linhas.push(q(s.rotulo!));
        else linhas.push(colunas.map((c, i) => q(celula(s, c, i))).join(sep));
      }
      return Buffer.from('﻿' + linhas.join('\r\n'), 'utf8');
    }
    case 'html':
    case 'doc': {
      const corpo = segs
        .map((s, idx) => {
          if (s.tipo === 'cabecalho_grupo') return `<tr class="g"><td colspan="${colunas.length}">${escHtml(s.rotulo!)}</td></tr>`;
          const cls = s.tipo === 'linha' ? (t.zebrado && idx % 2 ? ' class="z"' : '') : ' class="t"';
          return `<tr${cls}>${colunas.map((c, i) => `<td>${escHtml(celula(s, c, i))}</td>`).join('')}</tr>`;
        })
        .join('\n');
      const html = `<!doctype html><html${formato === 'doc' ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"' : ''} lang="pt-BR"><head><meta charset="utf-8"><title>${escHtml(t.titulo)}</title>
<style>body{font-family:Arial,sans-serif;font-size:10pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px}th{background:#e8eef5}tr.g td{background:#dde;font-weight:bold}tr.t td{font-weight:bold;background:#f4f4f4}tr.z td{background:#fafafa}</style></head>
<body><h3>${escHtml(ident.entidade)}<br><small>${escHtml(ident.secretaria)}</small></h3><h4>${escHtml(t.titulo)}</h4>
${opcoes.filtros?.length ? `<p><small>Filtros: ${escHtml(opcoes.filtros.join('; '))}</small></p>` : ''}
<table><thead><tr>${colunas.map((c) => `<th>${escHtml(c.titulo)}</th>`).join('')}</tr></thead><tbody>
${corpo}
</tbody></table>
<p><small>${opcoes.codigo ? `Código de emissão ${escHtml(opcoes.codigo)} · ` : ''}Emitido por ${escHtml(opcoes.operador ?? '-')} em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small></p>
</body></html>`;
      return Buffer.from(html, 'utf8');
    }
    case 'xml': {
      const tag = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
      const reg = t.linhas
        .map((l) => `  <registro>\n${t.colunas.map((c) => `    <${tag(c.campo)}>${escXml(formatarValor(l[c.campo], c.formato))}</${tag(c.campo)}>`).join('\n')}\n  </registro>`)
        .join('\n');
      return Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>\n<relatorio titulo="${escXml(t.titulo)}"${opcoes.codigo ? ` codigo="${escXml(opcoes.codigo)}"` : ''} emitido="${new Date().toISOString()}">\n${reg}\n</relatorio>\n`,
        'utf8',
      );
    }
    case 'xls': {
      // Planilha XML 2003 (SpreadsheetML), aberta nativamente pelo Excel como .xls.
      const linha = (vals: string[], estilo?: string) =>
        `<Row>${vals.map((v) => `<Cell${estilo ? ` ss:StyleID="${estilo}"` : ''}><Data ss:Type="String">${escXml(v)}</Data></Cell>`).join('')}</Row>`;
      const rows = [linha(colunas.map((c) => c.titulo), 'h')];
      for (const s of segs) {
        if (s.tipo === 'cabecalho_grupo') rows.push(linha([s.rotulo!], 'h'));
        else rows.push(linha(colunas.map((c, i) => celula(s, c, i)), s.tipo === 'linha' ? undefined : 'h'));
      }
      return Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>
<Worksheet ss:Name="Relatorio"><Table>${rows.join('')}</Table></Worksheet></Workbook>`,
        'utf8',
      );
    }
    case 'xlsx': {
      const wb = new ExcelJS.Workbook();
      wb.creator = ident.entidade;
      const ws = wb.addWorksheet(t.titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
      ws.addRow([ident.entidade]).font = { bold: true };
      ws.addRow([t.titulo]).font = { bold: true };
      if (opcoes.filtros?.length) ws.addRow(['Filtros: ' + opcoes.filtros.join('; ')]);
      ws.addRow([]);
      const cab = ws.addRow(colunas.map((c) => c.titulo));
      cab.font = { bold: true };
      cab.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }));
      for (const s of segs) {
        if (s.tipo === 'cabecalho_grupo') {
          ws.addRow([s.rotulo]).font = { bold: true };
          continue;
        }
        const valores = colunas.map((c, i) => {
          const v = s.tipo === 'linha' || c.total ? s.valores[c.campo] : i === 0 ? s.rotulo : null;
          if (v == null) return null;
          if (['inteiro', 'decimal', 'moeda', 'percentual'].includes(c.formato ?? '') && v !== '' && !isNaN(Number(v))) return Number(v);
          if (c.formato === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return new Date(String(v) + 'T12:00:00');
          return formatarValor(v, c.formato);
        });
        const r = ws.addRow(valores);
        if (s.tipo !== 'linha') r.font = { bold: true };
      }
      colunas.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = Math.min(60, Math.max(10, c.titulo.length + 2));
        if (c.formato === 'moeda') col.numFmt = '"R$" #,##0.00';
        if (c.formato === 'data') col.numFmt = 'dd/mm/yyyy';
      });
      return Buffer.from(await wb.xlsx.writeBuffer());
    }
    case 'docx': {
      const linhasTab = [
        new TableRow({
          tableHeader: true,
          children: colunas.map((c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.titulo, bold: true, size: 16 })] })] })),
        }),
        ...segs.map((s) =>
          s.tipo === 'cabecalho_grupo'
            ? new TableRow({
                children: [
                  new TableCell({
                    columnSpan: colunas.length,
                    children: [new Paragraph({ children: [new TextRun({ text: s.rotulo!, bold: true, size: 16 })] })],
                  }),
                ],
              })
            : new TableRow({
                children: colunas.map(
                  (c, i) =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: celula(s, c, i), bold: s.tipo !== 'linha', size: 16 })] })],
                    }),
                ),
              }),
        ),
      ];
      const doc = new Document({
        creator: ident.entidade,
        title: t.titulo,
        sections: [
          {
            properties: { page: { size: { orientation: opcoes.orientacao === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT } } },
            children: [
              new Paragraph({ text: ident.entidade, heading: HeadingLevel.HEADING_2 }),
              new Paragraph({ text: ident.secretaria }),
              new Paragraph({ text: t.titulo, heading: HeadingLevel.HEADING_3 }),
              ...(opcoes.filtros?.length ? [new Paragraph({ children: [new TextRun({ text: 'Filtros: ' + opcoes.filtros.join('; '), size: 16 })] })] : []),
              new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: linhasTab }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: `${opcoes.codigo ? `Código de emissão ${opcoes.codigo} · ` : ''}Emitido por ${opcoes.operador ?? '-'} em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                    size: 14,
                  }),
                ],
              }),
            ],
          },
        ],
      });
      return Buffer.from(await Packer.toBuffer(doc));
    }
    case 'pdf': {
      const corpo: PdfCell[][] = [colunas.map((c) => ({ text: c.titulo, style: 'th' }))];
      segs.forEach((s, idx) => {
        if (s.tipo === 'cabecalho_grupo') {
          corpo.push([{ text: s.rotulo!, colSpan: colunas.length, bold: true, fillColor: '#dde3ee' }, ...colunas.slice(1).map(() => ({}))]);
        } else {
          corpo.push(
            colunas.map((c, i) => ({
              text: celula(s, c, i),
              style: s.tipo === 'linha' ? 'td' : 'subtotal',
              alignment: ['inteiro', 'decimal', 'moeda', 'percentual'].includes(c.formato ?? '') ? 'right' : 'left',
              fillColor: s.tipo === 'linha' && t.zebrado && idx % 2 ? '#f6f6f6' : undefined,
            })),
          );
        }
      });
      const paisagem = (opcoes.orientacao ?? (colunas.length > 7 ? 'landscape' : 'portrait')) === 'landscape';
      const conteudo: Content[] = [
        ...(t.grafico && t.linhas.length ? [{ svg: svgGrafico(t.grafico, t.linhas), width: paisagem ? 760 : 515, margin: [0, 0, 0, 10] } as Content] : []),
        {
          table: { headerRows: 1, widths: colunas.map((c) => c.largura ?? '*'), body: corpo },
          layout: { hLineColor: '#cccccc', vLineColor: '#cccccc', hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
        },
      ];
      return gerarPdf(documentoPadrao(ident, { ...opcoes, titulo: t.titulo, orientacao: opcoes.orientacao ?? (colunas.length > 7 ? 'landscape' : 'portrait') }, conteudo));
    }
  }
}
