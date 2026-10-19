// Tratamento Fora do Domicílio - TFD (TR 1.2.35): laudos, complementos, trâmites, acompanhantes,
// documentos e ajudas de custo. O transporte é agendado no módulo de transporte sanitário (TR 1.2.35.17).
import { definirEntidade } from '../../meta/registro.js';

const TFD = 'TFD';

export const SITUACAO_LAUDO: [string, string][] = [
  ['ABERTO', 'Aberto (aguardando aprovação)'],
  ['APROVADO', 'Aprovado'],
  ['GLOSADO', 'Glosado'],
  ['ARQUIVADO', 'Arquivado'],
  ['NEGADO', 'Negado'],
  ['AUTORIZADO', 'Autorizado'],
];

export const SITUACAO_TRATAMENTO: [string, string][] = [
  ['PENDENTE', 'Pendente'],
  ['AUTORIZADO', 'Autorizado'],
  ['NEGADO', 'Negado'],
];

export const TIPO_TRANSPORTE: [string, string][] = [
  ['VEICULO_MUNICIPAL', 'Veículo da Secretaria de Saúde'],
  ['AMBULANCIA', 'Ambulância'],
  ['ONIBUS_LINHA', 'Ônibus de linha (passagem)'],
  ['AEREO', 'Aéreo'],
  ['PROPRIO', 'Meio próprio'],
  ['OUTRO', 'Outro'],
];

const S = 'Solicitação';
const C = 'Informações clínicas';
const T = 'Transporte e acompanhante';
const A = 'Situação';

