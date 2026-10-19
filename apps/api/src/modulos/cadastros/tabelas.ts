// Tabelas de apoio: endereços, ocupações, CID, CIAP, SIGTAP e demais domínios povoados.
import { campoAtivo, campoCodigo, campoNome, definirEntidade } from '../../meta/registro.js';
import { COMPLEXIDADE, INSTRUMENTO_REGISTRO, SEXO, UF } from './opcoes.js';

const AGE = 'AGE';

definirEntidade({
  nome: 'pais',
  tabela: 'cad.pais',
  titulo: 'Países',
  tituloSingular: 'País',
  modulo: AGE,
  menu: 'Cadastros/Endereços',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  campos: [campoCodigo(5, { unico: true }), campoNome(80)],
});

definirEntidade({
  nome: 'uf',
  tabela: 'cad.uf',
  titulo: 'Estados',
  tituloSingular: 'Estado',
  modulo: AGE,
  menu: 'Cadastros/Endereços',
  rotulo: ['sigla'],
  ordemPadrao: 'sigla',
  campos: [
    { nome: 'codigo_ibge', tipo: 'texto', rotulo: 'Código IBGE', max: 2, unico: true, lista: true, obrigatorio: true },
    { nome: 'sigla', tipo: 'opcao', rotulo: 'Sigla', opcoes: UF, unico: true, lista: true, busca: true, obrigatorio: true },
    campoNome(60),
  ],
});

