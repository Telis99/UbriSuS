// Carga inicial do laboratório (seções, materiais, recipientes, motivos, catálogo de exames com layout e
// valores de referência, modelos e parâmetros) e dados fictícios de demonstração do fluxo completo.
import { deflateSync } from 'node:zlib';
import type pg from 'pg';
import { registrarCarga, registrarCargaDemonstracao, type ContextoDemonstracao } from '../../db/carga/modulos.js';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { gerarHashSenha } from '../../seguranca/senha.js';
import type { Usuario } from '../../seguranca/usuario.js';
import { loteNaUnidade, movimentar } from '../farmacia/servico.js';
import { registrarResultadoControle } from './interface.js';
import { criarRequisicaoExterna, liberarItens, registrarColeta, registrarOcorrencia, registrarPresenca, salvarResultado } from './servico.js';

type C = pg.PoolClient;

/** Executa em sequência (um único cliente de banco não aceita consultas simultâneas). */
async function sequencial<T, R>(lista: T[], fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (const x of lista) out.push(await fn(x));
  return out;
}

// Parâmetros do laboratório (TR 1.2.47.15, 1.2.47.43.10, 1.2.47.43.11, 1.2.47.43.15, 1.2.47.43.18 a 1.2.47.43.22,
// 1.2.47.43.26 a 1.2.47.43.29, 1.2.47.43.40, 1.2.47.43.42, 1.2.47.43.45, 1.2.47.43.68).
registrarParametro('lab.destacar_upa', true, 'Destacar na recepção do laboratório os exames requisitados pela UPA', 'LAB');
registrarParametro('lab.confirmar_presenca', false, 'Exigir confirmação de presença do paciente na recepção antes da coleta', 'LAB');
registrarParametro('lab.coleta_com_presenca', false, 'Registrar automaticamente a coleta junto com a confirmação de presença', 'LAB');
registrarParametro('lab.exigir_materiais_coleta', false, 'Tornar obrigatório informar os materiais usados na coleta', 'LAB');
registrarParametro('lab.exigir_material_examinar', false, 'Obrigar a seleção do material a examinar quando não informado na requisição', 'LAB');
registrarParametro('lab.producao_coleta', { ativo: true, procedimentoCodigo: '0201020041', carater: '01', grupoAtendimento: 'ELETIVO' }, 'Registro automático de produção da coleta (procedimento faturado, caráter e grupo de atendimento padrão)', 'LAB');
registrarParametro('lab.producao_exame', true, 'Lançar a produção do exame (BPA) na liberação do resultado', 'LAB');
registrarParametro('lab.etiquetas_apos_coleta', 'PERGUNTAR', 'Etiquetas após a coleta: PERGUNTAR, AUTOMATICO ou NAO', 'LAB');
registrarParametro('lab.mapas_apos_coleta', false, 'Imprimir automaticamente os mapas de trabalho após o registro de coleta', 'LAB');
registrarParametro('lab.comprovante', { modelo: 'MEIA', tituloObservacoes: 'Orientações', textoObservacoes: 'Retire seu resultado com este comprovante e documento com foto.', prazoSomenteColetaCompleta: true }, 'Comprovante de coleta: modelo (MEIA/QUARTO de página), título e texto de observações, prazo somente com coleta completa', 'LAB');
registrarParametro('lab.envelope', { larguraMm: 229, alturaMm: 162, margemTopoMm: 60, margemEsquerdaMm: 100 }, 'Envelope do laudo: largura, altura e margens (mm)', 'LAB');
registrarParametro('lab.tamanho_maximo_pdf_mb', 5, 'Tamanho máximo (MB) do resultado digitalizado anexado em PDF', 'LAB');
registrarParametro('lab.interface_envio_automatico', true, 'Enviar automaticamente os pedidos aos equipamentos bidirecionais após a coleta', 'INT');
registrarParametro('lab.interface_assina', false, 'Considerar assinado o resultado recebido do equipamento (sem alertas de Delta-Check/valor crítico)', 'INT');
registrarParametro('lab.interface_profissional_id', null, 'Profissional liberador usado na assinatura automática do interfaceamento (id)', 'INT');

const PROCEDIMENTOS: [string, string, number, string][] = [
  ['0201020041', 'COLETA DE MATERIAL P/ EXAME LABORATORIAL', 0, 'A'],
  ['0202010120', 'DOSAGEM DE ACIDO URICO', 1.85, 'A'],
  ['0202010287', 'DOSAGEM DE COLESTEROL LDL', 3.51, 'A'],
  ['0202010503', 'DOSAGEM DE HEMOGLOBINA GLICOSILADA', 7.86, 'A'],
  ['0202010643', 'DOSAGEM DE TRANSAMINASE GLUTAMICO-OXALACETICA (TGO)', 2.01, 'A'],
  ['0202010651', 'DOSAGEM DE TRANSAMINASE GLUTAMICO-PIRUVICA (TGP)', 2.01, 'A'],
  ['0202030105', 'DOSAGEM DE ANTIGENO PROSTATICO ESPECIFICO (PSA)', 16.42, 'M'],
  ['0202031110', 'TESTE NAO TREPONEMICO P/ DETECCAO DE SIFILIS', 2.83, 'A'],
  ['0202040143', 'PESQUISA DE OVOS E CISTOS DE PARASITAS', 1.65, 'A'],
  ['0202060217', 'DOSAGEM DE GONADOTROFINA CORIONICA HUMANA (HCG, BETA HCG)', 7.85, 'F'],
  ['0202060250', 'DOSAGEM DE HORMONIO TIREOESTIMULANTE (TSH)', 8.96, 'A'],
];

const SECOES: [string, string, number][] = [
  ['HEMATOLOGIA', 'HEM', 1],
  ['BIOQUÍMICA', 'BIO', 2],
  ['IMUNOLOGIA E HORMÔNIOS', 'IMU', 3],
  ['URINÁLISE', 'URI', 4],
  ['PARASITOLOGIA', 'PAR', 5],
  ['SOROLOGIA', 'SOR', 6],
];
const MATERIAIS: [string, string][] = [
  ['SANGUE TOTAL', 'ST'],
  ['SORO', 'SO'],
  ['PLASMA', 'PL'],
  ['URINA', 'UR'],
  ['FEZES', 'FZ'],
];
// [nome, cor, nome da cor, volume, espaço morto]
const RECIPIENTES: [string, string, string, number, number][] = [
  ['TUBO EDTA K2 4 ML', '#7b2cbf', 'ROXA', 4, 0.5],
  ['TUBO SECO COM GEL 5 ML', '#f4c430', 'AMARELA', 5, 0.8],
  ['TUBO FLUORETO 4 ML', '#9e9e9e', 'CINZA', 4, 0.5],
  ['TUBO CITRATO 3,6 ML', '#1e88e5', 'AZUL', 3.6, 0.4],
  ['FRASCO COLETOR DE URINA 80 ML', '#fff59d', 'AMARELO CLARO', 80, 0],
  ['COLETOR UNIVERSAL DE FEZES', '#8d6e63', 'MARROM', 60, 0],
];
const MOTIVOS: [string, boolean, boolean][] = [
  ['AMOSTRA HEMOLISADA', true, true],
  ['AMOSTRA INSUFICIENTE', true, true],
  ['AMOSTRA COAGULADA', true, true],
  ['MATERIAL SEM IDENTIFICAÇÃO / IDENTIFICAÇÃO DIVERGENTE', true, true],
  ['JEJUM NÃO REALIZADO', false, true],
  ['EQUIPAMENTO EM MANUTENÇÃO (ATRASO NA LIBERAÇÃO)', false, true],
  ['RESULTADO CRÍTICO COMUNICADO', false, true],
];

