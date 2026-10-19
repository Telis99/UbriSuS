// Anamneses configuráveis com perguntas dependentes de respostas (TR 1.2.5).
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';
import { CONDICOES_SAUDE } from './opcoes.js';

const AGE = 'AGE';

definirEntidade({
  nome: 'anamnese',
  tabela: 'cad.anamnese',
  titulo: 'Modelos de anamnese',
  tituloSingular: 'Modelo de anamnese',
  modulo: AGE,
  menu: 'Cadastros/Clínicos',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.5.1', '1.2.5.2', '1.2.5.6'],
  clonavel: true,
  campos: [
    campoNome(100),
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', obrigatorio: true, lista: true, opcoes: [['MEDICO', 'Médico'], ['ODONTOLOGICO', 'Odontológico']] },
    { nome: 'especialidades', tipo: 'multi_opcao', rotulo: 'Especialidades habilitadas (ids)', oculto: true },
    campoAtivo,
  ],
  filhos: [
    { entidade: 'anamnese_especialidade', campo: 'anamnese_id', titulo: 'Especialidades que aplicam' },
    { entidade: 'anamnese_pergunta', campo: 'anamnese_id', titulo: 'Perguntas' },
  ],
});

definirEntidade({
  nome: 'anamnese_especialidade',
  tabela: 'cad.anamnese_especialidade',
  titulo: 'Especialidades da anamnese',
  tituloSingular: 'Especialidade da anamnese',
  modulo: AGE,
  permissao: 'anamnese',
  rotulo: ['especialidade_id'],
  unicos: [['anamnese_id', 'especialidade_id']],
  tr: ['1.2.5.2', '1.2.5.9', '1.2.5.16'],
  campos: [
    { nome: 'anamnese_id', tipo: 'ref', ref: 'anamnese', rotulo: 'Anamnese', obrigatorio: true },
    { nome: 'especialidade_id', tipo: 'ref', ref: 'especialidade', rotulo: 'Especialidade', obrigatorio: true, lista: true },
  ],
});

definirEntidade({
  nome: 'anamnese_pergunta',
  tabela: 'cad.anamnese_pergunta',
  titulo: 'Perguntas da anamnese',
  tituloSingular: 'Pergunta',
  modulo: AGE,
  permissao: 'anamnese',
  rotulo: ['texto'],
  ordemPadrao: 'ordem',
  tr: ['1.2.5.3', '1.2.5.4', '1.2.5.8'],
  campos: [
    { nome: 'anamnese_id', tipo: 'ref', ref: 'anamnese', rotulo: 'Anamnese', obrigatorio: true },
    { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem', obrigatorio: true, lista: true, largura: 2 },
    { nome: 'texto', tipo: 'texto', rotulo: 'Pergunta', max: 250, obrigatorio: true, lista: true, largura: 10 },
    {
      nome: 'tipo_resposta',
      tipo: 'opcao',
      rotulo: 'Tipo de resposta',
      obrigatorio: true,
      lista: true,
      opcoes: [
        ['TEXTO', 'Texto digitável'],
        ['MULTIPLA', 'Marcação múltipla'],
        ['MULTIPLA_OBS', 'Marcação múltipla e observação'],
        ['UNICA', 'Marcação única'],
        ['UNICA_OBS', 'Marcação única e observação'],
        ['SELECAO', 'Seleção (lista)'],
      ],
    },
    {
      nome: 'tipo_observacao',
      tipo: 'opcao',
      rotulo: 'Conteúdo da observação',
      opcoes: [['NUMERO', 'Apenas números'], ['TEXTO', 'Apenas texto'], ['AMBOS', 'Números e texto']],
      padrao: 'AMBOS',
    },
    {
      nome: 'depende_opcao_id',
      tipo: 'ref',
      ref: 'anamnese_opcao',
      rotulo: 'Exibir somente se for respondida a opção',
      ajuda: 'Pergunta dependente: só é feita quando a opção indicada for escolhida (TR 1.2.5.8)',
    },
    { nome: 'obrigatoria', tipo: 'booleano', rotulo: 'Resposta obrigatória', padrao: true },
  ],
  filhos: [{ entidade: 'anamnese_opcao', campo: 'pergunta_id', titulo: 'Opções de resposta' }],
});

definirEntidade({
  nome: 'anamnese_opcao',
  tabela: 'cad.anamnese_opcao',
  titulo: 'Opções de resposta da anamnese',
  tituloSingular: 'Opção de resposta',
  modulo: AGE,
  permissao: 'anamnese',
  rotulo: ['texto'],
  ordemPadrao: 'ordem',
  tr: ['1.2.5.5', '1.2.5.7', '1.2.5.17'],
  campos: [
    { nome: 'pergunta_id', tipo: 'ref', ref: 'anamnese_pergunta', rotulo: 'Pergunta', obrigatorio: true },
    { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem', obrigatorio: true, lista: true },
    { nome: 'texto', tipo: 'texto', rotulo: 'Resposta', max: 150, obrigatorio: true, lista: true },
    { nome: 'condicao_saude', tipo: 'opcao', rotulo: 'Doença/agravante relacionada (e-SUS)', opcoes: CONDICOES_SAUDE, lista: true },
    { nome: 'acao_condicao', tipo: 'opcao', rotulo: 'Ao responder', opcoes: [['ATRIBUIR', 'Atribuir ao paciente'], ['REMOVER', 'Remover do paciente']], padrao: 'ATRIBUIR' },
  ],
});

definirEntidade({
  nome: 'anamnese_aplicada',
  tabela: 'cad.anamnese_aplicada',
  titulo: 'Anamneses aplicadas',
  tituloSingular: 'Anamnese aplicada',
  modulo: AGE,
  rotulo: ['data_hora'],
  ordemPadrao: 'data_hora desc',
  tr: ['1.2.5.9', '1.2.5.10', '1.2.5.11', '1.2.5.13', '1.2.5.14'],
  campos: [
    { nome: 'pessoa_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    { nome: 'anamnese_id', tipo: 'ref', ref: 'anamnese', rotulo: 'Anamnese', obrigatorio: true, lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade' },
    { nome: 'data_hora', tipo: 'data_hora', rotulo: 'Data e hora', obrigatorio: true, lista: true },
    { nome: 'concluida', tipo: 'booleano', rotulo: 'Concluída', padrao: false, lista: true },
    { nome: 'respostas', tipo: 'json', rotulo: 'Respostas', oculto: true },
  ],
});
