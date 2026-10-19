// Atendimento remoto e autoatendimento do cidadão (aplicativo móvel e portal web) (TR 1.2.41).
// Contas de acesso do cidadão são separadas dos operadores do sistema.
import { definirEntidade } from '../../meta/registro.js';

const APP = 'APP';

export const SITUACAO_CONTA: [string, string][] = [
  ['SOLICITADA', 'Solicitada (aguardando liberação)'],
  ['ATIVA', 'Liberada'],
  ['RECUSADA', 'Recusada'],
  ['BLOQUEADA', 'Bloqueada'],
  ['INATIVA', 'Inativa'],
];

// Solicitação de acesso pelo aplicativo, liberada pelo operador da unidade (TR 1.2.41.3);
// login pelo Cartão Nacional de Saúde e senha forte (TR 1.2.41.4); bloqueio após 3 tentativas (TR 1.2.41.5).
definirEntidade({
  nome: 'portal_conta',
  tabela: 'portal.conta',
  titulo: 'Contas do aplicativo do cidadão',
  tituloSingular: 'Conta do aplicativo do cidadão',
  modulo: APP,
  menu: 'Atendimento remoto',
  rotulo: ['nome_informado', 'cns'],
  ordemPadrao: 'solicitado_em desc',
  somenteLeitura: true,
  tr: ['1.2.41.3', '1.2.41.4', '1.2.41.5'],
  abas: ['Identificação', 'Liberação', 'Segurança'],
  campos: [
    { nome: 'pessoa_id', tipo: 'ref', ref: 'paciente', rotulo: 'Cidadão (cadastro único)', lista: true, aba: 'Identificação', largura: 6 },
    { nome: 'cns', tipo: 'cns', rotulo: 'Cartão Nacional de Saúde (login)', obrigatorio: true, unico: true, lista: true, busca: true, aba: 'Identificação' },
    { nome: 'cpf', tipo: 'cpf', rotulo: 'CPF', busca: true, aba: 'Identificação' },
    { nome: 'nome_informado', tipo: 'texto', rotulo: 'Nome informado', max: 70, maiusculo: true, lista: true, busca: true, aba: 'Identificação', largura: 6 },
    { nome: 'nascimento_informado', tipo: 'data', rotulo: 'Data de nascimento informada', aba: 'Identificação' },
    { nome: 'mae_informada', tipo: 'texto', rotulo: 'Nome da mãe informado', max: 70, maiusculo: true, aba: 'Identificação' },
    { nome: 'email', tipo: 'email', rotulo: 'E-mail', aba: 'Identificação' },
    { nome: 'celular', tipo: 'telefone', rotulo: 'Celular', lista: true, aba: 'Identificação' },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade responsável pela liberação', lista: true, aba: 'Liberação', largura: 6 },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: SITUACAO_CONTA, padrao: 'SOLICITADA', lista: true, aba: 'Liberação' },
    { nome: 'solicitado_em', tipo: 'data_hora', rotulo: 'Solicitado em', somenteLeitura: true, lista: true, aba: 'Liberação' },
    { nome: 'liberado_em', tipo: 'data_hora', rotulo: 'Liberado em', somenteLeitura: true, aba: 'Liberação' },
    { nome: 'liberado_por', tipo: 'ref', ref: 'operador', rotulo: 'Liberado por', somenteLeitura: true, aba: 'Liberação' },
    { nome: 'motivo', tipo: 'texto', rotulo: 'Motivo (recusa/bloqueio)', max: 250, aba: 'Liberação' },
    { nome: 'senha_hash', tipo: 'segredo', rotulo: 'Senha' },
    { nome: 'senha_alterada_em', tipo: 'data_hora', rotulo: 'Senha alterada em', somenteLeitura: true, aba: 'Segurança' },
    { nome: 'tentativas_invalidas', tipo: 'inteiro', rotulo: 'Tentativas inválidas', padrao: 0, somenteLeitura: true, aba: 'Segurança' },
    { nome: 'bloqueado_em', tipo: 'data_hora', rotulo: 'Bloqueado em', somenteLeitura: true, aba: 'Segurança' },
    { nome: 'termos_versao', tipo: 'texto', rotulo: 'Versão dos termos aceitos (LGPD)', max: 20, somenteLeitura: true, aba: 'Segurança' },
    { nome: 'termos_aceitos_em', tipo: 'data_hora', rotulo: 'Termos aceitos em', somenteLeitura: true, aba: 'Segurança' },
    { nome: 'ultimo_acesso_em', tipo: 'data_hora', rotulo: 'Último acesso', somenteLeitura: true, lista: true, aba: 'Segurança' },
  ],
});