interface Ref {
  s?: 'A' | 'M' | 'F';
  min?: number | null;
  max?: number | null;
  cmin?: number;
  cmax?: number;
  imin?: number;
  imax?: number;
  un?: 'DIAS' | 'MESES' | 'ANOS';
  normal?: string;
  texto?: string;
}
interface Var {
  c: string;
  r: string;
  t?: 'TITULO' | 'TEXTO' | 'TEXTO_LONGO' | 'NUMERICO' | 'LISTA' | 'CALCULO';
  u?: string;
  casas?: number;
  f?: string;
  op?: string;
  ob?: boolean;
  recuo?: number;
  delta?: number;
  refs?: Ref[];
  rotuloEditavel?: boolean;
}
interface ExameCarga {
  codigo: string;
  nome: string;
  sigla: string;
  sigtap: string;
  secao: string;
  material: string;
  recipiente: string | null;
  volume?: number;
  prazo: number;
  interface?: boolean;
  codInterface?: string;
  amostras?: number;
  sexo?: 'A' | 'M' | 'F';
  preparo?: string;
  instrucoes?: string;
  rotina?: string[];
  vars: Var[];
}

const NAO_REAGENTE = 'NÃO REAGENTE;REAGENTE';
const CRUZES = 'NEGATIVO;TRAÇOS;+;++;+++;++++';
const EXAMES: ExameCarga[] = [
  {
    codigo: 'HMG',
    nome: 'HEMOGRAMA COMPLETO',
    sigla: 'HMG',
    sigtap: '0202020380',
    secao: 'HEMATOLOGIA',
    material: 'SANGUE TOTAL',
    recipiente: 'TUBO EDTA K2 4 ML',
    volume: 4,
    prazo: 1,
    interface: true,
    codInterface: 'CBC',
    instrucoes: 'Homogeneizar suavemente o tubo por 8 inversões. Conservar em temperatura ambiente até 6 horas.',
    vars: [
      { c: 'T_ERI', r: 'ERITROGRAMA', t: 'TITULO' },
      { c: 'HEM', r: 'Hemácias', u: 'milhões/mm³', casas: 2, recuo: 1, refs: [{ s: 'M', min: 4.5, max: 5.9 }, { s: 'F', min: 4.0, max: 5.2 }, { s: 'A', imin: 0, imax: 11, min: 4.0, max: 5.2 }] },
      { c: 'HB', r: 'Hemoglobina', u: 'g/dL', casas: 1, recuo: 1, delta: 20, refs: [{ s: 'M', imin: 12, min: 13.5, max: 17.5, cmin: 7, cmax: 20 }, { s: 'F', imin: 12, min: 12.0, max: 16.0, cmin: 7, cmax: 20 }, { s: 'A', imin: 0, imax: 11, min: 11.5, max: 15.5, cmin: 7, cmax: 20 }] },
      { c: 'HT', r: 'Hematócrito', u: '%', casas: 1, recuo: 1, refs: [{ s: 'M', min: 41, max: 53 }, { s: 'F', min: 36, max: 46 }] },
      { c: 'VCM', r: 'VCM', t: 'CALCULO', f: 'HT / HEM * 10', u: 'fL', casas: 1, recuo: 1, refs: [{ min: 80, max: 100 }] },
      { c: 'HCM', r: 'HCM', t: 'CALCULO', f: 'HB / HEM * 10', u: 'pg', casas: 1, recuo: 1, refs: [{ min: 27, max: 33 }] },
      { c: 'CHCM', r: 'CHCM', t: 'CALCULO', f: 'HB / HT * 100', u: 'g/dL', casas: 1, recuo: 1, refs: [{ min: 32, max: 36 }] },
      { c: 'RDW', r: 'RDW', u: '%', casas: 1, recuo: 1, refs: [{ min: 11.5, max: 14.5 }] },
      { c: 'T_LEU', r: 'LEUCOGRAMA', t: 'TITULO' },
      { c: 'LEUC', r: 'Leucócitos', u: '/mm³', casas: 0, recuo: 1, delta: 50, refs: [{ min: 4000, max: 11000, cmin: 1000, cmax: 30000 }] },
      { c: 'NEUT', r: 'Neutrófilos', u: '%', casas: 0, recuo: 2, refs: [{ min: 40, max: 75 }] },
      { c: 'LINF', r: 'Linfócitos', u: '%', casas: 0, recuo: 2, refs: [{ min: 20, max: 45 }] },
      { c: 'MONO', r: 'Monócitos', u: '%', casas: 0, recuo: 2, refs: [{ min: 2, max: 10 }] },
      { c: 'EOS', r: 'Eosinófilos', u: '%', casas: 0, recuo: 2, refs: [{ min: 1, max: 6 }] },
      { c: 'BASO', r: 'Basófilos', u: '%', casas: 0, recuo: 2, refs: [{ min: 0, max: 1 }] },
      { c: 'NEUT_ABS', r: 'Neutrófilos (absoluto)', t: 'CALCULO', f: 'LEUC * NEUT / 100', u: '/mm³', casas: 0, recuo: 2, refs: [{ min: 1600, max: 8250, cmin: 500 }] },
      { c: 'T_PLA', r: 'PLAQUETOGRAMA', t: 'TITULO' },
      { c: 'PLAQ', r: 'Plaquetas', u: '/mm³', casas: 0, recuo: 1, delta: 50, refs: [{ min: 150000, max: 450000, cmin: 20000, cmax: 1000000 }] },
      { c: 'OBS', r: 'Observações da lâmina', t: 'TEXTO_LONGO', ob: false, rotuloEditavel: true },
    ],
  },
  { codigo: 'GLI', nome: 'GLICOSE', sigla: 'GLI', sigtap: '0202010473', secao: 'BIOQUÍMICA', material: 'PLASMA', recipiente: 'TUBO FLUORETO 4 ML', volume: 2, prazo: 1, interface: true, codInterface: 'GLU', preparo: 'Jejum de 8 horas.', vars: [{ c: 'GLI', r: 'Glicose', u: 'mg/dL', casas: 0, delta: 50, refs: [{ min: 70, max: 99, cmin: 40, cmax: 400, texto: '70 a 99 mg/dL (jejum)' }] }] },
  { codigo: 'CT', nome: 'COLESTEROL TOTAL', sigla: 'CT', sigtap: '0202010295', secao: 'BIOQUÍMICA', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 2, interface: true, codInterface: 'CHOL', vars: [{ c: 'CT', r: 'Colesterol total', u: 'mg/dL', casas: 0, refs: [{ max: 190, texto: 'Desejável: inferior a 190 mg/dL' }] }] },
  { codigo: 'HDL', nome: 'COLESTEROL HDL', sigla: 'HDL', sigtap: '0202010279', secao: 'BIOQUÍMICA', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 2, interface: true, codInterface: 'HDL', vars: [{ c: 'HDL', r: 'Colesterol HDL', u: 'mg/dL', casas: 0, refs: [{ min: 40, texto: 'Desejável: superior a 40 mg/dL' }] }] },
  { codigo: 'TG', nome: 'TRIGLICERÍDEOS', sigla: 'TG', sigtap: '0202010678', secao: 'BIOQUÍMICA', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 2, interface: true, codInterface: 'TG', preparo: 'Jejum de 12 horas e sem ingestão de álcool nas 72 horas anteriores.', vars: [{ c: 'TG', r: 'Triglicerídeos', u: 'mg/dL', casas: 0, refs: [{ max: 150, texto: 'Desejável: inferior a 150 mg/dL' }] }] },
  {
    codigo: 'LDL',
    nome: 'COLESTEROL LDL (FRIEDEWALD)',
    sigla: 'LDL',
    sigtap: '0202010287',
    secao: 'BIOQUÍMICA',
    material: 'SORO',
    recipiente: 'TUBO SECO COM GEL 5 ML',
    volume: 1,
    prazo: 2,
    vars: [
      { c: 'CT', r: 'Colesterol total', u: 'mg/dL', casas: 0 },
      { c: 'HDL', r: 'Colesterol HDL', u: 'mg/dL', casas: 0 },
      { c: 'TG', r: 'Triglicerídeos', u: 'mg/dL', casas: 0 },
      { c: 'VLDL', r: 'Colesterol VLDL', t: 'CALCULO', f: 'TG / 5', u: 'mg/dL', casas: 0 },
      { c: 'LDL', r: 'Colesterol LDL', t: 'CALCULO', f: 'CT - HDL - TG / 5', u: 'mg/dL', casas: 0, refs: [{ max: 130, texto: 'Desejável: inferior a 130 mg/dL' }] },
    ],
  },
  {
    codigo: 'CREA',
    nome: 'CREATININA',
    sigla: 'CREA',
    sigtap: '0202010317',
    secao: 'BIOQUÍMICA',
    material: 'SORO',
    recipiente: 'TUBO SECO COM GEL 5 ML',
    volume: 1,
    prazo: 2,
    interface: true,
    codInterface: 'CREA',
    vars: [
      { c: 'CREA', r: 'Creatinina', u: 'mg/dL', casas: 2, delta: 40, refs: [{ s: 'M', min: 0.7, max: 1.3, cmax: 6 }, { s: 'F', min: 0.6, max: 1.1, cmax: 6 }] },
      { c: 'TFG', r: 'Taxa de filtração glomerular estimada (CKD-EPI 2021)', t: 'CALCULO', u: 'mL/min/1,73m²', casas: 0, f: '142 * POT(MIN(CREA / SE(FEMININO; 0,7; 0,9); 1); SE(FEMININO; -0,241; -0,302)) * POT(MAX(CREA / SE(FEMININO; 0,7; 0,9); 1); -1,2) * POT(0,9938; IDADE) * SE(FEMININO; 1,012; 1)', refs: [{ min: 60, texto: 'Superior a 60 mL/min/1,73m²' }] },
    ],
  },
  { codigo: 'AU', nome: 'ÁCIDO ÚRICO', sigla: 'AU', sigtap: '0202010120', secao: 'BIOQUÍMICA', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 2, interface: true, codInterface: 'UA', vars: [{ c: 'AU', r: 'Ácido úrico', u: 'mg/dL', casas: 1, refs: [{ s: 'M', min: 3.4, max: 7.0 }, { s: 'F', min: 2.4, max: 5.7 }] }] },
  { codigo: 'TGO', nome: 'TRANSAMINASE OXALACÉTICA (TGO/AST)', sigla: 'TGO', sigtap: '0202010643', secao: 'BIOQUÍMICA', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 2, interface: true, codInterface: 'AST', vars: [{ c: 'TGO', r: 'TGO (AST)', u: 'U/L', casas: 0, refs: [{ s: 'M', max: 40, texto: 'Até 40 U/L' }, { s: 'F', max: 32, texto: 'Até 32 U/L' }] }] },
  { codigo: 'TGP', nome: 'TRANSAMINASE PIRÚVICA (TGP/ALT)', sigla: 'TGP', sigtap: '0202010651', secao: 'BIOQUÍMICA', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 2, interface: true, codInterface: 'ALT', vars: [{ c: 'TGP', r: 'TGP (ALT)', u: 'U/L', casas: 0, refs: [{ s: 'M', max: 41, texto: 'Até 41 U/L' }, { s: 'F', max: 33, texto: 'Até 33 U/L' }] }] },
  { codigo: 'HBA1C', nome: 'HEMOGLOBINA GLICADA', sigla: 'HBA1C', sigtap: '0202010503', secao: 'BIOQUÍMICA', material: 'SANGUE TOTAL', recipiente: 'TUBO EDTA K2 4 ML', volume: 1, prazo: 3, vars: [{ c: 'HBA1C', r: 'Hemoglobina glicada (HbA1c)', u: '%', casas: 1, refs: [{ max: 5.6, texto: 'Normal: inferior a 5,7% · pré-diabetes: 5,7 a 6,4% · diabetes: 6,5% ou mais' }] }] },
  { codigo: 'TSH', nome: 'HORMÔNIO TIREOESTIMULANTE (TSH)', sigla: 'TSH', sigtap: '0202060250', secao: 'IMUNOLOGIA E HORMÔNIOS', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 3, interface: true, codInterface: 'TSH', rotina: ['TER', 'QUI'], vars: [{ c: 'TSH', r: 'TSH', u: 'µUI/mL', casas: 2, refs: [{ min: 0.4, max: 4.0 }] }] },
  { codigo: 'BHCG', nome: 'BETA HCG (GONADOTROFINA CORIÔNICA)', sigla: 'BHCG', sigtap: '0202060217', secao: 'IMUNOLOGIA E HORMÔNIOS', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 1, sexo: 'F', vars: [{ c: 'BHCG', r: 'Beta HCG', t: 'LISTA', op: 'NEGATIVO;POSITIVO;INDETERMINADO', refs: [{ normal: 'NEGATIVO', texto: 'Negativo' }] }, { c: 'BHCG_Q', r: 'Beta HCG quantitativo', u: 'mUI/mL', casas: 1, ob: false }] },
  { codigo: 'PSA', nome: 'ANTÍGENO PROSTÁTICO ESPECÍFICO (PSA TOTAL)', sigla: 'PSA', sigtap: '0202030105', secao: 'IMUNOLOGIA E HORMÔNIOS', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 5, sexo: 'M', vars: [{ c: 'PSA', r: 'PSA total', u: 'ng/mL', casas: 2, refs: [{ s: 'M', max: 4.0, texto: 'Inferior a 4,0 ng/mL' }] }] },
  { codigo: 'VDRL', nome: 'VDRL (TESTE NÃO TREPONÊMICO PARA SÍFILIS)', sigla: 'VDRL', sigtap: '0202031110', secao: 'SOROLOGIA', material: 'SORO', recipiente: 'TUBO SECO COM GEL 5 ML', volume: 1, prazo: 2, vars: [{ c: 'VDRL', r: 'VDRL', t: 'LISTA', op: NAO_REAGENTE, refs: [{ normal: 'NÃO REAGENTE', texto: 'Não reagente' }] }, { c: 'TITULO', r: 'Titulação', t: 'TEXTO', ob: false }] },
  {
    codigo: 'EAS',
    nome: 'URINA TIPO I (EAS)',
    sigla: 'EAS',
    sigtap: '0202050017',
    secao: 'URINÁLISE',
    material: 'URINA',
    recipiente: 'FRASCO COLETOR DE URINA 80 ML',
    volume: 40,
    prazo: 1,
    preparo: 'Primeira urina da manhã, jato médio, após higiene íntima.',
    vars: [
      { c: 'T_FIS', r: 'EXAME FÍSICO', t: 'TITULO' },
      { c: 'COR', r: 'Cor', t: 'LISTA', op: 'AMARELO CLARO;AMARELO CITRINO;AMARELO ESCURO;ÂMBAR;AVERMELHADO', recuo: 1 },
      { c: 'ASP', r: 'Aspecto', t: 'LISTA', op: 'LÍMPIDO;LIGEIRAMENTE TURVO;TURVO', recuo: 1, refs: [{ normal: 'LÍMPIDO', texto: 'Límpido' }] },
      { c: 'DENS', r: 'Densidade', casas: 3, recuo: 1, refs: [{ min: 1.005, max: 1.03 }] },
      { c: 'PH', r: 'pH', casas: 1, recuo: 1, refs: [{ min: 5, max: 8 }] },
      { c: 'T_QUI', r: 'EXAME QUÍMICO', t: 'TITULO' },
      { c: 'PROT', r: 'Proteínas', t: 'LISTA', op: CRUZES, recuo: 1, refs: [{ normal: 'NEGATIVO', texto: 'Negativo' }] },
      { c: 'GLIC', r: 'Glicose', t: 'LISTA', op: CRUZES, recuo: 1, refs: [{ normal: 'NEGATIVO', texto: 'Negativo' }] },
      { c: 'HEMOG', r: 'Hemoglobina', t: 'LISTA', op: CRUZES, recuo: 1, refs: [{ normal: 'NEGATIVO', texto: 'Negativo' }] },
      { c: 'NITR', r: 'Nitrito', t: 'LISTA', op: 'NEGATIVO;POSITIVO', recuo: 1, refs: [{ normal: 'NEGATIVO', texto: 'Negativo' }] },
      { c: 'T_SED', r: 'SEDIMENTOSCOPIA', t: 'TITULO' },
      { c: 'LEU', r: 'Leucócitos', u: '/campo', casas: 0, recuo: 1, refs: [{ min: 0, max: 5, texto: 'Até 5 por campo' }] },
      { c: 'HEMA', r: 'Hemácias', u: '/campo', casas: 0, recuo: 1, refs: [{ min: 0, max: 3, texto: 'Até 3 por campo' }] },
      { c: 'BACT', r: 'Bactérias', t: 'LISTA', op: 'AUSENTES;RARAS;FREQUENTES;NUMEROSAS', recuo: 1, refs: [{ normal: 'AUSENTES', texto: 'Ausentes' }] },
      { c: 'OBS', r: 'Observações', t: 'TEXTO_LONGO', ob: false },
    ],
  },
  {
    codigo: 'EPF',
    nome: 'PARASITOLÓGICO DE FEZES (3 AMOSTRAS)',
    sigla: 'EPF',
    sigtap: '0202040143',
    secao: 'PARASITOLOGIA',
    material: 'FEZES',
    recipiente: 'COLETOR UNIVERSAL DE FEZES',
    volume: 20,
    prazo: 3,
    amostras: 3,
    instrucoes: 'Coletar 3 amostras em dias alternados, em conservante MIF.',
    vars: [
      { c: 'METODO', r: 'Método', t: 'TEXTO', ob: false },
      { c: 'RES', r: 'Resultado', t: 'TEXTO_LONGO', refs: [{ texto: 'Negativo' }] },
    ],
  },
];

