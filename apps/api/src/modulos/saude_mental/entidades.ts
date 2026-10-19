// Ambulatório de saúde mental (CAPS): programas, agendas dos programas, locais de atendimento, oficinas
// associadas aos programas, inscrições, acolhimento, atendimentos e projeto terapêutico singular (TR 1.2.46).
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';
import { DIAS_SEMANA } from '../cadastros/opcoes.js';

const CAPS = 'CAPS';
const SIGILO = 'caps_prontuario:consultar';

// Programas do CAPS (TR 1.2.46.3).
definirEntidade({
  nome: 'caps_programa',
  tabela: 'caps.programa',
  titulo: 'Programas de saúde mental',
  tituloSingular: 'Programa',
  modulo: CAPS,
  menu: 'Saúde mental/Cadastros',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.46.3'],
  campos: [
    campoNome(100),
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade (CAPS)', obrigatorio: true, lista: true },
    { nome: 'descricao', tipo: 'texto_longo', rotulo: 'Descrição / objetivos' },
    {
      nome: 'publico',
      tipo: 'opcao',
      rotulo: 'Público-alvo',
      lista: true,
      opcoes: [['ADULTO', 'Adultos com transtornos mentais graves'], ['AD', 'Usuários de álcool e outras drogas'], ['INFANTOJUVENIL', 'Crianças e adolescentes'], ['FAMILIAS', 'Familiares'], ['GERAL', 'Geral']],
    },
    { nome: 'responsavel_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional responsável', lista: true },
    { nome: 'vigencia_inicio', tipo: 'data', rotulo: 'Início', obrigatorio: true },
    { nome: 'vigencia_fim', tipo: 'data', rotulo: 'Término' },
    { nome: 'vagas', tipo: 'inteiro', rotulo: 'Vagas', min: 1, lista: true },
    campoAtivo,
  ],
  filhos: [
    { entidade: 'caps_oficina', campo: 'programa_id', titulo: 'Oficinas do programa' },
    { entidade: 'caps_agenda', campo: 'programa_id', titulo: 'Agendas do programa' },
  ],
});

// Locais de atendimento (TR 1.2.46.5).
definirEntidade({
  nome: 'caps_local',
  tabela: 'caps.local',
  titulo: 'Locais de atendimento (saúde mental)',
  tituloSingular: 'Local de atendimento',
  modulo: CAPS,
  menu: 'Saúde mental/Cadastros',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.46.5'],
  campos: [
    campoNome(80),
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    {
      nome: 'tipo',
      tipo: 'opcao',
      rotulo: 'Tipo',
      lista: true,
      padrao: 'SALA',
      opcoes: [['SALA', 'Sala de atendimento'], ['OFICINA', 'Sala de oficinas / grupos'], ['ESPACO_EXTERNO', 'Espaço externo'], ['TERRITORIO', 'Território / comunidade'], ['DOMICILIO', 'Domicílio']],
    },
    { nome: 'capacidade', tipo: 'inteiro', rotulo: 'Capacidade (pessoas)', lista: true },
    { nome: 'endereco', tipo: 'texto', rotulo: 'Endereço / referência (locais externos)', max: 200 },
    campoAtivo,
  ],
});

// Oficinas terapêuticas associadas aos programas (TR 1.2.46.6).
definirEntidade({
  nome: 'caps_oficina',
  tabela: 'caps.oficina',
  titulo: 'Oficinas terapêuticas',
  tituloSingular: 'Oficina',
  modulo: CAPS,
  menu: 'Saúde mental/Cadastros',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.46.6'],
  campos: [
    campoNome(100),
    { nome: 'programa_id', tipo: 'ref', ref: 'caps_programa', rotulo: 'Programa', obrigatorio: true, lista: true },
    { nome: 'local_id', tipo: 'ref', ref: 'caps_local', rotulo: 'Local', lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional facilitador', lista: true },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento SIGTAP do atendimento em grupo', ajuda: 'Ex.: práticas expressivas e comunicativas, práticas corporais' },
    { nome: 'descricao', tipo: 'texto_longo', rotulo: 'Descrição' },
    { nome: 'vagas', tipo: 'inteiro', rotulo: 'Vagas', min: 1, lista: true },
    campoAtivo,
  ],
});

