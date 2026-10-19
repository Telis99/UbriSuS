// Documentos do laboratório em PDF com código de validação: laudo (modelo HTML personalizável ou
// padrão), etiquetas de amostras e de materiais, comprovante de coleta, protocolo e controle interno,
// capa de faturamento, envelope e mapas de trabalho (sintético e personalizado).
import type pg from 'pg';
import bwipjs from 'bwip-js';
import type { Content } from 'pdfmake/interfaces.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { idadeTexto } from '../../compartilhado/validacao.js';
import { parametro } from '../cadastros/alertas.js';
import { classificar, formatar, numero } from './calculo.js';
import { htmlParaPdf, preencherModelo } from './html-pdf.js';
import { layoutDoExame, modeloDoExame, previsaoEntrega, referenciasDoPaciente, type VariavelCompleta } from './servico.js';

type Cliente = pg.PoolClient | pg.Pool;
const MM = 2.8346;
const fmtData = (d?: string | Date | null) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10).split('-').reverse().join('/') : '');
const fmtHora = (d?: string | Date | null) => (d ? new Date(d).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDataLocal = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEXO: Record<string, string> = { M: 'Masculino', F: 'Feminino' };
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const nomeOperador = (col: string) => `(select coalesce(o.nome, pe.nome) from seg.operador o join cad.pessoa pe on pe.id = o.pessoa_id where o.id = ${col})`;
const especialidade = (col: string) => `(select es.nome from cad.vinculo v join cad.especialidade es on es.id = v.especialidade_id where v.profissional_id = ${col} and v.ativo order by v.id limit 1)`;

/** Dados completos dos exames para laudo, mapas e modelos (TR 1.2.47.32.8.1 a 1.2.47.32.11.1). */
export async function dadosItens(c: Cliente, ids: number[]) {
  if (!ids.length) return [];
  return (
    await c.query(
      `select i.*, r.numero, r.paciente_id, r.data_agendada::text data_agendada, to_char(r.hora_agendada, 'HH24:MI') hora_agendada, r.criado_em req_criado_em, r.data_prevista_entrega::text previsao,
              r.solicitante_externo, r.dados_clinicos, r.origem, r.urgente, r.laboratorio_id req_laboratorio_id,
              us.nome unidade_solicitante, ps.nome profissional_solicitante, ps.conselho sol_conselho, ps.registro_conselho sol_registro,
              p.nome paciente, p.nome_social, p.sexo, p.data_nascimento::text nascimento, p.prontuario, p.cns, p.cpf,
              e.nome exame, e.sigla, e.codigo exame_codigo, e.metodo, e.secao_id, sc.nome secao, coalesce(sc.ordem, 99) secao_ordem, e.codigo_interfaceamento,
              pr.codigo proc_codigo, pr.nome proc_nome, m.nome material,
              l.nome laboratorio, l.responsavel_tecnico, l.tipo laboratorio_tipo, ul.nome unidade_laboratorio, ul.telefone unidade_telefone,
              pl.nome liberador, pl.conselho lib_conselho, pl.registro_conselho lib_registro, pl.uf_conselho lib_uf, pl.assinatura_grafica_id, ${especialidade('pl.id')} lib_especialidade,
              ${nomeOperador('i.digitado_por')} digitador, ${nomeOperador('i.liberado_operador_id')} operador_liberacao, ${nomeOperador('r.operador_id')} operador_cadastro,
              am.codigo_barras amostra_codigo, am.sequencia amostra_sequencia, am.coletada_em, rc.nome recipiente, rc.cor_nome recipiente_cor, pc.nome profissional_coleta, ${especialidade('pc.id')} coleta_especialidade,
              ${nomeOperador('am.operador_id')} operador_coleta
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join cad.pessoa p on p.id = r.paciente_id
         join lab.exame e on e.id = i.exame_id join cad.procedimento pr on pr.id = e.procedimento_id
         left join lab.secao sc on sc.id = e.secao_id left join lab.material m on m.id = i.material_id
         left join lab.laboratorio l on l.id = coalesce(i.laboratorio_id, r.laboratorio_id) left join cad.unidade ul on ul.id = l.unidade_id
         left join cad.unidade us on us.id = r.unidade_solicitante_id left join cad.profissional ps on ps.id = r.profissional_solicitante_id
         left join cad.profissional pl on pl.id = i.liberado_por
         left join lateral (select a.* from lab.amostra a where a.requisicao_id = r.id and a.situacao <> 'DESCARTADA' and a.itens @> jsonb_build_array(i.id) order by a.coletada_em limit 1) am on true
         left join lab.recipiente rc on rc.id = am.recipiente_id left join cad.profissional pc on pc.id = am.profissional_coleta_id
        where i.id = any($1) order by r.id, coalesce(sc.ordem, 99), e.nome`,
      [ids],
    )
  ).rows;
}

async function imagemArquivo(c: Cliente, id: string | null) {
  if (!id) return null;
  const a = (await c.query(`select tipo_mime, encode(conteudo, 'base64') b64 from sis.arquivo where id = $1`, [id])).rows[0];
  return a && a.tipo_mime.startsWith('image/') ? `data:${a.tipo_mime};base64,${a.b64}` : null;
}

/** Variáveis do laudo: o layout congelado na liberação prevalece sobre o cadastro atual (TR 1.2.47.43.55). */
async function variaveisDoItem(c: Cliente, d: any): Promise<VariavelCompleta[]> {
  if (d.layout?.variaveis) return d.layout.variaveis;
  return referenciasDoPaciente(await layoutDoExame(c, d.exame_id), d.sexo, d.nascimento);
}

function valorTexto(v: VariavelCompleta, valores: Record<string, any>) {
  const x = valores?.[v.codigo];
  if (x === null || x === undefined || x === '') return '';
  return v.tipo === 'NUMERICO' || v.tipo === 'CALCULO' ? formatar(numero(x), v.casas_decimais) : String(x);
}

function tabelaResultadosHtml(vars: VariavelCompleta[], valores: Record<string, any>, rotulos: Record<string, string> | null) {
  const linhas = vars.map((v) => {
    const rot = esc(rotulos?.[v.codigo] || v.rotulo);
    if (v.tipo === 'TITULO') return `<tr><td colspan="3"><b>${rot}</b></td></tr>`;
    const s = classificar(valores?.[v.codigo], v.tipo, v.referencia ?? null);
    const val = esc(valorTexto(v, valores));
    const alterado = s && s !== 'NORMAL';
    return `<tr><td>${'&nbsp;'.repeat((v.recuo ?? 0) * 4)}${v.negrito ? `<b>${rot}</b>` : rot}</td><td>${alterado ? `<b>${val}*</b>` : val} ${esc(v.unidade_medida ?? '')}</td><td>${esc(v.referencia_texto ?? '')}</td></tr>`;
  });
  return `<table><tr><th>Exame</th><th>Resultado</th><th>Valores de referência</th></tr>${linhas.join('')}</table>`;
}

/** Campos disponíveis nos modelos de laudo e de mapa de trabalho. */
export const CAMPOS_MODELO: [string, string][] = [
  ['exame.nome', 'Nome do exame'],
  ['exame.sigla', 'Sigla do exame'],
  ['exame.codigo', 'Código do exame'],
  ['exame.metodo', 'Método'],
  ['procedimento.codigo', 'Código do procedimento (SIGTAP)'],
  ['procedimento.nome', 'Nome do procedimento'],
  ['secao.nome', 'Seção'],
  ['amostra.codigo', 'Código de barras da amostra'],
  ['amostra.data_coleta', 'Data da coleta'],
  ['amostra.hora_coleta', 'Hora da coleta'],
  ['amostra.recipiente', 'Recipiente usado'],
  ['amostra.material', 'Material coletado'],
  ['amostra.profissional', 'Profissional responsável pela coleta'],
  ['amostra.especialidade', 'Especialidade do profissional da coleta'],
  ['amostra.operador', 'Operador que registrou a coleta'],
  ['resultado.data', 'Data do resultado'],
  ['resultado.hora', 'Hora do resultado'],
  ['resultado.data_liberacao', 'Data da liberação'],
  ['resultado.hora_liberacao', 'Hora da liberação'],
  ['resultado.profissional', 'Profissional que assinou'],
  ['resultado.conselho', 'Conselho/registro do profissional'],
  ['resultado.especialidade', 'Especialidade do profissional'],
  ['resultado.operador', 'Operador que registrou o resultado'],
  ['resultado.observacao', 'Observação do resultado'],
  ['agendamento.data', 'Data do agendamento'],
  ['agendamento.hora', 'Hora do agendamento'],
  ['paciente.nome', 'Nome do paciente'],
  ['paciente.codigo', 'Código do paciente'],
  ['paciente.idade', 'Idade'],
  ['paciente.sexo', 'Sexo'],
  ['paciente.nascimento', 'Data de nascimento'],
  ['paciente.prontuario', 'Prontuário'],
  ['paciente.cns', 'Cartão Nacional de Saúde'],
  ['requisicao.numero', 'Número da requisição'],
  ['requisicao.solicitante', 'Profissional solicitante'],
  ['requisicao.unidade', 'Unidade solicitante'],
  ['requisicao.data', 'Data do cadastro da requisição'],
  ['requisicao.previsao', 'Previsão de entrega'],
  ['tabela_resultados', 'Tabela com todos os resultados e referências'],
  ['assinatura', 'Assinatura gráfica do profissional'],
  ['unidade.nome', 'Unidade prestadora (laboratório)'],
  ['unidade.telefone', 'Telefone da unidade prestadora'],
  ['data_atual', 'Data atual'],
  ['data_extenso', 'Data atual por extenso'],
  ['dia', 'Dia atual'],
  ['mes', 'Mês atual'],
  ['mes_extenso', 'Mês atual por extenso'],
  ['ano', 'Ano atual'],
  ['var.CODIGO', 'Valor da variável (substitua CODIGO)'],
  ['ref.CODIGO', 'Valor de referência da variável'],
  ['unid.CODIGO', 'Unidade de medida da variável'],
  ['rotulo.CODIGO', 'Texto da linha da variável'],
];

function valoresModelo(d: any, vars: VariavelCompleta[], assinaturaImg: string | null) {
  const hoje = new Date();
  const v: Record<string, unknown> = {
    'exame.nome': d.exame,
    'exame.sigla': d.sigla,
    'exame.codigo': d.exame_codigo,
    'exame.metodo': d.metodo,
    'procedimento.codigo': d.proc_codigo,
    'procedimento.nome': d.proc_nome,
    'secao.nome': d.secao,
    'amostra.codigo': d.amostra_codigo,
    'amostra.data_coleta': fmtDataLocal(d.coletada_em),
    'amostra.hora_coleta': fmtHora(d.coletada_em),
    'amostra.recipiente': d.recipiente,
    'amostra.material': d.material,
    'amostra.profissional': d.profissional_coleta,
    'amostra.especialidade': d.coleta_especialidade,
    'amostra.operador': d.operador_coleta,
    'resultado.data': fmtDataLocal(d.digitado_em),
    'resultado.hora': fmtHora(d.digitado_em),
    'resultado.data_liberacao': fmtDataLocal(d.liberado_em),
    'resultado.hora_liberacao': fmtHora(d.liberado_em),
    'resultado.profissional': d.liberador ?? d.layout?.assinanteExterno,
    'resultado.conselho': d.lib_conselho ? `${d.lib_conselho} ${d.lib_registro ?? ''}/${d.lib_uf ?? ''}` : '',
    'resultado.especialidade': d.lib_especialidade,
    'resultado.operador': d.digitador,
    'resultado.observacao': d.observacao_resultado,
    'agendamento.data': fmtData(d.data_agendada),
    'agendamento.hora': d.hora_agendada,
    'paciente.nome': d.nome_social ? `${d.nome_social} (${d.paciente})` : d.paciente,
    'paciente.codigo': d.paciente_id,
    'paciente.idade': d.nascimento ? idadeTexto(d.nascimento) : '',
    'paciente.sexo': SEXO[d.sexo] ?? 'Ignorado',
    'paciente.nascimento': fmtData(d.nascimento),
    'paciente.prontuario': d.prontuario,
    'paciente.cns': d.cns,
    'requisicao.numero': d.numero,
    'requisicao.solicitante': d.profissional_solicitante ?? d.solicitante_externo,
    'requisicao.unidade': d.unidade_solicitante,
    'requisicao.data': fmtDataLocal(d.req_criado_em),
    'requisicao.previsao': fmtData(d.previsao),
    tabela_resultados: tabelaResultadosHtml(vars, d.valores ?? {}, d.rotulos),
    assinatura: assinaturaImg ? `<img src="${assinaturaImg}" width="160">` : '',
    'unidade.nome': d.unidade_laboratorio ?? d.laboratorio,
    'unidade.telefone': d.unidade_telefone,
    data_atual: hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    data_extenso: `${hoje.getDate()} de ${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}`,
    dia: String(hoje.getDate()).padStart(2, '0'),
    mes: String(hoje.getMonth() + 1).padStart(2, '0'),
    mes_extenso: MESES[hoje.getMonth()],
    ano: hoje.getFullYear(),
  };
  for (const x of vars) {
    v[`var.${x.codigo}`] = valorTexto(x, d.valores ?? {});
    v[`ref.${x.codigo}`] = x.referencia_texto ?? '';
    v[`unid.${x.codigo}`] = x.unidade_medida ?? '';
    v[`rotulo.${x.codigo}`] = d.rotulos?.[x.codigo] || x.rotulo;
  }
  return v;
}

function cabecalhoPaciente(d: any): Content {
  const celula = (rot: string, val: unknown): Content => ({ stack: [{ text: rot, fontSize: 6, color: '#666' }, { text: String(val ?? '-'), fontSize: 8, bold: true }] });
  return {
    table: {
      widths: ['*', 'auto', 'auto', 'auto', 'auto'],
      body: [
        [celula('Paciente', d.nome_social ? `${d.nome_social} (${d.paciente})` : d.paciente), celula('Nascimento / idade', `${fmtData(d.nascimento)} - ${d.nascimento ? idadeTexto(d.nascimento) : ''}`), celula('Sexo', SEXO[d.sexo] ?? '-'), celula('Prontuário', d.prontuario), celula('CNS', d.cns)],
        [celula('Solicitante', d.profissional_solicitante ? `${d.profissional_solicitante} ${d.sol_conselho ?? ''} ${d.sol_registro ?? ''}` : d.solicitante_externo), celula('Unidade solicitante', d.unidade_solicitante), celula('Requisição', d.numero), celula('Cadastro', fmtDataLocal(d.req_criado_em)), celula('Coleta', d.coletada_em ? `${fmtDataLocal(d.coletada_em)} ${fmtHora(d.coletada_em)}` : '-')],
      ],
    },
    layout: { hLineColor: () => '#bbb', vLineColor: () => '#bbb' },
    margin: [0, 0, 0, 8],
  } as Content;
}

function blocoPadrao(d: any, vars: VariavelCompleta[]): Content[] {
  const corpo: any[][] = [
    [
      { text: 'Exame', style: 'th' },
      { text: 'Resultado', style: 'th' },
      { text: 'Valores de referência', style: 'th' },
    ],
  ];
  for (const v of vars) {
    const rot = d.rotulos?.[v.codigo] || v.rotulo;
    const alin = v.alinhamento === 'CENTRO' ? 'center' : v.alinhamento === 'DIREITA' ? 'right' : 'left';
    if (v.tipo === 'TITULO') {
      corpo.push([{ text: rot, bold: true, colSpan: 3, alignment: alin, margin: [(v.recuo ?? 0) * 8, 2, 0, 0] }, {}, {}]);
      continue;
    }
    const val = valorTexto(v, d.valores ?? {});
    if (!val && !v.obrigatoria) continue;
    const s = classificar(d.valores?.[v.codigo], v.tipo, v.referencia ?? null);
    const alterado = !!s && s !== 'NORMAL';
    corpo.push([
      { text: rot, bold: v.negrito, alignment: alin, margin: [(v.recuo ?? 0) * 8, 0, 0, 0] },
      { text: `${val}${alterado ? ' *' : ''} ${v.unidade_medida ?? ''}`.trim(), bold: true, color: s?.startsWith('CRITICO') ? '#c00' : undefined },
      { text: v.referencia_texto ?? '', fontSize: 7 },
    ]);
  }
  return [
    { text: `${d.exame}${d.sigla ? ` (${d.sigla})` : ''}`, style: 'h2', margin: [0, 6, 0, 2] },
    { text: [`Material: ${d.material ?? '-'}`, d.metodo ? `   Método: ${d.metodo}` : '', `   Procedimento: ${d.proc_codigo} - ${d.proc_nome}`].join(''), fontSize: 7, color: '#444', margin: [0, 0, 0, 3] },
    { table: { headerRows: 1, widths: ['*', 'auto', 180], body: corpo }, layout: 'lightHorizontalLines' } as Content,
    ...(d.observacao_resultado ? [{ text: `Observação: ${d.observacao_resultado}`, fontSize: 8, margin: [0, 3, 0, 0] } as Content] : []),
    { text: `Digitado em ${fmtDataLocal(d.digitado_em)} ${fmtHora(d.digitado_em)} por ${d.digitador ?? '-'} · Liberado em ${fmtDataLocal(d.liberado_em)} ${fmtHora(d.liberado_em)}`, fontSize: 6, color: '#777', margin: [0, 2, 0, 0] },
  ];
}

/** Monta o conteúdo do laudo dos exames (somente liberados, salvo prévia). */
export async function conteudoLaudo(c: Cliente, itens: any[]) {
  const conteudo: Content[] = [];
  let orientacao: 'portrait' | 'landscape' = 'portrait';
  const assinantes = new Map<string, any>();
  let reqAtual: number | null = null;
  for (const d of itens) {
    if (reqAtual !== d.requisicao_id) {
      if (reqAtual !== null) conteudo.push({ text: '', pageBreak: 'after' });
      conteudo.push(cabecalhoPaciente(d));
      reqAtual = d.requisicao_id;
    }
    const vars = await variaveisDoItem(c, d);
    const modelo = d.layout?.modelo ?? (d.layout ? null : await modeloDoExame(c, d.exame_id, d.material_id));
    const assinatura = await imagemArquivo(c, d.assinatura_grafica_id);
    if (modelo?.orientacao === 'PAISAGEM') orientacao = 'landscape';
    if (modelo?.html) {
      const html = preencherModelo(modelo.html, valoresModelo(d, vars, assinatura), new Set(['tabela_resultados', 'assinatura']));
      conteudo.push({ stack: htmlParaPdf(html), margin: [0, 4, 0, 6] } as Content);
    } else conteudo.push(...blocoPadrao(d, vars));
    const chave = d.liberado_por ? `p${d.liberado_por}` : d.layout?.assinanteExterno ? `e${d.layout.assinanteExterno}` : '';
    if (chave && !modelo?.html?.includes('{{assinatura}}')) assinantes.set(chave, { ...d, assinatura });
  }
  // Assinatura gráfica dos profissionais que liberaram (TR 1.2.47.39).
  if (assinantes.size)
    conteudo.push({
      columns: [{ text: '', width: '*' }, ...[...assinantes.values()].map((a) => ({
        width: 220,
        stack: [
          ...(a.assinatura ? [{ image: a.assinatura, fit: [140, 50], alignment: 'center' }] : [{ text: ' ', margin: [0, 20, 0, 0] }]),
          { canvas: [{ type: 'line', x1: 10, y1: 0, x2: 210, y2: 0, lineWidth: 0.5 }] },
          { text: a.liberador ?? a.layout?.assinanteExterno, alignment: 'center', bold: true, fontSize: 8 },
          { text: a.lib_conselho ? `${a.lib_conselho} ${a.lib_registro ?? ''}/${a.lib_uf ?? ''}${a.lib_especialidade ? ` - ${a.lib_especialidade}` : ''}` : 'Laboratório de apoio', alignment: 'center', fontSize: 7 },
          { text: `Assinado eletronicamente em ${fmtDataLocal(a.liberado_em)} ${fmtHora(a.liberado_em)}`, alignment: 'center', fontSize: 6, color: '#666' },
        ],
      })), { text: '', width: '*' }],
      columnGap: 16,
      margin: [0, 18, 0, 0],
    } as Content);
  conteudo.push({ text: '* Resultado fora dos valores de referência.', fontSize: 6, color: '#666', margin: [0, 8, 0, 0] });
  return { conteudo, orientacao };
}

export async function emitirLaudo(c: Cliente, itemIds: number[], u: Usuario | undefined, titulo = 'Laudo de exames laboratoriais') {
  const itens = await dadosItens(c, itemIds);
  if (!itens.length) throw new ErroHttp(404, 'Nenhum exame para o laudo.');
  const { conteudo, orientacao } = await conteudoLaudo(c, itens);
  return emitirDocumento({ relatorio: 'lab:laudo', titulo, filtros: { itens: itemIds, emitido: Date.now() } }, conteudo, { orientacao, subtitulo: itens[0].unidade_laboratorio ?? itens[0].laboratorio ?? undefined }, u);
}

/** Visualização prévia do modelo/layout com dados fictícios (TR 1.2.47.7, 1.2.47.37). */
export async function previaLaudo(c: Cliente, d: { exameId: number; html?: string | null; orientacao?: string | null; sexo?: string; idade?: number }, u: Usuario) {
  const exame = (await c.query(`select e.*, pr.codigo proc_codigo, pr.nome proc_nome, s.nome secao, m.nome material from lab.exame e join cad.procedimento pr on pr.id = e.procedimento_id left join lab.secao s on s.id = e.secao_id left join lab.material m on m.id = e.material_id where e.id = $1`, [d.exameId])).rows[0];
  if (!exame) throw new ErroHttp(404, 'Exame não encontrado.');
  const nasc = new Date();
  nasc.setFullYear(nasc.getFullYear() - (d.idade ?? 40));
  const vars = referenciasDoPaciente(await layoutDoExame(c, d.exameId), d.sexo ?? 'F', nasc.toISOString().slice(0, 10));
  const valores: Record<string, any> = {};
  for (const v of vars) {
    if (v.tipo === 'NUMERICO' || v.tipo === 'CALCULO') {
      const min = numero(v.referencia?.minimo);
      const max = numero(v.referencia?.maximo);
      valores[v.codigo] = min !== null && max !== null ? (min + max) / 2 : (min ?? max ?? 1);
    } else if (v.tipo === 'LISTA') valores[v.codigo] = v.referencia?.valor_normal ?? v.opcoes?.split(';')[0]?.trim() ?? '';
    else if (v.tipo !== 'TITULO') valores[v.codigo] = v.valor_padrao ?? 'Texto do resultado';
  }
  const agora = new Date().toISOString();
  const ficticio = {
    requisicao_id: 0,
    exame_id: exame.id,
    exame: exame.nome,
    sigla: exame.sigla,
    exame_codigo: exame.codigo,
    metodo: exame.metodo,
    proc_codigo: exame.proc_codigo,
    proc_nome: exame.proc_nome,
    secao: exame.secao,
    material: exame.material,
    paciente: 'PACIENTE DE DEMONSTRAÇÃO',
    paciente_id: 0,
    sexo: d.sexo ?? 'F',
    nascimento: nasc.toISOString().slice(0, 10),
    prontuario: '000000',
    cns: '700000000000000',
    numero: 'L0000000000',
    profissional_solicitante: 'PROFISSIONAL SOLICITANTE',
    unidade_solicitante: 'UNIDADE DE SAÚDE',
    req_criado_em: agora,
    coletada_em: agora,
    digitado_em: agora,
    liberado_em: agora,
    amostra_codigo: '000000000001',
    recipiente: 'TUBO',
    profissional_coleta: 'PROFISSIONAL DA COLETA',
    digitador: u.nome,
    liberador: 'PROFISSIONAL RESPONSÁVEL',
    lib_conselho: 'CRBM',
    lib_registro: '00000',
    lib_uf: 'SP',
    unidade_laboratorio: 'LABORATÓRIO MUNICIPAL',
    valores,
    rotulos: {},
    layout: { variaveis: vars, modelo: d.html !== undefined ? (d.html ? { html: d.html, orientacao: d.orientacao } : null) : await modeloDoExame(c, exame.id, exame.material_id) },
  };
  const { conteudo, orientacao } = await conteudoLaudo(c, [ficticio]);
  return emitirDocumento({ relatorio: 'lab:previa-laudo', titulo: 'Visualização prévia do laudo', filtros: { exame: d.exameId, t: Date.now() } }, [{ text: 'VISUALIZAÇÃO PRÉVIA - DADOS FICTÍCIOS', color: '#c00', bold: true, alignment: 'center', margin: [0, 0, 0, 6] }, ...conteudo], { orientacao }, u);
}

// ---------------------------------------------------------------------------
// Etiquetas (TR 1.2.47.11, 1.2.47.12, 1.2.47.13, 1.2.47.43.32 a 1.2.47.43.37.1)
// ---------------------------------------------------------------------------
export interface LinhaEtiqueta {
  texto?: string;
  codigoBarras?: string;
  tamanho?: number;
  negrito?: boolean;
  alinhamento?: 'left' | 'center' | 'right';
  altura?: number;
}
export const LINHAS_PADRAO: LinhaEtiqueta[] = [
  { texto: '{paciente.nome}', tamanho: 7, negrito: true },
  { texto: 'Req. {requisicao.numero}  Am. {amostra.numero}  Pac. {paciente.codigo}', tamanho: 5.5 },
  { codigoBarras: 'amostra.codigo', altura: 7 },
  { texto: '{amostra.codigo}   {exames.siglas}', tamanho: 6, negrito: true, alinhamento: 'center' },
  { texto: '{amostra.material} - {amostra.recipiente} ({amostra.cor})', tamanho: 5 },
  { texto: '{coleta.data} {coleta.hora}  {secao.nome}  Vol. {amostra.volume} mL  E.M. {amostra.espaco_morto} mL', tamanho: 5 },
];
export const CAMPOS_ETIQUETA: [string, string][] = [
  ['paciente.nome', 'Nome do paciente'],
  ['paciente.codigo', 'Código do paciente'],
  ['paciente.prontuario', 'Prontuário'],
  ['paciente.nascimento', 'Nascimento'],
  ['requisicao.numero', 'Nº da requisição'],
  ['amostra.codigo', 'Código de barras da amostra'],
  ['amostra.numero', 'Número da amostra'],
  ['amostra.material', 'Material a examinar'],
  ['amostra.recipiente', 'Tubo / recipiente'],
  ['amostra.cor', 'Cor do tubo'],
  ['amostra.volume', 'Volume'],
  ['amostra.espaco_morto', 'Espaço morto'],
  ['exames.siglas', 'Siglas dos exames'],
  ['exames.codigo_interface', 'Código usado nos equipamentos interfaceados'],
  ['coleta.data', 'Data da coleta'],
  ['coleta.hora', 'Hora da coleta'],
  ['secao.nome', 'Setor de destino'],
  ['laboratorio.nome', 'Laboratório'],
];

export async function dadosEtiquetas(c: Cliente, filtro: { requisicaoIds?: number[]; amostraIds?: number[] }) {
  return (
    await c.query(
      `select a.*, r.numero, r.paciente_id, p.nome paciente, p.prontuario, p.data_nascimento::text nascimento, m.nome material, rc.nome recipiente, rc.cor_nome, rc.espaco_morto_ml,
              s.nome secao, l.nome laboratorio,
              (select string_agg(e.sigla, ' ' order by e.sigla) from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.id in (select jsonb_array_elements_text(a.itens)::bigint)) siglas,
              (select string_agg(coalesce(e.codigo_interfaceamento, e.sigla), ' ' order by e.sigla) from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.id in (select jsonb_array_elements_text(a.itens)::bigint) and e.usa_interfaceamento) interface
         from lab.amostra a join lab.requisicao r on r.id = a.requisicao_id join cad.pessoa p on p.id = r.paciente_id
         left join lab.material m on m.id = a.material_id left join lab.recipiente rc on rc.id = a.recipiente_id left join lab.secao s on s.id = a.secao_id
         left join lab.laboratorio l on l.id = r.laboratorio_id
        where a.situacao <> 'DESCARTADA' and (($1::bigint[] is not null and a.requisicao_id = any($1)) or ($2::bigint[] is not null and a.id = any($2)))
        order by r.id, a.sequencia`,
      [filtro.requisicaoIds ?? null, filtro.amostraIds ?? null],
    )
  ).rows;
}

export function camposEtiqueta(a: any): Record<string, string> {
  return {
    'paciente.nome': a.paciente,
    'paciente.codigo': String(a.paciente_id ?? ''),
    'paciente.prontuario': a.prontuario ?? '',
    'paciente.nascimento': fmtData(a.nascimento),
    'requisicao.numero': a.numero,
    'amostra.codigo': a.codigo_barras,
    'amostra.numero': String(a.sequencia ?? ''),
    'amostra.material': a.material ?? '',
    'amostra.recipiente': a.recipiente ?? '',
    'amostra.cor': a.cor_nome ?? '',
    'amostra.volume': a.volume_ml != null ? formatar(Number(a.volume_ml), 1) : '-',
    'amostra.espaco_morto': a.espaco_morto_ml != null ? formatar(Number(a.espaco_morto_ml), 1) : '-',
    'exames.siglas': a.siglas ?? '',
    'exames.codigo_interface': a.interface ?? '',
    'coleta.data': fmtDataLocal(a.coletada_em),
    'coleta.hora': fmtHora(a.coletada_em),
    'secao.nome': a.secao ?? '',
    'laboratorio.nome': a.laboratorio ?? '',
  };
}

const preencherLinha = (t: string, v: Record<string, string>) => t.replace(/\{([\w.]+)\}/g, (_m, k: string) => v[k] ?? '');

/** Código de barras sem texto embutido (o texto vai em linha própria para caber na etiqueta). */
async function barras(valor: string) {
  const png = await bwipjs.toBuffer({ bcid: 'code128', text: valor, scale: 3, height: 8, includetext: false });
  return 'data:image/png;base64,' + png.toString('base64');
}

async function etiqueta(linhas: LinhaEtiqueta[], valores: Record<string, string>, larguraPt: number): Promise<Content> {
  const stack: Content[] = [];
  for (const l of linhas) {
    if (l.codigoBarras) {
      const valor = valores[l.codigoBarras] ?? l.codigoBarras;
      if (valor) stack.push({ image: await barras(valor), width: larguraPt, height: (l.altura ?? 7) * MM, alignment: 'center', margin: [0, 0.5, 0, 0.5] } as Content);
    } else if (l.texto) {
      const tam = l.tamanho ?? 6;
      // Uma linha por item: o texto é truncado à largura da etiqueta.
      const max = Math.max(8, Math.floor(larguraPt / (tam * (l.negrito ? 0.58 : 0.52))));
      const t = preencherLinha(l.texto, valores).replace(/\s+/g, ' ').trim();
      stack.push({ text: t.length > max ? t.slice(0, max - 1) + '…' : t, fontSize: tam, bold: !!l.negrito, alignment: l.alinhamento ?? 'left', lineHeight: 0.95 } as Content);
    }
  }
  return { stack, unbreakable: true } as Content;
}

/** Gera o PDF das etiquetas: térmica (uma por página no tamanho configurado) ou folha A4. */
export async function emitirEtiquetas(modelo: { largura_mm: number; altura_mm: number; termica: boolean; linhas: LinhaEtiqueta[] | null }, conjuntos: Record<string, string>[], u: Usuario | undefined, relatorio = 'lab:etiquetas') {
  if (!conjuntos.length) throw new ErroHttp(404, 'Nenhuma etiqueta para imprimir.');
  const linhas = modelo.linhas?.length ? modelo.linhas : LINHAS_PADRAO;
  const w = Number(modelo.largura_mm) * MM;
  const h = Number(modelo.altura_mm) * MM;
  const margem = 1.5 * MM;
  if (modelo.termica) {
    const paginas: Content[] = [];
    for (let i = 0; i < conjuntos.length; i++) {
      const e = await etiqueta(linhas, conjuntos[i], w - 2 * margem);
      paginas.push(i < conjuntos.length - 1 ? ({ stack: [e], pageBreak: 'after' } as Content) : e);
    }
    return emitirDocumento({ relatorio, titulo: 'Etiquetas', filtros: { n: conjuntos.length, t: Date.now() } }, paginas, { tamanho: { width: w, height: h }, orientacao: w > h ? 'landscape' : 'portrait', margens: [margem, margem, margem, margem], semCabecalho: true, semRodape: true }, u);
  }
  const colunas = Math.max(1, Math.floor((595 - 40) / (w + 6)));
  const corpo: any[][] = [];
  for (let i = 0; i < conjuntos.length; i += colunas) {
    const linha: any[] = [];
    for (let j = 0; j < colunas; j++) linha.push(conjuntos[i + j] ? { stack: [await etiqueta(linhas, conjuntos[i + j], w - 8)], margin: [2, 2, 2, 2] } : { text: '' });
    corpo.push(linha);
  }
  return emitirDocumento({ relatorio, titulo: 'Etiquetas', filtros: { n: conjuntos.length, t: Date.now() } }, [{ table: { widths: Array(colunas).fill(w), heights: h, body: corpo }, layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' } } as Content], { semCabecalho: true, semRodape: true, margens: [20, 20, 20, 20] }, u);
}

export async function modeloEtiqueta(c: Cliente, id: number | null | undefined, tipo = 'AMOSTRA') {
  const m = id
    ? (await c.query(`select * from lab.modelo_etiqueta where id = $1`, [id])).rows[0]
    : (await c.query(`select * from lab.modelo_etiqueta where ativo and tipo = $1 order by padrao desc, id limit 1`, [tipo])).rows[0];
  return m ?? { largura_mm: 50, altura_mm: 25, termica: true, linhas: null };
}

// ---------------------------------------------------------------------------
// Comprovante de coleta, protocolo/controle interno, capa de faturamento e envelope
// ---------------------------------------------------------------------------
async function requisicaoCompleta(c: Cliente, id: number) {
  const r = (
    await c.query(
      `select r.*, p.nome paciente, p.data_nascimento::text nascimento, p.sexo, p.prontuario, p.cns, p.cpf, p.celular, us.nome unidade_solicitante, ps.nome profissional_solicitante,
              l.nome laboratorio, ul.nome unidade_laboratorio, ul.telefone, cv.nome convenio, ${nomeOperador('r.operador_id')} operador_cadastro,
              (select lg.nome || coalesce(', ' || p.numero, '') || coalesce(' - ' || b.nome, '') from cad.logradouro lg left join cad.bairro b on b.id = p.bairro_id where lg.id = p.logradouro_id) endereco
         from lab.requisicao r join cad.pessoa p on p.id = r.paciente_id left join cad.unidade us on us.id = r.unidade_solicitante_id
         left join cad.profissional ps on ps.id = r.profissional_solicitante_id left join lab.laboratorio l on l.id = r.laboratorio_id
         left join cad.unidade ul on ul.id = l.unidade_id left join cad.convenio cv on cv.id = r.convenio_id where r.id = $1`,
      [id],
    )
  ).rows[0];
  if (!r) throw new ErroHttp(404, 'Requisição não encontrada.');
  const itens = (
    await c.query(
      `select i.*, e.nome exame, e.sigla, e.prazo_entrega_dias, e.preparo_paciente, pr.codigo proc_codigo, pr.nome proc_nome, s.nome secao, m.nome material
         from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id join cad.procedimento pr on pr.id = e.procedimento_id
         left join lab.secao s on s.id = e.secao_id left join lab.material m on m.id = i.material_id where i.requisicao_id = $1 and i.situacao <> 'CANCELADO' order by e.nome`,
      [id],
    )
  ).rows;
  return { r, itens };
}

/** Comprovante de coleta em ½ ou ¼ de página com observações configuráveis (TR 1.2.47.43.27, 1.2.47.43.39, 1.2.47.43.40). */
export async function emitirComprovante(c: Cliente, id: number, u: Usuario) {
  const { r, itens } = await requisicaoCompleta(c, id);
  const cfg = await parametro<{ modelo: 'MEIA' | 'QUARTO'; tituloObservacoes: string; textoObservacoes: string; prazoSomenteColetaCompleta: boolean }>('lab.comprovante', {
    modelo: 'MEIA',
    tituloObservacoes: 'Orientações',
    textoObservacoes: 'Retire seu resultado com este comprovante e documento com foto.',
    prazoSomenteColetaCompleta: true,
  });
  const pendentes = itens.filter((i) => i.situacao === 'AGUARDANDO_COLETA').length;
  const mostrarPrazo = !cfg.prazoSomenteColetaCompleta || pendentes === 0;
  const quarto = cfg.modelo === 'QUARTO';
  const conteudo: Content[] = [
    { text: r.unidade_laboratorio ?? r.laboratorio ?? 'Laboratório', bold: true, fontSize: quarto ? 8 : 10 },
    { text: 'COMPROVANTE DE COLETA', bold: true, fontSize: quarto ? 9 : 12, margin: [0, 2, 0, 4] },
    { image: await codigoBarras(r.numero), width: quarto ? 120 : 170, margin: [0, 0, 0, 4] } as Content,
    { text: `Paciente: ${r.paciente}`, fontSize: quarto ? 7 : 9, bold: true },
    { text: `Nascimento: ${fmtData(r.nascimento)} · Prontuário: ${r.prontuario ?? '-'} · Requisição: ${r.numero}`, fontSize: quarto ? 6 : 8 },
    {
      table: {
        widths: ['*', 'auto'],
        body: [[{ text: 'Exame', style: 'th' }, { text: 'Situação', style: 'th' }], ...itens.map((i) => [{ text: `${i.sigla} - ${i.exame}`, fontSize: quarto ? 6 : 8 }, { text: i.situacao === 'AGUARDANDO_COLETA' ? 'Pendente' : 'Coletado', fontSize: quarto ? 6 : 8 }])],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 4],
    } as Content,
    mostrarPrazo
      ? { text: `Previsão de entrega do resultado: ${fmtData(r.data_prevista_entrega)}`, bold: true, fontSize: quarto ? 7 : 9 }
      : { text: `Há ${pendentes} exame(s) pendente(s) de coleta: o prazo será informado após a coleta completa.`, fontSize: quarto ? 6 : 8, italics: true },
    { text: cfg.tituloObservacoes, bold: true, fontSize: quarto ? 7 : 9, margin: [0, 6, 0, 1] },
    { text: cfg.textoObservacoes, fontSize: quarto ? 6 : 8 },
  ];
  const tamanho = quarto ? { width: 297.64, height: 419.53 } : ('A5' as const);
  return emitirDocumento({ relatorio: 'lab:comprovante', titulo: 'Comprovante de coleta', filtros: { requisicao: id, t: Date.now() } }, conteudo, { tamanho, semCabecalho: true, margens: quarto ? [16, 16, 16, 40] : [28, 28, 28, 50] }, u);
}

/** Etiqueta de protocolo e folha de controle interno da requisição (TR 1.2.47.14). */
export async function emitirProtocolo(c: Cliente, id: number, u: Usuario) {
  const { r, itens } = await requisicaoCompleta(c, id);
  const etapas = ['Coleta', 'Triagem', 'Análise', 'Digitação', 'Liberação', 'Entrega'];
  const conteudo: Content[] = [
    {
      table: {
        widths: ['*'],
        body: [
          [
            {
              stack: [
                { text: 'PROTOCOLO DE EXAMES', bold: true },
                { columns: [{ image: await codigoBarras(r.numero), width: 160 }, { stack: [{ text: r.paciente, bold: true }, { text: `Requisição ${r.numero} · cadastro ${fmtDataLocal(r.criado_em)}` }, { text: `Previsão de entrega: ${fmtData(r.data_prevista_entrega)}`, bold: true }] }] },
              ],
              margin: [4, 4, 4, 4],
            },
          ],
        ],
      },
    } as Content,
    { text: '- - - - - - - - - - - - - - - - - - - - - recorte aqui - - - - - - - - - - - - - - - - - - - - -', alignment: 'center', color: '#999', margin: [0, 8, 0, 8] },
    { text: 'CONTROLE INTERNO', style: 'h2' },
    { text: `Paciente: ${r.paciente} · Nasc.: ${fmtData(r.nascimento)} · Origem: ${r.unidade_solicitante ?? r.origem} · Solicitante: ${r.profissional_solicitante ?? r.solicitante_externo ?? '-'}`, fontSize: 8, margin: [0, 0, 0, 4] },
    {
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', ...etapas.map(() => 42)],
        body: [
          [{ text: 'Exame', style: 'th' }, { text: 'Seção', style: 'th' }, { text: 'Material', style: 'th' }, ...etapas.map((e) => ({ text: e, style: 'th', alignment: 'center' }))],
          ...itens.map((i) => [{ text: `${i.sigla} - ${i.exame}`, style: 'td' }, { text: i.secao ?? '', style: 'td' }, { text: i.material ?? '', style: 'td' }, ...etapas.map(() => ({ text: '☐  ____', style: 'td', alignment: 'center' }))]),
        ],
      },
    } as Content,
  ];
  return emitirDocumento({ relatorio: 'lab:protocolo', titulo: 'Protocolo e controle interno', filtros: { requisicao: id, t: Date.now() } }, conteudo, { orientacao: 'landscape' }, u);
}

/** Capa de faturamento individual ou em lote (TR 1.2.47.43.74, 1.2.47.43.74.1). */
export async function emitirCapaFaturamento(c: Cliente, ids: number[], u: Usuario) {
  const conteudo: Content[] = [];
  for (let k = 0; k < ids.length; k++) {
    const { r, itens } = await requisicaoCompleta(c, ids[k]);
    const total = itens.reduce((s, i) => s + Number(i.valor ?? 0), 0);
    conteudo.push(
      { columns: [{ stack: [{ text: `Requisição nº ${r.numero}`, style: 'h2' }, { text: `Cadastrada em ${fmtDataLocal(r.criado_em)} ${fmtHora(r.criado_em)} por ${r.operador_cadastro ?? '-'}`, fontSize: 8 }] }, { image: await codigoBarras(r.numero), width: 150 }] } as Content,
      {
        table: {
          widths: ['auto', '*', 'auto', '*'],
          body: [
            ['Paciente', { text: r.paciente, bold: true }, 'Nascimento', fmtData(r.nascimento)],
            ['CNS', r.cns ?? '-', 'CPF', r.cpf ?? '-'],
            ['Unidade de origem', r.unidade_solicitante ?? r.origem, 'Convênio', r.convenio ?? 'SUS'],
            ['Solicitante', r.profissional_solicitante ?? r.solicitante_externo ?? '-', 'Laboratório', r.laboratorio ?? '-'],
          ],
        },
        layout: 'lightHorizontalLines',
        fontSize: 8,
        margin: [0, 6, 0, 6],
      } as Content,
      {
        table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto'],
          body: [
            [{ text: 'Procedimento', style: 'th' }, { text: 'Exame', style: 'th' }, { text: 'Valor (R$)', style: 'th', alignment: 'right' }],
            ...itens.map((i) => [i.proc_codigo, `${i.sigla} - ${i.exame}`, { text: Number(i.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }), alignment: 'right' }]),
            [{ text: 'Total', bold: true, colSpan: 2 }, {}, { text: total.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), bold: true, alignment: 'right' }],
          ],
        },
        fontSize: 8,
      } as Content,
    );
    if (k < ids.length - 1) conteudo.push({ text: '', pageBreak: 'after' });
  }
  return emitirDocumento({ relatorio: 'lab:capa-faturamento', titulo: 'Capa de faturamento', filtros: { requisicoes: ids, t: Date.now() } }, conteudo, {}, u);
}

