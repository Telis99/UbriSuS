// e-SUS AB (Atenção Primária): ações programáticas com inscrições, benefícios e eventos, reuniões de equipes
// multiprofissionais, fichas CDS sem equivalente nos demais módulos (atividade coletiva, marcadores de consumo
// alimentar, avaliação de elegibilidade e atendimento domiciliar), cadastro HIPERDIA, teleconsulta,
// envios à RNDS e controle das exportações LEDI (TR 1.2.36, 1.2.13.1.2 a 1.2.13.1.14, 1.2.13.1.37, 1.2.13.1.38).
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';

const ESUS = 'ESUS';
const TURNO: [string, string][] = [['1', 'Manhã'], ['2', 'Tarde'], ['3', 'Noite']];

// ---------------------------------------------------------------------------
// Ações programáticas (TR 1.2.36.1 a 1.2.36.9.4)
// ---------------------------------------------------------------------------
definirEntidade({
  nome: 'esus_acao',
  tabela: 'esus.acao_programatica',
  titulo: 'Ações programáticas',
  tituloSingular: 'Ação programática',
  modulo: ESUS,
  menu: 'e-SUS AB/Ações programáticas',
  rotulo: ['nome'],
  ordemPadrao: 'data_inicio desc',
  tr: ['1.2.36.1'],
  campos: [
    campoNome(120),
    { nome: 'descricao', tipo: 'texto_longo', rotulo: 'Descrição / público-alvo' },
    { nome: 'data_inicio', tipo: 'data', rotulo: 'Data de início', obrigatorio: true, lista: true },
    { nome: 'data_fim', tipo: 'data', rotulo: 'Data de término', lista: true },
    { nome: 'max_inscricoes', tipo: 'inteiro', rotulo: 'Quantidade máxima de inscrições', min: 1, lista: true },
    { nome: 'concede_beneficio', tipo: 'booleano', rotulo: 'Concede benefícios', padrao: false, lista: true },
    {
      nome: 'tipo_beneficio',
      tipo: 'opcao',
      rotulo: 'Tipo de benefício',
      lista: true,
      opcoes: [['LEITE', 'Leite / fórmula infantil'], ['CESTA', 'Cesta básica'], ['SUPLEMENTO', 'Suplemento alimentar'], ['FRALDA', 'Fraldas'], ['TRANSPORTE', 'Vale-transporte'], ['MEDICAMENTO', 'Medicamento / insumo'], ['KIT', 'Kit (gestante, bebê, higiene)'], ['OUTRO', 'Outro']],
    },
    campoAtivo,
  ],
  filhos: [
    { entidade: 'esus_acao_local', campo: 'acao_id', titulo: 'Locais de atendimento' },
    { entidade: 'esus_acao_procedimento', campo: 'acao_id', titulo: 'Procedimentos / subsídios e periodicidade' },
    { entidade: 'esus_acao_evento', campo: 'acao_id', titulo: 'Eventos e periodicidade' },
    { entidade: 'esus_inscricao', campo: 'acao_id', titulo: 'Inscrições' },
  ],
});