definirEntidade({
  nome: 'portal_sessao',
  tabela: 'portal.sessao',
  titulo: 'Sessões do aplicativo do cidadão',
  tituloSingular: 'Sessão do aplicativo do cidadão',
  modulo: APP,
  rotulo: ['inicio'],
  ordemPadrao: 'inicio desc',
  somenteLeitura: true,
  campos: [
    { nome: 'token_hash', tipo: 'texto', rotulo: 'Token', max: 64, obrigatorio: true, unico: true, oculto: true },
    { nome: 'conta_id', tipo: 'ref', ref: 'portal_conta', rotulo: 'Conta', obrigatorio: true, lista: true },
    { nome: 'inicio', tipo: 'data_hora', rotulo: 'Início', lista: true },
    { nome: 'ultimo_acesso', tipo: 'data_hora', rotulo: 'Último acesso', lista: true },
    { nome: 'ip', tipo: 'texto', rotulo: 'IP', max: 60, lista: true },
    { nome: 'agente', tipo: 'texto', rotulo: 'Navegador / dispositivo', max: 300 },
    { nome: 'encerrada_em', tipo: 'data_hora', rotulo: 'Encerrada em', lista: true },
  ],
});

definirEntidade({
  nome: 'portal_recuperacao',
  tabela: 'portal.recuperacao_senha',
  titulo: 'Recuperações de senha do aplicativo do cidadão',
  tituloSingular: 'Recuperação de senha',
  modulo: APP,
  rotulo: ['criado_em'],
  somenteLeitura: true,
  campos: [
    { nome: 'conta_id', tipo: 'ref', ref: 'portal_conta', rotulo: 'Conta', obrigatorio: true },
    { nome: 'codigo_hash', tipo: 'texto', rotulo: 'Código', max: 64, oculto: true },
    { nome: 'meio', tipo: 'texto', rotulo: 'Enviado por', max: 20, lista: true },
    { nome: 'expira_em', tipo: 'data_hora', rotulo: 'Expira em', lista: true },
    { nome: 'usado_em', tipo: 'data_hora', rotulo: 'Utilizado em', lista: true },
    { nome: 'tentativas', tipo: 'inteiro', rotulo: 'Tentativas', padrao: 0 },
  ],
});

// Histórico das ações do cidadão sobre agendamentos (responsável e motivo do cancelamento) (TR 1.2.41.7.11).
definirEntidade({
  nome: 'portal_evento',
  tabela: 'portal.evento_agendamento',
  titulo: 'Ações sobre agendamentos pelo aplicativo do cidadão',
  tituloSingular: 'Ação sobre agendamento',
  modulo: APP,
  rotulo: ['data_hora', 'evento'],
  ordemPadrao: 'data_hora desc',
  somenteLeitura: true,
  tr: ['1.2.41.7.11'],
  campos: [
    { nome: 'agendamento_id', tipo: 'ref', ref: 'agendamento', rotulo: 'Agendamento', obrigatorio: true, lista: true },
    { nome: 'conta_id', tipo: 'ref', ref: 'portal_conta', rotulo: 'Conta', lista: true },
    { nome: 'pessoa_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', lista: true },
    { nome: 'evento', tipo: 'opcao', rotulo: 'Ação', lista: true, opcoes: [['AGENDAMENTO', 'Agendamento'], ['SOLICITACAO', 'Solicitação'], ['CANCELAMENTO', 'Cancelamento'], ['TRANSFERENCIA', 'Transferência'], ['CONFIRMACAO', 'Confirmação pela unidade'], ['RECUSA', 'Recusa pela unidade']] },
    { nome: 'data_hora', tipo: 'data_hora', rotulo: 'Data e hora', lista: true },
    { nome: 'motivo', tipo: 'texto', rotulo: 'Motivo', max: 250, lista: true },
    { nome: 'responsavel', tipo: 'texto', rotulo: 'Responsável', max: 120, lista: true },
  ],
});

// Caixa de mensagens do aplicativo: leitura das notificações enviadas pelo sistema (TR 1.2.41.7.4).
definirEntidade({
  nome: 'portal_leitura',
  tabela: 'portal.mensagem_lida',
  titulo: 'Mensagens lidas no aplicativo do cidadão',
  tituloSingular: 'Mensagem lida',
  modulo: APP,
  rotulo: ['lida_em'],
  somenteLeitura: true,
  unicos: [['conta_id', 'mensagem_id']],
  campos: [
    { nome: 'conta_id', tipo: 'ref', ref: 'portal_conta', rotulo: 'Conta', obrigatorio: true },
    { nome: 'mensagem_id', tipo: 'inteiro', rotulo: 'Mensagem', obrigatorio: true },
    { nome: 'lida_em', tipo: 'data_hora', rotulo: 'Lida em' },
  ],
});

