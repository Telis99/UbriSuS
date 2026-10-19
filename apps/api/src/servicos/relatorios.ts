// Emissão de relatórios: código único, cópia armazenada por no mínimo 1 ano,
// fila em segundo plano com notificação, bloqueio de emissões idênticas simultâneas
// e validação pública de autenticidade (TR 1.1.1.64.11 a 1.1.1.64.19).
import { createHash, randomBytes } from 'node:crypto';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { consultarUm, pool } from '../db/pool.js';
import { ErroHttp, type Usuario } from '../seguranca/usuario.js';
import { salvarArquivo } from './arquivos.js';
import { exportarTabela, MIME, type Formato, type Tabela } from './exportar.js';
import { documentoPadrao, gerarPdf, obterIdentidade, type OpcoesDocumento } from './pdf.js';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function novoCodigo(): string {
  const b = randomBytes(10);
  let s = '';
  for (const x of b) s += ALFABETO[x % ALFABETO.length];
  const d = new Date();
  const data = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${data}-${s.slice(0, 5)}-${s.slice(5)}`;
}

export interface PedidoEmissao {
  relatorio: string;
  titulo: string;
  formato: Formato;
  filtros?: Record<string, unknown>;
  filtrosTexto?: string[];
  orientacao?: 'portrait' | 'landscape';
  /** Formato de impressão específico (gerador de relatórios). */
  formatoId?: number | null;
}

export interface ResultadoEmissao {
  id: string;
  codigo: string;
  arquivoId: string;
  nome: string;
  mime: string;
  conteudo: Buffer;
}

async function registrar(p: PedidoEmissao, u: Usuario | undefined) {
  const chave = createHash('sha256')
    .update(JSON.stringify([p.relatorio, p.formato, p.filtros ?? {}, u?.id ?? null]))
    .digest('hex');
  try {
    return await consultarUm<{ id: string; codigo: string }>(
      `insert into sis.relatorio_emitido (codigo, relatorio, titulo, filtros, formato, operador_id, chave_execucao)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, codigo`,
      [novoCodigo(), p.relatorio, p.titulo, JSON.stringify(p.filtros ?? {}), p.formato, u?.id ?? null, chave],
    );
  } catch (e: any) {
    if (e?.code === '23505')
      throw new ErroHttp(409, 'Este relatório já está em emissão com os mesmos parâmetros. Aguarde a conclusão para emitir novamente.');
    throw e;
  }
}

async function concluir(regId: string, codigo: string, p: PedidoEmissao, conteudo: Buffer, u?: Usuario): Promise<ResultadoEmissao> {
  const nome = `${p.relatorio.replace(/[^a-z0-9_-]/gi, '_')}_${codigo}.${p.formato}`;
  const arquivoId = await salvarArquivo(nome, MIME[p.formato], conteudo, u?.id);
  await pool.query(
    `update sis.relatorio_emitido set situacao = 'concluido', concluido_em = now(), arquivo_id = $2, chave_execucao = null where id = $1`,
    [regId, arquivoId],
  );
  return { id: regId, codigo, arquivoId, nome, mime: MIME[p.formato], conteudo };
}

async function falhar(regId: string, e: unknown) {
  await pool.query(`update sis.relatorio_emitido set situacao = 'erro', erro = $2, chave_execucao = null where id = $1`, [
    regId,
    (e as Error).message,
  ]);
}

/** Emite uma tabela de dados no formato pedido. */
export async function emitirTabela(p: PedidoEmissao, tabela: Tabela, u?: Usuario): Promise<ResultadoEmissao> {
  const reg = (await registrar(p, u))!;
  try {
    const ident = await obterIdentidade(p.relatorio, p.formatoId);
    const conteudo = await exportarTabela(tabela, p.formato, ident, {
      titulo: p.titulo,
      filtros: p.filtrosTexto,
      codigo: reg.codigo,
      operador: u?.nome,
      orientacao: p.orientacao,
    });
    return await concluir(reg.id, reg.codigo, p, conteudo, u);
  } catch (e) {
    await falhar(reg.id, e);
    throw e;
  }
}

/** Emite um documento PDF livre (receitas, atestados, comprovantes, laudos). */
export async function emitirDocumento(
  p: Omit<PedidoEmissao, 'formato'>,
  conteudo: Content[] | ((codigo: string) => Promise<Content[]> | Content[]),
  opcoes: Partial<OpcoesDocumento> = {},
  u?: Usuario,
  ajustar?: (doc: TDocumentDefinitions) => void,
): Promise<ResultadoEmissao> {
  const pedido: PedidoEmissao = { ...p, formato: 'pdf' };
  const reg = (await registrar(pedido, u))!;
  try {
    const ident = await obterIdentidade(p.relatorio, p.formatoId);
    const corpo = typeof conteudo === 'function' ? await conteudo(reg.codigo) : conteudo;
    const doc = documentoPadrao(ident, { titulo: p.titulo, filtros: p.filtrosTexto, codigo: reg.codigo, operador: u?.nome, ...opcoes }, corpo);
    ajustar?.(doc);
    return await concluir(reg.id, reg.codigo, pedido, await gerarPdf(doc), u);
  } catch (e) {
    await falhar(reg.id, e);
    throw e;
  }
}

/**
 * Executa a emissão em segundo plano: continua mesmo que o operador feche a aplicação
 * e o notifica ao concluir (TR 1.1.1.64.12, 1.1.1.64.14).
 */
export function emitirEmSegundoPlano(executar: () => Promise<ResultadoEmissao>, u: Usuario, titulo: string) {
  executar()
    .then((r) =>
      pool.query(`insert into sis.notificacao_operador (destinatario_id, titulo, mensagem, anexo_id) values ($1,$2,$3,$4)`, [
        u.id,
        'Relatório concluído',
        `O relatório "${titulo}" (código ${r.codigo}) está disponível.`,
        r.arquivoId,
      ]),
    )
    .catch((e) =>
      pool.query(`insert into sis.notificacao_operador (destinatario_id, titulo, mensagem) values ($1,$2,$3)`, [
        u.id,
        'Falha na emissão de relatório',
        `O relatório "${titulo}" não pôde ser emitido: ${(e as Error).message}`,
      ]),
    );
}
