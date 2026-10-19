// Transporte sanitário (TR 1.2.40): cadastros de apoio, veículos, condutores, rotas com paradas,
// agendas de transporte por rota, viagens, passageiros, acompanhantes, adiantamentos e despesas.
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';
import { DIAS_SEMANA } from '../cadastros/opcoes.js';

const TRA = 'TRA';

export const TIPO_VIAGEM: [string, string][] = [
  ['IDA_VOLTA', 'Ida e volta'],
  ['IDA', 'Somente ida'],
  ['VOLTA', 'Somente volta'],
];

export const SITUACAO_VIAGEM: [string, string][] = [
  ['ABERTA', 'Aberta para agendamento'],
  ['CONFIRMADA', 'Confirmada'],
  ['CONCLUIDA', 'Concluída (fechada)'],
  ['CANCELADA', 'Cancelada'],
];

export const SITUACAO_PASSAGEIRO: [string, string][] = [
  ['AGENDADO', 'Agendado'],
  ['CONFIRMADO', 'Confirmado'],
  ['PRESENTE', 'Transportado'],
  ['FALTA', 'Ausente (falta)'],
  ['CANCELADO', 'Cancelado'],
];

const simples = (nome: string, tabela: string, titulo: string, singular: string, tr: string[], extra: any[] = [], menu = 'Transporte/Cadastros') =>
  definirEntidade({
    nome,
    tabela,
    titulo,
    tituloSingular: singular,
    modulo: TRA,
    menu,
    rotulo: ['nome'],
    ordemPadrao: 'nome',
    tr,
    campos: [campoNome(100, { maiusculo: true }), ...extra, campoAtivo],
  });

// Tabelas já povoadas pela carga inicial (TR 1.2.40.1, 1.2.40.2).
simples('tipo_veiculo', 'tra.tipo_veiculo', 'Tipos de veículos', 'Tipo de veículo', ['1.2.40.1'], [
  { nome: 'categoria_cnh', tipo: 'opcao', rotulo: 'Categoria mínima de CNH', lista: true, opcoes: [['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']] },
]);
simples('marca_veiculo', 'tra.marca_veiculo', 'Marcas de veículos', 'Marca de veículo', ['1.2.40.2']);