// Laudo de TFD com as informações exigidas (TR 1.2.35.1, 1.2.35.1.1) e registro automático das decisões.
definirEntidade({
  nome: 'laudo_tfd',
  tabela: 'tfd.laudo',
  titulo: 'Laudos de TFD',
  tituloSingular: 'Laudo de TFD',
  modulo: TFD,
  menu: 'TFD/Laudos',
  rotulo: ['numero', 'paciente_id'],
  ordemPadrao: 'id desc',
  tr: ['1.2.35.1', '1.2.35.1.1', '1.2.35.5', '1.2.35.6'],
  abas: [S, C, T, A],
  campos: [
    { nome: 'numero', tipo: 'texto', rotulo: 'Número do laudo', max: 15, unico: true, lista: true, busca: true, somenteLeitura: true, aba: S, ajuda: 'Gerado automaticamente na inclusão' },
    { nome: 'data_abertura', tipo: 'data', rotulo: 'Data de abertura', obrigatorio: true, lista: true, aba: S },
    { nome: 'unidade_solicitante_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade solicitante', obrigatorio: true, lista: true, aba: S, largura: 6 },
    { nome: 'profissional_solicitante_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional solicitante', obrigatorio: true, lista: true, aba: S, largura: 6 },
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true, aba: S, largura: 12 },
    { nome: 'carater', tipo: 'opcao', rotulo: 'Caráter', padrao: 'ELETIVO', aba: S, opcoes: [['ELETIVO', 'Eletivo'], ['PRIORITARIO', 'Prioritário'], ['URGENCIA', 'Urgência']] },
    { nome: 'especialidade_id', tipo: 'ref', ref: 'especialidade', rotulo: 'Especialidade', aba: S },
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'CID', obrigatorio: true, lista: true, aba: S, largura: 6 },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento para o tratamento', obrigatorio: true, lista: true, aba: S, largura: 6 },
    { nome: 'municipio_destino_id', tipo: 'ref', ref: 'municipio', rotulo: 'Município de referência pretendido', aba: S, largura: 6 },
    { nome: 'unidade_referencia', tipo: 'texto', rotulo: 'Unidade de referência pretendida', max: 150, aba: S, largura: 6 },
    { nome: 'diagnostico_inicial', tipo: 'texto_longo', rotulo: 'Diagnóstico inicial', obrigatorio: true, aba: C },
    { nome: 'diagnostico_provavel', tipo: 'texto_longo', rotulo: 'Diagnóstico provável', aba: C },
    { nome: 'historico_doenca', tipo: 'texto_longo', rotulo: 'Histórico da doença', obrigatorio: true, aba: C },
    { nome: 'exame_fisico', tipo: 'texto_longo', rotulo: 'Exame físico', aba: C },
    { nome: 'exames_complementares', tipo: 'texto_longo', rotulo: 'Exames complementares', aba: C },
    { nome: 'tratamentos_realizados', tipo: 'texto_longo', rotulo: 'Tratamentos realizados', aba: C },
    { nome: 'razoes_impossibilidade', tipo: 'texto_longo', rotulo: 'Razões que impossibilitam a realização do tratamento no município', obrigatorio: true, aba: C },
    { nome: 'tipo_transporte', tipo: 'opcao', rotulo: 'Tipo de transporte', obrigatorio: true, padrao: 'VEICULO_MUNICIPAL', lista: true, opcoes: TIPO_TRANSPORTE, aba: T },
    { nome: 'necessita_acompanhante', tipo: 'booleano', rotulo: 'Necessita de acompanhante', padrao: false, aba: T },
    { nome: 'justificativa_acompanhante', tipo: 'texto_longo', rotulo: 'Justificativa para a necessidade de acompanhante', aba: T },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação do laudo', opcoes: SITUACAO_LAUDO, padrao: 'ABERTO', lista: true, somenteLeitura: true, aba: A },
    { nome: 'situacao_tratamento', tipo: 'opcao', rotulo: 'Situação do tratamento', opcoes: SITUACAO_TRATAMENTO, padrao: 'PENDENTE', lista: true, somenteLeitura: true, aba: A },
    { nome: 'local_tratamento_id', tipo: 'ref', ref: 'local_destino', rotulo: 'Local de tratamento autorizado', somenteLeitura: true, aba: A },
    { nome: 'motivo_tratamento', tipo: 'texto', rotulo: 'Motivo da autorização do tratamento', max: 250, somenteLeitura: true, aba: A },
    { nome: 'agendamento_data_hora', tipo: 'data_hora', rotulo: 'Data e hora do atendimento no destino', somenteLeitura: true, aba: A },
    { nome: 'motivo_decisao', tipo: 'texto', rotulo: 'Motivo da última decisão (glosa/arquivamento/negação/cancelamento)', max: 250, somenteLeitura: true, aba: A },
    { nome: 'aprovado_em', tipo: 'data_hora', rotulo: 'Aprovado em', somenteLeitura: true, aba: A },
    { nome: 'aprovado_por', tipo: 'ref', ref: 'operador', rotulo: 'Aprovado por', somenteLeitura: true, aba: A },
    { nome: 'autorizado_em', tipo: 'data_hora', rotulo: 'Laudo autorizado em', somenteLeitura: true, aba: A },
    { nome: 'autorizado_por', tipo: 'ref', ref: 'operador', rotulo: 'Laudo autorizado por', somenteLeitura: true, aba: A },
    { nome: 'tratamento_autorizado_em', tipo: 'data_hora', rotulo: 'Tratamento autorizado em', somenteLeitura: true, aba: A },
    { nome: 'tratamento_autorizado_por', tipo: 'ref', ref: 'operador', rotulo: 'Tratamento autorizado por', somenteLeitura: true, aba: A },
    { nome: 'alterado_em', tipo: 'data_hora', rotulo: 'Última alteração em', somenteLeitura: true, aba: A },
    { nome: 'alterado_por', tipo: 'ref', ref: 'operador', rotulo: 'Última alteração por', somenteLeitura: true, aba: A },
  ],
  filhos: [
    { entidade: 'laudo_tfd_acompanhante', campo: 'laudo_id', titulo: 'Acompanhantes' },
    { entidade: 'laudo_tfd_documento', campo: 'laudo_id', titulo: 'Documentos' },
    { entidade: 'tfd_ajuda_custo', campo: 'laudo_id', titulo: 'Ajudas de custo' },
    { entidade: 'laudo_tfd_complemento', campo: 'laudo_id', titulo: 'Complementos' },
    { entidade: 'laudo_tfd_tramite', campo: 'laudo_id', titulo: 'Trâmites do processo' },
  ],
});

// Complementos ao laudo com data, hora e usuário automáticos (TR 1.2.35.4).
definirEntidade({
  nome: 'laudo_tfd_complemento',
  tabela: 'tfd.laudo_complemento',
  titulo: 'Complementos do laudo de TFD',
  tituloSingular: 'Complemento',
  modulo: TFD,
  permissao: 'laudo_tfd',
  rotulo: ['data_hora'],
  ordemPadrao: 'data_hora',
  tr: ['1.2.35.4'],
  campos: [
    { nome: 'laudo_id', tipo: 'ref', ref: 'laudo_tfd', rotulo: 'Laudo', obrigatorio: true },
    { nome: 'data_hora', tipo: 'data_hora', rotulo: 'Data e hora', lista: true, somenteLeitura: true },
    { nome: 'texto', tipo: 'texto_longo', rotulo: 'Complemento', obrigatorio: true, lista: true },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Usuário', lista: true, somenteLeitura: true },
  ],
});

