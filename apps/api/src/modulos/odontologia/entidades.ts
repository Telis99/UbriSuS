// Prontuário odontológico (TR 1.2.34): faces e situações dentárias, procedimentos odontológicos
// pré-cadastrados com mapeamento para o SIGTAP, marcações do odontograma (dente, face, arcada,
// quadrante, sextante e boca), plano de tratamento com etapas e dados e-SUS do atendimento.
import { campoAtivo, campoCodigo, campoNome, definirEntidade } from '../../meta/registro.js';

const ODO = 'ODO';

export const MARCACOES: [string, string][] = [
  ['DENTE', 'Dente'],
  ['FACE', 'Face do dente'],
  ['ARCADA', 'Arcada'],
  ['QUADRANTE', 'Quadrante'],
  ['SEXTANTE', 'Sextante'],
  ['BOCA', 'Boca toda'],
];

export const DENTICOES: [string, string][] = [
  ['PERMANENTE', 'Permanente (adulto)'],
  ['DECIDUA', 'Decídua (infantil)'],
  ['MISTA', 'Mista'],
];

export const STATUS_MARCACAO: [string, string][] = [
  ['EXISTENTE', 'Situação registrada'],
  ['PLANEJADO', 'Planejado'],
  ['EXECUTADO', 'Executado'],
  ['CANCELADO', 'Cancelado'],
];

export const COMPONENTES_CPO: [string, string][] = [
  ['C', 'Cariado (C / c)'],
  ['P', 'Perdido (P)'],
  ['EI', 'Extração indicada (e)'],
  ['O', 'Obturado (O / o)'],
  ['H', 'Hígido'],
  ['N', 'Não se aplica'],
];

/** Regra de aplicação do item SIGTAP conforme o tipo do dente (escolha automática do código). */
export const APLICACAO_ITEM: [string, string][] = [
  ['TODOS', 'Todos os dentes'],
  ['DECIDUO', 'Dente decíduo'],
  ['PERMANENTE', 'Dente permanente'],
  ['PERMANENTE_ANTERIOR', 'Permanente anterior'],
  ['PERMANENTE_POSTERIOR', 'Permanente posterior'],
  ['UNIRRADICULAR', 'Permanente unirradicular'],
  ['BIRRADICULAR', 'Permanente birradicular'],
  ['MULTIRRADICULAR', 'Permanente com três ou mais raízes'],
];

// Tipo de consulta odontológica da Ficha de Atendimento Odontológico (e-SUS APS).
export const TIPOS_CONSULTA: [string, string][] = [
  ['PRIMEIRA_PROGRAMATICA', 'Primeira consulta odontológica programática'],
  ['RETORNO', 'Consulta de retorno em odontologia'],
  ['MANUTENCAO', 'Consulta de manutenção em odontologia'],
  ['NAO_SE_APLICA', 'Não se aplica (urgência / demanda espontânea)'],
];

// Tipo de atendimento conforme SIA/e-SUS (gravado em amb.atendimento.tipo_atendimento_sia).
export const TIPOS_ATENDIMENTO_SIA: [string, string][] = [
  ['01', 'Consulta agendada'],
  ['02', 'Demanda espontânea - consulta no dia'],
  ['03', 'Demanda espontânea - atendimento de urgência'],
  ['04', 'Escuta inicial / orientação'],
];

// Vigilância em saúde bucal da FAO (TR 1.2.34.35.1 a 1.2.34.35.6).
export const VIGILANCIA_SAUDE_BUCAL: [string, string][] = [
  ['ABSCESSO_DENTOALVEOLAR', 'Abscesso dentoalveolar'],
  ['ALTERACAO_TECIDOS_MOLES', 'Alteração em tecidos moles'],
  ['DOR_DENTE', 'Dor de dente'],
  ['FENDAS_FISSURAS', 'Fendas ou fissuras lábio-palatais'],
  ['FLUOROSE', 'Fluorose dentária moderada ou severa'],
  ['TRAUMATISMO', 'Traumatismo dentoalveolar'],
  ['NAO_IDENTIFICADO', 'Não identificado'],
];

// Fornecimento de material odontológico (TR 1.2.34.36, 1.2.34.37).
export const MATERIAIS_ODONTO: [string, string][] = [
  ['ESCOVA', 'Escova dental'],
  ['CREME', 'Creme dental'],
  ['FIO', 'Fio dental'],
];

