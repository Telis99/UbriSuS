// Tabelas de opções do SIH/SUS usadas nos laudos, autorizações e exportações de AIH.

export const CLINICA_AIH: [string, string][] = [
  ['01', 'Cirúrgica'],
  ['02', 'Obstétrica'],
  ['03', 'Clínica médica'],
  ['04', 'Crônicos'],
  ['05', 'Psiquiatria'],
  ['06', 'Pneumologia sanitária (tisiologia)'],
  ['07', 'Pediatria'],
  ['08', 'Reabilitação'],
  ['09', 'Leito dia / cirúrgico'],
  ['10', 'Leito dia / AIDS'],
  ['13', 'Leito dia / geriatria'],
  ['14', 'Leito dia / saúde mental'],
];

export const SITUACAO_LAUDO: [string, string][] = [
  ['SOLICITADO', 'Solicitado (aguardando aprovação)'],
  ['APROVADO', 'Aprovado'],
  ['GLOSADO', 'Glosado (não aprovado)'],
  ['ARQUIVADO', 'Arquivado'],
  ['AUTORIZADO', 'Autorizado'],
];

// Motivos de saída/permanência do SIH/SUS.
export const MOTIVO_SAIDA: [string, string][] = [
  ['11', 'Alta curado'],
  ['12', 'Alta melhorado'],
  ['14', 'Alta a pedido'],
  ['15', 'Alta com previsão de retorno para acompanhamento'],
  ['16', 'Alta por evasão'],
  ['18', 'Alta por outros motivos'],
  ['21', 'Permanência por características próprias da doença'],
  ['31', 'Transferido para outro estabelecimento'],
  ['41', 'Óbito com declaração fornecida pelo médico assistente'],
  ['42', 'Óbito com declaração fornecida pelo IML'],
  ['43', 'Óbito com declaração fornecida pelo SVO'],
  ['51', 'Encerramento administrativo'],
];