definirEntidade({
  nome: 'esus_acao_local',
  tabela: 'esus.acao_local',
  titulo: 'Locais de atendimento da ação programática',
  tituloSingular: 'Local da ação programática',
  modulo: ESUS,
  permissao: 'esus_acao',
  rotulo: ['unidade_id'],
  unicos: [['acao_id', 'unidade_id']],
  tr: ['1.2.36.2'],
  campos: [
    { nome: 'acao_id', tipo: 'ref', ref: 'esus_acao', rotulo: 'Ação programática', obrigatorio: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Local de atendimento (unidade)', obrigatorio: true, lista: true },
    { nome: 'observacao', tipo: 'texto', rotulo: 'Sala / horário de atendimento', max: 120, lista: true },
  ],
});

definirEntidade({
  nome: 'esus_acao_procedimento',
  tabela: 'esus.acao_procedimento',
  titulo: 'Procedimentos e subsídios da ação programática',
  tituloSingular: 'Procedimento / subsídio',
  modulo: ESUS,
  permissao: 'esus_acao',
  rotulo: ['descricao'],
  tr: ['1.2.36.3'],
  campos: [
    { nome: 'acao_id', tipo: 'ref', ref: 'esus_acao', rotulo: 'Ação programática', obrigatorio: true },
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', opcoes: [['PROCEDIMENTO', 'Procedimento'], ['SUBSIDIO', 'Subsídio / benefício']], obrigatorio: true, padrao: 'PROCEDIMENTO', lista: true },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento (SIGTAP)', lista: true },
    { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição do subsídio', max: 120, lista: true },
    { nome: 'quantidade', tipo: 'decimal', casas: 2, rotulo: 'Quantidade por concessão', padrao: 1, lista: true },
    { nome: 'periodicidade_dias', tipo: 'inteiro', rotulo: 'Periodicidade (dias)', obrigatorio: true, min: 1, lista: true },
  ],
});

definirEntidade({
  nome: 'esus_acao_evento',
  tabela: 'esus.acao_evento',
  titulo: 'Eventos da ação programática',
  tituloSingular: 'Evento',
  modulo: ESUS,
  permissao: 'esus_acao',
  rotulo: ['nome'],
  tr: ['1.2.36.4'],
  campos: [
    { nome: 'acao_id', tipo: 'ref', ref: 'esus_acao', rotulo: 'Ação programática', obrigatorio: true },
    campoNome(100, { rotulo: 'Evento (consulta, grupo, pesagem, palestra...)' }),
    { nome: 'periodicidade_dias', tipo: 'inteiro', rotulo: 'Periodicidade (dias)', obrigatorio: true, min: 1, lista: true },
    { nome: 'prazo_dias', tipo: 'inteiro', rotulo: 'Prazo de tolerância (dias)', padrao: 7, lista: true },
    { nome: 'obrigatorio', tipo: 'booleano', rotulo: 'Obrigatório para manter o benefício', padrao: true, lista: true },
  ],
});

definirEntidade({
  nome: 'esus_inscricao',
  tabela: 'esus.inscricao',
  titulo: 'Inscrições em ações programáticas',
  tituloSingular: 'Inscrição',
  modulo: ESUS,
  menu: 'e-SUS AB/Ações programáticas',
  rotulo: ['paciente_id', 'acao_id'],
  ordemPadrao: 'data_inicial desc',
  unicos: [['acao_id', 'paciente_id', 'data_inicial']],
  tr: ['1.2.36.5', '1.2.36.6', '1.2.36.7', '1.2.36.8', '1.2.36.9'],
  campos: [
    { nome: 'acao_id', tipo: 'ref', ref: 'esus_acao', rotulo: 'Ação programática', obrigatorio: true, lista: true },
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Cidadão', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Local de atendimento', lista: true },
    { nome: 'data_inicial', tipo: 'data', rotulo: 'Data inicial', obrigatorio: true, lista: true },
    { nome: 'data_final', tipo: 'data', rotulo: 'Data final', lista: true },
    { nome: 'recebe_beneficio', tipo: 'booleano', rotulo: 'Recebe benefícios', padrao: false, lista: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['ATIVO', 'Ativo'], ['DESISTENTE', 'Desistente'], ['DESLIGADO', 'Desligado']], padrao: 'ATIVO', lista: true },
    { nome: 'motivo', tipo: 'texto', rotulo: 'Motivo (desistência / desligamento)', max: 250 },
  ],
  filhos: [
    { entidade: 'esus_inscricao_evento', campo: 'inscricao_id', titulo: 'Eventos, frequência e prazos' },
    { entidade: 'esus_inscricao_beneficio', campo: 'inscricao_id', titulo: 'Benefícios concedidos' },
  ],
});