// Atendimento remoto: sala virtual e conversa do teleatendimento agendado.
definirEntidade({
  nome: 'portal_teleatendimento',
  tabela: 'portal.teleatendimento',
  titulo: 'Teleatendimentos (salas virtuais)',
  tituloSingular: 'Teleatendimento',
  modulo: APP,
  menu: 'Atendimento remoto',
  rotulo: ['sala'],
  ordemPadrao: 'id desc',
  campos: [
    { nome: 'agendamento_id', tipo: 'ref', ref: 'agendamento', rotulo: 'Agendamento', obrigatorio: true, unico: true, lista: true },
    { nome: 'sala', tipo: 'texto', rotulo: 'Identificador da sala', max: 60, obrigatorio: true, unico: true, lista: true },
    { nome: 'link_video', tipo: 'texto', rotulo: 'Link da videochamada', max: 250, lista: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['AGUARDANDO', 'Aguardando'], ['EM_ANDAMENTO', 'Em andamento'], ['ENCERRADO', 'Encerrado']], padrao: 'AGUARDANDO', lista: true },
    { nome: 'paciente_entrou_em', tipo: 'data_hora', rotulo: 'Paciente entrou em' },
    { nome: 'encerrado_em', tipo: 'data_hora', rotulo: 'Encerrado em' },
  ],
});

definirEntidade({
  nome: 'portal_tele_mensagem',
  tabela: 'portal.teleatendimento_mensagem',
  titulo: 'Mensagens do teleatendimento',
  tituloSingular: 'Mensagem do teleatendimento',
  modulo: APP,
  permissao: 'portal_teleatendimento',
  rotulo: ['data_hora'],
  ordemPadrao: 'data_hora',
  somenteLeitura: true,
  campos: [
    { nome: 'teleatendimento_id', tipo: 'ref', ref: 'portal_teleatendimento', rotulo: 'Teleatendimento', obrigatorio: true },
    { nome: 'autor', tipo: 'opcao', rotulo: 'Autor', opcoes: [['PACIENTE', 'Paciente'], ['PROFISSIONAL', 'Profissional']], obrigatorio: true, lista: true },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador' },
    { nome: 'texto', tipo: 'texto_longo', rotulo: 'Mensagem', obrigatorio: true, lista: true },
    { nome: 'data_hora', tipo: 'data_hora', rotulo: 'Data e hora', lista: true },
  ],
});

// Avaliação do atendimento e manifestações do cidadão (ouvidoria), respondidas pela unidade.
definirEntidade({
  nome: 'portal_manifestacao',
  tabela: 'portal.manifestacao',
  titulo: 'Avaliações e manifestações do cidadão',
  tituloSingular: 'Manifestação do cidadão',
  modulo: APP,
  menu: 'Atendimento remoto',
  rotulo: ['protocolo'],
  ordemPadrao: 'id desc',
  campos: [
    { nome: 'protocolo', tipo: 'texto', rotulo: 'Protocolo', max: 20, unico: true, lista: true, busca: true, somenteLeitura: true },
    { nome: 'pessoa_id', tipo: 'ref', ref: 'paciente', rotulo: 'Cidadão', lista: true, somenteLeitura: true },
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', lista: true, obrigatorio: true, opcoes: [['AVALIACAO', 'Avaliação de atendimento'], ['ELOGIO', 'Elogio'], ['SUGESTAO', 'Sugestão'], ['RECLAMACAO', 'Reclamação'], ['SOLICITACAO', 'Solicitação'], ['DENUNCIA', 'Denúncia']] },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', lista: true },
    { nome: 'agendamento_id', tipo: 'ref', ref: 'agendamento', rotulo: 'Agendamento avaliado' },
    { nome: 'nota', tipo: 'inteiro', rotulo: 'Nota (1 a 5)', min: 1, max: 5, lista: true },
    { nome: 'texto', tipo: 'texto_longo', rotulo: 'Texto do cidadão', somenteLeitura: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', lista: true, padrao: 'ABERTA', opcoes: [['ABERTA', 'Aberta'], ['EM_ANALISE', 'Em análise'], ['RESPONDIDA', 'Respondida'], ['ENCERRADA', 'Encerrada']] },
    { nome: 'resposta', tipo: 'texto_longo', rotulo: 'Resposta ao cidadão' },
    { nome: 'respondido_em', tipo: 'data_hora', rotulo: 'Respondido em', somenteLeitura: true },
  ],
});