// Agendas dos programas e oficinas, geradas na agenda da rede (tipo grupo) (TR 1.2.46.4).
definirEntidade({
  nome: 'caps_agenda',
  tabela: 'caps.agenda',
  titulo: 'Agendas dos programas',
  tituloSingular: 'Agenda do programa',
  modulo: CAPS,
  menu: 'Saúde mental/Cadastros',
  rotulo: ['programa_id', 'hora_inicio'],
  ordemPadrao: 'id desc',
  tr: ['1.2.46.4'],
  campos: [
    { nome: 'programa_id', tipo: 'ref', ref: 'caps_programa', rotulo: 'Programa', obrigatorio: true, lista: true },
    { nome: 'oficina_id', tipo: 'ref', ref: 'caps_oficina', rotulo: 'Oficina', lista: true },
    { nome: 'local_id', tipo: 'ref', ref: 'caps_local', rotulo: 'Local', lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', lista: true },
    { nome: 'dias_semana', tipo: 'multi_opcao', rotulo: 'Dias da semana', opcoes: DIAS_SEMANA, obrigatorio: true, lista: true },
    { nome: 'hora_inicio', tipo: 'hora', rotulo: 'Início', obrigatorio: true, lista: true },
    { nome: 'hora_fim', tipo: 'hora', rotulo: 'Término', obrigatorio: true },
    { nome: 'vagas', tipo: 'inteiro', rotulo: 'Vagas por encontro', obrigatorio: true, min: 1, padrao: 10 },
    { nome: 'vigencia_inicio', tipo: 'data', rotulo: 'Vigência - início', obrigatorio: true },
    { nome: 'vigencia_fim', tipo: 'data', rotulo: 'Vigência - fim' },
    { nome: 'agenda_id', tipo: 'ref', ref: 'agenda', rotulo: 'Agenda gerada na rede', somenteLeitura: true, lista: true },
    campoAtivo,
  ],
});

// Inscrição do usuário em programas e oficinas.
definirEntidade({
  nome: 'caps_inscricao',
  tabela: 'caps.inscricao',
  titulo: 'Usuários inscritos em programas e oficinas',
  tituloSingular: 'Inscrição',
  modulo: CAPS,
  menu: 'Saúde mental',
  rotulo: ['paciente_id', 'programa_id'],
  ordemPadrao: 'data_inicio desc',
  tr: ['1.2.46.6', '1.2.46.9'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Usuário', obrigatorio: true, lista: true },
    { nome: 'programa_id', tipo: 'ref', ref: 'caps_programa', rotulo: 'Programa', obrigatorio: true, lista: true },
    { nome: 'oficina_id', tipo: 'ref', ref: 'caps_oficina', rotulo: 'Oficina', lista: true },
    { nome: 'profissional_referencia_id', tipo: 'ref', ref: 'profissional', rotulo: 'Técnico de referência' },
    { nome: 'data_inicio', tipo: 'data', rotulo: 'Data de inclusão', obrigatorio: true, lista: true },
    { nome: 'data_fim', tipo: 'data', rotulo: 'Data de saída' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['ATIVO', 'Ativo'], ['ALTA', 'Alta'], ['DESLIGADO', 'Desligado'], ['TRANSFERIDO', 'Transferido']], padrao: 'ATIVO', lista: true },
    { nome: 'observacao', tipo: 'texto', rotulo: 'Observação', max: 250 },
  ],
});

// Acolhimento com nível de acesso aos dados clínicos (TR 1.2.46.8).
definirEntidade({
  nome: 'caps_acolhimento',
  tabela: 'caps.acolhimento',
  titulo: 'Acolhimentos (saúde mental)',
  tituloSingular: 'Acolhimento',
  modulo: CAPS,
  menu: 'Saúde mental',
  rotulo: ['data_hora', 'paciente_id'],
  ordemPadrao: 'data_hora desc',
  tr: ['1.2.46.8'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Usuário', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    { nome: 'data_hora', tipo: 'data_hora', rotulo: 'Data e hora', lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', lista: true },
    {
      nome: 'demanda',
      tipo: 'opcao',
      rotulo: 'Forma de chegada',
      lista: true,
      padrao: 'ESPONTANEA',
      opcoes: [['ESPONTANEA', 'Demanda espontânea'], ['ATENCAO_BASICA', 'Encaminhado pela atenção básica'], ['URGENCIA', 'Encaminhado por urgência/UPA'], ['HOSPITAL', 'Alta hospitalar'], ['JUSTICA', 'Justiça / conselho tutelar'], ['ASSISTENCIA_SOCIAL', 'Assistência social'], ['OUTROS', 'Outros']],
    },
    { nome: 'motivo', tipo: 'texto', rotulo: 'Motivo da procura', max: 250, lista: true },
    { nome: 'escuta', tipo: 'texto_longo', rotulo: 'Escuta qualificada / avaliação', permissaoLeitura: SIGILO },
    { nome: 'risco', tipo: 'opcao', rotulo: 'Avaliação de risco', opcoes: [['BAIXO', 'Baixo'], ['MODERADO', 'Moderado'], ['ALTO', 'Alto (crise / risco de suicídio)']], lista: true },
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'Hipótese diagnóstica (CID-10)', permissaoLeitura: SIGILO },
    {
      nome: 'conduta',
      tipo: 'opcao',
      rotulo: 'Conduta',
      lista: true,
      opcoes: [['INSERCAO', 'Inserção no CAPS'], ['ATENCAO_BASICA', 'Acompanhamento pela atenção básica'], ['AMBULATORIO', 'Ambulatório de saúde mental'], ['URGENCIA', 'Encaminhamento à urgência'], ['REDE', 'Outro ponto da rede'], ['RETORNO', 'Retorno para nova avaliação']],
    },
    { nome: 'programa_id', tipo: 'ref', ref: 'caps_programa', rotulo: 'Programa indicado' },
  ],
});