/** Envelope do laudo com dimensões e margens configuráveis, somente após a liberação (TR 1.2.47.43.67, 1.2.47.43.68). */
export async function emitirEnvelope(c: Cliente, id: number, u: Usuario) {
  const { r, itens } = await requisicaoCompleta(c, id);
  if (!itens.some((i) => i.situacao === 'LIBERADO')) throw new ErroHttp(422, 'O envelope só pode ser impresso após a liberação da assinatura.');
  const cfg = await parametro<{ larguraMm: number; alturaMm: number; margemTopoMm: number; margemEsquerdaMm: number }>('lab.envelope', { larguraMm: 229, alturaMm: 162, margemTopoMm: 60, margemEsquerdaMm: 100 });
  const conteudo: Content[] = [
    { text: r.paciente, bold: true, fontSize: 12 },
    { text: r.endereco ?? '', fontSize: 9 },
    { text: `Requisição ${r.numero} · Laudo de exames laboratoriais`, fontSize: 9, margin: [0, 4, 0, 0] },
    { text: r.unidade_laboratorio ?? r.laboratorio ?? '', fontSize: 8, color: '#555', margin: [0, 12, 0, 0] },
  ];
  return emitirDocumento({ relatorio: 'lab:envelope', titulo: 'Envelope', filtros: { requisicao: id, t: Date.now() } }, conteudo, {
    tamanho: { width: cfg.larguraMm * MM, height: cfg.alturaMm * MM },
    orientacao: cfg.larguraMm > cfg.alturaMm ? 'landscape' : 'portrait',
    margens: [cfg.margemEsquerdaMm * MM, cfg.margemTopoMm * MM, 20, 20],
    semCabecalho: true,
    semRodape: true,
  }, u);
}

