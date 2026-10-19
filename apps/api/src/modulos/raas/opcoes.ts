// Tabelas de opções do RAAS (origem do usuário e motivo de saída/permanência).

export const ORIGEM_RAAS: [string, string][] = [
  ['01', 'Demanda espontânea'],
  ['02', 'Atenção básica'],
  ['03', 'Serviço de urgência / emergência'],
  ['04', 'Outro CAPS'],
  ['05', 'Hospital geral'],
  ['06', 'Hospital psiquiátrico'],
  ['07', 'Serviço de atenção domiciliar'],
  ['08', 'Ambulatório especializado'],
  ['09', 'Instituições de justiça / assistência social'],
  ['10', 'Outros'],
];

export const DESFECHO_RAAS: [string, string][] = [
  ['11', 'Alta clínica'],
  ['12', 'Alta a pedido / abandono'],
  ['21', 'Permanência'],
  ['31', 'Transferência para outro serviço'],
  ['32', 'Encaminhamento para a atenção básica'],
  ['33', 'Internação hospitalar'],
  ['41', 'Óbito'],
];