definirEntidade({
  nome: 'esus_inscricao_beneficio',
  tabela: 'esus.inscricao_beneficio',
  titulo: 'Benefícios concedidos',
  tituloSingular: 'Benefício concedido',
  modulo: ESUS,
  permissao: 'esus_inscricao',
  rotulo: ['data', 'descricao'],
  ordemPadrao: 'data desc',
  tr: ['1.2.36.9.1'],
  campos: [
    { nome: 'inscricao_id', tipo: 'ref', ref: 'esus_inscricao', rotulo: 'Inscrição', obrigatorio: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data da concessão', obrigatorio: true, lista: true },
    { nome: 'acao_procedimento_id', tipo: 'ref', ref: 'esus_acao_procedimento', rotulo: 'Subsídio / procedimento', lista: true },
    { nome: 'descricao', tipo: 'texto', rotulo: 'Benefício', max: 120, lista: true },
    { nome: 'quantidade', tipo: 'decimal', casas: 2, rotulo: 'Quantidade', padrao: 1, lista: true },
    { nome: 'proxima_concessao', tipo: 'data', rotulo: 'Próxima concessão prevista', somenteLeitura: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Responsável' },
  ],
});

definirEntidade({
  nome: 'esus_inscricao_evento',
  tabela: 'esus.inscricao_evento',
  titulo: 'Eventos previstos da inscrição',
  tituloSingular: 'Evento previsto',
  modulo: ESUS,
  permissao: 'esus_inscricao',
  rotulo: ['nome', 'data_prevista'],
  ordemPadrao: 'data_prevista',
  tr: ['1.2.36.9.2', '1.2.36.9.3', '1.2.36.9.4'],
  campos: [
    { nome: 'inscricao_id', tipo: 'ref', ref: 'esus_inscricao', rotulo: 'Inscrição', obrigatorio: true },
    { nome: 'evento_id', tipo: 'ref', ref: 'esus_acao_evento', rotulo: 'Evento da ação' },
    { nome: 'nome', tipo: 'texto', rotulo: 'Evento', max: 100, obrigatorio: true, lista: true },
    { nome: 'frequencia_dias', tipo: 'inteiro', rotulo: 'Frequência (dias)', lista: true },
    { nome: 'data_prevista', tipo: 'data', rotulo: 'Data prevista', obrigatorio: true, lista: true },
    { nome: 'prazo_limite', tipo: 'data', rotulo: 'Prazo limite', lista: true },
    { nome: 'data_realizacao', tipo: 'data', rotulo: 'Realizado em', lista: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['PREVISTO', 'Previsto'], ['REALIZADO', 'Realizado'], ['FALTOU', 'Não compareceu'], ['CANCELADO', 'Cancelado']], padrao: 'PREVISTO', lista: true },
  ],
});

// ---------------------------------------------------------------------------
// Reuniões de equipes multiprofissionais (TR 1.2.36.13)
// ---------------------------------------------------------------------------
definirEntidade({
  nome: 'esus_reuniao',
  tabela: 'esus.reuniao',
  titulo: 'Reuniões de equipes multiprofissionais',
  tituloSingular: 'Reunião de equipe',
  modulo: ESUS,
  menu: 'e-SUS AB',
  rotulo: ['data', 'tipo'],
  ordemPadrao: 'data desc',
  tr: ['1.2.36.13'],
  campos: [
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    { nome: 'equipe', tipo: 'texto', rotulo: 'Equipe (INE / nome)', max: 60, lista: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'hora_inicio', tipo: 'hora', rotulo: 'Início', obrigatorio: true, lista: true },
    { nome: 'hora_fim', tipo: 'hora', rotulo: 'Término' },
    { nome: 'local', tipo: 'texto', rotulo: 'Local', max: 80 },
    {
      nome: 'tipo',
      tipo: 'opcao',
      rotulo: 'Tipo',
      obrigatorio: true,
      padrao: '01',
      lista: true,
      opcoes: [['01', 'Reunião de equipe'], ['02', 'Reunião com outras equipes de saúde'], ['03', 'Reunião intersetorial / conselho local'], ['08', 'Discussão de caso / matriciamento'], ['09', 'Educação permanente']],
    },
    { nome: 'pauta', tipo: 'texto_longo', rotulo: 'Pauta' },
    { nome: 'participantes', tipo: 'json', rotulo: 'Participantes (profissionais)', oculto: true },
    { nome: 'ata', tipo: 'texto_longo', rotulo: 'Ata / registro da reunião' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['AGENDADA', 'Agendada'], ['REALIZADA', 'Realizada'], ['CANCELADA', 'Cancelada']], padrao: 'AGENDADA', lista: true },
  ],
});