// ---------------------------------------------------------------------------
// Mapas de trabalho (TR 1.2.47.30 a 1.2.47.32.5, 1.2.47.43.30, 1.2.47.43.31)
// ---------------------------------------------------------------------------
export interface FiltroMapa {
  secaoId?: number | null;
  exameId?: number | null;
  laboratorioId?: number | null;
  requisicaoIds?: number[] | null;
  de?: string | null;
  ate?: string | null;
}

export async function itensDoMapa(c: Cliente, f: FiltroMapa) {
  return (
    await c.query(
      `select i.id from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id
        where i.situacao in ('COLETADO','EM_ANALISE','DIGITADO_PARCIAL')
          and ($1::bigint is null or e.secao_id = $1) and ($2::bigint is null or i.exame_id = $2)
          and ($3::bigint is null or coalesce(i.laboratorio_id, r.laboratorio_id) = $3) and ($4::bigint[] is null or r.id = any($4))
          and ($5::date is null or exists (select 1 from lab.amostra a where a.requisicao_id = r.id and a.coletada_em::date >= $5))
          and ($6::date is null or exists (select 1 from lab.amostra a where a.requisicao_id = r.id and a.coletada_em::date <= $6))
        order by r.urgente desc, r.id, i.id`,
      [f.secaoId ?? null, f.exameId ?? null, f.laboratorioId ?? null, f.requisicaoIds?.length ? f.requisicaoIds : null, f.de ?? null, f.ate ?? null],
    )
  ).rows.map((x) => Number(x.id));
}