// Veículo com capacidade de passageiros, macas e cadeiras de rodas (TR 1.2.40.3).
definirEntidade({
  nome: 'veiculo',
  tabela: 'tra.veiculo',
  titulo: 'Veículos',
  tituloSingular: 'Veículo',
  modulo: TRA,
  menu: 'Transporte/Cadastros',
  rotulo: ['placa', 'modelo'],
  ordemPadrao: 'placa',
  tr: ['1.2.40.3'],
  abas: ['Identificação', 'Capacidade'],
  campos: [
    { nome: 'placa', tipo: 'texto', rotulo: 'Placa', max: 8, obrigatorio: true, unico: true, lista: true, busca: true, maiusculo: true, aba: 'Identificação' },
    { nome: 'tipo_id', tipo: 'ref', ref: 'tipo_veiculo', rotulo: 'Tipo', obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'marca_id', tipo: 'ref', ref: 'marca_veiculo', rotulo: 'Marca', lista: true, aba: 'Identificação' },
    { nome: 'modelo', tipo: 'texto', rotulo: 'Modelo', max: 60, lista: true, busca: true, maiusculo: true, aba: 'Identificação' },
    { nome: 'ano_fabricacao', tipo: 'inteiro', rotulo: 'Ano de fabricação', min: 1950, max: 2100, aba: 'Identificação' },
    { nome: 'ano_modelo', tipo: 'inteiro', rotulo: 'Ano do modelo', min: 1950, max: 2100, aba: 'Identificação' },
    { nome: 'cor', tipo: 'texto', rotulo: 'Cor', max: 30, maiusculo: true, aba: 'Identificação' },
    { nome: 'renavam', tipo: 'texto', rotulo: 'RENAVAM', max: 11, aba: 'Identificação' },
    { nome: 'chassi', tipo: 'texto', rotulo: 'Chassi', max: 17, maiusculo: true, aba: 'Identificação' },
    { nome: 'combustivel', tipo: 'opcao', rotulo: 'Combustível', aba: 'Identificação', opcoes: [['DIESEL', 'Diesel'], ['GASOLINA', 'Gasolina'], ['ETANOL', 'Etanol'], ['FLEX', 'Flex'], ['GNV', 'GNV'], ['ELETRICO', 'Elétrico']] },
    { nome: 'propriedade', tipo: 'opcao', rotulo: 'Propriedade', padrao: 'PROPRIO', aba: 'Identificação', opcoes: [['PROPRIO', 'Frota própria'], ['LOCADO', 'Locado'], ['TERCEIRIZADO', 'Serviço terceirizado'], ['CONVENIADO', 'Conveniado']] },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade / setor de lotação', aba: 'Identificação' },
    { nome: 'km_atual', tipo: 'inteiro', rotulo: 'Quilometragem atual', min: 0, aba: 'Identificação', ajuda: 'Atualizada automaticamente no fechamento das viagens' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', padrao: 'ATIVO', lista: true, aba: 'Identificação', opcoes: [['ATIVO', 'Em operação'], ['MANUTENCAO', 'Em manutenção'], ['BAIXADO', 'Baixado']] },
    { nome: 'passageiros', tipo: 'inteiro', rotulo: 'Capacidade de passageiros (sentados)', obrigatorio: true, min: 0, lista: true, aba: 'Capacidade' },
    { nome: 'macas', tipo: 'inteiro', rotulo: 'Capacidade de macas', padrao: 0, min: 0, lista: true, aba: 'Capacidade' },
    { nome: 'cadeiras_rodas', tipo: 'inteiro', rotulo: 'Capacidade de cadeiras de rodas', padrao: 0, min: 0, lista: true, aba: 'Capacidade' },
    { nome: 'acessivel', tipo: 'booleano', rotulo: 'Possui elevador / rampa de acessibilidade', padrao: false, aba: 'Capacidade' },
    campoAtivo,
  ],
});

simples('local_destino', 'tra.local_destino', 'Locais de destino', 'Local de destino', ['1.2.40.4'], [
  { nome: 'municipio_id', tipo: 'ref', ref: 'municipio', rotulo: 'Município', obrigatorio: true, lista: true },
  { nome: 'endereco', tipo: 'texto', rotulo: 'Endereço', max: 200 },
  { nome: 'telefone', tipo: 'telefone', rotulo: 'Telefone' },
  { nome: 'cnes', tipo: 'texto', rotulo: 'CNES', max: 7, lista: true },
]);
simples('motivo_viagem', 'tra.motivo_viagem', 'Motivos de viagem', 'Motivo de viagem', ['1.2.40.5']);
simples('local_embarque', 'tra.local_embarque', 'Locais de embarque', 'Local de embarque', ['1.2.40.18.3'], [
  { nome: 'endereco', tipo: 'texto', rotulo: 'Endereço / ponto de referência', max: 200, lista: true },
]);

// Despesas cadastradas por grupos (TR 1.2.40.6).
simples('grupo_despesa', 'tra.grupo_despesa', 'Grupos de despesas', 'Grupo de despesas', ['1.2.40.6']);
definirEntidade({
  nome: 'despesa_transporte',
  tabela: 'tra.despesa',
  titulo: 'Despesas de viagem',
  tituloSingular: 'Despesa de viagem',
  modulo: TRA,
  menu: 'Transporte/Cadastros',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.40.6'],
  campos: [
    campoNome(100, { maiusculo: true }),
    { nome: 'grupo_id', tipo: 'ref', ref: 'grupo_despesa', rotulo: 'Grupo', obrigatorio: true, lista: true },
    { nome: 'unidade_medida', tipo: 'texto', rotulo: 'Unidade de medida', max: 10, padrao: 'UN', lista: true, maiusculo: true },
    { nome: 'valor_padrao', tipo: 'moeda', rotulo: 'Valor unitário padrão' },
    { nome: 'combustivel', tipo: 'booleano', rotulo: 'É combustível (quantidade em litros)', padrao: false, lista: true, ajuda: 'Usado nas médias de km por litro e valor por litro (TR 1.2.40.29.1, 1.2.40.29.3)' },
    campoAtivo,
  ],
});

// Condutores com número da CNH (TR 1.2.40.7).
definirEntidade({
  nome: 'condutor',
  tabela: 'tra.condutor',
  titulo: 'Condutores',
  tituloSingular: 'Condutor',
  modulo: TRA,
  menu: 'Transporte/Cadastros',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.40.7'],
  campos: [
    campoNome(120, { maiusculo: true }),
    { nome: 'cpf', tipo: 'cpf', rotulo: 'CPF', unico: true, lista: true, busca: true },
    { nome: 'cnh_numero', tipo: 'texto', rotulo: 'Número da CNH', max: 11, obrigatorio: true, unico: true, lista: true, busca: true },
    { nome: 'cnh_categoria', tipo: 'opcao', rotulo: 'Categoria da CNH', obrigatorio: true, lista: true, opcoes: [['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E'], ['AB', 'AB'], ['AC', 'AC'], ['AD', 'AD'], ['AE', 'AE']] },
    { nome: 'cnh_validade', tipo: 'data', rotulo: 'Validade da CNH', obrigatorio: true, lista: true },
    { nome: 'curso_transporte_pacientes', tipo: 'booleano', rotulo: 'Curso de condutor de veículo de emergência / transporte coletivo', padrao: false },
    { nome: 'telefone', tipo: 'telefone', rotulo: 'Telefone', lista: true },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Usuário do sistema' },
    campoAtivo,
  ],
});

// Rota: nome, município de destino com ordem das paradas, local, motivo e veículo (TR 1.2.40.8, 1.2.40.9, 1.2.40.10).
definirEntidade({
  nome: 'rota',
  tabela: 'tra.rota',
  titulo: 'Rotas',
  tituloSingular: 'Rota',
  modulo: TRA,
  menu: 'Transporte/Rotas e agendas',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  clonavel: true,
  tr: ['1.2.40.8', '1.2.40.8.1', '1.2.40.8.2', '1.2.40.8.3', '1.2.40.8.4', '1.2.40.8.5', '1.2.40.9', '1.2.40.10'],
  campos: [
    campoNome(100, { rotulo: 'Nome da rota', maiusculo: true }),
    { nome: 'municipio_destino_id', tipo: 'ref', ref: 'municipio', rotulo: 'Município de destino final', obrigatorio: true, lista: true, largura: 6 },
    { nome: 'local_destino_id', tipo: 'ref', ref: 'local_destino', rotulo: 'Local de destino', lista: true, largura: 6 },
    { nome: 'motivo_id', tipo: 'ref', ref: 'motivo_viagem', rotulo: 'Motivo', lista: true, largura: 6 },
    { nome: 'veiculo_id', tipo: 'ref', ref: 'veiculo', rotulo: 'Veículo', lista: true, largura: 6 },
    { nome: 'condutor_id', tipo: 'ref', ref: 'condutor', rotulo: 'Condutor padrão', largura: 6 },
    { nome: 'local_embarque_id', tipo: 'ref', ref: 'local_embarque', rotulo: 'Local de embarque padrão', largura: 6 },
    {
      nome: 'abrangencia',
      tipo: 'opcao',
      rotulo: 'Abrangência',
      lista: true,
      opcoes: [['MUNICIPIO', 'Dentro do município'], ['FORA', 'Para fora do município']],
      ajuda: 'Define quais feriados bloqueiam a rota (TR 1.2.40.27, 1.2.40.28). Calculada pelo município de destino quando não informada.',
    },
    { nome: 'distancia_km', tipo: 'inteiro', rotulo: 'Distância total ida e volta (km)', min: 0 },
    { nome: 'valor_viagem', tipo: 'moeda', rotulo: 'Valor de cada viagem (R$)', lista: true, ajuda: 'Rateado entre os pacientes transportados para gerar o custo por paciente (TR 1.2.40.9)' },
    { nome: 'observacao', tipo: 'texto_longo', rotulo: 'Observações' },
    campoAtivo,
  ],
  filhos: [
    { entidade: 'rota_parada', campo: 'rota_id', titulo: 'Municípios de parada (em ordem)' },
    { entidade: 'agenda_transporte', campo: 'rota_id', titulo: 'Agendas de transporte' },
  ],
});

definirEntidade({
  nome: 'rota_parada',
  tabela: 'tra.rota_parada',
  titulo: 'Paradas da rota',
  tituloSingular: 'Parada',
  modulo: TRA,
  permissao: 'rota',
  rotulo: ['ordem', 'municipio_id'],
  ordemPadrao: 'ordem',
  unicos: [['rota_id', 'municipio_id']],
  tr: ['1.2.40.8.2', '1.2.40.10'],
  campos: [
    { nome: 'rota_id', tipo: 'ref', ref: 'rota', rotulo: 'Rota', obrigatorio: true },
    { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem de parada', obrigatorio: true, min: 1, lista: true },
    { nome: 'municipio_id', tipo: 'ref', ref: 'municipio', rotulo: 'Município', obrigatorio: true, lista: true },
    { nome: 'local_destino_id', tipo: 'ref', ref: 'local_destino', rotulo: 'Local principal', lista: true },
    { nome: 'distancia_km', tipo: 'inteiro', rotulo: 'Distância da origem (km)', lista: true },
  ],
});

// Agenda de transporte por rota: veículo, vagas, horário, vigência e dias da semana (TR 1.2.40.11).
definirEntidade({
  nome: 'agenda_transporte',
  tabela: 'tra.agenda',
  titulo: 'Agendas de transporte',
  tituloSingular: 'Agenda de transporte',
  modulo: TRA,
  menu: 'Transporte/Rotas e agendas',
  rotulo: ['rota_id', 'hora_saida'],
  ordemPadrao: 'id',
  clonavel: true,
  tr: ['1.2.40.11', '1.2.40.11.1', '1.2.40.11.2', '1.2.40.11.3', '1.2.40.11.4', '1.2.40.11.5', '1.2.40.11.6'],
  campos: [
    { nome: 'rota_id', tipo: 'ref', ref: 'rota', rotulo: 'Rota', obrigatorio: true, lista: true, largura: 6 },
    { nome: 'veiculo_id', tipo: 'ref', ref: 'veiculo', rotulo: 'Veículo', obrigatorio: true, lista: true, largura: 6 },
    { nome: 'condutor_id', tipo: 'ref', ref: 'condutor', rotulo: 'Condutor', largura: 6 },
    { nome: 'local_embarque_id', tipo: 'ref', ref: 'local_embarque', rotulo: 'Local de embarque', largura: 6 },
    { nome: 'vagas', tipo: 'inteiro', rotulo: 'Número de vagas', obrigatorio: true, min: 1, lista: true, ajuda: 'Limitado à capacidade de passageiros do veículo' },
    { nome: 'hora_saida', tipo: 'hora', rotulo: 'Horário de saída', obrigatorio: true, lista: true },
    { nome: 'data_inicial', tipo: 'data', rotulo: 'Data inicial', obrigatorio: true, lista: true },
    { nome: 'data_final', tipo: 'data', rotulo: 'Data final', lista: true },
    { nome: 'dias_semana', tipo: 'multi_opcao', rotulo: 'Dias da semana', opcoes: DIAS_SEMANA, obrigatorio: true, largura: 12 },
    { nome: 'antecedencia_minima_horas', tipo: 'inteiro', rotulo: 'Antecedência mínima para agendar (horas)', padrao: 0, min: 0 },
    campoAtivo,
  ],
});

// Viagem: gerada pelo agendamento na agenda da rota ou cadastrada sem agendamento prévio (TR 1.2.40.17, 1.2.40.19, 1.2.40.22).
definirEntidade({
  nome: 'viagem',
  tabela: 'tra.viagem',
  titulo: 'Viagens',
  tituloSingular: 'Viagem',
  modulo: TRA,
  rotulo: ['data_saida', 'hora_saida', 'rota_id'],
  ordemPadrao: 'data_saida desc',
  unicos: [['agenda_id', 'data_saida']],
  tr: ['1.2.40.17', '1.2.40.19', '1.2.40.22'],
  abas: ['Viagem', 'Fechamento'],
  campos: [
    { nome: 'data_saida', tipo: 'data', rotulo: 'Data de saída', obrigatorio: true, lista: true, aba: 'Viagem' },
    { nome: 'hora_saida', tipo: 'hora', rotulo: 'Horário de saída', lista: true, aba: 'Viagem' },
    { nome: 'agenda_id', tipo: 'ref', ref: 'agenda_transporte', rotulo: 'Agenda', somenteLeitura: true, aba: 'Viagem' },
    { nome: 'rota_id', tipo: 'ref', ref: 'rota', rotulo: 'Rota', lista: true, aba: 'Viagem' },
    { nome: 'sem_agendamento', tipo: 'booleano', rotulo: 'Viagem sem agendamento prévio', padrao: false, lista: true, aba: 'Viagem' },
    { nome: 'municipio_destino_id', tipo: 'ref', ref: 'municipio', rotulo: 'Destino final (município)', lista: true, aba: 'Viagem' },
    { nome: 'local_destino_id', tipo: 'ref', ref: 'local_destino', rotulo: 'Local de destino', aba: 'Viagem' },
    { nome: 'motivo_id', tipo: 'ref', ref: 'motivo_viagem', rotulo: 'Motivo', aba: 'Viagem' },
    { nome: 'veiculo_id', tipo: 'ref', ref: 'veiculo', rotulo: 'Veículo', lista: true, aba: 'Viagem' },
    { nome: 'condutor_id', tipo: 'ref', ref: 'condutor', rotulo: 'Condutor', lista: true, aba: 'Viagem' },
    { nome: 'local_embarque_id', tipo: 'ref', ref: 'local_embarque', rotulo: 'Local de embarque', aba: 'Viagem' },
    { nome: 'vagas', tipo: 'inteiro', rotulo: 'Vagas', min: 0, aba: 'Viagem' },
    { nome: 'valor_viagem', tipo: 'moeda', rotulo: 'Valor da viagem (R$)', aba: 'Viagem' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: SITUACAO_VIAGEM, padrao: 'ABERTA', lista: true, somenteLeitura: true, aba: 'Viagem' },
    { nome: 'confirmada_em', tipo: 'data_hora', rotulo: 'Confirmada em', somenteLeitura: true, aba: 'Viagem' },
    { nome: 'confirmada_por', tipo: 'ref', ref: 'operador', rotulo: 'Confirmada por', somenteLeitura: true, aba: 'Viagem' },
    { nome: 'motivo_cancelamento', tipo: 'texto', rotulo: 'Motivo do cancelamento', max: 200, somenteLeitura: true, aba: 'Viagem' },
    { nome: 'observacao', tipo: 'texto_longo', rotulo: 'Observações', aba: 'Viagem' },
    { nome: 'km_inicial', tipo: 'inteiro', rotulo: 'Km inicial', min: 0, aba: 'Fechamento' },
    { nome: 'km_final', tipo: 'inteiro', rotulo: 'Km final', min: 0, aba: 'Fechamento' },
    { nome: 'data_chegada', tipo: 'data', rotulo: 'Data de chegada', aba: 'Fechamento' },
    { nome: 'hora_chegada', tipo: 'hora', rotulo: 'Horário de chegada', aba: 'Fechamento' },
    { nome: 'custo_paciente', tipo: 'moeda', rotulo: 'Custo por paciente (R$)', somenteLeitura: true, aba: 'Fechamento' },
    { nome: 'fechada_em', tipo: 'data_hora', rotulo: 'Fechada em', somenteLeitura: true, aba: 'Fechamento' },
    { nome: 'fechada_por', tipo: 'ref', ref: 'operador', rotulo: 'Fechada por', somenteLeitura: true, aba: 'Fechamento' },
  ],
  filhos: [
    { entidade: 'viagem_passageiro', campo: 'viagem_id', titulo: 'Passageiros' },
    { entidade: 'viagem_adiantamento', campo: 'viagem_id', titulo: 'Adiantamentos' },
    { entidade: 'viagem_despesa', campo: 'viagem_id', titulo: 'Despesas (prestação de contas)' },
  ],
});

// Paciente na viagem: local de destino, motivo, embarque, horário, poltrona, tipo e se ocupa vaga (TR 1.2.40.13, 1.2.40.18).
definirEntidade({
  nome: 'viagem_passageiro',
  tabela: 'tra.viagem_passageiro',
  titulo: 'Passageiros das viagens',
  tituloSingular: 'Passageiro',
  modulo: TRA,
  permissao: 'viagem',
  rotulo: ['paciente_id'],
  ordemPadrao: 'id',
  tr: ['1.2.40.13', '1.2.40.18', '1.2.40.18.1', '1.2.40.18.2', '1.2.40.18.3', '1.2.40.18.4', '1.2.40.18.6', '1.2.40.18.7'],
  campos: [
    { nome: 'viagem_id', tipo: 'ref', ref: 'viagem', rotulo: 'Viagem', obrigatorio: true },
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    { nome: 'protocolo', tipo: 'texto', rotulo: 'Protocolo', max: 20, lista: true, busca: true, somenteLeitura: true },
    { nome: 'municipio_destino_id', tipo: 'ref', ref: 'municipio', rotulo: 'Município de destino', lista: true },
    { nome: 'local_destino_id', tipo: 'ref', ref: 'local_destino', rotulo: 'Local de destino', lista: true },
    { nome: 'local_destino', tipo: 'texto', rotulo: 'Local de destino (descrição)', max: 150, somenteLeitura: true },
    { nome: 'motivo_id', tipo: 'ref', ref: 'motivo_viagem', rotulo: 'Motivo do transporte', lista: true },
    { nome: 'local_embarque_id', tipo: 'ref', ref: 'local_embarque', rotulo: 'Local do embarque' },
    { nome: 'hora_saida', tipo: 'hora', rotulo: 'Horário de saída' },
    { nome: 'horario_compromisso', tipo: 'hora', rotulo: 'Horário do atendimento no destino' },
    { nome: 'poltrona', tipo: 'inteiro', rotulo: 'Poltrona', min: 1, lista: true },
    { nome: 'tipo_viagem', tipo: 'opcao', rotulo: 'Tipo da viagem', opcoes: TIPO_VIAGEM, padrao: 'IDA_VOLTA', lista: true },
    { nome: 'ocupa_vaga', tipo: 'booleano', rotulo: 'Ocupa vaga', padrao: true, lista: true, ajuda: 'Quando não ocupa (ex.: criança de colo), não é computado nas vagas (TR 1.2.40.13)' },
    { nome: 'necessidade', tipo: 'opcao', rotulo: 'Necessidade especial', padrao: 'NENHUMA', opcoes: [['NENHUMA', 'Nenhuma'], ['MACA', 'Maca'], ['CADEIRA_RODAS', 'Cadeira de rodas']] },
    { nome: 'sem_agendamento', tipo: 'booleano', rotulo: 'Incluído sem agendamento prévio', padrao: false, somenteLeitura: true },
    { nome: 'tfd_laudo_id', tipo: 'ref', ref: 'laudo_tfd', rotulo: 'Processo de TFD' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: SITUACAO_PASSAGEIRO, padrao: 'AGENDADO', lista: true, somenteLeitura: true },
    { nome: 'observacao_ausencia', tipo: 'texto', rotulo: 'Observação sobre a ausência', max: 250 },
    { nome: 'custo', tipo: 'moeda', rotulo: 'Custo do transporte (R$)', somenteLeitura: true },
    { nome: 'observacao', tipo: 'texto', rotulo: 'Observação', max: 250 },
    { nome: 'agendado_por', tipo: 'ref', ref: 'operador', rotulo: 'Agendado por', somenteLeitura: true },
  ],
  filhos: [{ entidade: 'viagem_acompanhante', campo: 'passageiro_id', titulo: 'Acompanhantes' }],
});

// Acompanhante definido ou vaga reservada sem identificação, com tipo de viagem e se ocupa vaga (TR 1.2.40.14 a 1.2.40.16, 1.2.40.18.5).
definirEntidade({
  nome: 'viagem_acompanhante',
  tabela: 'tra.viagem_acompanhante',
  titulo: 'Acompanhantes dos passageiros',
  tituloSingular: 'Acompanhante',
  modulo: TRA,
  permissao: 'viagem',
  rotulo: ['nome'],
  ordemPadrao: 'id',
  tr: ['1.2.40.14', '1.2.40.15', '1.2.40.16', '1.2.40.18.5'],
  campos: [
    { nome: 'passageiro_id', tipo: 'ref', ref: 'viagem_passageiro', rotulo: 'Passageiro', obrigatorio: true },
    { nome: 'indefinido', tipo: 'booleano', rotulo: 'Vaga reservada (acompanhante ainda não definido)', padrao: false, lista: true },
    { nome: 'pessoa_id', tipo: 'ref', ref: 'paciente', rotulo: 'Pessoa cadastrada' },
    { nome: 'nome', tipo: 'texto', rotulo: 'Nome', max: 120, lista: true, maiusculo: true },
    { nome: 'documento', tipo: 'texto', rotulo: 'Documento (RG/CPF)', max: 20, lista: true },
    { nome: 'parentesco', tipo: 'texto', rotulo: 'Parentesco', max: 40 },
    { nome: 'tipo_viagem', tipo: 'opcao', rotulo: 'Tipo da viagem', opcoes: TIPO_VIAGEM, padrao: 'IDA_VOLTA', lista: true },
    { nome: 'ocupa_vaga', tipo: 'booleano', rotulo: 'Ocupa vaga', padrao: true, lista: true },
    { nome: 'poltrona', tipo: 'inteiro', rotulo: 'Poltrona', min: 1, lista: true },
  ],
});

// Adiantamento de viagem (TR 1.2.40.21, 1.2.40.23).
definirEntidade({
  nome: 'viagem_adiantamento',
  tabela: 'tra.viagem_adiantamento',
  titulo: 'Adiantamentos de viagem',
  tituloSingular: 'Adiantamento',
  modulo: TRA,
  permissao: 'viagem',
  rotulo: ['data', 'valor'],
  ordemPadrao: 'data',
  tr: ['1.2.40.21'],
  campos: [
    { nome: 'viagem_id', tipo: 'ref', ref: 'viagem', rotulo: 'Viagem', obrigatorio: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'condutor_id', tipo: 'ref', ref: 'condutor', rotulo: 'Beneficiário (condutor)', lista: true },
    { nome: 'valor', tipo: 'moeda', rotulo: 'Valor (R$)', obrigatorio: true, lista: true },
    { nome: 'finalidade', tipo: 'texto', rotulo: 'Finalidade', max: 200, lista: true },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Lançado por', somenteLeitura: true },
  ],
});

// Despesas ocasionadas na viagem para a prestação de contas (TR 1.2.40.22).
definirEntidade({
  nome: 'viagem_despesa',
  tabela: 'tra.viagem_despesa',
  titulo: 'Despesas das viagens',
  tituloSingular: 'Despesa da viagem',
  modulo: TRA,
  permissao: 'viagem',
  rotulo: ['despesa_id', 'valor_total'],
  ordemPadrao: 'data',
  tr: ['1.2.40.22'],
  campos: [
    { nome: 'viagem_id', tipo: 'ref', ref: 'viagem', rotulo: 'Viagem', obrigatorio: true },
    { nome: 'despesa_id', tipo: 'ref', ref: 'despesa_transporte', rotulo: 'Despesa', obrigatorio: true, lista: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição', max: 200, lista: true },
    { nome: 'quantidade', tipo: 'decimal', casas: 3, rotulo: 'Quantidade', obrigatorio: true, padrao: 1, lista: true },
    { nome: 'valor_unitario', tipo: 'moeda', rotulo: 'Valor unitário (R$)', obrigatorio: true, lista: true },
    { nome: 'valor_total', tipo: 'moeda', rotulo: 'Valor total (R$)', lista: true, somenteLeitura: true },
    { nome: 'documento', tipo: 'texto', rotulo: 'Documento fiscal', max: 40 },
  ],
});