// Conduta / desfecho e encaminhamentos da FAO (e-SUS APS).
export const CONDUTAS: [string, string][] = [
  ['RETORNO_AGENDADO', 'Retorno para consulta agendada'],
  ['AGENDAMENTO_OUTROS_PROF', 'Agendamento para outros profissionais da AB'],
  ['AGENDAMENTO_GRUPOS', 'Agendamento para grupos'],
  ['TRATAMENTO_CONCLUIDO', 'Tratamento concluído'],
  ['ALTA_EPISODIO', 'Alta do episódio'],
  ['ENC_PNE', 'Encaminhamento: pacientes com necessidades especiais'],
  ['ENC_CIRURGIA_BMF', 'Encaminhamento: cirurgia BMF'],
  ['ENC_ENDODONTIA', 'Encaminhamento: endodontia'],
  ['ENC_ESTOMATOLOGIA', 'Encaminhamento: estomatologia'],
  ['ENC_IMPLANTODONTIA', 'Encaminhamento: implantodontia'],
  ['ENC_ODONTOPEDIATRIA', 'Encaminhamento: odontopediatria'],
  ['ENC_ORTODONTIA', 'Encaminhamento: ortodontia / ortopedia'],
  ['ENC_PERIODONTIA', 'Encaminhamento: periodontia'],
  ['ENC_PROTESE', 'Encaminhamento: prótese dentária'],
  ['ENC_RADIOLOGIA', 'Encaminhamento: radiologia'],
  ['ENC_OUTROS', 'Encaminhamento: outros'],
];