/** Mapa sintético em colunas, paciente e exames em sequência para economia de papel. */
export async function emitirMapaSintetico(c: Cliente, f: FiltroMapa, u: Usuario) {
  const ids = await itensDoMapa(c, f);
  if (!ids.length) throw new ErroHttp(404, 'Nenhum exame coletado aguardando resultado para os filtros informados.');
  const dados = await dadosItens(c, ids);
  const layouts = new Map<number, VariavelCompleta[]>();
  for (const d of dados) if (!layouts.has(d.exame_id)) layouts.set(d.exame_id, await layoutDoExame(c, d.exame_id));
  const porSecao = new Map<string, Map<number, any[]>>();
  for (const d of dados) {
    const s = porSecao.get(d.secao ?? 'Sem seção') ?? new Map();
    s.set(d.requisicao_id, [...(s.get(d.requisicao_id) ?? []), d]);
    porSecao.set(d.secao ?? 'Sem seção', s);
  }
  const conteudo: Content[] = [];
  for (const [secao, reqs] of porSecao) {
    const blocos: Content[] = [];
    for (const itens of reqs.values()) {
      const d = itens[0];
      blocos.push({
        stack: [
          { text: [{ text: `${d.numero}  `, bold: true }, { text: `${d.amostra_codigo ?? ''}  ` }, { text: d.paciente, bold: true }, ` (${d.nascimento ? idadeTexto(d.nascimento) : '-'}, ${d.sexo ?? '-'})${d.urgente ? '  URGENTE' : ''}`], fontSize: 7 },
          {
            text: itens
              .map((i) => `${i.sigla}: ${(layouts.get(i.exame_id) ?? []).filter((v) => !['TITULO', 'CALCULO'].includes(v.tipo)).map((v) => `${v.codigo} ______`).join('  ') || '__________'}`)
              .join('   |   '),
            fontSize: 6.5,
            margin: [6, 1, 0, 0],
          },
        ],
        margin: [0, 0, 0, 5],
        unbreakable: true,
      } as Content);
    }
    const meio = Math.ceil(blocos.length / 2);
    conteudo.push({ text: `Seção: ${secao}`, style: 'h2' }, { columns: [{ stack: blocos.slice(0, meio) }, { stack: blocos.slice(meio) }], columnGap: 14 } as Content);
  }
  return emitirDocumento({ relatorio: 'lab:mapa', titulo: 'Mapa de trabalho', filtros: { ...f, t: Date.now() } }, conteudo, { orientacao: 'landscape', subtitulo: `${ids.length} exame(s)` }, u);
}