const PREDEFINIDOS: [string | null, string | null, string][] = [
  ['EPF', 'RES', 'NÃO FORAM ENCONTRADOS OVOS OU CISTOS DE PARASITAS NAS AMOSTRAS ANALISADAS.'],
  ['EPF', 'RES', 'FORAM ENCONTRADOS CISTOS DE GIARDIA LAMBLIA.'],
  ['EPF', 'RES', 'FORAM ENCONTRADOS OVOS DE ASCARIS LUMBRICOIDES.'],
  ['EPF', 'METODO', 'HOFFMAN, PONS E JANER (SEDIMENTAÇÃO ESPONTÂNEA) E FAUST'],
  ['HMG', 'OBS', 'SÉRIE VERMELHA SEM ALTERAÇÕES MORFOLÓGICAS.'],
  ['HMG', 'OBS', 'PRESENÇA DE ANISOCITOSE E HIPOCROMIA.'],
  ['HMG', 'OBS', 'PLAQUETAS CONFIRMADAS EM LÂMINA.'],
  [null, null, 'RESULTADO CONFIRMADO EM NOVA DOSAGEM.'],
  [null, null, 'AMOSTRA LEVEMENTE HEMOLISADA; RESULTADO PODE ESTAR SUPERESTIMADO.'],
];

