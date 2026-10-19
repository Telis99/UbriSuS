// Geração de PDF com o padrão visual da Prefeitura: brasão, cabeçalho, rodapé com
// código único de emissão e QR Code de validação (TR 1.1.1.64, 1.1.2.1.14).
import { createRequire } from 'node:module';
import bwipjs from 'bwip-js';
import type { Content, ContextPageSize, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { config } from '../config.js';
import { consultarUm } from '../db/pool.js';

const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake');
const vfs: Record<string, string> = require('pdfmake/build/vfs_fonts.js');

const fonte = (n: string) => Buffer.from(vfs[n], 'base64');
const impressora = new PdfPrinter({
  Roboto: {
    normal: fonte('Roboto-Regular.ttf'),
    bold: fonte('Roboto-Medium.ttf'),
    italics: fonte('Roboto-Italic.ttf'),
    bolditalics: fonte('Roboto-MediumItalic.ttf'),
  },
});

export function gerarPdf(doc: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = impressora.createPdfKitDocument(doc);
    const partes: Buffer[] = [];
    pdf.on('data', (b: Buffer) => partes.push(b));
    pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.on('error', reject);
    pdf.end();
  });
}

export async function codigoBarras(texto: string, tipo: 'code128' | 'qrcode' = 'code128'): Promise<string> {
  const png = await bwipjs.toBuffer({ bcid: tipo, text: texto, scale: 2, height: tipo === 'code128' ? 10 : undefined, includetext: tipo === 'code128', textxalign: 'center' });
  return 'data:image/png;base64,' + png.toString('base64');
}

export interface Identidade {
  entidade: string;
  secretaria: string;
  brasao?: string;
  marcaDagua?: string;
  papelTimbrado?: string;
  rodape?: string;
}

/** Identidade visual configurada em Parâmetros (brasão, marca d'água, papel timbrado). */
export async function obterIdentidade(): Promise<Identidade> {
  const img = async (chave: string) => {
    const r = await consultarUm(
      `select a.tipo_mime, encode(a.conteudo, 'base64') as b64 from sis.parametro p
         join sis.arquivo a on a.id = (p.valor #>> '{}')::uuid where p.chave = $1`,
      [chave],
    );
    return r ? `data:${r.tipo_mime};base64,${r.b64}` : undefined;
  };
  const texto = async (chave: string, padrao: string) =>
    (await consultarUm(`select valor #>> '{}' as v from sis.parametro where chave = $1`, [chave]))?.v ?? padrao;
  return {
    entidade: await texto('entidade.nome', config.nomeEntidade),
    secretaria: await texto('entidade.secretaria', config.nomeSecretaria),
    brasao: await img('entidade.brasao'),
    marcaDagua: await img('relatorio.marca_dagua'),
    papelTimbrado: await img('relatorio.papel_timbrado'),
    rodape: await texto('relatorio.rodape', ''),
  };
}

export interface OpcoesDocumento {
  titulo: string;
  subtitulo?: string;
  filtros?: string[];
  codigo?: string;
  operador?: string;
  emitidoEm?: Date;
  orientacao?: 'portrait' | 'landscape';
  tamanho?: 'A4' | 'A5' | { width: number; height: number };
  margens?: [number, number, number, number];
  semCabecalho?: boolean;
  semRodape?: boolean;
  usarPapelTimbrado?: boolean;
}

export function urlValidacao(codigo: string) {
  return `${config.urlPublica.replace(/\/$/, '')}/validar/${codigo}`;
}

export function documentoPadrao(id: Identidade, o: OpcoesDocumento, conteudo: Content[]): TDocumentDefinitions {
  const quando = (o.emitidoEm ?? new Date()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const cabecalho: Content = o.semCabecalho
    ? []
    : {
        margin: [36, 20, 36, 0],
        columns: [
          id.brasao ? { image: id.brasao, fit: [48, 48], width: 56 } : { text: '', width: 0 },
          {
            stack: [
              { text: id.entidade, style: 'entidade' },
              { text: id.secretaria, style: 'secretaria' },
              { text: o.titulo, style: 'tituloRel', margin: [0, 4, 0, 0] },
              ...(o.subtitulo ? [{ text: o.subtitulo, fontSize: 8 }] : []),
              ...(o.filtros?.length ? [{ text: 'Filtros: ' + o.filtros.join('; '), fontSize: 7, color: '#555' }] : []),
            ],
          },
        ],
      };
  return {
    pageSize: (o.tamanho ?? 'A4') as any,
    pageOrientation: o.orientacao ?? 'portrait',
    pageMargins: o.margens ?? [36, o.semCabecalho ? 30 : 100, 36, o.semRodape ? 30 : 56],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    info: { title: o.titulo, author: id.entidade, creator: 'UbriSUS' },
    header: () => cabecalho,
    background: (_pagina: number, tam: ContextPageSize) => {
      const camadas: Content[] = [];
      if (o.usarPapelTimbrado && id.papelTimbrado) camadas.push({ image: id.papelTimbrado, width: tam.width, absolutePosition: { x: 0, y: 0 } } as any);
      if (id.marcaDagua) {
        camadas.push({ image: id.marcaDagua, width: 260, opacity: 0.08, absolutePosition: { x: (tam.width - 260) / 2, y: tam.height / 2 - 130 } } as any);
      }
      return camadas;
    },
    footer: o.semRodape
      ? undefined
      : (pagina: number, total: number) => ({
          margin: [36, 6, 36, 0],
          columns: [
            o.codigo ? { qr: urlValidacao(o.codigo), fit: 44, width: 50 } : { text: '', width: 0 },
            {
              fontSize: 7,
              color: '#444',
              stack: [
                o.codigo ? { text: `Código de emissão: ${o.codigo}  ·  Valide em ${urlValidacao(o.codigo)}` } : '',
                { text: `Emitido por ${o.operador ?? '-'} em ${quando}` },
                ...(id.rodape ? [{ text: id.rodape }] : []),
              ],
            },
            { text: `Página ${pagina} de ${total}`, alignment: 'right', fontSize: 7, width: 70 },
          ],
        }),
    content: conteudo,
    styles: {
      entidade: { fontSize: 12, bold: true },
      secretaria: { fontSize: 9 },
      tituloRel: { fontSize: 11, bold: true },
      th: { bold: true, fillColor: '#e8eef5', fontSize: 8 },
      td: { fontSize: 8 },
      subtotal: { bold: true, fontSize: 8, fillColor: '#f4f4f4' },
      h2: { fontSize: 11, bold: true, margin: [0, 8, 0, 4] },
    },
  };
}