/** Mapa de trabalho personalizado (HTML com dados da unidade, do paciente e do atendimento). */
export async function mapaPersonalizado(c: Cliente, modeloId: number, f: FiltroMapa) {
  const m = (await c.query(`select * from lab.mapa_trabalho where id = $1`, [modeloId])).rows[0];
  if (!m) throw new ErroHttp(404, 'Mapa de trabalho não encontrado.');
  if (!m.ativo) throw new ErroHttp(422, 'Mapa de trabalho inativo.');
  const ids = await itensDoMapa(c, { ...f, exameId: f.exameId ?? m.exame_id, secaoId: f.secaoId ?? m.secao_id });
  const dados = await dadosItens(c, ids);
  const partes: string[] = [];
  for (const d of dados) {
    const vars = await variaveisDoItem(c, d);
    partes.push(preencherModelo(m.html ?? '', { ...valoresModelo(d, vars, null), 'atendimento.solicitante': d.profissional_solicitante ?? d.solicitante_externo, 'atendimento.unidade': d.unidade_solicitante, 'atendimento.dados_clinicos': d.dados_clinicos }, new Set(['tabela_resultados'])));
  }
  return { modelo: m, html: partes.join('<hr>'), quantidade: dados.length };
}

export async function emitirMapaPersonalizado(c: Cliente, modeloId: number, f: FiltroMapa, u: Usuario) {
  const r = await mapaPersonalizado(c, modeloId, f);
  if (!r.quantidade) throw new ErroHttp(404, 'Nenhum exame para o mapa de trabalho.');
  return emitirDocumento({ relatorio: 'lab:mapa-personalizado', titulo: r.modelo.nome, filtros: { modelo: modeloId, ...f, t: Date.now() } }, htmlParaPdf(r.html), { orientacao: r.modelo.orientacao === 'PAISAGEM' ? 'landscape' : 'portrait' }, u);
}