const MODELO_EAS = `<table border="0"><tr><td><b>{{unidade.nome}}</b></td><td style="text-align:right">Requisição <b>{{requisicao.numero}}</b></td></tr></table>
<h3 style="text-align:center">{{exame.nome}}</h3>
<p style="font-size:8px">Material: <b>{{amostra.material}}</b> · Coletado em {{amostra.data_coleta}} às {{amostra.hora_coleta}} ({{amostra.recipiente}}) por {{amostra.profissional}}</p>
{{tabela_resultados}}
<p><i>{{resultado.observacao}}</i></p>
<p style="font-size:7px;color:#555555">Método: tiras reagentes e microscopia óptica. Resultado liberado em {{resultado.data_liberacao}} às {{resultado.hora_liberacao}}. {{data_extenso}}.</p>`;

const MAPA_HEMATO = `<table border="1"><tr><th colspan="4" style="background-color:#e8eef5">MAPA DE BANCADA - {{secao.nome}} - {{data_atual}}</th></tr>
<tr><td>Requisição <b>{{requisicao.numero}}</b></td><td>Amostra {{amostra.codigo}}</td><td><b>{{paciente.nome}}</b></td><td>{{paciente.idade}} · {{paciente.sexo}}</td></tr>
<tr><td colspan="2">Exame: <b>{{exame.sigla}}</b> - {{exame.nome}}</td><td colspan="2">Solicitante: {{atendimento.solicitante}} ({{atendimento.unidade}})</td></tr>
<tr><td>HEM: ________</td><td>HB: ________</td><td>HT: ________</td><td>LEUC: ________</td></tr>
<tr><td>PLAQ: ________</td><td>RDW: ________</td><td colspan="2">Lâmina: _______________________</td></tr></table>`;

async function idPor(c: C, tabela: string, campo: string, valor: string) {
  return (await c.query(`select id from ${tabela} where ${campo} = $1 limit 1`, [valor])).rows[0]?.id as number | undefined;
}

