// Suporte técnico: ajuda online por chat e chamados com controle de SLA/MTtR
// (TR 1.1.2.1.32, 1.1.1.73 a 1.1.1.79).
import { definirEntidade } from '../../meta/registro.js';

export const CLASSIFICACAO_CHAMADO: [string, string][] = [
  ['ORIENTACAO_TELEFONE', 'Orientação técnica/operacional por telefone (1 hora)'],
  ['CHAMADO_PLATAFORMA', 'Atendimento por chamado na plataforma (2 horas)'],
  ['FUNCIONALIDADE_ISOLADA', 'Mau funcionamento de funcionalidade isolada (24 horas)'],
  ['INCONSISTENCIA_MODULO', 'Inconsistência de dados ou módulo comprometido (8 horas)'],
];

/** Prazo em horas úteis e percentual de desconto na fatura por classificação (TR 1.1.1.73). */
export const SLA_CHAMADO: Record<string, { horas: number; multa: number }> = {
  ORIENTACAO_TELEFONE: { horas: 1, multa: 0.5 },
  CHAMADO_PLATAFORMA: { horas: 2, multa: 1 },
  FUNCIONALIDADE_ISOLADA: { horas: 24, multa: 1 },
  INCONSISTENCIA_MODULO: { horas: 8, multa: 2.5 },
};

definirEntidade({
  nome: 'chamado',
  tabela: 'sis.chamado',
  titulo: 'Chamados de suporte',
  tituloSingular: 'Chamado',
  modulo: 'TEC',
  menu: 'Administração/Suporte',
  rotulo: ['protocolo', 'titulo'],
  ordemPadrao: 'id desc',
  tr: ['1.1.1.73', '1.1.1.75', '1.1.1.76', '1.1.1.77', '1.1.1.78', '1.1.2.1.32'],
  campos: [
    { nome: 'protocolo', tipo: 'texto', rotulo: 'Protocolo', max: 20, somenteLeitura: true, lista: true, busca: true },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Solicitante', lista: true, somenteLeitura: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade' },
    { nome: 'titulo', tipo: 'texto', rotulo: 'Assunto', max: 150, obrigatorio: true, lista: true, busca: true },
    { nome: 'classificacao', tipo: 'opcao', rotulo: 'Classificação (SLA)', opcoes: CLASSIFICACAO_CHAMADO, padrao: 'CHAMADO_PLATAFORMA', lista: true },
    { nome: 'modulo', tipo: 'texto', rotulo: 'Módulo / tela', max: 60 },
    {
      nome: 'situacao',
      tipo: 'opcao',
      rotulo: 'Situação',
      lista: true,
      padrao: 'ABERTO',
      opcoes: [
        ['ABERTO', 'Aberto'],
        ['EM_ATENDIMENTO', 'Em atendimento'],
        ['AGUARDANDO_SOLICITANTE', 'Aguardando solicitante'],
        ['RESOLVIDO', 'Resolvido'],
        ['CANCELADO', 'Cancelado'],
      ],
    },
    { nome: 'aberto_em', tipo: 'data_hora', rotulo: 'Aberto em', somenteLeitura: true, lista: true },
    { nome: 'primeira_resposta_em', tipo: 'data_hora', rotulo: 'Primeira resposta em', somenteLeitura: true },
    { nome: 'encerrado_em', tipo: 'data_hora', rotulo: 'Encerrado em', lista: true },
    { nome: 'horas_uteis_reparo', tipo: 'decimal', casas: 2, rotulo: 'Horas úteis até a conclusão', somenteLeitura: true, lista: true },
    {
      nome: 'causa_externa',
      tipo: 'booleano',
      rotulo: 'Causa não relacionada à contratada',
      padrao: false,
      ajuda: 'Ex.: queda de conexão da contratante ou ausência do operador. Não entra no cálculo do MTtR (TR 1.1.1.77)',
    },
    { nome: 'solucao', tipo: 'texto_longo', rotulo: 'Solução aplicada' },
  ],
  filhos: [{ entidade: 'chamado_mensagem', campo: 'chamado_id', titulo: 'Mensagens' }],
});

definirEntidade({
  nome: 'chamado_mensagem',
  tabela: 'sis.chamado_mensagem',
  titulo: 'Mensagens do chamado',
  tituloSingular: 'Mensagem',
  modulo: 'TEC',
  permissao: 'chamado',
  rotulo: ['criado_em'],
  ordemPadrao: 'id',
  campos: [
    { nome: 'chamado_id', tipo: 'ref', ref: 'chamado', rotulo: 'Chamado', obrigatorio: true },
    { nome: 'autor_id', tipo: 'ref', ref: 'operador', rotulo: 'Autor', lista: true, somenteLeitura: true },
    { nome: 'suporte', tipo: 'booleano', rotulo: 'Resposta do suporte', padrao: false, lista: true },
    { nome: 'texto', tipo: 'texto_longo', rotulo: 'Mensagem', obrigatorio: true, lista: true },
    { nome: 'anexo_id', tipo: 'arquivo', rotulo: 'Anexo' },
  ],
});