// ---------------------------------------------------------------------------
// Fichas CDS (TR 1.2.13.1.6, 1.2.13.1.12, 1.2.13.1.13, 1.2.13.1.14)
// ---------------------------------------------------------------------------
definirEntidade({
  nome: 'esus_atividade_coletiva',
  tabela: 'esus.atividade_coletiva',
  titulo: 'Fichas de atividade coletiva',
  tituloSingular: 'Atividade coletiva',
  modulo: ESUS,
  menu: 'e-SUS AB/Fichas CDS',
  rotulo: ['data', 'tema'],
  ordemPadrao: 'data desc',
  tr: ['1.2.13.1.6'],
  campos: [
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional responsável', obrigatorio: true, lista: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'turno', tipo: 'opcao', rotulo: 'Turno', opcoes: TURNO, padrao: '1' },
    {
      nome: 'tipo_atividade',
      tipo: 'opcao',
      rotulo: 'Atividade',
      obrigatorio: true,
      padrao: '04',
      lista: true,
      opcoes: [['01', 'Reunião de equipe'], ['02', 'Reunião com outras equipes'], ['03', 'Reunião intersetorial'], ['04', 'Educação em saúde'], ['05', 'Atendimento em grupo'], ['06', 'Avaliação / procedimento coletivo'], ['07', 'Mobilização social']],
    },
    { nome: 'tema', tipo: 'texto', rotulo: 'Tema', max: 120, lista: true },
    {
      nome: 'publico',
      tipo: 'multi_opcao',
      rotulo: 'Público-alvo',
      opcoes: [['1', 'Comunidade em geral'], ['2', 'Criança 0 a 3 anos'], ['3', 'Criança 4 a 5 anos'], ['4', 'Criança 6 a 11 anos'], ['5', 'Adolescente'], ['6', 'Mulher'], ['7', 'Gestante'], ['8', 'Homem'], ['9', 'Familiares'], ['10', 'Idoso'], ['12', 'Pessoas com doenças crônicas'], ['13', 'Usuário de tabaco'], ['14', 'Usuário de álcool'], ['15', 'Usuário de outras drogas'], ['16', 'Pessoas com sofrimento mental'], ['17', 'Profissional de educação'], ['18', 'Outros']],
    },
    { nome: 'local', tipo: 'texto', rotulo: 'Local (escola INEP ou outro)', max: 120 },
    { nome: 'inep', tipo: 'texto', rotulo: 'Código INEP da escola (PSE)', max: 8 },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento coletivo (SIGTAP)' },
    { nome: 'participantes', tipo: 'inteiro', rotulo: 'Nº de participantes', min: 0, lista: true },
    { nome: 'participantes_ids', tipo: 'json', rotulo: 'Participantes identificados', oculto: true },
    { nome: 'avaliacoes_alteradas', tipo: 'inteiro', rotulo: 'Nº de avaliações alteradas', min: 0 },
    { nome: 'observacao', tipo: 'texto_longo', rotulo: 'Observação' },
  ],
});

definirEntidade({
  nome: 'esus_marcador_consumo',
  tabela: 'esus.marcador_consumo',
  titulo: 'Marcadores de consumo alimentar',
  tituloSingular: 'Marcadores de consumo alimentar',
  modulo: ESUS,
  menu: 'e-SUS AB/Fichas CDS',
  rotulo: ['data', 'paciente_id'],
  ordemPadrao: 'data desc',
  tr: ['1.2.13.1.12'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Cidadão', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', obrigatorio: true, lista: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'local_atendimento', tipo: 'opcao', rotulo: 'Local de atendimento', opcoes: [['1', 'UBS'], ['4', 'Domicílio'], ['5', 'Escola / creche'], ['6', 'Outros']], padrao: '1' },
    { nome: 'faixa', tipo: 'opcao', rotulo: 'Faixa etária do questionário', opcoes: [['MENOR6M', 'Menor de 6 meses'], ['6A23M', '6 a 23 meses'], ['2MAIS', '2 anos ou mais']], obrigatorio: true, lista: true },
    { nome: 'refeicoes_tv', tipo: 'opcao', rotulo: 'Costuma realizar as refeições assistindo TV, celular ou computador?', opcoes: [['1', 'Sim'], ['2', 'Não'], ['3', 'Não sabe']] },
    { nome: 'refeicoes', tipo: 'multi_opcao', rotulo: 'Refeições que faz ao longo do dia', opcoes: [['1', 'Café da manhã'], ['2', 'Lanche da manhã'], ['3', 'Almoço'], ['4', 'Lanche da tarde'], ['5', 'Jantar'], ['6', 'Ceia']] },
    {
      nome: 'consumo_ontem',
      tipo: 'multi_opcao',
      rotulo: 'Ontem consumiu',
      opcoes: [['FEIJAO', 'Feijão'], ['FRUTAS', 'Frutas frescas'], ['VERDURAS', 'Verduras e/ou legumes'], ['EMBUTIDOS', 'Hambúrguer e/ou embutidos'], ['BEBIDAS_ADOCADAS', 'Bebidas adoçadas'], ['MACARRAO_INSTANTANEO', 'Macarrão instantâneo, salgadinhos ou biscoitos salgados'], ['BISCOITO_RECHEADO', 'Biscoito recheado, doces ou guloseimas'], ['LEITE_PEITO', 'Leite do peito'], ['MINGAU', 'Mingau com leite'], ['OUTRO_LEITE', 'Outro leite'], ['AGUA_CHA', 'Água / chá'], ['FRUTA_INTEIRA', 'Fruta inteira, em pedaço ou amassada'], ['COMIDA_SAL', 'Comida de sal (de panela, papa ou sopa)'], ['OVO', 'Ovo'], ['CARNE', 'Carne ou ovo'], ['FIGADO', 'Fígado'], ['ABOBORA', 'Abóbora, cenoura, batata-doce ou couve'], ['IOGURTE', 'Iogurte']],
    },
  ],
});