// Trâmites do processo: todas as ações com data, hora, usuário e motivo (TR 1.2.35.18).
definirEntidade({
  nome: 'laudo_tfd_tramite',
  tabela: 'tfd.laudo_tramite',
  titulo: 'Trâmites do processo de TFD',
  tituloSingular: 'Trâmite',
  modulo: TFD,
  permissao: 'laudo_tfd',
  rotulo: ['data_hora', 'acao'],
  ordemPadrao: 'data_hora',
  tr: ['1.2.35.18'],
  campos: [
    { nome: 'laudo_id', tipo: 'ref', ref: 'laudo_tfd', rotulo: 'Laudo', obrigatorio: true },
    { nome: 'data_hora', tipo: 'data_hora', rotulo: 'Data e hora', obrigatorio: true, lista: true },
    { nome: 'acao', tipo: 'texto', rotulo: 'Ação', max: 60, obrigatorio: true, lista: true },
    { nome: 'descricao', tipo: 'texto_longo', rotulo: 'Descrição / motivo', lista: true },
    { nome: 'situacao', tipo: 'texto', rotulo: 'Situação resultante', max: 60, lista: true },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Usuário', lista: true },
  ],
});

definirEntidade({
  nome: 'laudo_tfd_acompanhante',
  tabela: 'tfd.laudo_acompanhante',
  titulo: 'Acompanhantes do TFD',
  tituloSingular: 'Acompanhante',
  modulo: TFD,
  permissao: 'laudo_tfd',
  rotulo: ['nome'],
  ordemPadrao: 'id',
  tr: ['1.2.35.1.1'],
  campos: [
    { nome: 'laudo_id', tipo: 'ref', ref: 'laudo_tfd', rotulo: 'Laudo', obrigatorio: true },
    { nome: 'pessoa_id', tipo: 'ref', ref: 'paciente', rotulo: 'Pessoa cadastrada' },
    { nome: 'nome', tipo: 'texto', rotulo: 'Nome', max: 120, lista: true, maiusculo: true },
    { nome: 'cpf', tipo: 'cpf', rotulo: 'CPF', lista: true },
    { nome: 'parentesco', tipo: 'texto', rotulo: 'Parentesco', max: 40, lista: true },
    { nome: 'telefone', tipo: 'telefone', rotulo: 'Telefone' },
  ],
});

definirEntidade({
  nome: 'laudo_tfd_documento',
  tabela: 'tfd.laudo_documento',
  titulo: 'Documentos do processo de TFD',
  tituloSingular: 'Documento',
  modulo: TFD,
  permissao: 'laudo_tfd',
  rotulo: ['descricao'],
  ordemPadrao: 'id',
  campos: [
    { nome: 'laudo_id', tipo: 'ref', ref: 'laudo_tfd', rotulo: 'Laudo', obrigatorio: true },
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', lista: true, opcoes: [['EXAME', 'Exame'], ['RELATORIO', 'Relatório médico'], ['DOCUMENTO_PESSOAL', 'Documento pessoal'], ['COMPROVANTE', 'Comprovante de residência'], ['AGENDAMENTO', 'Comprovante de agendamento no destino'], ['OUTRO', 'Outro']] },
    { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição', max: 150, obrigatorio: true, lista: true },
    { nome: 'arquivo_id', tipo: 'arquivo', rotulo: 'Arquivo' },
  ],
});

// Ajudas de custo ao paciente e acompanhante (alimentação, pernoite, passagens).
definirEntidade({
  nome: 'tfd_ajuda_custo',
  tabela: 'tfd.ajuda_custo',
  titulo: 'Ajudas de custo do TFD',
  tituloSingular: 'Ajuda de custo',
  modulo: TFD,
  permissao: 'laudo_tfd',
  rotulo: ['data', 'valor'],
  ordemPadrao: 'data',
  campos: [
    { nome: 'laudo_id', tipo: 'ref', ref: 'laudo_tfd', rotulo: 'Laudo', obrigatorio: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', obrigatorio: true, lista: true, opcoes: [['ALIMENTACAO', 'Alimentação'], ['PERNOITE', 'Pernoite / hospedagem'], ['PASSAGEM', 'Passagem'], ['OUTRA', 'Outra']] },
    { nome: 'beneficiario', tipo: 'opcao', rotulo: 'Beneficiário', padrao: 'PACIENTE', lista: true, opcoes: [['PACIENTE', 'Paciente'], ['ACOMPANHANTE', 'Acompanhante']] },
    { nome: 'quantidade', tipo: 'inteiro', rotulo: 'Quantidade (diárias/unidades)', padrao: 1, min: 1, lista: true },
    { nome: 'valor_unitario', tipo: 'moeda', rotulo: 'Valor unitário (R$)', obrigatorio: true },
    { nome: 'valor', tipo: 'moeda', rotulo: 'Valor total (R$)', lista: true, somenteLeitura: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', padrao: 'PENDENTE', lista: true, opcoes: [['PENDENTE', 'Pendente de pagamento'], ['PAGO', 'Pago'], ['CANCELADO', 'Cancelado']] },
    { nome: 'data_pagamento', tipo: 'data', rotulo: 'Data do pagamento' },
    { nome: 'observacao', tipo: 'texto', rotulo: 'Observação', max: 200 },
  ],
});
