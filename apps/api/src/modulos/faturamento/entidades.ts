// Faturamento SUS: competências, produção ambulatorial (BPA), lotes de exportação (TR 1.2.13).
import { definirEntidade } from '../../meta/registro.js';
import { CARATER_ATENDIMENTO } from '../cadastros/opcoes.js';

const FAT = 'FAT';

definirEntidade({
  nome: 'competencia',
  tabela: 'fat.competencia',
  titulo: 'Competências de faturamento',
  tituloSingular: 'Competência',
  modulo: FAT,
  menu: 'Faturamento',
  rotulo: ['competencia'],
  ordemPadrao: 'competencia desc',
  tr: ['1.2.13.1.34'],
  campos: [
    { nome: 'competencia', tipo: 'texto', rotulo: 'Competência (AAAAMM)', max: 6, obrigatorio: true, unico: true, lista: true },
    { nome: 'inicio', tipo: 'data', rotulo: 'Início', obrigatorio: true, lista: true },
    { nome: 'fim', tipo: 'data', rotulo: 'Fim', obrigatorio: true, lista: true },
    { nome: 'fechamento', tipo: 'data', rotulo: 'Dia de fechamento', lista: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['ABERTA', 'Aberta'], ['FECHADA', 'Fechada'], ['ENVIADA', 'Enviada']], padrao: 'ABERTA', lista: true },
  ],
});

definirEntidade({
  nome: 'producao',
  tabela: 'fat.producao',
  titulo: 'Produção ambulatorial',
  tituloSingular: 'Registro de produção',
  modulo: FAT,
  menu: 'Faturamento',
  rotulo: ['data', 'procedimento_id'],
  ordemPadrao: 'data desc',
  tr: ['1.2.13.1.24', '1.2.13.1.29', '1.2.13.1.35', '1.2.16.26', '1.2.17.19', '1.2.17.20', '1.2.32.18', '1.2.49.11'],
  campos: [
    { nome: 'competencia', tipo: 'texto', rotulo: 'Competência', max: 6, obrigatorio: true, lista: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data do atendimento', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', lista: true },
    { nome: 'cbo_codigo', tipo: 'texto', rotulo: 'CBO', max: 6, lista: true },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento', obrigatorio: true, lista: true },
    { nome: 'quantidade', tipo: 'inteiro', rotulo: 'Quantidade', padrao: 1, lista: true },
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', lista: true },
    { nome: 'idade', tipo: 'inteiro', rotulo: 'Idade' },
    { nome: 'cid_codigo', tipo: 'texto', rotulo: 'CID', max: 5 },
    { nome: 'carater', tipo: 'opcao', rotulo: 'Caráter', opcoes: CARATER_ATENDIMENTO, padrao: '01' },
    { nome: 'instrumento', tipo: 'opcao', rotulo: 'Instrumento', opcoes: [['BPA_C', 'BPA consolidado'], ['BPA_I', 'BPA individualizado']], lista: true },
    {
      nome: 'origem',
      tipo: 'opcao',
      rotulo: 'Origem',
      lista: true,
      opcoes: [
        ['ATENDIMENTO', 'Atendimento'],
        ['ACOLHIMENTO', 'Acolhimento'],
        ['AFERICAO_PA', 'Aferição de PA'],
        ['GLICEMIA', 'Teste de glicemia'],
        ['PROCEDIMENTO', 'Procedimento registrado'],
        ['VISITA_ACS', 'Visita domiciliar ACS'],
        ['COLETA', 'Coleta laboratorial'],
        ['EXAME', 'Exame realizado'],
        ['VACINACAO', 'Vacinação'],
        ['ODONTOLOGIA', 'Odontologia'],
        ['DIGITACAO', 'Digitação manual'],
        ['IMPORTACAO', 'Importação de prestador'],
      ],
    },
    { nome: 'referencia', tipo: 'texto', rotulo: 'Documento de origem', max: 40 },
    { nome: 'ine', tipo: 'texto', rotulo: 'INE', max: 10 },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['VALIDO', 'Válido'], ['CRITICA', 'Com crítica'], ['EXPORTADO', 'Exportado']], padrao: 'VALIDO', lista: true },
    { nome: 'critica', tipo: 'texto', rotulo: 'Críticas SIGTAP', max: 400, lista: true },
    { nome: 'lote_bpa_id', tipo: 'ref', ref: 'lote_bpa', rotulo: 'Lote BPA', oculto: true },
    { nome: 'valor', tipo: 'moeda', rotulo: 'Valor', somenteLeitura: true },
  ],
});

definirEntidade({
  nome: 'lote_bpa',
  tabela: 'fat.lote_bpa',
  titulo: 'Arquivos BPA gerados',
  tituloSingular: 'Arquivo BPA',
  modulo: FAT,
  menu: 'Faturamento',
  rotulo: ['competencia', 'id'],
  ordemPadrao: 'id desc',
  tr: ['1.2.13.1.24', '1.2.13.1.25'],
  campos: [
    { nome: 'competencia', tipo: 'texto', rotulo: 'Competência', max: 6, obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade (vazio = agrupado)', lista: true },
    { nome: 'arquivo_id', tipo: 'arquivo', rotulo: 'Arquivo', lista: true },
    { nome: 'linhas', tipo: 'inteiro', rotulo: 'Linhas', lista: true },
    { nome: 'campo_controle', tipo: 'texto', rotulo: 'Campo de controle', max: 4 },
    { nome: 'gerado_em', tipo: 'data_hora', rotulo: 'Gerado em', lista: true },
  ],
});