definirEntidade({
  nome: 'municipio',
  tabela: 'cad.municipio',
  titulo: 'Municípios',
  tituloSingular: 'Município',
  modulo: AGE,
  menu: 'Cadastros/Endereços',
  rotulo: ['nome', 'uf_sigla'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.1', '1.1.1.40'],
  campos: [
    { nome: 'codigo_ibge', tipo: 'texto', rotulo: 'Código IBGE', max: 7, unico: true, lista: true, busca: true, obrigatorio: true },
    campoNome(80),
    { nome: 'uf_id', tipo: 'ref', ref: 'uf', rotulo: 'Estado', obrigatorio: true, lista: true },
    { nome: 'uf_sigla', tipo: 'texto', rotulo: 'UF', max: 2, lista: true, busca: true },
    { nome: 'latitude', tipo: 'decimal', rotulo: 'Latitude', casas: 6 },
    { nome: 'longitude', tipo: 'decimal', rotulo: 'Longitude', casas: 6 },
  ],
});

definirEntidade({
  nome: 'tipo_logradouro',
  tabela: 'cad.tipo_logradouro',
  titulo: 'Tipos de logradouro',
  tituloSingular: 'Tipo de logradouro',
  modulo: AGE,
  menu: 'Cadastros/Endereços',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.3'],
  campos: [campoCodigo(5, { unico: true, ajuda: 'Código DNE/e-SUS' }), campoNome(40), { nome: 'abreviatura', tipo: 'texto', rotulo: 'Abreviatura', max: 10, lista: true }],
});

definirEntidade({
  nome: 'bairro',
  tabela: 'cad.bairro',
  titulo: 'Bairros',
  tituloSingular: 'Bairro',
  modulo: AGE,
  menu: 'Cadastros/Endereços',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.2', '1.1.1.57.5'],
  unicos: [['municipio_id', 'nome']],
  campos: [
    campoNome(80, { maiusculo: true }),
    { nome: 'municipio_id', tipo: 'ref', ref: 'municipio', rotulo: 'Município', obrigatorio: true, lista: true },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'localidade',
  tabela: 'cad.localidade',
  titulo: 'Localidades',
  tituloSingular: 'Localidade',
  modulo: AGE,
  menu: 'Cadastros/Endereços',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.5'],
  campos: [
    campoNome(80, { maiusculo: true }),
    { nome: 'municipio_id', tipo: 'ref', ref: 'municipio', rotulo: 'Município', obrigatorio: true, lista: true },
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', opcoes: [['URBANA', 'Urbana'], ['RURAL', 'Rural']], lista: true },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'logradouro',
  tabela: 'cad.logradouro',
  titulo: 'Logradouros',
  tituloSingular: 'Logradouro',
  modulo: AGE,
  menu: 'Cadastros/Endereços',
  rotulo: ['tipo_abreviatura', 'nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.4', '1.1.1.57.5', '1.1.1.40'],
  campos: [
    { nome: 'tipo_logradouro_id', tipo: 'ref', ref: 'tipo_logradouro', rotulo: 'Tipo', obrigatorio: true, lista: true, largura: 3 },
    { nome: 'tipo_abreviatura', tipo: 'texto', rotulo: 'Tipo (abrev.)', max: 10, oculto: true },
    campoNome(120, { maiusculo: true, largura: 9 }),
    { nome: 'cep', tipo: 'cep', rotulo: 'CEP', lista: true, busca: true },
    { nome: 'bairro_id', tipo: 'ref', ref: 'bairro', rotulo: 'Bairro', lista: true },
    { nome: 'municipio_id', tipo: 'ref', ref: 'municipio', rotulo: 'Município', obrigatorio: true, lista: true },
    campoAtivo,
  ],
});

// Base do Diretório Nacional de Endereços (DNE) dos Correios, atualizada mensalmente (TR 1.1.1.40).
definirEntidade({
  nome: 'cep',
  tabela: 'cad.cep',
  titulo: 'CEPs (DNE)',
  tituloSingular: 'CEP',
  modulo: AGE,
  menu: 'Cadastros/Endereços',
  rotulo: ['cep', 'logradouro'],
  ordemPadrao: 'cep',
  tr: ['1.1.1.40'],
  campos: [
    { nome: 'cep', tipo: 'cep', rotulo: 'CEP', obrigatorio: true, unico: true, lista: true, busca: true },
    { nome: 'tipo_logradouro', tipo: 'texto', rotulo: 'Tipo de logradouro', max: 30, lista: true },
    { nome: 'logradouro', tipo: 'texto', rotulo: 'Logradouro', max: 150, lista: true, busca: true },
    { nome: 'complemento', tipo: 'texto', rotulo: 'Complemento', max: 120 },
    { nome: 'bairro', tipo: 'texto', rotulo: 'Bairro', max: 80, lista: true, busca: true },
    { nome: 'municipio', tipo: 'texto', rotulo: 'Cidade', max: 80, lista: true, busca: true },
    { nome: 'uf', tipo: 'texto', rotulo: 'UF', max: 2, lista: true },
    { nome: 'codigo_ibge', tipo: 'texto', rotulo: 'Código IBGE', max: 7, lista: true, busca: true },
    { nome: 'atualizado_dne', tipo: 'data', rotulo: 'Atualização DNE' },
  ],
});

definirEntidade({
  nome: 'religiao',
  tabela: 'cad.religiao',
  titulo: 'Religiões',
  tituloSingular: 'Religião',
  modulo: AGE,
  menu: 'Cadastros/Tabelas',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.6', '1.2.6.20'],
  campos: [campoNome(60), campoAtivo],
});

definirEntidade({
  nome: 'etnia',
  tabela: 'cad.etnia',
  titulo: 'Etnias indígenas',
  tituloSingular: 'Etnia',
  modulo: AGE,
  menu: 'Cadastros/Tabelas',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  campos: [campoCodigo(4, { unico: true }), campoNome(80)],
});

definirEntidade({
  nome: 'tipo_encaminhamento',
  tabela: 'cad.tipo_encaminhamento',
  titulo: 'Tipos de encaminhamento',
  tituloSingular: 'Tipo de encaminhamento',
  modulo: AGE,
  menu: 'Cadastros/Tabelas',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.7', '1.2.32.62'],
  campos: [campoNome(80), campoAtivo],
});

definirEntidade({
  nome: 'tipo_vulnerabilidade',
  tabela: 'cad.tipo_vulnerabilidade',
  titulo: 'Tipos de vulnerabilidade',
  tituloSingular: 'Tipo de vulnerabilidade',
  modulo: AGE,
  menu: 'Cadastros/Tabelas',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.8'],
  campos: [campoNome(80), campoAtivo],
});

definirEntidade({
  nome: 'cbo',
  tabela: 'cad.cbo',
  titulo: 'Ocupações (CBO)',
  tituloSingular: 'Ocupação (CBO)',
  modulo: AGE,
  menu: 'Cadastros/Tabelas',
  rotulo: ['codigo', 'nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.1.1.9', '1.1.1.57.7'],
  campos: [
    campoCodigo(6, { unico: true, obrigatorio: true }),
    campoNome(150),
    { nome: 'area_saude', tipo: 'booleano', rotulo: 'Área da saúde', padrao: false, lista: true },
    { nome: 'nivel_superior', tipo: 'booleano', rotulo: 'Nível superior', padrao: false },
    {
      nome: 'atuacao',
      tipo: 'multi_opcao',
      rotulo: 'Locais de atuação',
      ajuda: 'Diferencia profissionais que atuam em USF, UBS, serviços especializados, administrativos e hospitalares (TR 1.2.4.11)',
      opcoes: [
        ['USF', 'USF'],
        ['UBS', 'UBS'],
        ['ESPECIALIZADO', 'Serviços especializados'],
        ['ADMINISTRATIVO', 'Unidades administrativas'],
        ['HOSPITALAR', 'Unidades hospitalares'],
      ],
    },
  ],
});

definirEntidade({
  nome: 'cid',
  tabela: 'cad.cid',
  titulo: 'CID-10',
  tituloSingular: 'CID',
  modulo: AGE,
  menu: 'Cadastros/Tabelas',
  rotulo: ['codigo', 'nome'],
  ordemPadrao: 'codigo',
  tr: ['1.2.32.25', '1.2.32.27'],
  campos: [
    campoCodigo(5, { unico: true, obrigatorio: true }),
    campoNome(400),
    { nome: 'nome_abreviado', tipo: 'texto', rotulo: 'Descrição abreviada', max: 120 },
    { nome: 'capitulo', tipo: 'texto', rotulo: 'Capítulo', max: 10, lista: true },
    { nome: 'restricao_sexo', tipo: 'opcao', rotulo: 'Restrito ao sexo', opcoes: SEXO },
    { nome: 'causa_obito', tipo: 'booleano', rotulo: 'Pode ser causa de óbito', padrao: true },
    {
      nome: 'notificavel',
      tipo: 'booleano',
      rotulo: 'Agravo de notificação compulsória',
      padrao: false,
      lista: true,
      ajuda: 'Ao ser informado em um atendimento, gera aviso automático à Vigilância Epidemiológica (TR 1.2.32.28)',
    },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'ciap',
  tabela: 'cad.ciap',
  titulo: 'CIAP-2',
  tituloSingular: 'CIAP',
  modulo: AGE,
  menu: 'Cadastros/Tabelas',
  rotulo: ['codigo', 'nome'],
  ordemPadrao: 'codigo',
  tr: ['1.2.32.26'],
  campos: [
    campoCodigo(5, { unico: true, obrigatorio: true }),
    campoNome(255),
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'CID-10 correspondente' },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'procedimento',
  tabela: 'cad.procedimento',
  titulo: 'Procedimentos (SIGTAP)',
  tituloSingular: 'Procedimento',
  modulo: 'FAT',
  menu: 'Faturamento/Tabelas',
  rotulo: ['codigo', 'nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.13.1.1', '1.2.13.1.33', '1.2.13.1.32', '1.2.7.8'],
  abas: ['Geral', 'Regras SUS', 'Valores'],
  campos: [
    campoCodigo(10, { unico: true, obrigatorio: true, aba: 'Geral' }),
    campoNome(250, { aba: 'Geral', largura: 12 }),
    { nome: 'sigla', tipo: 'texto', rotulo: 'Sigla', max: 20, busca: true, aba: 'Geral' },
    { nome: 'grupo', tipo: 'texto', rotulo: 'Grupo', max: 2, aba: 'Geral', lista: true },
    { nome: 'subgrupo', tipo: 'texto', rotulo: 'Subgrupo', max: 4, aba: 'Geral' },
    { nome: 'forma_organizacao', tipo: 'texto', rotulo: 'Forma de organização', max: 6, aba: 'Geral' },
    { nome: 'complexidade', tipo: 'opcao', rotulo: 'Complexidade', opcoes: COMPLEXIDADE, aba: 'Regras SUS', lista: true },
    { nome: 'sexo', tipo: 'opcao', rotulo: 'Sexo permitido', opcoes: [['A', 'Ambos'], ['M', 'Masculino'], ['F', 'Feminino'], ['N', 'Não se aplica']], aba: 'Regras SUS' },
    { nome: 'idade_minima_meses', tipo: 'inteiro', rotulo: 'Idade mínima (meses)', aba: 'Regras SUS' },
    { nome: 'idade_maxima_meses', tipo: 'inteiro', rotulo: 'Idade máxima (meses)', aba: 'Regras SUS' },
    { nome: 'quantidade_maxima', tipo: 'inteiro', rotulo: 'Quantidade máxima', aba: 'Regras SUS' },
    { nome: 'instrumentos', tipo: 'multi_opcao', rotulo: 'Instrumentos de registro', opcoes: INSTRUMENTO_REGISTRO, aba: 'Regras SUS' },
    { nome: 'exige_cid', tipo: 'booleano', rotulo: 'Exige CID', padrao: false, aba: 'Regras SUS' },
    { nome: 'financiamento', tipo: 'texto', rotulo: 'Financiamento', max: 2, aba: 'Regras SUS' },
    { nome: 'valor_sa', tipo: 'moeda', rotulo: 'Valor ambulatorial (SA)', aba: 'Valores' },
    { nome: 'valor_sh', tipo: 'moeda', rotulo: 'Valor hospitalar (SH)', aba: 'Valores' },
    { nome: 'valor_sp', tipo: 'moeda', rotulo: 'Valor profissional (SP)', aba: 'Valores' },
    {
      nome: 'valor_municipal',
      tipo: 'moeda',
      rotulo: 'Valor diferenciado (fora da tabela)',
      aba: 'Valores',
      ajuda: 'Valor de repasse diferenciado definido pelo município (TR 1.2.13.1.32)',
    },
    { nome: 'competencia', tipo: 'texto', rotulo: 'Competência SIGTAP', max: 6, aba: 'Geral' },
    { nome: 'preparo', tipo: 'texto_longo', rotulo: 'Recomendações e preparo', aba: 'Geral', ajuda: 'Impresso junto ao comprovante de agendamento (TR 1.2.10.29)' },
    campoAtivo,
  ],
  filhos: [
    { entidade: 'procedimento_cbo', campo: 'procedimento_id', titulo: 'CBOs permitidos' },
    { entidade: 'procedimento_cid', campo: 'procedimento_id', titulo: 'CIDs compatíveis' },
  ],
});

definirEntidade({
  nome: 'procedimento_cbo',
  tabela: 'cad.procedimento_cbo',
  titulo: 'CBOs do procedimento',
  tituloSingular: 'CBO do procedimento',
  modulo: 'FAT',
  rotulo: ['cbo_id'],
  unicos: [['procedimento_id', 'cbo_id']],
  campos: [
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento', obrigatorio: true },
    { nome: 'cbo_id', tipo: 'ref', ref: 'cbo', rotulo: 'CBO', obrigatorio: true, lista: true },
  ],
});

definirEntidade({
  nome: 'procedimento_cid',
  tabela: 'cad.procedimento_cid',
  titulo: 'CIDs do procedimento',
  tituloSingular: 'CID do procedimento',
  modulo: 'FAT',
  rotulo: ['cid_id'],
  unicos: [['procedimento_id', 'cid_id']],
  campos: [
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento', obrigatorio: true },
    { nome: 'cid_id', tipo: 'ref', ref: 'cid', rotulo: 'CID', obrigatorio: true, lista: true },
    { nome: 'principal', tipo: 'booleano', rotulo: 'CID principal', padrao: true, lista: true },
  ],
});

definirEntidade({
  nome: 'convenio',
  tabela: 'cad.convenio',
  titulo: 'Convênios',
  tituloSingular: 'Convênio',
  modulo: AGE,
  menu: 'Cadastros/Agendamento',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  campos: [campoNome(80), { nome: 'sus', tipo: 'booleano', rotulo: 'SUS', padrao: true, lista: true }, campoAtivo],
});

definirEntidade({
  nome: 'especialidade',
  tabela: 'cad.especialidade',
  titulo: 'Especialidades',
  tituloSingular: 'Especialidade',
  modulo: AGE,
  menu: 'Cadastros/Agendamento',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.12.14'],
  campos: [
    campoNome(80),
    {
      nome: 'tipo',
      tipo: 'opcao',
      rotulo: 'Tipo',
      obrigatorio: true,
      lista: true,
      opcoes: [
        ['MEDICA', 'Médica'],
        ['ODONTOLOGICA', 'Odontológica'],
        ['ENFERMAGEM', 'Enfermagem'],
        ['MULTIPROFISSIONAL', 'Multiprofissional'],
      ],
    },
    { nome: 'cbo_id', tipo: 'ref', ref: 'cbo', rotulo: 'CBO principal' },
    { nome: 'atencao', tipo: 'opcao', rotulo: 'Nível de atenção', opcoes: [['BASICA', 'Atenção básica'], ['ESPECIALIZADA', 'Atenção especializada']], lista: true },
    { nome: 'sexo_permitido', tipo: 'opcao', rotulo: 'Restrição de sexo', opcoes: [['A', 'Ambos'], ['M', 'Somente masculino'], ['F', 'Somente feminino']], padrao: 'A' },
    { nome: 'idade_minima', tipo: 'inteiro', rotulo: 'Idade mínima (anos)' },
    { nome: 'idade_maxima', tipo: 'inteiro', rotulo: 'Idade máxima (anos)' },
    { nome: 'regulada', tipo: 'booleano', rotulo: 'Agendamento regulado', padrao: false, ajuda: 'Solicitações seguem para a fila da regulação (TR 1.2.43.1.1)' },
    { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento faturado na consulta', ajuda: 'Lançado automaticamente na produção BPA (TR 1.2.32.18)' },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'feriado',
  tabela: 'cad.feriado',
  titulo: 'Feriados e bloqueios',
  tituloSingular: 'Feriado',
  modulo: AGE,
  menu: 'Cadastros/Agendamento',
  rotulo: ['data', 'descricao'],
  ordemPadrao: 'data desc',
  tr: ['1.2.7.6', '1.2.7.7', '1.2.12.16', '1.2.40.27'],
  campos: [
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição', max: 100, obrigatorio: true, lista: true, busca: true },
    {
      nome: 'tipo',
      tipo: 'opcao',
      rotulo: 'Tipo',
      lista: true,
      opcoes: [
        ['NACIONAL', 'Feriado nacional'],
        ['ESTADUAL', 'Feriado estadual'],
        ['MUNICIPAL', 'Feriado municipal'],
        ['PONTO_FACULTATIVO', 'Ponto facultativo'],
      ],
    },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Somente na unidade', ajuda: 'Deixe em branco para todas as unidades' },
    {
      nome: 'rotas_afetadas',
      tipo: 'opcao',
      rotulo: 'Rotas de transporte afetadas',
      padrao: 'TODAS',
      opcoes: [
        ['NENHUMA', 'Nenhuma'],
        ['TODAS', 'Todas'],
        ['MUNICIPIO', 'Rotas do município'],
        ['FORA', 'Rotas para fora do município'],
      ],
    },
  ],
});