definirEntidade({
  nome: 'esus_elegibilidade',
  tabela: 'esus.elegibilidade',
  titulo: 'Avaliações de elegibilidade e admissão (atenção domiciliar)',
  tituloSingular: 'Avaliação de elegibilidade',
  modulo: ESUS,
  menu: 'e-SUS AB/Fichas CDS',
  rotulo: ['data', 'paciente_id'],
  ordemPadrao: 'data desc',
  tr: ['1.2.13.1.13'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Cidadão', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Serviço de atenção domiciliar', obrigatorio: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', obrigatorio: true, lista: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'turno', tipo: 'opcao', rotulo: 'Turno', opcoes: TURNO, padrao: '1' },
    { nome: 'procedencia', tipo: 'opcao', rotulo: 'Procedência', opcoes: [['1', 'Atenção básica'], ['2', 'Serviço de urgência/emergência'], ['3', 'Serviço de internação hospitalar'], ['4', 'Atenção especializada'], ['5', 'Iniciativa do paciente / família'], ['6', 'Outros']], padrao: '1' },
    { nome: 'condicoes', tipo: 'multi_opcao', rotulo: 'Condições avaliadas', opcoes: [['ACAMADO', 'Acamado'], ['DOMICILIADO', 'Domiciliado'], ['ULCERA', 'Úlceras / feridas'], ['NUTRICAO_ENTERAL', 'Nutrição enteral / parenteral'], ['OXIGENOTERAPIA', 'Oxigenoterapia'], ['VENTILACAO', 'Suporte ventilatório'], ['PALIATIVOS', 'Cuidados paliativos'], ['POS_OPERATORIO', 'Pós-operatório'], ['MEDICACAO_PARENTERAL', 'Medicação parenteral'], ['REABILITACAO', 'Reabilitação domiciliar']] },
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'CID-10 principal' },
    { nome: 'conclusao', tipo: 'opcao', rotulo: 'Conclusão', opcoes: [['ELEGIVEL', 'Elegível - admitido'], ['INELEGIVEL', 'Inelegível']], obrigatorio: true, lista: true },
    { nome: 'modalidade', tipo: 'opcao', rotulo: 'Modalidade', opcoes: [['AD1', 'AD1'], ['AD2', 'AD2'], ['AD3', 'AD3']], lista: true },
    { nome: 'motivo_inelegibilidade', tipo: 'opcao', rotulo: 'Motivo da inelegibilidade', opcoes: [['1', 'Instabilidade clínica'], ['2', 'Necessidade de monitorização contínua'], ['3', 'Ausência de cuidador'], ['4', 'Outros']] },
    { nome: 'cuidador', tipo: 'texto', rotulo: 'Cuidador', max: 70 },
    { nome: 'cuidador_relacao', tipo: 'opcao', rotulo: 'Relação do cuidador', opcoes: [['1', 'Cônjuge'], ['2', 'Filho(a)'], ['3', 'Pai/mãe'], ['4', 'Avô/avó'], ['5', 'Neto(a)'], ['6', 'Irmão(ã)'], ['7', 'Cuidador profissional'], ['8', 'Outro']] },
  ],
});

definirEntidade({
  nome: 'esus_atendimento_domiciliar',
  tabela: 'esus.atendimento_domiciliar',
  titulo: 'Fichas de atendimento domiciliar',
  tituloSingular: 'Atendimento domiciliar',
  modulo: ESUS,
  menu: 'e-SUS AB/Fichas CDS',
  rotulo: ['data', 'paciente_id'],
  ordemPadrao: 'data desc',
  tr: ['1.2.13.1.14'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Cidadão', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade / serviço', obrigatorio: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', obrigatorio: true, lista: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'turno', tipo: 'opcao', rotulo: 'Turno', opcoes: TURNO, padrao: '1' },
    { nome: 'modalidade', tipo: 'opcao', rotulo: 'Modalidade', opcoes: [['AD1', 'AD1'], ['AD2', 'AD2'], ['AD3', 'AD3']], obrigatorio: true, padrao: 'AD2', lista: true },
    { nome: 'tipo_atendimento', tipo: 'opcao', rotulo: 'Tipo de atendimento', opcoes: [['7', 'Atendimento programado'], ['8', 'Atendimento não programado'], ['9', 'Visita domiciliar pós-óbito']], padrao: '7', lista: true },
    { nome: 'condicoes', tipo: 'multi_opcao', rotulo: 'Condições avaliadas', opcoes: [['ACAMADO', 'Acamado'], ['DOMICILIADO', 'Domiciliado'], ['ULCERA', 'Úlceras / feridas'], ['NUTRICAO_ENTERAL', 'Nutrição enteral'], ['OXIGENOTERAPIA', 'Oxigenoterapia'], ['PALIATIVOS', 'Cuidados paliativos'], ['REABILITACAO', 'Reabilitação']] },
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'CID-10' },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento realizado (SIGTAP)' },
    { nome: 'conduta', tipo: 'opcao', rotulo: 'Conduta / desfecho', opcoes: [['1', 'Permanência'], ['2', 'Alta administrativa'], ['3', 'Alta clínica'], ['4', 'Óbito'], ['5', 'Encaminhado para atenção básica'], ['6', 'Encaminhado para urgência'], ['7', 'Internação hospitalar']], padrao: '1', lista: true },
    { nome: 'observacao', tipo: 'texto_longo', rotulo: 'Evolução' },
    { nome: 'raas_acao_id', tipo: 'ref', ref: 'raas_acao', rotulo: 'Ação RAAS-AD gerada', somenteLeitura: true },
  ],
});