definirEntidade({
  nome: 'odo_face',
  tabela: 'odo.face',
  titulo: 'Faces dentárias',
  tituloSingular: 'Face dentária',
  modulo: ODO,
  menu: 'Odontologia/Configuração',
  rotulo: ['nome'],
  ordemPadrao: 'ordem',
  tr: ['1.2.34.26'],
  campos: [
    campoCodigo(2, { obrigatorio: true, unico: true, maiusculo: true }),
    campoNome(40),
    { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem', lista: true },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'odo_situacao',
  tabela: 'odo.situacao',
  titulo: 'Situações dentárias (odontograma)',
  tituloSingular: 'Situação dentária',
  modulo: ODO,
  menu: 'Odontologia/Configuração',
  rotulo: ['codigo', 'nome'],
  ordemPadrao: 'ordem',
  tr: ['1.2.34.26'],
  campos: [
    campoCodigo(4, { obrigatorio: true, unico: true, maiusculo: true }),
    campoNome(80),
    {
      nome: 'abrangencia',
      tipo: 'opcao',
      rotulo: 'Aplica-se a',
      obrigatorio: true,
      lista: true,
      opcoes: [['FACE', 'Face do dente'], ['DENTE', 'Dente inteiro']],
      padrao: 'DENTE',
    },
    { nome: 'cor', tipo: 'cor', rotulo: 'Cor no odontograma', obrigatorio: true, lista: true },
    { nome: 'simbolo', tipo: 'texto', rotulo: 'Símbolo', max: 3, lista: true, ajuda: 'Sigla exibida sobre o dente (ex.: X para ausente)' },
    { nome: 'componente_cpo', tipo: 'opcao', rotulo: 'Componente do CPO-D / ceo-d', opcoes: COMPONENTES_CPO, padrao: 'N', lista: true },
    { nome: 'necessita_tratamento', tipo: 'booleano', rotulo: 'Indica necessidade de tratamento', padrao: false },
    { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem' },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'odo_procedimento',
  tabela: 'odo.procedimento',
  titulo: 'Procedimentos odontológicos',
  tituloSingular: 'Procedimento odontológico',
  modulo: ODO,
  menu: 'Odontologia/Configuração',
  rotulo: ['nome'],
  ordemPadrao: 'ordem, nome',
  tr: ['1.2.34.29', '1.2.34.30'],
  descricao: 'Procedimentos selecionáveis ao clicar no odontograma; cada um gera automaticamente os procedimentos SIGTAP relacionados.',
  campos: [
    campoNome(100, { unico: true }),
    { nome: 'marcacao', tipo: 'opcao', rotulo: 'Tipo de marcação', obrigatorio: true, lista: true, opcoes: MARCACOES, padrao: 'DENTE' },
    { nome: 'denticao', tipo: 'opcao', rotulo: 'Dentição', lista: true, opcoes: [['AMBAS', 'Permanente e decídua'], ['PERMANENTE', 'Somente permanente'], ['DECIDUA', 'Somente decídua']], padrao: 'AMBAS' },
    { nome: 'situacao_resultante_id', tipo: 'ref', ref: 'odo_situacao', rotulo: 'Situação do dente após a execução' },
    { nome: 'cor', tipo: 'cor', rotulo: 'Cor' },
    { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem' },
    campoAtivo,
  ],
  filhos: [{ entidade: 'odo_procedimento_item', campo: 'procedimento_odonto_id', titulo: 'Procedimentos SIGTAP gerados' }],
});

definirEntidade({
  nome: 'odo_procedimento_item',
  tabela: 'odo.procedimento_item',
  titulo: 'Procedimentos SIGTAP do procedimento odontológico',
  tituloSingular: 'Procedimento SIGTAP',
  modulo: ODO,
  permissao: 'odo_procedimento',
  rotulo: ['procedimento_id'],
  tr: ['1.2.34.29'],
  campos: [
    { nome: 'procedimento_odonto_id', tipo: 'ref', ref: 'odo_procedimento', rotulo: 'Procedimento odontológico', obrigatorio: true },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento SIGTAP', obrigatorio: true, lista: true },
    { nome: 'aplica_a', tipo: 'opcao', rotulo: 'Aplicar quando o dente for', opcoes: APLICACAO_ITEM, padrao: 'TODOS', lista: true },
    { nome: 'quantidade', tipo: 'inteiro', rotulo: 'Quantidade', padrao: 1, lista: true },
    { nome: 'por_elemento', tipo: 'booleano', rotulo: 'Multiplicar pelo número de dentes/sextantes', padrao: true, lista: true },
  ],
});

definirEntidade({
  nome: 'odo_grupo_atendimento',
  tabela: 'odo.grupo_atendimento',
  titulo: 'Grupos de atendimento (SIA)',
  tituloSingular: 'Grupo de atendimento',
  modulo: ODO,
  menu: 'Odontologia/Configuração',
  rotulo: ['codigo', 'nome'],
  ordemPadrao: 'codigo',
  tr: ['1.2.34.31'],
  campos: [campoCodigo(4, { obrigatorio: true, unico: true }), campoNome(100), campoAtivo],
});

definirEntidade({
  nome: 'odo_plano',
  tabela: 'odo.plano_tratamento',
  titulo: 'Planos de tratamento odontológico',
  tituloSingular: 'Plano de tratamento',
  modulo: ODO,
  menu: 'Odontologia',
  rotulo: ['paciente_id', 'data_inicio'],
  ordemPadrao: 'data_inicio desc',
  tr: ['1.2.34.40'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true, busca: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', lista: true },
    { nome: 'atendimento_id', tipo: 'ref', ref: 'atendimento', rotulo: 'Atendimento de origem', somenteLeitura: true },
    { nome: 'data_inicio', tipo: 'data', rotulo: 'Início', obrigatorio: true, lista: true },
    { nome: 'primeira_consulta', tipo: 'booleano', rotulo: 'Iniciado em primeira consulta odontológica programática', padrao: false, lista: true },
    {
      nome: 'situacao',
      tipo: 'opcao',
      rotulo: 'Situação',
      lista: true,
      opcoes: [['EM_ANDAMENTO', 'Em andamento'], ['CONCLUIDO', 'Tratamento concluído'], ['INTERROMPIDO', 'Interrompido']],
      padrao: 'EM_ANDAMENTO',
    },
    { nome: 'data_conclusao', tipo: 'data', rotulo: 'Conclusão', lista: true },
    { nome: 'atendimento_conclusao_id', tipo: 'ref', ref: 'atendimento', rotulo: 'Atendimento de conclusão', somenteLeitura: true },
    { nome: 'motivo_interrupcao', tipo: 'texto', rotulo: 'Motivo da interrupção', max: 250 },
    { nome: 'observacao', tipo: 'texto_longo', rotulo: 'Observações' },
  ],
  filhos: [{ entidade: 'odo_plano_etapa', campo: 'plano_id', titulo: 'Etapas' }],
});

definirEntidade({
  nome: 'odo_plano_etapa',
  tabela: 'odo.plano_etapa',
  titulo: 'Etapas do plano de tratamento',
  tituloSingular: 'Etapa',
  modulo: ODO,
  permissao: 'odo_plano',
  rotulo: ['ordem', 'descricao'],
  ordemPadrao: 'ordem',
  campos: [
    { nome: 'plano_id', tipo: 'ref', ref: 'odo_plano', rotulo: 'Plano', obrigatorio: true },
    { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem', obrigatorio: true, lista: true },
    { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição', max: 200, obrigatorio: true, lista: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', lista: true, opcoes: [['PENDENTE', 'Pendente'], ['CONCLUIDA', 'Concluída']], padrao: 'PENDENTE' },
    { nome: 'concluida_em', tipo: 'data', rotulo: 'Concluída em', lista: true },
  ],
});

definirEntidade({
  nome: 'odo_marcacao',
  tabela: 'odo.marcacao',
  titulo: 'Odontograma (marcações e evolução)',
  tituloSingular: 'Marcação do odontograma',
  modulo: ODO,
  rotulo: ['dente', 'data'],
  ordemPadrao: 'data desc, id desc',
  tr: ['1.2.34.26', '1.2.34.28', '1.2.34.40'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    { nome: 'atendimento_id', tipo: 'ref', ref: 'atendimento', rotulo: 'Atendimento do registro' },
    { nome: 'plano_id', tipo: 'ref', ref: 'odo_plano', rotulo: 'Plano de tratamento' },
    { nome: 'etapa_id', tipo: 'ref', ref: 'odo_plano_etapa', rotulo: 'Etapa' },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade' },
    { nome: 'marcacao', tipo: 'opcao', rotulo: 'Tipo de marcação', obrigatorio: true, opcoes: MARCACOES, lista: true },
    { nome: 'dente', tipo: 'inteiro', rotulo: 'Dente (FDI)', lista: true },
    { nome: 'faces', tipo: 'multi_opcao', rotulo: 'Faces', opcoes: [['M', 'Mesial'], ['D', 'Distal'], ['O', 'Oclusal/incisal'], ['V', 'Vestibular'], ['L', 'Lingual/palatina']] },
    { nome: 'arcada', tipo: 'opcao', rotulo: 'Arcada', opcoes: [['SUPERIOR', 'Superior'], ['INFERIOR', 'Inferior']] },
    { nome: 'quadrante', tipo: 'inteiro', rotulo: 'Quadrante' },
    { nome: 'sextante', tipo: 'inteiro', rotulo: 'Sextante' },
    { nome: 'situacao_id', tipo: 'ref', ref: 'odo_situacao', rotulo: 'Situação', lista: true },
    { nome: 'procedimento_odonto_id', tipo: 'ref', ref: 'odo_procedimento', rotulo: 'Procedimento', lista: true },
    { nome: 'status', tipo: 'opcao', rotulo: 'Status', obrigatorio: true, opcoes: STATUS_MARCACAO, lista: true },
    { nome: 'executado_em', tipo: 'data_hora', rotulo: 'Executado em' },
    { nome: 'executado_atendimento_id', tipo: 'ref', ref: 'atendimento', rotulo: 'Atendimento da execução' },
    { nome: 'executado_profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional executante' },
    { nome: 'producao', tipo: 'json', rotulo: 'Produção lançada (ids)', oculto: true },
    { nome: 'observacao', tipo: 'texto_longo', rotulo: 'Observação' },
    { nome: 'motivo_cancelamento', tipo: 'texto', rotulo: 'Motivo do cancelamento', max: 250 },
  ],
});

definirEntidade({
  nome: 'odo_atendimento',
  tabela: 'odo.atendimento_odonto',
  titulo: 'Atendimentos odontológicos (FAO)',
  tituloSingular: 'Atendimento odontológico',
  modulo: ODO,
  rotulo: ['atendimento_id'],
  ordemPadrao: 'id desc',
  tr: ['1.2.34.31', '1.2.34.35', '1.2.34.36', '1.2.34.40'],
  campos: [
    { nome: 'atendimento_id', tipo: 'ref', ref: 'atendimento', rotulo: 'Atendimento', obrigatorio: true, unico: true, lista: true },
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    { nome: 'tipo_consulta', tipo: 'opcao', rotulo: 'Tipo de consulta', opcoes: TIPOS_CONSULTA, lista: true },
    { nome: 'grupo_atendimento_id', tipo: 'ref', ref: 'odo_grupo_atendimento', rotulo: 'Grupo de atendimento (SIA)' },
    { nome: 'denticao', tipo: 'opcao', rotulo: 'Dentição', opcoes: DENTICOES },
    { nome: 'gestante', tipo: 'booleano', rotulo: 'Gestante', padrao: false },
    { nome: 'necessidades_especiais', tipo: 'booleano', rotulo: 'Paciente com necessidades especiais', padrao: false },
    { nome: 'condutas', tipo: 'multi_opcao', rotulo: 'Conduta / desfecho', opcoes: CONDUTAS },
    { nome: 'materiais_baixados', tipo: 'json', rotulo: 'Baixas de estoque dos materiais', oculto: true },
    { nome: 'observacao', tipo: 'texto_longo', rotulo: 'Observação' },
  ],
});