registrarCarga('Tabelas do laboratório', async (c) => {
  for (const [codigo, nome, valor, sexo] of PROCEDIMENTOS)
    await c.query(
      `insert into cad.procedimento (codigo, nome, grupo, subgrupo, forma_organizacao, complexidade, sexo, instrumentos, valor_sa, ativo)
       select $1::varchar, $2::varchar, substr($1, 1, 2), substr($1, 1, 4), substr($1, 1, 6), '2', $4::varchar, '{01,02}', $3::numeric, true
        where not exists (select 1 from cad.procedimento where codigo = $1)`,
      [codigo, nome, valor, sexo],
    );
  if (!(await idPor(c, 'lab.laboratorio', 'tipo', 'PROPRIO')))
    await c.query(
      `insert into lab.laboratorio (nome, tipo, hora_abertura, hora_fechamento, hora_corte, dias_funcionamento, integracao, ativo)
       values ('LABORATÓRIO MUNICIPAL DE ANÁLISES CLÍNICAS', 'PROPRIO', '07:00', '17:00', '10:00', '{SEG,TER,QUA,QUI,SEX}', 'NENHUMA', true)`,
    );
  const labId = (await c.query(`select id from lab.laboratorio where tipo = 'PROPRIO' order by id limit 1`)).rows[0].id;
  for (const [nome, sigla, ordem] of SECOES)
    await c.query(`insert into lab.secao (nome, sigla, ordem, laboratorio_id, ativo) select $1::varchar, $2::varchar, $3::int, $4::bigint, true where not exists (select 1 from lab.secao where nome = $1)`, [nome, sigla, ordem, labId]);
  for (const [nome, sigla] of MATERIAIS) await c.query(`insert into lab.material (nome, sigla, ativo) select $1::varchar, $2::varchar, true where not exists (select 1 from lab.material where nome = $1)`, [nome, sigla]);
  for (const [nome, cor, corNome, vol, morto] of RECIPIENTES)
    await c.query(
      `insert into lab.recipiente (nome, cor, cor_nome, volume_ml, espaco_morto_ml, ativo) select $1::varchar, $2::varchar, $3::varchar, $4::numeric, $5::numeric, true where not exists (select 1 from lab.recipiente where nome = $1)`,
      [nome, cor, corNome, vol, morto],
    );
  for (const [nome, recoleta, notificar] of MOTIVOS)
    await c.query(
      `insert into lab.motivo_ocorrencia (nome, exige_recoleta, notificar_solicitante, ativo) select $1::varchar, $2::boolean, $3::boolean, true where not exists (select 1 from lab.motivo_ocorrencia where nome = $1)`,
      [nome, recoleta, notificar],
    );
  for (const e of EXAMES) {
    if (await idPor(c, 'lab.exame', 'codigo', e.codigo)) continue;
    const proc = await idPor(c, 'cad.procedimento', 'codigo', e.sigtap);
    if (!proc) continue;
    const exameId = (
      await c.query(
        `insert into lab.exame (codigo, nome, sigla, secao_id, laboratorio_id, material_id, procedimento_id, instrumento_registro, cbo_id, prazo_entrega_dias, prazo_liberacao_horas,
                                validade_resultado_dias, sexo, quantidade_amostras, permite_recoleta, permite_reagendamento, usa_interfaceamento, codigo_interfaceamento, casas_decimais,
                                preparo_paciente, instrucoes_coleta, dias_rotina, ativo)
         values ($1,$2,$3,(select id from lab.secao where nome = $4),$5,(select id from lab.material where nome = $6),$7,'BPA_I',(select id from cad.cbo where codigo = '221205'),$8,24,
                 180,$9,$10,true,true,$11,$12,2,$13,$14,$15,true) returning id`,
        [e.codigo, e.nome, e.sigla, e.secao, labId, e.material, proc, e.prazo, e.sexo ?? 'A', e.amostras ?? 1, !!e.interface, e.codInterface ?? null, e.preparo ?? null, e.instrucoes ?? null, e.rotina ?? null],
      )
    ).rows[0].id;
    if (e.recipiente)
      await c.query(
        `insert into lab.exame_recipiente (exame_id, recipiente_id, material_id, quantidade, volume_coleta_ml, compartilhavel) values ($1,(select id from lab.recipiente where nome = $2),(select id from lab.material where nome = $3),1,$4,true)`,
        [exameId, e.recipiente, e.material, e.volume ?? null],
      );
    let ordem = 1;
    for (const v of e.vars) {
      const varId = (
        await c.query(
          `insert into lab.exame_variavel (exame_id, ordem, codigo, rotulo, tipo, unidade_medida, casas_decimais, opcoes, formula, obrigatoria, permite_alterar_rotulo, permite_alterar_valor,
                                           alinhamento, recuo, negrito, delta_percentual, delta_dias)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,'ESQUERDA',$12,$13,$14,365) returning id`,
          [exameId, ordem++, v.c, v.r, v.t ?? 'NUMERICO', v.u ?? null, v.casas ?? null, v.op ?? null, v.f ?? null, v.t === 'TITULO' ? false : (v.ob ?? true), !!v.rotuloEditavel, v.recuo ?? 0, v.t === 'TITULO', v.delta ?? null],
        )
      ).rows[0].id;
      for (const r of v.refs ?? [])
        await c.query(
          `insert into lab.valor_referencia (variavel_id, sexo, idade_min, idade_max, unidade_idade, minimo, maximo, critico_min, critico_max, valor_normal, texto_referencia)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [varId, r.s ?? 'A', r.imin ?? null, r.imax ?? null, r.un ?? 'ANOS', r.min ?? null, r.max ?? null, r.cmin ?? null, r.cmax ?? null, r.normal ?? null, r.texto ?? null],
        );
    }
  }
  for (const [exame, variavel, texto] of PREDEFINIDOS)
    await c.query(
      `insert into lab.resultado_predefinido (exame_id, variavel_codigo, texto, ativo) select (select id from lab.exame where codigo = $1), $2::varchar, $3::text, true
        where not exists (select 1 from lab.resultado_predefinido where texto = $3)`,
      [exame, variavel, texto],
    );
  if (!(await idPor(c, 'lab.modelo_etiqueta', 'tipo', 'AMOSTRA')))
    await c.query(
      `insert into lab.modelo_etiqueta (nome, tipo, largura_mm, altura_mm, termica, linhas, padrao, ativo) values
       ('ETIQUETA DE TUBO 50 X 25 MM (TÉRMICA)', 'AMOSTRA', 50, 25, true, null, true, true),
       ('ETIQUETA EM FOLHA A4 (PIMACO 6180)', 'AMOSTRA', 66.7, 25.4, false, null, false, true),
       ('ETIQUETA DE MATERIAL 60 X 30 MM', 'MATERIAL', 60, 30, true, null, true, true)`,
    );
  if (!(await idPor(c, 'lab.modelo_laudo', 'nome', 'URINA TIPO I - MODELO HTML')))
    await c.query(`insert into lab.modelo_laudo (nome, exame_id, orientacao, html, versao, ativo) values ('URINA TIPO I - MODELO HTML', (select id from lab.exame where codigo = 'EAS'), 'RETRATO', $1, 1, true)`, [MODELO_EAS]);
  if (!(await idPor(c, 'lab.mapa_trabalho', 'nome', 'MAPA DE BANCADA - HEMATOLOGIA')))
    await c.query(`insert into lab.mapa_trabalho (nome, exame_id, secao_id, orientacao, html, ativo) values ('MAPA DE BANCADA - HEMATOLOGIA', (select id from lab.exame where codigo = 'HMG'), (select id from lab.secao where nome = 'HEMATOLOGIA'), 'RETRATO', $1, true)`, [MAPA_HEMATO]);
});

// ---------------------------------------------------------------------------
// Demonstração
// ---------------------------------------------------------------------------
/** Assinatura gráfica fictícia (PNG em tons de cinza gerado sem dependências). */
function pngAssinatura(): Buffer {
  const w = 320;
  const h = 90;
  const px = new Uint8Array(w * h).fill(255);
  const ponto = (x: number, y: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) px[(y + dy) * w + x + dx] = 25;
  };
  for (let t = 0; t < 2400; t++) {
    const x = Math.round(20 + (t / 2400) * 280);
    const y = Math.round(h / 2 + Math.sin(t / 38) * 22 * Math.sin(t / 400 + 1) + Math.cos(t / 11) * 6);
    ponto(x, y);
  }
  for (let x = 30; x < 290; x++) ponto(x, h - 14 + Math.round(Math.sin(x / 50) * 2));
  const linhas = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    linhas[y * (w + 1)] = 0;
    Buffer.from(px.subarray(y * w, (y + 1) * w)).copy(linhas, y * (w + 1) + 1);
  }
  const tabela = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = tabela[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloco = (tipo: string, dados: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(dados.length);
    const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
    const cr = Buffer.alloc(4);
    cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]);
}

const MATERIAIS_ESTOQUE: [string, string, string, number, number, string][] = [
  ['TUBO A VÁCUO EDTA K2 4 ML', 'UNIDADE', '7891234500011', 0.45, 2000, 'TUBO EDTA K2 4 ML'],
  ['TUBO A VÁCUO SECO COM GEL 5 ML', 'UNIDADE', '7891234500028', 0.62, 2000, 'TUBO SECO COM GEL 5 ML'],
  ['TUBO A VÁCUO FLUORETO 4 ML', 'UNIDADE', '7891234500035', 0.55, 1000, 'TUBO FLUORETO 4 ML'],
  ['FRASCO COLETOR DE URINA 80 ML', 'UNIDADE', '7891234500042', 0.3, 1000, 'FRASCO COLETOR DE URINA 80 ML'],
  ['COLETOR UNIVERSAL DE FEZES COM CONSERVANTE', 'UNIDADE', '7891234500059', 0.8, 600, 'COLETOR UNIVERSAL DE FEZES'],
  ['AGULHA PARA COLETA A VÁCUO 25 X 7', 'UNIDADE', '7891234500066', 0.18, 3000, ''],
  ['ALGODÃO HIDRÓFILO EM BOLAS', 'PACOTE', '7891234500073', 4.9, 50, ''],
  ['REAGENTE GLICOSE ENZIMÁTICA 500 ML', 'FRASCO', '7891234500080', 89.0, 10, ''],
];

export async function carregarDemonstracaoLaboratorio(c: C, ctx: ContextoDemonstracao) {
  if ((await c.query(`select 1 from seg.operador where login = 'laboratorio'`)).rowCount) return;
  const mun = (await c.query(`select municipio_id from cad.unidade where municipio_id is not null limit 1`)).rows[0]?.municipio_id ?? null;
  // Unidades do laboratório municipal e do laboratório de apoio.
  const unidade = async (nome: string, tipo: string, propria: boolean, cnes: string) =>
    (await idPor(c, 'cad.unidade', 'nome', nome)) ??
    ((
      await c.query(`insert into cad.unidade (cnes, nome, tipo_unidade, propria, prestadora, municipio_id, ativo) values ($1,$2,$3,$4,$5,$6,true) returning id`, [
        (await c.query(`select 1 from cad.unidade where cnes = $1`, [cnes])).rowCount ? null : cnes,
        nome,
        tipo,
        propria,
        !propria,
        mun,
      ])
    ).rows[0].id as number);
  const unLab = await unidade('LABORATÓRIO MUNICIPAL DE ANÁLISES CLÍNICAS', 'LABORATORIO', true, '9000001');
  const unApoio = await unidade('LABORATÓRIO DE APOIO DIAGNÓSTICO LTDA', 'PRESTADOR', false, '9000002');
  const lab = (await c.query(`select id from lab.laboratorio where tipo = 'PROPRIO' order by id limit 1`)).rows[0].id as number;
  await c.query(`update lab.laboratorio set unidade_id = $2, responsavel_tecnico = 'FERNANDA ALVES MOREIRA - CRBM 12345', telefone = '1145290000' where id = $1`, [lab, unLab]);
  const apoio = (
    await c.query(
      `insert into lab.laboratorio (nome, tipo, unidade_id, cnpj, responsavel_tecnico, hora_abertura, hora_fechamento, dias_funcionamento, integracao, ativo)
       values ('LABORATÓRIO DE APOIO DIAGNÓSTICO LTDA', 'APOIO', $1, '11222333000181', 'DR. HENRIQUE PASSOS - CRF 54321', '06:00', '22:00', '{SEG,TER,QUA,QUI,SEX,SAB}', 'WEBSERVICE', true) returning id`,
      [unApoio],
    )
  ).rows[0].id as number;
  await c.query(`update lab.exame set laboratorio_id = $1 where codigo = 'PSA'`, [apoio]);
  // Profissional biomédica liberadora com assinatura gráfica e operador "laboratorio".
  const pessoa = (
    await c.query(`insert into cad.pessoa (nome, sexo, data_nascimento, raca_cor, municipio_id, situacao, email) values ('FERNANDA ALVES MOREIRA','F','1985-08-19','01',$1,'ATIVO','laboratorio@saude.exemplo.gov.br') returning id`, [mun])
  ).rows[0].id;
  const png = pngAssinatura();
  const assinatura = (
    await c.query(`insert into sis.arquivo (nome, tipo_mime, tamanho, sha256, conteudo) values ('assinatura_biomedica.png','image/png',$1,md5($2::bytea::text),$2) returning id`, [png.length, png])
  ).rows[0].id;
  const prof = (
    await c.query(
      `insert into cad.profissional (pessoa_id, nome, conselho, registro_conselho, uf_conselho, liberador_laudo, solicitante_exames, assinatura_grafica_id, ativo) values ($1,'FERNANDA ALVES MOREIRA','CRBM','12345','SP',true,false,$2,true) returning id`,
      [pessoa, assinatura],
    )
  ).rows[0].id;
  await c.query(`insert into cad.vinculo (profissional_id, unidade_id, cbo_id, conselho, registro_conselho, uf_conselho, carga_horaria, ativo, data_inicio) values ($1,$2,(select id from cad.cbo where codigo = '221205'),'CRBM','12345','SP',40,true,'2024-01-01')`, [prof, unLab]);
  let perfil = (await c.query(`select id from seg.perfil where nome = 'Laboratório'`)).rows[0]?.id;
  if (!perfil)
    perfil = (
      await c.query(`insert into seg.perfil (nome, descricao, categoria, permissoes, ativo) values ('Laboratório','Laboratório de análises clínicas e interfaceamento','OPERACIONAL',$1,true) returning id`, [
        JSON.stringify(['LAB:*', 'INT:*', 'AGE:consultar', 'paciente:consultar', 'paciente:alterar', 'prontuario:consultar', 'produto:consultar', 'estoque_lote:consultar', 'entrada:*', 'inutilizacao:*', 'fornecedor:consultar']),
      ])
    ).rows[0].id;
  const op = (
    await c.query(
      `insert into seg.operador (pessoa_id, login, senha_hash, senha_alterada_em, profissional_id, termos_aceitos_em, unidade_padrao_id, ativo) values ($1,'laboratorio',$2,now(),$3,now(),$4,true) returning id`,
      [pessoa, await gerarHashSenha('Saude@2026'), prof, unLab],
    )
  ).rows[0].id;
  await c.query(`insert into seg.operador_perfil (operador_id, perfil_id) values ($1,$2)`, [op, perfil]);
  await c.query(`insert into seg.operador_unidade (operador_id, unidade_id) values ($1,$2)`, [op, unLab]);

  // Materiais de laboratório no estoque (TR 1.2.47.40, 1.2.47.41).
  let grupo = await idPor(c, 'far.grupo_produto', 'nome', 'MATERIAIS DE LABORATÓRIO');
  if (!grupo) grupo = (await c.query(`insert into far.grupo_produto (nome, ativo) values ('MATERIAIS DE LABORATÓRIO', true) returning id`)).rows[0].id;
  const fornecedor = (await c.query(`select id from far.fornecedor order by id limit 1`)).rows[0]?.id ?? null;
  const entrada = (
    await c.query(
      `insert into far.entrada (unidade_id, tipo, fornecedor_id, nota_numero, nota_serie, data_compra, data_entrada, valor_nota, situacao) values ($1,'FORNECEDOR',$2,'45871','1',current_date - 20,current_date - 18,null,'CONFIRMADA') returning id`,
      [unLab, fornecedor],
    )
  ).rows[0].id;
  const produtos = new Map<string, number>();
  let total = 0;
  for (const [nome, apres, barras, custo, qtd, recipiente] of MATERIAIS_ESTOQUE) {
    const p = (
      await c.query(
        `insert into far.produto (nome, tipo, grupo_id, preco_custo, codigos_barras, unidade_fornecimento, estoque_minimo, ativo) values ($1,'LABORATORIO',$2,$3,$4,$5,$6,true) returning id`,
        [nome, grupo, custo, barras, apres, Math.ceil(qtd * 0.2)],
      )
    ).rows[0].id;
    produtos.set(nome, p);
    await c.query(`insert into far.produto_unidade (produto_id, unidade_id, estoque_minimo, estoque_ideal, local, sala, estante, prateleira) values ($1,$2,$3,$4,'ALMOXARIFADO DO LABORATÓRIO','SALA 2','E1',$5)`, [
      p,
      unLab,
      Math.ceil(qtd * 0.2),
      qtd,
      String(1 + (produtos.size % 4)),
    ]);
    const lote = await loteNaUnidade(c, { unidadeId: unLab, produtoId: p, lote: `LT${barras.slice(-4)}`, validade: '2027-12-31', custo });
    const quantidade = nome.startsWith('REAGENTE') ? 3 : Math.ceil(qtd * 0.6);
    await movimentar(c, { unidadeId: unLab, produtoId: p, loteId: lote, tipo: 'ENTRADA', quantidade, documento: 'NF 45871', operadorId: op });
    await c.query(`insert into far.entrada_item (entrada_id, produto_id, lote, validade, quantidade, valor_unitario) values ($1,$2,$3,'2027-12-31',$4,$5)`, [entrada, p, `LT${barras.slice(-4)}`, quantidade, custo]);
    total += quantidade * custo;
    if (recipiente) await c.query(`update lab.recipiente set produto_id = $2 where nome = $1`, [recipiente, p]);
  }
  await c.query(`update far.entrada set valor_nota = $2 where id = $1`, [entrada, Math.round(total * 100) / 100]);
  await c.query(`insert into far.produto_similar (produto_id, similar_id) values ($1,$2),($2,$1)`, [produtos.get('TUBO A VÁCUO SECO COM GEL 5 ML'), produtos.get('TUBO A VÁCUO FLUORETO 4 ML')]);
  const motivoInut = (await c.query(`select id from far.motivo_inutilizacao order by id limit 1`)).rows[0]?.id;
  if (motivoInut) {
    const p = produtos.get('TUBO A VÁCUO EDTA K2 4 ML')!;
    const lote = (await c.query(`select id from far.estoque_lote where produto_id = $1 and unidade_id = $2`, [p, unLab])).rows[0].id;
    await c.query(`insert into far.inutilizacao (data, unidade_id, produto_id, lote_id, quantidade, valor_total, motivo_id, observacao) values (current_date - 5,$1,$2,$3,25,11.25,$4,'Tubos com vácuo comprometido')`, [unLab, p, lote, motivoInut]);
    await movimentar(c, { unidadeId: unLab, produtoId: p, loteId: lote, tipo: 'INUTILIZACAO', quantidade: -25, documento: 'Inutilização', operadorId: op });
  }
  for (const codigo of ['HMG', 'GLI', 'CT', 'HDL', 'TG', 'CREA', 'AU', 'TGO', 'TGP', 'HBA1C', 'TSH', 'BHCG', 'PSA', 'VDRL', 'LDL'])
    await c.query(`insert into lab.exame_insumo (exame_id, produto_id, quantidade, etapa) select id, $2, 1, 'COLETA' from lab.exame where codigo = $1`, [codigo, produtos.get('AGULHA PARA COLETA A VÁCUO 25 X 7')]);
  await c.query(`insert into lab.exame_insumo (exame_id, produto_id, quantidade, etapa) select id, $1, 0.02, 'ANALISE' from lab.exame where codigo = 'GLI'`, [produtos.get('REAGENTE GLICOSE ENZIMÁTICA 500 ML')]);

  // Equipamentos interfaceados com mapeamento de parâmetros (TR 1.2.48).
  const equip = async (nome: string, fab: string, modelo: string, secao: string, protocolo: string, comunicacao: string, mapa: [string, string, string, number?][], automatizado = true) => {
    const id = (
      await c.query(
        `insert into lab.equipamento (nome, fabricante, modelo, numero_serie, laboratorio_id, secao_id, automatizado, empresa_suporte, contato_suporte, protocolo, comunicacao, request_mode, conexao, ativo)
         values ($1,$2,$3,$4,$5,(select id from lab.secao where nome = $6),$7,$8,'suporte@fornecedor.exemplo.com.br',$9,$10,$11,$12,true) returning id`,
        [nome, fab, modelo, `SN${Math.abs(nome.length * 7919) % 100000}`, lab, secao, automatizado, `${fab} DO BRASIL (assistência técnica)`, protocolo, comunicacao, comunicacao === 'BIDIRECIONAL', protocolo === 'ASTM' ? 'COM3 9600 8N1' : protocolo === 'HL7' ? '10.0.0.21:5000' : '\\\\servidor\\interface\\imuno'],
      )
    ).rows[0].id as number;
    for (const [cod, exame, variavel, fator] of mapa)
      await c.query(`insert into lab.equipamento_parametro (equipamento_id, codigo_equipamento, exame_id, variavel_codigo, fator, ativo) values ($1,$2,(select id from lab.exame where codigo = $3),$4,$5,true)`, [id, cod, exame, variavel, fator ?? 1]);
    return id;
  };
  const hemato = await equip('ANALISADOR HEMATOLÓGICO XN-550', 'SYSMEX', 'XN-550', 'HEMATOLOGIA', 'ASTM', 'BIDIRECIONAL', [
    ['WBC', 'HMG', 'LEUC', 1000],
    ['RBC', 'HMG', 'HEM'],
    ['HGB', 'HMG', 'HB'],
    ['HCT', 'HMG', 'HT'],
    ['RDW-CV', 'HMG', 'RDW'],
    ['PLT', 'HMG', 'PLAQ', 1000],
    ['NEUT%', 'HMG', 'NEUT'],
    ['LYMPH%', 'HMG', 'LINF'],
    ['MONO%', 'HMG', 'MONO'],
    ['EO%', 'HMG', 'EOS'],
    ['BASO%', 'HMG', 'BASO'],
  ]);
  const bioq = await equip('ANALISADOR BIOQUÍMICO BS-240', 'MINDRAY', 'BS-240', 'BIOQUÍMICA', 'HL7', 'BIDIRECIONAL', [
    ['GLU', 'GLI', 'GLI'],
    ['CHOL', 'CT', 'CT'],
    ['HDL', 'HDL', 'HDL'],
    ['TG', 'TG', 'TG'],
    ['CREA', 'CREA', 'CREA'],
    ['UA', 'AU', 'AU'],
    ['AST', 'TGO', 'TGO'],
    ['ALT', 'TGP', 'TGP'],
    ['CHOL', 'LDL', 'CT'],
    ['HDL', 'LDL', 'HDL'],
    ['TG', 'LDL', 'TG'],
  ]);
  await equip('IMUNOANALISADOR MAGLUMI 800', 'SNIBE', 'MAGLUMI 800', 'IMUNOLOGIA E HORMÔNIOS', 'KERMIT', 'MONODIRECIONAL', [['TSH', 'TSH', 'TSH']]);
  await equip('MICROSCÓPIO ÓPTICO BINOCULAR (URINÁLISE)', 'OLYMPUS', 'CX23', 'URINÁLISE', 'MANUAL', 'MONODIRECIONAL', [], false);
  // Controle interno de qualidade com histórico para o gráfico de Levey-Jennings (TR 1.2.48.3).
  const ctrl = async (nome: string, eq: number, exame: string, variavel: string, nivel: string, lote: string, codigo: string, media: number, dp: number, origem: string, desvios: number[]) => {
    const id = (
      await c.query(
        `insert into lab.cq_controle (nome, equipamento_id, exame_id, variavel_codigo, nivel, lote, fabricante, validade, codigo_amostra, origem_media, media, desvio_padrao, regras, ativo)
         values ($1,$2,(select id from lab.exame where codigo = $3),$4,$5,$6,'CONTROLES DIAGNÓSTICOS',current_date + 120,$7,$8,$9,$10,'{1_2S,1_3S,2_2S,R_4S,4_1S,10X}',true) returning id`,
        [nome, eq, exame, variavel, nivel, lote, codigo, origem, media, dp],
      )
    ).rows[0].id;
    for (let i = 0; i < desvios.length; i++) {
      const r = await registrarResultadoControle(c, id, Math.round((media + desvios[i] * dp) * 100) / 100, i % 3 ? 'EQUIPAMENTO' : 'MANUAL', null);
      await c.query(`update lab.cq_resultado set data_hora = now() - ($2 || ' days')::interval where id = $1`, [r.id, desvios.length - i]);
    }
  };
  await ctrl('CONTROLE HEMATOLÓGICO NÍVEL 2 - HEMOGLOBINA', hemato, 'HMG', 'HB', 'NORMAL', 'HC2-2611', 'CQHB2', 13.2, 0.25, 'BULA', [0.2, -0.5, 0.8, 1.1, -0.3, 0.4, -1.2, 0.1, 2.3, 0.6, -0.4, 0.9, -0.8, 0.2, 1.4, 1.2, 1.3, 1.1, -0.2, 0.5]);
  await ctrl('CONTROLE BIOQUÍMICO NÍVEL 1 - GLICOSE', bioq, 'GLI', 'GLI', 'NORMAL', 'BQ1-0726', 'CQGLI1', 98, 3, 'LABORATORIO', [0.3, 0.7, -0.6, -1.1, 0.2, 0.9, -0.4, 1.7, -2.1, 0.5, 0.1, -0.9, 3.4, -0.2, 0.6]);
  await ctrl('CONTROLE BIOQUÍMICO NÍVEL 2 - GLICOSE', bioq, 'GLI', 'GLI', 'ALTO', 'BQ2-0726', 'CQGLI2', 252, 6, 'BULA', [-0.4, 0.5, 0.9, -0.2, 0.3, -1.4, 0.8, 0.1, -0.7, 0.4]);

  // Requisições em todas as etapas do fluxo (TR 1.2.47.43).
  const u: Usuario = {
    id: op,
    nome: 'FERNANDA ALVES MOREIRA',
    login: 'laboratorio',
    email: null,
    administrador: false,
    encarregadoDados: false,
    permissoes: new Set(['*']),
    modulos: null,
    unidades: [unLab],
    unidadeAtual: unLab,
    profissionalId: prof,
    gruposProfissionais: [],
    sessaoId: 'carga',
    horarioInicio: null,
    horarioFim: null,
    diasTrabalho: null,
    precisaTrocarSenha: false,
    precisaAceitarTermos: false,
  };
  const exame = async (codigo: string) => (await c.query(`select id from lab.exame where codigo = $1`, [codigo])).rows[0]?.id as number;
  const pac = ctx.pacientes;
  if (pac.length < 9) return;
  const sexo = async (id: number) => (await c.query(`select sexo from cad.pessoa where id = $1`, [id])).rows[0]?.sexo;
  const masculinos: number[] = [];
  const femininos: number[] = [];
  for (const id of pac.slice(0, 40)) ((await sexo(id)) === 'M' ? masculinos : femininos).push(id);
  const nova = async (pacienteId: number, codigos: string[], extra: Record<string, any> = {}) =>
    criarRequisicaoExterna(
      c,
      {
        pacienteId,
        unidadeSolicitanteId: extra.unidade ?? ctx.unidades.usf,
        profissionalSolicitanteId: extra.profissional ?? ctx.profissionais.medico,
        origem: extra.origem ?? 'REDE',
        urgente: !!extra.urgente,
        dataAgendada: extra.data ?? null,
        itens: await sequencial(codigos, async (x) => ({ exameId: await exame(x) })),
        confirmarAvisos: true,
      },
      u,
    );
  const itensDe = async (reqId: number) => (await c.query(`select i.id, e.codigo from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.requisicao_id = $1`, [reqId])).rows as { id: number; codigo: string }[];
  const digitar = async (reqId: number, valores: Record<string, Record<string, any>>, parcial = false) => {
    for (const it of await itensDe(reqId)) if (valores[it.codigo]) await salvarResultado(c, it.id, { valores: valores[it.codigo], parcial }, u);
  };
  const p1 = femininos[0] ?? pac[0];
  const p2 = masculinos[0] ?? pac[1];
  // Resultado anterior (30 dias atrás) para o Delta-Check e o histórico.
  const antiga = await nova(p1, ['HMG', 'GLI'], { data: null });
  await registrarColeta(c, antiga.id, { profissionalId: ctx.profissionais.enfermeira }, u);
  await digitar(antiga.id, { HMG: { HEM: 4.6, HB: 13.8, HT: 41.2, RDW: 13.1, LEUC: 6800, NEUT: 58, LINF: 32, MONO: 6, EOS: 3, BASO: 1, PLAQ: 245000 }, GLI: { GLI: 92 } });
  await liberarItens(c, (await itensDe(antiga.id)).map((i) => i.id), prof, u);
  await c.query(`update lab.requisicao set situacao = 'ENTREGUE', entregue_em = now() - interval '25 days', entregue_a = 'O PRÓPRIO PACIENTE', criado_em = now() - interval '30 days', data_agendada = current_date - 30, data_prevista_entrega = current_date - 29 where id = $1`, [antiga.id]);
  await c.query(`update lab.amostra set coletada_em = now() - interval '30 days' where requisicao_id = $1`, [antiga.id]);
  await c.query(`update lab.requisicao_exame set digitado_em = now() - interval '30 days', liberado_em = now() - interval '30 days' + interval '5 hours', impresso_em = now() - interval '29 days' where requisicao_id = $1`, [antiga.id]);
  // Liberada hoje, com hemoglobina em queda (Delta-Check) e perfil lipídico.
  const b = await nova(p1, ['HMG', 'GLI', 'CT', 'HDL', 'TG', 'LDL']);
  await registrarPresenca(c, b.id, true, u);
  await registrarColeta(c, b.id, { profissionalId: ctx.profissionais.enfermeira, materiais: [{ produtoId: produtos.get('AGULHA PARA COLETA A VÁCUO 25 X 7')!, quantidade: 1 }] }, u);
  await digitar(b.id, {
    HMG: { HEM: 3.9, HB: 10.4, HT: 33.5, RDW: 15.2, LEUC: 7200, NEUT: 61, LINF: 29, MONO: 6, EOS: 3, BASO: 1, PLAQ: 230000, OBS: 'PRESENÇA DE ANISOCITOSE E HIPOCROMIA.' },
    GLI: { GLI: 112 },
    CT: { CT: 214 },
    HDL: { HDL: 38 },
    TG: { TG: 176 },
    LDL: { CT: 214, HDL: 38, TG: 176 },
  });
  await liberarItens(c, (await itensDe(b.id)).map((i) => i.id), prof, u);
  // Coletada com digitação em andamento (parcial) e ocorrência.
  const cReq = await nova(p2, ['GLI', 'CREA', 'EAS', 'AU']);
  await registrarColeta(c, cReq.id, { profissionalId: ctx.profissionais.enfermeira }, u);
  await digitar(cReq.id, { GLI: { GLI: 87 }, AU: { AU: 7.6 } });
  await digitar(cReq.id, { CREA: { CREA: 1.08 } }, true);
  const motivo = (await c.query(`select id from lab.motivo_ocorrencia where nome = 'JEJUM NÃO REALIZADO'`)).rows[0].id;
  await registrarOcorrencia(c, { requisicaoId: cReq.id, motivoId: motivo, descricao: 'Paciente informou ter tomado café às 6h.' }, u);
  // UPA urgente com valor crítico aguardando liberação.
  const d = await nova(femininos[1] ?? pac[2], ['HMG', 'GLI'], { origem: 'UPA', urgente: true, unidade: ctx.unidades.upa, profissional: ctx.profissionais.plantonista });
  await registrarColeta(c, d.id, { profissionalId: ctx.profissionais.enfermeira }, u);
  await digitar(d.id, { HMG: { HEM: 4.1, HB: 12.1, HT: 37, RDW: 13.4, LEUC: 18900, NEUT: 86, LINF: 9, MONO: 4, EOS: 1, BASO: 0, PLAQ: 312000 }, GLI: { GLI: 438 } });
  // Coleta parcial: TSH coletado, parasitológico (3 amostras) pendente.
  const e = await nova(femininos[2] ?? pac[3], ['TSH', 'EPF', 'HBA1C']);
  const itensE = await itensDe(e.id);
  await registrarColeta(c, e.id, { itens: itensE.filter((i) => i.codigo !== 'EPF').map((i) => i.id), profissionalId: ctx.profissionais.enfermeira }, u);
  // Exame repassado ao laboratório de apoio.
  const f = await nova(masculinos[1] ?? pac[4], ['PSA', 'GLI']);
  await registrarColeta(c, f.id, { profissionalId: ctx.profissionais.enfermeira }, u);
  // Agendadas para hoje e amanhã (recepção) e falta de ontem.
  await nova(masculinos[2] ?? pac[5], ['HMG', 'VDRL'], { data: null });
  await nova(femininos[3] ?? pac[6], ['BHCG', 'EAS'], { data: null, origem: 'UPA', unidade: ctx.unidades.upa });
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await nova(pac[7], ['HMG', 'CT', 'TG'], { data: amanha });
  const falta = await nova(pac[8], ['GLI', 'HBA1C']);
  await registrarPresenca(c, falta.id, false, u);
  await c.query(`update lab.requisicao set data_agendada = current_date - 1 where id = $1`, [falta.id]);
}

registrarCargaDemonstracao('Laboratório (exames, coletas, resultados e interfaceamento)', carregarDemonstracaoLaboratorio);