// Cadastro HIPERDIA de hipertensos e diabéticos (TR 1.2.13.1.37).
definirEntidade({
  nome: 'esus_hiperdia',
  tabela: 'esus.hiperdia',
  titulo: 'Cadastro HIPERDIA (hipertensos e diabéticos)',
  tituloSingular: 'Cadastro HIPERDIA',
  modulo: ESUS,
  menu: 'e-SUS AB/HIPERDIA',
  rotulo: ['paciente_id', 'data'],
  ordemPadrao: 'data desc',
  unicos: [['paciente_id', 'data']],
  tr: ['1.2.13.1.37'],
  abas: ['Cadastro', 'Fatores de risco', 'Tratamento'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Cidadão', obrigatorio: true, lista: true, aba: 'Cadastro' },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true, aba: 'Cadastro' },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', aba: 'Cadastro' },
    { nome: 'data', tipo: 'data', rotulo: 'Data da consulta / cadastro', obrigatorio: true, lista: true, aba: 'Cadastro' },
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Condição', opcoes: [['HAS', 'Hipertensão'], ['DM1', 'Diabetes tipo 1'], ['DM2', 'Diabetes tipo 2'], ['HAS_DM1', 'Hipertensão + diabetes tipo 1'], ['HAS_DM2', 'Hipertensão + diabetes tipo 2']], obrigatorio: true, lista: true, aba: 'Cadastro' },
    { nome: 'pa_sistolica', tipo: 'inteiro', rotulo: 'PA sistólica', aba: 'Cadastro' },
    { nome: 'pa_diastolica', tipo: 'inteiro', rotulo: 'PA diastólica', aba: 'Cadastro' },
    { nome: 'glicemia', tipo: 'inteiro', rotulo: 'Glicemia (mg/dL)', aba: 'Cadastro' },
    { nome: 'glicemia_jejum', tipo: 'booleano', rotulo: 'Glicemia em jejum', padrao: true, aba: 'Cadastro' },
    { nome: 'peso', tipo: 'decimal', casas: 2, rotulo: 'Peso (kg)', aba: 'Cadastro' },
    { nome: 'altura', tipo: 'inteiro', rotulo: 'Altura (cm)', aba: 'Cadastro' },
    { nome: 'cintura', tipo: 'inteiro', rotulo: 'Cintura (cm)', aba: 'Cadastro' },
    {
      nome: 'fatores',
      tipo: 'multi_opcao',
      rotulo: 'Fatores de risco e doenças concomitantes',
      aba: 'Fatores de risco',
      opcoes: [['ANTECEDENTES', 'Antecedentes familiares cardiovasculares'], ['TABAGISMO', 'Tabagismo'], ['SEDENTARISMO', 'Sedentarismo'], ['SOBREPESO', 'Sobrepeso / obesidade'], ['INFARTO', 'Infarto agudo do miocárdio'], ['CORONARIOPATIA', 'Outras coronariopatias'], ['AVC', 'AVC'], ['PE_DIABETICO', 'Pé diabético'], ['AMPUTACAO', 'Amputação por diabetes'], ['DOENCA_RENAL', 'Doença renal']],
    },
    {
      nome: 'medicamentos',
      tipo: 'multi_opcao',
      rotulo: 'Tratamento medicamentoso',
      aba: 'Tratamento',
      opcoes: [['HIDROCLOROTIAZIDA', 'Hidroclorotiazida 25 mg'], ['PROPRANOLOL', 'Propranolol 40 mg'], ['CAPTOPRIL', 'Captopril 25 mg'], ['LOSARTANA', 'Losartana 50 mg'], ['GLIBENCLAMIDA', 'Glibenclamida 5 mg'], ['METFORMINA', 'Metformina 850 mg'], ['INSULINA', 'Insulina NPH'], ['OUTROS', 'Outros']],
    },
    { nome: 'nao_medicamentoso', tipo: 'booleano', rotulo: 'Tratamento não medicamentoso', padrao: true, aba: 'Tratamento' },
    { nome: 'origem', tipo: 'texto', rotulo: 'Origem', max: 40, somenteLeitura: true, lista: true, aba: 'Cadastro' },
    { nome: 'exportado_em', tipo: 'data_hora', rotulo: 'Exportado em', somenteLeitura: true, lista: true, aba: 'Cadastro' },
  ],
});

