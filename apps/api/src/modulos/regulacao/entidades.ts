// Regulação de solicitações de consultas, exames e procedimentos: decisão do médico regulador/auditor sobre
// a lista de espera regulada e histórico auditável de cada ação, inclusive exclusões de requisições (TR 1.2.43).
import { definirEntidade } from '../../meta/registro.js';

const REG = 'REG';

definirEntidade({
  nome: 'reg_avaliacao',
  tabela: 'reg.avaliacao',
  titulo: 'Avaliações da regulação',
  tituloSingular: 'Avaliação da regulação',
  modulo: REG,
  menu: 'Regulação',
  rotulo: ['lista_espera_id', 'decisao'],
  ordemPadrao: 'avaliado_em desc',
  tr: ['1.2.43.1.3', '1.2.43.1.8'],
  campos: [
    { nome: 'lista_espera_id', tipo: 'ref', ref: 'lista_espera', rotulo: 'Solicitação (lista de espera)', obrigatorio: true, unico: true, lista: true },
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    {
      nome: 'decisao',
      tipo: 'opcao',
      rotulo: 'Decisão',
      opcoes: [['PENDENTE', 'Pendente'], ['AUTORIZADO', 'Autorizado para agendamento'], ['NEGADO', 'Negado'], ['DEVOLVIDO', 'Devolvido ao solicitante'], ['AGENDADO', 'Agendado']],
      padrao: 'PENDENTE',
      lista: true,
    },
    { nome: 'prioridade', tipo: 'opcao', rotulo: 'Classificação', opcoes: [['AZUL', 'Não urgente (azul)'], ['AMARELO', 'Urgente (amarelo)'], ['VERMELHO', 'Emergência (vermelho)']], lista: true },
    { nome: 'justificativa', tipo: 'texto_longo', rotulo: 'Justificativa / parecer do regulador' },
    { nome: 'regulador_id', tipo: 'ref', ref: 'profissional', rotulo: 'Médico regulador / auditor', lista: true },
    { nome: 'avaliado_em', tipo: 'data_hora', rotulo: 'Avaliado em', lista: true },
    { nome: 'agendamento_id', tipo: 'ref', ref: 'agendamento', rotulo: 'Agendamento', somenteLeitura: true },
  ],
});

definirEntidade({
  nome: 'reg_historico',
  tabela: 'reg.historico',
  titulo: 'Histórico da regulação (auditoria)',
  tituloSingular: 'Registro do histórico da regulação',
  modulo: REG,
  menu: 'Regulação',
  rotulo: ['acao', 'criado_em'],
  ordemPadrao: 'id desc',
  tr: ['1.2.43.1.14'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    { nome: 'lista_espera_id', tipo: 'ref', ref: 'lista_espera', rotulo: 'Solicitação' },
    { nome: 'solicitacao_exame_id', tipo: 'ref', ref: 'solicitacao_exame', rotulo: 'Requisição de exames' },
    {
      nome: 'acao',
      tipo: 'opcao',
      rotulo: 'Ação',
      lista: true,
      opcoes: [
        ['INCLUSAO', 'Inclusão de solicitação regulada'],
        ['CLASSIFICACAO', 'Classificação de prioridade'],
        ['AUTORIZACAO', 'Autorização'],
        ['NEGATIVA', 'Negativa'],
        ['DEVOLUCAO', 'Devolução ao solicitante'],
        ['ALTERACAO_TIPO', 'Alteração do tipo de consulta/exame'],
        ['AGENDAMENTO', 'Agendamento'],
        ['EXCLUSAO_REQUISICAO', 'Exclusão de requisição de exames'],
        ['CONSULTA_PRONTUARIO', 'Consulta ao prontuário'],
      ],
    },
    { nome: 'de', tipo: 'texto', rotulo: 'De', max: 200, lista: true },
    { nome: 'para', tipo: 'texto', rotulo: 'Para', max: 200, lista: true },
    { nome: 'justificativa', tipo: 'texto_longo', rotulo: 'Justificativa', lista: true },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador', lista: true },
    { nome: 'regulador_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional regulador' },
  ],
});