/** Etiquetas de identificação de materiais de estoque com código de barras, código e descrição (TR 1.2.47.40.6). */
export async function emitirEtiquetasMateriais(c: Cliente, produtoIds: number[], copias: number, u: Usuario) {
  const prods = (await c.query(`select id, nome || coalesce(' ' || concentracao, '') nome, codigos_barras from far.produto where id = any($1) order by nome`, [produtoIds])).rows;
  const conjuntos: Record<string, string>[] = [];
  for (const p of prods) {
    const codigo = String(p.codigos_barras ?? '').split(',')[0].trim() || String(p.id).padStart(8, '0');
    for (let i = 0; i < Math.max(1, copias); i++) conjuntos.push({ 'material.codigo': codigo, 'material.id': String(p.id), 'material.nome': p.nome });
  }
  const modelo = await modeloEtiqueta(c, null, 'MATERIAL');
  const linhas: LinhaEtiqueta[] = modelo.linhas?.length ? modelo.linhas : [{ texto: '{material.nome}', tamanho: 7, negrito: true }, { codigoBarras: 'material.codigo', altura: 10 }, { texto: 'Código interno: {material.id}', tamanho: 6 }];
  return emitirEtiquetas({ ...modelo, linhas }, conjuntos, u, 'lab:etiquetas-materiais');
}

export { previsaoEntrega };