// Critérios dos indicadores de saúde (exame solicitado/realizado) (TR 1.2.36.12).
definirEntidade({
  nome: 'esus_indicador',
  tabela: 'esus.indicador',
  titulo: 'Critérios de indicadores de saúde (exames)',
  tituloSingular: 'Critério de indicador',
  modulo: ESUS,
  menu: 'e-SUS AB/Indicadores',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.36.12'],
  campos: [
    campoNome(120),
    { nome: 'publico', tipo: 'opcao', rotulo: 'Público', opcoes: [['DIABETICOS', 'Pessoas com diabetes'], ['HIPERTENSOS', 'Pessoas com hipertensão'], ['GESTANTES', 'Gestantes'], ['MULHERES_25_64', 'Mulheres de 25 a 64 anos'], ['MULHERES_50_69', 'Mulheres de 50 a 69 anos'], ['TODOS', 'Todos os cadastrados']], obrigatorio: true, lista: true },
    { nome: 'procedimentos', tipo: 'texto', rotulo: 'Códigos SIGTAP do exame (separados por vírgula)', max: 200, obrigatorio: true, lista: true },
    { nome: 'periodo_meses', tipo: 'inteiro', rotulo: 'Janela de avaliação (meses)', obrigatorio: true, padrao: 12, lista: true },
    campoAtivo,
  ],
});

// Teleconsulta (TR 1.2.36.11).
definirEntidade({
  nome: 'esus_teleconsulta',
  tabela: 'esus.teleconsulta',
  titulo: 'Teleconsultas',
  tituloSingular: 'Teleconsulta',
  modulo: ESUS,
  menu: 'e-SUS AB',
  rotulo: ['data_hora', 'paciente_id'],
  ordemPadrao: 'data_hora desc',
  tr: ['1.2.36.11'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    { nome: 'agendamento_id', tipo: 'ref', ref: 'agendamento', rotulo: 'Agendamento' },
    { nome: 'data_hora', tipo: 'data_hora', rotulo: 'Data e hora', obrigatorio: true, lista: true },
    { nome: 'modalidade', tipo: 'opcao', rotulo: 'Modalidade (Res. CFM 2.314/2022)', opcoes: [['TELECONSULTA', 'Teleconsulta'], ['TELEMONITORAMENTO', 'Telemonitoramento'], ['TELEINTERCONSULTA', 'Teleinterconsulta'], ['TELEORIENTACAO', 'Teleorientação']], padrao: 'TELECONSULTA', lista: true },
    { nome: 'sala', tipo: 'texto', rotulo: 'Sala virtual', max: 80, somenteLeitura: true },
    { nome: 'token', tipo: 'texto', rotulo: 'Chave de acesso do paciente', max: 64, unico: true, somenteLeitura: true, oculto: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['AGENDADA', 'Agendada'], ['EM_ANDAMENTO', 'Em andamento'], ['ENCERRADA', 'Encerrada'], ['CANCELADA', 'Cancelada']], padrao: 'AGENDADA', lista: true, somenteLeitura: true },
    { nome: 'consentimento_em', tipo: 'data_hora', rotulo: 'Consentimento do paciente (TCLE) em', somenteLeitura: true, lista: true },
    { nome: 'consentimento_ip', tipo: 'texto', rotulo: 'IP do consentimento', max: 60, somenteLeitura: true },
    { nome: 'inicio_em', tipo: 'data_hora', rotulo: 'Início', somenteLeitura: true },
    { nome: 'fim_em', tipo: 'data_hora', rotulo: 'Término', somenteLeitura: true },
    { nome: 'registro', tipo: 'texto_longo', rotulo: 'Registro do atendimento (prontuário)' },
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'CID-10' },
  ],
});

