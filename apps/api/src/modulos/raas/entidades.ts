// RAAS - Registro das Ações Ambulatoriais de Saúde: atenção psicossocial (CAPS) e atenção domiciliar,
// com as ações realizadas por competência, exportação e importação do arquivo RAAS (TR 1.2.44, 1.2.13.1.30, 1.2.13.1.31, 1.2.13.1.36).
import { definirEntidade } from '../../meta/registro.js';
import { DESFECHO_RAAS, ORIGEM_RAAS } from './opcoes.js';

const RAAS = 'RAAS';

definirEntidade({
  nome: 'raas_registro',
  tabela: 'raas.registro',
  titulo: 'RAAS - registros por usuário e competência',
  tituloSingular: 'RAAS',
  modulo: RAAS,
  menu: 'RAAS',
  rotulo: ['competencia', 'paciente_id'],
  ordemPadrao: 'competencia desc, id desc',
  unicos: [['tipo', 'unidade_id', 'paciente_id', 'competencia']],
  tr: ['1.2.44.1', '1.2.44.2', '1.2.13.1.30', '1.2.13.1.31'],
  abas: ['Identificação', 'Dados clínicos', 'Atenção domiciliar'],
  campos: [
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo de RAAS', opcoes: [['PSICOSSOCIAL', 'RAAS psicossocial (RAAS-PS)'], ['DOMICILIAR', 'RAAS atenção domiciliar (RAAS-AD)']], obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'competencia', tipo: 'texto', rotulo: 'Competência (AAAAMM)', max: 6, obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Estabelecimento (CAPS / SAD)', obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Usuário', obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'data_inicio', tipo: 'data', rotulo: 'Data de admissão / início do acompanhamento', obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'data_fim', tipo: 'data', rotulo: 'Data de conclusão', aba: 'Identificação' },
    { nome: 'origem', tipo: 'opcao', rotulo: 'Origem do usuário', opcoes: ORIGEM_RAAS, padrao: '01', aba: 'Identificação' },
    { nome: 'desfecho', tipo: 'opcao', rotulo: 'Motivo de saída / permanência', opcoes: DESFECHO_RAAS, padrao: '21', lista: true, aba: 'Identificação' },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional responsável', aba: 'Identificação' },
    { nome: 'cid_principal_id', tipo: 'ref', ref: 'cid', rotulo: 'CID-10 principal', lista: true, aba: 'Dados clínicos' },
    { nome: 'cid_secundario_id', tipo: 'ref', ref: 'cid', rotulo: 'CID-10 secundário', aba: 'Dados clínicos' },
    { nome: 'cid_associado_id', tipo: 'ref', ref: 'cid', rotulo: 'CID-10 causas associadas', aba: 'Dados clínicos' },
    { nome: 'situacao_rua', tipo: 'booleano', rotulo: 'Em situação de rua', padrao: false, aba: 'Dados clínicos' },
    {
      nome: 'substancias',
      tipo: 'multi_opcao',
      rotulo: 'Uso de substâncias psicoativas',
      opcoes: [['ALCOOL', 'Álcool'], ['CRACK', 'Crack'], ['COCAINA', 'Cocaína'], ['MACONHA', 'Maconha'], ['TABACO', 'Tabaco'], ['OUTRAS', 'Outras']],
      aba: 'Dados clínicos',
    },
    { nome: 'cobertura_esf', tipo: 'booleano', rotulo: 'Com cobertura da Estratégia Saúde da Família', padrao: true, aba: 'Dados clínicos' },
    { nome: 'modalidade_ad', tipo: 'opcao', rotulo: 'Modalidade de atenção domiciliar', opcoes: [['AD1', 'AD1'], ['AD2', 'AD2'], ['AD3', 'AD3']], aba: 'Atenção domiciliar' },
    { nome: 'cuidador', tipo: 'texto', rotulo: 'Nome do cuidador', max: 70, aba: 'Atenção domiciliar' },
    { nome: 'cuidador_cns', tipo: 'texto', rotulo: 'CNS do cuidador', max: 15, aba: 'Atenção domiciliar' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['ABERTO', 'Aberto'], ['EXPORTADO', 'Exportado'], ['IMPORTADO', 'Importado']], padrao: 'ABERTO', lista: true, somenteLeitura: true, aba: 'Identificação' },
    { nome: 'lote_id', tipo: 'ref', ref: 'raas_lote', rotulo: 'Arquivo RAAS', somenteLeitura: true, aba: 'Identificação' },
  ],
  filhos: [{ entidade: 'raas_acao', campo: 'registro_id', titulo: 'Ações realizadas' }],
});

// Ações realizadas no RAAS domiciliar e psicossocial (TR 1.2.44.5).
definirEntidade({
  nome: 'raas_acao',
  tabela: 'raas.acao',
  titulo: 'RAAS - ações realizadas',
  tituloSingular: 'Ação RAAS',
  modulo: RAAS,
  permissao: 'raas_registro',
  rotulo: ['data', 'procedimento_id'],
  ordemPadrao: 'data, id',
  tr: ['1.2.44.5'],
  campos: [
    { nome: 'registro_id', tipo: 'ref', ref: 'raas_registro', rotulo: 'RAAS', obrigatorio: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data da ação', obrigatorio: true, lista: true },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Ação (procedimento SIGTAP)', obrigatorio: true, lista: true },
    { nome: 'quantidade', tipo: 'inteiro', rotulo: 'Quantidade', padrao: 1, min: 1, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', lista: true },
    { nome: 'cbo_codigo', tipo: 'texto', rotulo: 'CBO', max: 6, lista: true },
    { nome: 'local', tipo: 'opcao', rotulo: 'Local de realização', opcoes: [['C', 'No serviço (CAPS / SAD)'], ['T', 'No território'], ['D', 'No domicílio']], padrao: 'C', lista: true },
    { nome: 'cid_codigo', tipo: 'texto', rotulo: 'CID', max: 4 },
    { nome: 'origem', tipo: 'texto', rotulo: 'Origem do registro', max: 120, somenteLeitura: true, lista: true },
  ],
});

definirEntidade({
  nome: 'raas_lote',
  tabela: 'raas.lote',
  titulo: 'Arquivos RAAS gerados e importados',
  tituloSingular: 'Arquivo RAAS',
  modulo: RAAS,
  menu: 'RAAS',
  rotulo: ['competencia', 'id'],
  ordemPadrao: 'id desc',
  tr: ['1.2.44.3', '1.2.44.4', '1.2.13.1.36'],
  campos: [
    { nome: 'operacao', tipo: 'opcao', rotulo: 'Operação', opcoes: [['EXPORTACAO', 'Exportação'], ['IMPORTACAO', 'Importação']], obrigatorio: true, lista: true },
    { nome: 'competencia', tipo: 'texto', rotulo: 'Competência', max: 6, obrigatorio: true, lista: true },
    { nome: 'tipo', tipo: 'texto', rotulo: 'Tipo', max: 20, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Estabelecimento', lista: true },
    { nome: 'registros', tipo: 'inteiro', rotulo: 'RAAS', lista: true },
    { nome: 'acoes', tipo: 'inteiro', rotulo: 'Ações', lista: true },
    { nome: 'criticas', tipo: 'texto_longo', rotulo: 'Críticas' },
    { nome: 'arquivo_id', tipo: 'arquivo', rotulo: 'Arquivo', lista: true },
    { nome: 'gerado_em', tipo: 'data_hora', rotulo: 'Data', lista: true },
  ],
});
