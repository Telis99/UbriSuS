// Cópias de segurança no servidor local da contratante e exportações para portabilidade (TR 1.1.1.23, 1.1.1.70).
import { definirEntidade } from '../../meta/registro.js';

const SITUACAO: [string, string][] = [
  ['EXECUTANDO', 'Em execução'],
  ['CONCLUIDO', 'Concluído'],
  ['FALHA', 'Falha'],
];

definirEntidade({
  nome: 'copia_seguranca',
  tabela: 'sis.copia_seguranca',
  titulo: 'Cópias de segurança',
  tituloSingular: 'Cópia de segurança',
  modulo: 'TEC',
  rotulo: ['arquivo'],
  ordemPadrao: 'id desc',
  tr: ['1.1.1.23'],
  campos: [
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', opcoes: [['BACKUP', 'Cópia do banco de dados'], ['PORTABILIDADE', 'Exportação para portabilidade']], lista: true },
    { nome: 'origem', tipo: 'opcao', rotulo: 'Origem', opcoes: [['AGENDADA', 'Agendada'], ['MANUAL', 'Manual']], lista: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: SITUACAO, lista: true },
    { nome: 'iniciado_em', tipo: 'data_hora', rotulo: 'Início', lista: true },
    { nome: 'concluido_em', tipo: 'data_hora', rotulo: 'Término', lista: true },
    { nome: 'arquivo', tipo: 'texto', rotulo: 'Arquivo', max: 400, lista: true },
    { nome: 'tamanho', tipo: 'inteiro', rotulo: 'Tamanho (bytes)', lista: true },
    { nome: 'sha256', tipo: 'texto', rotulo: 'Resumo SHA-256', max: 64 },
    { nome: 'validado_em', tipo: 'data_hora', rotulo: 'Última validação de integridade', lista: true },
    { nome: 'integro', tipo: 'booleano', rotulo: 'Íntegro', lista: true },
    { nome: 'mensagem', tipo: 'texto_longo', rotulo: 'Mensagem' },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador' },
    { nome: 'excluido', tipo: 'booleano', rotulo: 'Removido pela retenção', padrao: false },
  ],
});