// Envios à Rede Nacional de Dados em Saúde (TR 1.2.36.10).
definirEntidade({
  nome: 'esus_rnds',
  tabela: 'esus.rnds_envio',
  titulo: 'Envios à RNDS',
  tituloSingular: 'Envio à RNDS',
  modulo: ESUS,
  menu: 'e-SUS AB/Integrações',
  rotulo: ['tipo', 'referencia'],
  ordemPadrao: 'id desc',
  unicos: [['tipo', 'referencia']],
  tr: ['1.2.36.10'],
  campos: [
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Modelo de informação', opcoes: [['RAC', 'Registro de atendimento clínico (RAC)'], ['RIA', 'Registro de imunobiológico administrado (RIA)']], obrigatorio: true, lista: true },
    { nome: 'referencia', tipo: 'texto', rotulo: 'Registro de origem', max: 60, obrigatorio: true, lista: true },
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', lista: true },
    { nome: 'payload', tipo: 'json', rotulo: 'Documento FHIR (Bundle)' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['PENDENTE', 'Pendente'], ['ENVIADO', 'Enviado'], ['ERRO', 'Erro']], padrao: 'PENDENTE', lista: true },
    { nome: 'protocolo', tipo: 'texto', rotulo: 'Identificador RNDS', max: 120, lista: true },
    { nome: 'resposta', tipo: 'texto_longo', rotulo: 'Resposta / erro' },
    { nome: 'tentativas', tipo: 'inteiro', rotulo: 'Tentativas', padrao: 0, lista: true },
    { nome: 'enviado_em', tipo: 'data_hora', rotulo: 'Enviado em', lista: true },
  ],
});

// Controle das exportações LEDI/HIPERDIA: total ou parcial a partir da última exportação (TR 1.2.13.1.2).
definirEntidade({
  nome: 'esus_exportacao',
  tabela: 'esus.exportacao',
  titulo: 'Exportações e-SUS AB (LEDI) e HIPERDIA',
  tituloSingular: 'Exportação',
  modulo: ESUS,
  menu: 'e-SUS AB/Exportação',
  rotulo: ['sistema', 'gerado_em'],
  ordemPadrao: 'id desc',
  tr: ['1.2.13.1.2', '1.2.13.1.3', '1.2.13.1.38'],
  campos: [
    { nome: 'sistema', tipo: 'opcao', rotulo: 'Sistema', opcoes: [['LEDI', 'e-SUS AB (LEDI / CDS)'], ['HIPERDIA', 'HIPERDIA']], obrigatorio: true, lista: true },
    { nome: 'modalidade', tipo: 'opcao', rotulo: 'Envio', opcoes: [['TOTAL', 'Total da base'], ['PARCIAL', 'Parcial (desde a última exportação)']], obrigatorio: true, lista: true },
    { nome: 'fichas', tipo: 'json', rotulo: 'Fichas e quantidades' },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade (vazio = todas)', lista: true },
    { nome: 'de', tipo: 'data', rotulo: 'Período - de', lista: true },
    { nome: 'ate', tipo: 'data', rotulo: 'até', lista: true },
    { nome: 'registros', tipo: 'inteiro', rotulo: 'Registros', lista: true },
    { nome: 'arquivo_id', tipo: 'arquivo', rotulo: 'Arquivo', lista: true },
    { nome: 'gerado_em', tipo: 'data_hora', rotulo: 'Gerado em', lista: true },
  ],
});

definirEntidade({
  nome: 'esus_registro_exportado',
  tabela: 'esus.registro_exportado',
  titulo: 'Registros exportados ao e-SUS AB',
  tituloSingular: 'Registro exportado',
  modulo: ESUS,
  permissao: 'esus_exportacao',
  rotulo: ['ficha', 'origem'],
  unicos: [['ficha', 'origem']],
  tr: ['1.2.13.1.2'],
  campos: [
    { nome: 'ficha', tipo: 'texto', rotulo: 'Ficha', max: 40, obrigatorio: true, lista: true },
    { nome: 'origem', tipo: 'texto', rotulo: 'Registro de origem', max: 60, obrigatorio: true, lista: true },
    { nome: 'uuid', tipo: 'texto', rotulo: 'UUID da ficha', max: 60, obrigatorio: true, lista: true },
    { nome: 'exportacao_id', tipo: 'ref', ref: 'esus_exportacao', rotulo: 'Exportação', lista: true },
    { nome: 'exportado_em', tipo: 'data_hora', rotulo: 'Exportado em', lista: true },
  ],
});