// Atendimentos relacionados a programas e oficinas (TR 1.2.46.7).
definirEntidade({
  nome: 'caps_atendimento',
  tabela: 'caps.atendimento',
  titulo: 'Atendimentos de saúde mental',
  tituloSingular: 'Atendimento de saúde mental',
  modulo: CAPS,
  menu: 'Saúde mental',
  rotulo: ['data', 'paciente_id'],
  ordemPadrao: 'data desc, id desc',
  tr: ['1.2.46.7', '1.2.46.1'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Usuário', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'hora', tipo: 'hora', rotulo: 'Hora' },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', obrigatorio: true, lista: true },
    {
      nome: 'tipo',
      tipo: 'opcao',
      rotulo: 'Tipo de atendimento',
      obrigatorio: true,
      lista: true,
      padrao: 'INDIVIDUAL',
      opcoes: [['INDIVIDUAL', 'Individual'], ['GRUPO', 'Em grupo / oficina'], ['FAMILIAR', 'Familiar'], ['DOMICILIAR', 'Domiciliar'], ['CRISE', 'Atenção à situação de crise'], ['ARTICULACAO', 'Articulação de rede'], ['REABILITACAO', 'Reabilitação psicossocial']],
    },
    { nome: 'programa_id', tipo: 'ref', ref: 'caps_programa', rotulo: 'Programa', lista: true },
    { nome: 'oficina_id', tipo: 'ref', ref: 'caps_oficina', rotulo: 'Oficina', lista: true },
    { nome: 'local_id', tipo: 'ref', ref: 'caps_local', rotulo: 'Local' },
    { nome: 'local_realizacao', tipo: 'opcao', rotulo: 'Realizado', opcoes: [['C', 'No CAPS'], ['T', 'No território'], ['D', 'No domicílio']], padrao: 'C' },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento (SIGTAP)', ajuda: 'Em branco: definido pelo tipo de atendimento' },
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'CID-10', permissaoLeitura: SIGILO },
    { nome: 'evolucao', tipo: 'texto_longo', rotulo: 'Evolução', permissaoLeitura: SIGILO },
    { nome: 'raas_acao_id', tipo: 'ref', ref: 'raas_acao', rotulo: 'Ação RAAS gerada', somenteLeitura: true },
    { nome: 'producao_id', tipo: 'ref', ref: 'producao', rotulo: 'Produção BPA gerada', somenteLeitura: true },
  ],
});

// Projeto terapêutico singular (PTS).
definirEntidade({
  nome: 'caps_pts',
  tabela: 'caps.pts',
  titulo: 'Projetos terapêuticos singulares (PTS)',
  tituloSingular: 'Projeto terapêutico singular',
  modulo: CAPS,
  menu: 'Saúde mental',
  rotulo: ['paciente_id', 'data_elaboracao'],
  ordemPadrao: 'data_elaboracao desc',
  tr: ['1.2.46.7'],
  abas: ['Identificação', 'Projeto'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Usuário', obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, aba: 'Identificação' },
    { nome: 'profissional_referencia_id', tipo: 'ref', ref: 'profissional', rotulo: 'Técnico de referência', obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'data_elaboracao', tipo: 'data', rotulo: 'Elaborado em', obrigatorio: true, lista: true, aba: 'Identificação' },
    { nome: 'data_reavaliacao', tipo: 'data', rotulo: 'Reavaliar em', lista: true, aba: 'Identificação' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['VIGENTE', 'Vigente'], ['REAVALIADO', 'Reavaliado'], ['CONCLUIDO', 'Concluído']], padrao: 'VIGENTE', lista: true, aba: 'Identificação' },
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'Diagnóstico (CID-10)', permissaoLeitura: SIGILO, aba: 'Projeto' },
    { nome: 'diagnostico_situacional', tipo: 'texto_longo', rotulo: 'Diagnóstico situacional (história, rede de apoio, vulnerabilidades)', permissaoLeitura: SIGILO, aba: 'Projeto' },
    { nome: 'objetivos', tipo: 'texto_longo', rotulo: 'Objetivos e metas (curto, médio e longo prazo)', aba: 'Projeto' },
    { nome: 'intervencoes', tipo: 'texto_longo', rotulo: 'Intervenções e divisão de responsabilidades', aba: 'Projeto' },
    { nome: 'programas', tipo: 'texto', rotulo: 'Programas e oficinas indicados', max: 250, aba: 'Projeto' },
    { nome: 'frequencia', tipo: 'opcao', rotulo: 'Modalidade de acompanhamento', opcoes: [['INTENSIVO', 'Intensivo (diário)'], ['SEMI', 'Semi-intensivo'], ['NAO_INTENSIVO', 'Não intensivo']], aba: 'Projeto' },
  ],
});
