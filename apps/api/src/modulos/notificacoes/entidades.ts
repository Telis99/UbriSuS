// Modelos de mensagem e campanhas de notificação em massa aos usuários da rede (TR 1.1.2.1.58, 1.1.2.1.60, 1.1.2.1.67).
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';

export const MEIOS: [string, string][] = [
  ['sms', 'SMS'],
  ['email', 'E-mail'],
  ['push', 'Aplicativo do cidadão'],
];

definirEntidade({
  nome: 'modelo_mensagem',
  tabela: 'sis.modelo_mensagem',
  titulo: 'Modelos de mensagens',
  tituloSingular: 'Modelo de mensagem',
  modulo: 'AGE',
  menu: 'Agendamento/Notificações',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  clonavel: true,
  tr: ['1.2.2.2'],
  campos: [
    campoNome(80),
    { nome: 'assunto', tipo: 'texto', rotulo: 'Assunto (e-mail e aplicativo)', max: 150, lista: true },
    {
      nome: 'texto',
      tipo: 'texto_longo',
      rotulo: 'Texto',
      obrigatorio: true,
      ajuda: 'Variáveis: {nome}, {primeiro_nome}, {unidade}, {data_agendamento}, {hora}, {profissional}, {hoje}',
    },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'campanha_notificacao',
  tabela: 'sis.campanha_notificacao',
  titulo: 'Notificações em massa',
  tituloSingular: 'Notificação em massa',
  modulo: 'AGE',
  rotulo: ['titulo'],
  ordemPadrao: 'id desc',
  tr: ['1.1.2.1.58', '1.1.2.1.60', '1.1.2.1.67'],
  campos: [
    { nome: 'titulo', tipo: 'texto', rotulo: 'Título', max: 120, obrigatorio: true, lista: true, busca: true },
    { nome: 'meios', tipo: 'multi_opcao', rotulo: 'Meios de envio', opcoes: MEIOS, obrigatorio: true, lista: true },
    { nome: 'assunto', tipo: 'texto', rotulo: 'Assunto', max: 150 },
    { nome: 'texto', tipo: 'texto_longo', rotulo: 'Texto', obrigatorio: true },
    { nome: 'criterios', tipo: 'json', rotulo: 'Critérios de seleção', oculto: true },
    { nome: 'agendada_para', tipo: 'data_hora', rotulo: 'Envio agendado para', lista: true },
    {
      nome: 'situacao',
      tipo: 'opcao',
      rotulo: 'Situação',
      opcoes: [['RASCUNHO', 'Rascunho'], ['AGENDADA', 'Agendada'], ['ENVIADA', 'Enviada'], ['CANCELADA', 'Cancelada']],
      padrao: 'RASCUNHO',
      lista: true,
    },
    { nome: 'destinatarios', tipo: 'inteiro', rotulo: 'Destinatários', lista: true },
    { nome: 'mensagens', tipo: 'inteiro', rotulo: 'Mensagens geradas' },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador' },
  ],
});
