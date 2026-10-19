// Imunizações: imunobiológicos, calendário (quadro de cobertura), campanhas,
// carteira de vacinação e frascos abertos (TR 1.2.39).
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';
import { SEXO } from '../cadastros/opcoes.js';

const IMU = 'IMU';

export const ESTRATEGIAS: [string, string][] = [
  ['ROTINA', 'Rotina'],
  ['ESPECIAL', 'Especial'],
  ['BLOQUEIO', 'Bloqueio'],
  ['INTENSIFICACAO', 'Intensificação'],
  ['CAMPANHA', 'Campanha'],
];

definirEntidade({
  nome: 'imunobiologico',
  tabela: 'imu.imunobiologico',
  titulo: 'Imunobiológicos',
  tituloSingular: 'Imunobiológico',
  modulo: IMU,
  menu: 'Imunização/Cadastros',
  rotulo: ['sigla'],
  ordemPadrao: 'ordem_carteira',
  tr: ['1.2.39.1.1', '1.2.39.1.2', '1.2.39.1.4', '1.2.39.1.12', '1.2.39.1.13', '1.2.39.1.14'],
  campos: [
    campoNome(120),
    { nome: 'sigla', tipo: 'texto', rotulo: 'Nome reduzido (carteira)', max: 20, obrigatorio: true, lista: true, busca: true },
    { nome: 'codigo_sipni', tipo: 'texto', rotulo: 'Código no SI-PNI', max: 10, lista: true },
    { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', opcoes: [['VACINA', 'Vacina'], ['SORO', 'Soro'], ['IMUNOGLOBULINA', 'Imunoglobulina']], padrao: 'VACINA', lista: true },
    { nome: 'via', tipo: 'opcao', rotulo: 'Via de administração', opcoes: [['IM', 'Intramuscular'], ['SC', 'Subcutânea'], ['ID', 'Intradérmica'], ['VO', 'Oral'], ['IN', 'Intranasal'], ['EV', 'Endovenosa']], lista: true },
    { nome: 'produto_id', tipo: 'ref', ref: 'produto', rotulo: 'Produto no estoque', ajuda: 'Baixa automática do estoque na aplicação' },
    { nome: 'exige_diluente', tipo: 'booleano', rotulo: 'Exige diluente', padrao: false },
    { nome: 'doses_tratamento', tipo: 'inteiro', rotulo: 'Doses por tratamento (soros)', ajuda: 'Baixa automática de todas as doses do tratamento (TR 1.2.39.1.27)' },
    { nome: 'exibir_carteira', tipo: 'booleano', rotulo: 'Exibir na carteira de vacinação', padrao: true },
    { nome: 'ordem_carteira', tipo: 'inteiro', rotulo: 'Ordem na carteira', padrao: 100 },
    campoAtivo,
  ],
  filhos: [
    { entidade: 'imunobiologico_diluente', campo: 'imunobiologico_id', titulo: 'Diluentes' },
    { entidade: 'imunobiologico_incompatibilidade', campo: 'imunobiologico_id', titulo: 'Incompatibilidades' },
    { entidade: 'imunobiologico_equivalencia', campo: 'imunobiologico_id', titulo: 'Equivalências' },
  ],
});

definirEntidade({
  nome: 'imunobiologico_diluente',
  tabela: 'imu.imunobiologico_diluente',
  titulo: 'Diluentes do imunobiológico',
  tituloSingular: 'Diluente',
  modulo: IMU,
  permissao: 'imunobiologico',
  rotulo: ['produto_id'],
  unicos: [['imunobiologico_id', 'produto_id']],
  campos: [
    { nome: 'imunobiologico_id', tipo: 'ref', ref: 'imunobiologico', rotulo: 'Imunobiológico', obrigatorio: true },
    { nome: 'produto_id', tipo: 'ref', ref: 'produto', rotulo: 'Diluente (produto)', obrigatorio: true, lista: true },
  ],
});

definirEntidade({
  nome: 'imunobiologico_incompatibilidade',
  tabela: 'imu.imunobiologico_incompatibilidade',
  titulo: 'Imunobiológicos incompatíveis',
  tituloSingular: 'Incompatibilidade',
  modulo: IMU,
  permissao: 'imunobiologico',
  rotulo: ['incompativel_id'],
  tr: ['1.2.39.1.3'],
  campos: [
    { nome: 'imunobiologico_id', tipo: 'ref', ref: 'imunobiologico', rotulo: 'Imunobiológico', obrigatorio: true },
    { nome: 'incompativel_id', tipo: 'ref', ref: 'imunobiologico', rotulo: 'Incompatível com', obrigatorio: true, lista: true },
    { nome: 'intervalo_dias', tipo: 'inteiro', rotulo: 'Intervalo mínimo (dias)', obrigatorio: true, lista: true },
  ],
});

definirEntidade({
  nome: 'imunobiologico_equivalencia',
  tabela: 'imu.imunobiologico_equivalencia',
  titulo: 'Equivalências entre imunobiológicos',
  tituloSingular: 'Equivalência',
  modulo: IMU,
  permissao: 'imunobiologico',
  rotulo: ['equivale_id'],
  tr: ['1.2.39.1.7'],
  campos: [
    { nome: 'imunobiologico_id', tipo: 'ref', ref: 'imunobiologico', rotulo: 'Imunobiológico aplicado', obrigatorio: true },
    { nome: 'dose_id', tipo: 'ref', ref: 'dose', rotulo: 'Dose aplicada', lista: true },
    { nome: 'equivale_id', tipo: 'ref', ref: 'imunobiologico', rotulo: 'Equivale a', obrigatorio: true, lista: true },
    { nome: 'equivale_dose_id', tipo: 'ref', ref: 'dose', rotulo: 'Dose equivalente', lista: true },
  ],
});

definirEntidade({
  nome: 'dose',
  tabela: 'imu.dose',
  titulo: 'Doses',
  tituloSingular: 'Dose',
  modulo: IMU,
  menu: 'Imunização/Cadastros',
  rotulo: ['sigla'],
  ordemPadrao: 'ordem',
  campos: [
    campoNome(40),
    { nome: 'sigla', tipo: 'texto', rotulo: 'Sigla', max: 6, obrigatorio: true, lista: true },
    { nome: 'codigo_sipni', tipo: 'texto', rotulo: 'Código SI-PNI', max: 4, lista: true },
    { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem', padrao: 1 },
  ],
});

definirEntidade({
  nome: 'quadro_cobertura',
  tabela: 'imu.quadro_cobertura',
  titulo: 'Quadro de cobertura (calendário vacinal)',
  tituloSingular: 'Regra do calendário vacinal',
  modulo: IMU,
  menu: 'Imunização/Cadastros',
  rotulo: ['imunobiologico_id', 'dose_id'],
  ordemPadrao: 'idade_minima_dias',
  tr: ['1.2.39.1.6', '1.2.39.1.8', '1.2.39.1.26', '1.2.39.1.16.5', '1.2.39.1.17'],
  campos: [
    { nome: 'imunobiologico_id', tipo: 'ref', ref: 'imunobiologico', rotulo: 'Imunobiológico', obrigatorio: true, lista: true },
    { nome: 'dose_id', tipo: 'ref', ref: 'dose', rotulo: 'Dose', obrigatorio: true, lista: true },
    { nome: 'estrategia', tipo: 'opcao', rotulo: 'Estratégia', opcoes: ESTRATEGIAS, padrao: 'ROTINA', lista: true },
    { nome: 'faixa_carteira', tipo: 'opcao', rotulo: 'Faixa da carteira', opcoes: [['CRIANCA', 'Criança'], ['ADOLESCENTE', 'Adolescente'], ['ADULTO', 'Adulto'], ['IDOSO', 'Idoso'], ['GESTANTE', 'Gestante']], lista: true },
    { nome: 'faixa_sipni', tipo: 'texto', rotulo: 'Faixa etária do SI-PNI', max: 20 },
    { nome: 'idade_minima_dias', tipo: 'inteiro', rotulo: 'Idade mínima (em dias)', obrigatorio: true, lista: true, ajuda: 'Anos×365 + meses×30 + dias' },
    { nome: 'idade_maxima_dias', tipo: 'inteiro', rotulo: 'Idade máxima (em dias)', lista: true },
    { nome: 'sexo', tipo: 'opcao', rotulo: 'Sexo', opcoes: [['A', 'Ambos'], ...SEXO.slice(0, 2)], padrao: 'A' },
    { nome: 'gestante', tipo: 'opcao', rotulo: 'Aplicação em gestantes', opcoes: [['INDIFERENTE', 'Indiferente'], ['RECOMENDADO', 'Recomendado'], ['NAO_RECOMENDADO', 'Não recomendado']], padrao: 'INDIFERENTE' },
    { nome: 'proxima_dose_id', tipo: 'ref', ref: 'dose', rotulo: 'Próxima dose (aprazamento)' },
    { nome: 'intervalo_proxima_dias', tipo: 'inteiro', rotulo: 'Intervalo para a próxima dose (dias)' },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'campanha_vacinacao',
  tabela: 'imu.campanha',
  titulo: 'Campanhas de vacinação',
  tituloSingular: 'Campanha de vacinação',
  modulo: IMU,
  menu: 'Imunização',
  rotulo: ['nome'],
  ordemPadrao: 'inicio desc',
  tr: ['1.2.39.1.9', '1.2.39.1.10', '1.2.39.1.11'],
  campos: [
    campoNome(120),
    { nome: 'estrategia', tipo: 'opcao', rotulo: 'Estratégia', opcoes: ESTRATEGIAS, padrao: 'CAMPANHA', lista: true },
    { nome: 'inicio', tipo: 'data', rotulo: 'Início', obrigatorio: true, lista: true },
    { nome: 'fim', tipo: 'data', rotulo: 'Fim', obrigatorio: true, lista: true },
    campoAtivo,
  ],
  filhos: [{ entidade: 'campanha_grupo', campo: 'campanha_id', titulo: 'Grupos de vacinação e metas' }],
});

definirEntidade({
  nome: 'campanha_grupo',
  tabela: 'imu.campanha_grupo',
  titulo: 'Grupos da campanha',
  tituloSingular: 'Grupo da campanha',
  modulo: IMU,
  permissao: 'campanha_vacinacao',
  rotulo: ['nome'],
  campos: [
    { nome: 'campanha_id', tipo: 'ref', ref: 'campanha_vacinacao', rotulo: 'Campanha', obrigatorio: true },
    campoNome(80, { rotulo: 'Grupo de vacinação' }),
    { nome: 'imunobiologico_id', tipo: 'ref', ref: 'imunobiologico', rotulo: 'Imunobiológico', obrigatorio: true, lista: true },
    { nome: 'dose_id', tipo: 'ref', ref: 'dose', rotulo: 'Dose', lista: true },
    { nome: 'idade_minima_dias', tipo: 'inteiro', rotulo: 'Idade inicial (dias)', lista: true },
    { nome: 'idade_maxima_dias', tipo: 'inteiro', rotulo: 'Idade final (dias)', lista: true },
    { nome: 'populacao_alvo', tipo: 'inteiro', rotulo: 'População alvo', lista: true },
    { nome: 'meta_percentual', tipo: 'decimal', casas: 2, rotulo: 'Meta (%)', lista: true },
  ],
});

definirEntidade({
  nome: 'vacinacao',
  tabela: 'imu.vacinacao',
  titulo: 'Registros de vacinação',
  tituloSingular: 'Registro de vacinação',
  modulo: IMU,
  menu: 'Imunização',
  rotulo: ['data', 'imunobiologico_id'],
  ordemPadrao: 'data desc',
  tr: ['1.2.6.29', '1.2.6.55', '1.2.39.1.19', '1.2.39.1.22', '1.2.39.1.38', '1.2.39.1.41', '1.2.39.1.46'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    { nome: 'imunobiologico_id', tipo: 'ref', ref: 'imunobiologico', rotulo: 'Imunobiológico', obrigatorio: true, lista: true },
    { nome: 'dose_id', tipo: 'ref', ref: 'dose', rotulo: 'Dose', lista: true },
    {
      nome: 'tipo',
      tipo: 'opcao',
      rotulo: 'Registro',
      obrigatorio: true,
      lista: true,
      opcoes: [['APLICACAO', 'Aplicação'], ['RESGATE', 'Resgate (vacina anterior)'], ['APRAZAMENTO', 'Aprazamento'], ['INDICACAO', 'Indicação']],
    },
    { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', lista: true },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Vacinador', lista: true },
    { nome: 'profissional_texto', tipo: 'texto', rotulo: 'Profissional (resgate)', max: 70 },
    { nome: 'lote_id', tipo: 'ref', ref: 'estoque_lote', rotulo: 'Lote' },
    { nome: 'lote_texto', tipo: 'texto', rotulo: 'Lote (resgate)', max: 40, lista: true },
    { nome: 'fabricante_id', tipo: 'ref', ref: 'fabricante', rotulo: 'Fabricante' },
    { nome: 'estrategia', tipo: 'opcao', rotulo: 'Estratégia', opcoes: ESTRATEGIAS, padrao: 'ROTINA' },
    { nome: 'campanha_id', tipo: 'ref', ref: 'campanha_vacinacao', rotulo: 'Campanha' },
    { nome: 'grupo_id', tipo: 'ref', ref: 'campanha_grupo', rotulo: 'Grupo da campanha' },
    { nome: 'gestante', tipo: 'booleano', rotulo: 'Gestante', padrao: false },
    { nome: 'inadvertida', tipo: 'booleano', rotulo: 'Aplicação inadvertida', padrao: false, lista: true },
    { nome: 'motivo_inadvertida', tipo: 'texto', rotulo: 'Motivo da aplicação inadvertida', max: 250 },
    { nome: 'via', tipo: 'texto', rotulo: 'Via', max: 10 },
    { nome: 'local_aplicacao', tipo: 'opcao', rotulo: 'Local de aplicação', opcoes: [['DELTOIDE_D', 'Deltoide direito'], ['DELTOIDE_E', 'Deltoide esquerdo'], ['VASTO_LATERAL_D', 'Vasto lateral da coxa direita'], ['VASTO_LATERAL_E', 'Vasto lateral da coxa esquerda'], ['GLUTEO', 'Glúteo'], ['ORAL', 'Oral'], ['OUTRO', 'Outro']] },
    { nome: 'frasco_id', tipo: 'ref', ref: 'frasco_aberto', rotulo: 'Frasco', oculto: true },
    { nome: 'diluente_lote_id', tipo: 'ref', ref: 'estoque_lote', rotulo: 'Lote do diluente' },
    { nome: 'data_aprazada', tipo: 'data', rotulo: 'Data aprazada (próxima dose)', lista: true },
    { nome: 'observacao', tipo: 'texto', rotulo: 'Observação', max: 250 },
    { nome: 'exportado_sipni_em', tipo: 'data_hora', rotulo: 'Exportado ao SI-PNI em', somenteLeitura: true },
  ],
});

definirEntidade({
  nome: 'frasco_aberto',
  tabela: 'imu.frasco_aberto',
  titulo: 'Frascos de vacinas abertos',
  tituloSingular: 'Frasco aberto',
  modulo: IMU,
  menu: 'Imunização',
  rotulo: ['lote_id', 'aberto_em'],
  ordemPadrao: 'aberto_em desc',
  tr: ['1.2.39.1.30', '1.2.39.1.31', '1.2.39.1.32', '1.2.39.1.33', '1.2.39.1.49', '1.2.39.1.50'],
  campos: [
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
    { nome: 'lote_id', tipo: 'ref', ref: 'estoque_lote', rotulo: 'Lote', obrigatorio: true, lista: true },
    { nome: 'aberto_em', tipo: 'data_hora', rotulo: 'Aberto em', obrigatorio: true, lista: true },
    { nome: 'doses_total', tipo: 'inteiro', rotulo: 'Doses do frasco', obrigatorio: true, lista: true },
    { nome: 'doses_usadas', tipo: 'inteiro', rotulo: 'Doses usadas', padrao: 0, lista: true },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['ABERTO', 'Aberto'], ['ENCERRADO', 'Encerrado (todas as doses usadas)'], ['INUTILIZADO', 'Doses restantes inutilizadas']], padrao: 'ABERTO', lista: true },
  ],
});

definirEntidade({
  nome: 'eapv',
  tabela: 'imu.eapv',
  titulo: 'Eventos adversos pós-vacinação (EAPV)',
  tituloSingular: 'Evento adverso',
  modulo: IMU,
  menu: 'Imunização',
  rotulo: ['data', 'paciente_id'],
  ordemPadrao: 'data desc',
  tr: ['1.2.39.1.5'],
  campos: [
    { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true },
    { nome: 'vacinacao_id', tipo: 'ref', ref: 'vacinacao', rotulo: 'Aplicação relacionada' },
    { nome: 'data', tipo: 'data', rotulo: 'Data do evento', obrigatorio: true, lista: true },
    { nome: 'tipo_evento', tipo: 'texto', rotulo: 'Evento adverso', max: 120, obrigatorio: true, lista: true },
    { nome: 'gravidade', tipo: 'opcao', rotulo: 'Gravidade', opcoes: [['NAO_GRAVE', 'Não grave'], ['GRAVE', 'Grave']], lista: true },
    { nome: 'descricao', tipo: 'texto_longo', rotulo: 'Descrição e conduta' },
  ],
});
