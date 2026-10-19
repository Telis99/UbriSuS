// Parâmetros, perfis padrão, unidades da rede de Cabreúva (TR item 4.6) e administrador inicial.
import type pg from 'pg';
import { config } from '../../config.js';
import { gerarHashSenha, gerarSenhaTemporaria } from '../../seguranca/senha.js';

export const PARAMETROS: [string, unknown, string, string][] = [
  ['entidade.nome', config.nomeEntidade, 'Nome da entidade nos relatórios', 'TEC'],
  ['entidade.secretaria', config.nomeSecretaria, 'Nome da secretaria nos relatórios', 'TEC'],
  ['entidade.brasao', null, 'Arquivo do brasão do município (id)', 'TEC'],
  ['relatorio.marca_dagua', null, "Imagem de marca d'água dos relatórios (id do arquivo)", 'TEC'],
  ['relatorio.papel_timbrado', null, 'Papel timbrado dos relatórios (id do arquivo)', 'TEC'],
  ['relatorio.rodape', '', 'Texto adicional no rodapé dos relatórios', 'TEC'],
  ['relatorio.dias_retencao', 365, 'Dias mínimos de guarda das cópias de relatórios emitidos', 'TEC'],
  ['arquivo.tamanho_maximo_mb', 20, 'Tamanho máximo de arquivos anexados (MB)', 'TEC'],
  ['suporte.expediente', { inicio: '08:00', fim: '17:00' }, 'Horário de expediente do órgão para cálculo do MTtR', 'TEC'],
  ['seguranca.versao_termos', '2026.1', 'Versão vigente dos termos de uso', 'TEC'],
  [
    'seguranca.termos_uso',
    'Ao utilizar o sistema de gestão da saúde, o operador declara estar ciente de que: (1) o acesso é pessoal e intransferível; (2) todas as operações são registradas em log de auditoria com data, hora, IP e identificação do operador; (3) os dados pessoais e sensíveis dos cidadãos devem ser tratados exclusivamente para as finalidades do serviço público de saúde, nos termos da Lei 13.709/2018 (LGPD); (4) o uso indevido de informações sujeita o infrator às penalidades administrativas, civis e penais cabíveis.',
    'Termos e condições de uso exibidos no primeiro login',
    'TEC',
  ],
  ['publico.politica_cookies_versao', '2026.1', 'Versão da política de cookies', 'TEC'],
  [
    'publico.politica_cookies',
    'Este sistema utiliza apenas cookies estritamente necessários para manter a sessão autenticada e registrar suas preferências de uso. Não são utilizados cookies de publicidade ou rastreamento de terceiros.',
    'Política de cookies',
    'TEC',
  ],
  ['paciente.validade_cadastro_dias', 365, 'Dias até exigir atualização cadastral do paciente', 'AGE'],
  ['paciente.bloquear_cadastro_vencido', true, 'Bloquear atendimento até atualizar cadastro vencido', 'AGE'],
  ['paciente.validade_pre_cadastro_dias', 30, 'Validade do pré-cadastro de urgência (dias)', 'AGE'],
  ['paciente.campos_obrigatorios', ['cns'], 'Campos adicionais obrigatórios no cadastro completo', 'AGE'],
  ['paciente.alertar_unidade_sem_vinculo', true, 'Alertar paciente sem vínculo com a unidade', 'AGE'],
  ['paciente.alertar_outro_municipio', true, 'Alertar paciente residente em outro município', 'AGE'],
  ['alerta.preventivo', { idadeInicial: 25, idadeFinal: 64, intervaloMeses: 36 }, 'Rastreamento do câncer do colo do útero (citopatológico)', 'AGE'],
  ['alerta.mamografia', { idadeInicial: 50, idadeFinal: 69, intervaloMeses: 24 }, 'Rastreamento do câncer de mama (mamografia)', 'AGE'],
  ['agenda.dias_bloqueio_falta', 30, 'Dias de bloqueio de novo agendamento especializado após falta não justificada', 'AGE'],
  ['agenda.horizonte_geracao_dias', 120, 'Horizonte (dias) de geração automática dos horários das agendas', 'AGE'],
  ['agenda.validar_carga_horaria', true, 'Impedir agendas acima da carga horária do vínculo do profissional', 'AGE'],
  ['exames.exigir_peso_altura', false, 'Exigir peso e altura do paciente na requisição de exames (regulação)', 'AMB'],
  ['exames.limite_sem_justificativa', 10, 'Quantidade de exames por requisição sem exigir justificativa', 'AMB'],
  ['exames.lista_espera_automatica', true, 'Incluir automaticamente na lista de espera os exames requisitados', 'AMB'],
  ['receita.impressao', { cabecalho: true, rodape: true, logoSus: true, duasVias: false, textoCabecalho: '' }, 'Configuração da impressão de receitas (cabeçalho, rodapé, logotipo do SUS, duas vias)', 'PEP'],
  ['integracao.rnds', { ativo: false, urlAutenticacao: 'https://ehr-auth-hmg.saude.gov.br/api/token', urlServicos: 'https://sp-ehr-services.hmg.saude.gov.br', certificadoId: null, cpfResponsavel: '' }, 'Integração CADSUS/RNDS', 'TEC'],
];

export async function carregarParametros(c: pg.PoolClient) {
  for (const [chave, valor, descricao, modulo] of PARAMETROS) {
    await c.query(
      `insert into sis.parametro (chave, valor, descricao, modulo) values ($1,$2,$3,$4)
       on conflict (chave) do update set descricao = excluded.descricao, modulo = excluded.modulo`,
      [chave, JSON.stringify(valor), descricao, modulo],
    );
  }
}

export const PERFIS: { nome: string; categoria: string; grupo: string | null; descricao: string; permissoes: string[] }[] = [
  { nome: 'Administrador', categoria: 'ADMINISTRADOR', grupo: 'GESTAO', descricao: 'Acesso total ao sistema', permissoes: ['*'] },
  {
    nome: 'Recepção e agendamento',
    categoria: 'OPERACIONAL',
    grupo: 'RECEPCAO',
    descricao: 'Cadastro de pacientes, recepção, filas e agendamentos',
    permissoes: ['AGE:consultar', 'AGE:incluir', 'AGE:alterar', 'AGE:exportar', 'paciente:*', 'familia:*', 'AMB:consultar', 'recepcao:*', 'agenda:*', 'TRA:consultar', 'TRA:incluir'],
  },
  {
    nome: 'Médico',
    categoria: 'OPERACIONAL',
    grupo: 'MEDICOS',
    descricao: 'Atendimento médico, prontuário, prescrição e solicitações',
    permissoes: ['AGE:consultar', 'paciente:consultar', 'paciente:alterar', 'AMB:*', 'PEP:*', 'UPA:*', 'IMU:consultar', 'FAR:consultar', 'TFD:incluir', 'TFD:consultar', 'AIH:incluir', 'AIH:consultar', 'REG:consultar', 'LAB:consultar', 'RAD:consultar', 'ECO:consultar', 'CAPS:*'],
  },
  {
    nome: 'Enfermagem',
    categoria: 'OPERACIONAL',
    grupo: 'ENFERMAGEM',
    descricao: 'Acolhimento, triagem, procedimentos de enfermagem e vacinação',
    permissoes: ['AGE:consultar', 'paciente:consultar', 'paciente:alterar', 'AMB:*', 'UPA:*', 'IMU:*', 'FAR:consultar', 'PEP:consultar'],
  },
  {
    nome: 'Farmácia',
    categoria: 'OPERACIONAL',
    grupo: 'FARMACIA',
    descricao: 'Estoque, dispensação e assistência farmacêutica',
    permissoes: ['AGE:consultar', 'paciente:consultar', 'FAR:*'],
  },
  {
    nome: 'Odontologia',
    categoria: 'OPERACIONAL',
    grupo: 'ODONTOLOGIA',
    descricao: 'Atendimento odontológico e odontograma',
    permissoes: ['AGE:consultar', 'paciente:consultar', 'paciente:alterar', 'ODO:*', 'AMB:consultar', 'FAR:consultar'],
  },
  {
    nome: 'Agente comunitário de saúde',
    categoria: 'OPERACIONAL',
    grupo: 'ACS',
    descricao: 'Aplicativo do ACS: visitas e cadastro domiciliar',
    permissoes: ['ACS:*', 'paciente:consultar', 'paciente:alterar', 'familia:*'],
  },
  {
    nome: 'Gestor da saúde',
    categoria: 'GERENCIAL',
    grupo: 'GESTAO',
    descricao: 'Indicadores, relatórios gerenciais, faturamento e regulação',
    permissoes: ['IND:*', 'FAT:*', 'REG:*', 'AIH:*', 'TFD:*', 'AGE:consultar', 'AGE:exportar', 'auditoria:consultar'],
  },
  { nome: 'Consulta', categoria: 'CONSULTA', grupo: null, descricao: 'Somente consulta aos cadastros', permissoes: ['AGE:consultar'] },
];

export async function carregarPerfis(c: pg.PoolClient) {
  for (const p of PERFIS) {
    await c.query(
      `insert into seg.perfil (nome, categoria, grupo_profissional, descricao, permissoes, ativo)
       select $1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::jsonb,true where not exists (select 1 from seg.perfil where nome = $1::varchar)`,
      [p.nome, p.categoria, p.grupo, p.descricao, JSON.stringify(p.permissoes)],
    );
  }
}

// Unidades atendidas pelo sistema (Termo de Referência, item 4.6).
export const UNIDADES_CABREUVA: { nome: string; tipo: string; cnesTipo: string; logradouro: string; numero: string; bairro: string }[] = [
  { nome: 'USF HERMÓGENES DE GODOY', tipo: 'USF', cnesTipo: '02', logradouro: 'AV MARCIANO XAVIER DE OLIVEIRA', numero: '314', bairro: 'CENTRO' },
  { nome: 'USF IRMÃO BRUNO E PHELIPE ZACCHI SPINA', tipo: 'USF', cnesTipo: '02', logradouro: 'AV ADÉLIA BARBOSA DE OLIVEIRA', numero: '128', bairro: 'VILAREJO' },
  { nome: 'USF EMÍLIA STEPHANI SIMIONATO', tipo: 'USF', cnesTipo: '02', logradouro: 'RUA DAS PALMEIRAS', numero: '32', bairro: 'PINHAL' },
  { nome: 'USF DARIO MORI ROMANI', tipo: 'USF', cnesTipo: '02', logradouro: 'AV HENRIQUE SÓRIO', numero: '413', bairro: 'BANANAL' },
  { nome: 'USF CONRADO VAZ GUIMARÃES', tipo: 'USF', cnesTipo: '02', logradouro: 'RUA DOS COQUEIROS', numero: '459', bairro: 'VALE VERDE' },
  { nome: 'UBS ANNITA VANINI SPINA', tipo: 'UBS', cnesTipo: '02', logradouro: 'RODOVIA PREFEITO JOÃO ZACHI', numero: 'S/N', bairro: 'CENTRO' },
  { nome: 'POLICLÍNICA MILENA CIOLA', tipo: 'POLICLINICA', cnesTipo: '04', logradouro: 'AV PASCHOAL SANTI', numero: 'S/N', bairro: 'NOVO BONFIM' },
  { nome: 'POLICLÍNICA WILSON FEDERZONI', tipo: 'POLICLINICA', cnesTipo: '04', logradouro: 'RUA ANDRELINO SPINA', numero: '100', bairro: 'JACARÉ' },
  { nome: 'CEO - CENTRO DE ESPECIALIDADES ODONTOLÓGICAS', tipo: 'CEO', cnesTipo: '36', logradouro: 'RUA CONCÓRDIA', numero: '153', bairro: 'JACARÉ' },
  { nome: 'UPA - UNIDADE DE PRONTO ATENDIMENTO ANTÔNIO BARADEL', tipo: 'UPA', cnesTipo: '73', logradouro: 'AV BENEDITO BICUDO GALVÃO', numero: '100', bairro: 'JACARÉ' },
  { nome: 'CEM - CENTRO DE ESPECIALIDADES MÉDICAS', tipo: 'CEM', cnesTipo: '36', logradouro: 'AV VEREADOR JOSÉ DONATO', numero: '489', bairro: 'JACARÉ' },
  { nome: 'CER - CENTRO DE REABILITAÇÃO E FISIOTERAPIA', tipo: 'CER', cnesTipo: '36', logradouro: 'RUA CARACOL', numero: '300', bairro: 'JACARÉ' },
  { nome: 'CAPS - CENTRO DE ATENÇÃO PSICOSSOCIAL', tipo: 'CAPS', cnesTipo: '70', logradouro: 'RUA RENATO DE BARROS CAMARGO', numero: '176', bairro: 'CENTRO' },
  { nome: 'CRICA - CENTRO DE REFERÊNCIA INTEGRADO À CRIANÇA E ADOLESCENTE', tipo: 'CEM', cnesTipo: '36', logradouro: 'RUA ESPÍRITO SANTO', numero: '32', bairro: 'JACARÉ' },
  { nome: 'MELHOR EM CASA - ATENÇÃO DOMICILIAR', tipo: 'AD', cnesTipo: '77', logradouro: 'RUA MARAJÓ', numero: '02', bairro: 'JACARÉ' },
  { nome: 'ALMOXARIFADO SAÚDE (ASSISTÊNCIA FARMACÊUTICA)', tipo: 'FARMACIA', cnesTipo: '84', logradouro: 'RUA FERNANDO NUNES', numero: '100', bairro: 'JACARÉ' },
  { nome: 'SAE - SERVIÇO DE ATENDIMENTO EMERGENCIAL', tipo: 'UPA', cnesTipo: '42', logradouro: 'AV SÃO PAULO', numero: 'S/N', bairro: 'JACARÉ' },
  { nome: 'VISA - VIGILÂNCIA SANITÁRIA E EPIDEMIOLÓGICA', tipo: 'VIGILANCIA', cnesTipo: '50', logradouro: 'AV MARCIANO XAVIER DE OLIVEIRA', numero: '253', bairro: 'CENTRO' },
  { nome: 'SECRETARIA MUNICIPAL DE SAÚDE', tipo: 'ADMINISTRATIVA', cnesTipo: '68', logradouro: 'RUA 24 DE MARÇO', numero: '446', bairro: 'JARDIM ALICE' },
  { nome: 'TRANSPORTE SANITÁRIO', tipo: 'TRANSPORTE', cnesTipo: '68', logradouro: 'AV MARCIANO XAVIER DE OLIVEIRA', numero: '532', bairro: 'CENTRO' },
];

export async function carregarUnidades(c: pg.PoolClient) {
  const mun = (await c.query(`select id from cad.municipio where codigo_ibge = $1`, [config.codigoIbgeMunicipio])).rows[0];
  if (!mun) return;
  for (const u of UNIDADES_CABREUVA) {
    const existe = (await c.query(`select 1 from cad.unidade where nome = $1`, [u.nome])).rowCount;
    if (existe) continue;
    let bairro = (await c.query(`select id from cad.bairro where municipio_id = $1 and nome = $2`, [mun.id, u.bairro])).rows[0];
    bairro ??= (await c.query(`insert into cad.bairro (nome, municipio_id) values ($1,$2) returning id`, [u.bairro, mun.id])).rows[0];
    const [tipoNome, ...resto] = u.logradouro.split(' ');
    const tipo = (
      await c.query(`select id from cad.tipo_logradouro where abreviatura = $1 or nome = $1 limit 1`, [tipoNome === 'AV' ? 'AV' : tipoNome === 'RODOVIA' ? 'ROD' : 'R'])
    ).rows[0];
    const nomeLogr = resto.join(' ');
    let logr = (await c.query(`select id from cad.logradouro where municipio_id = $1 and nome = $2`, [mun.id, nomeLogr])).rows[0];
    logr ??= (
      await c.query(`insert into cad.logradouro (tipo_logradouro_id, nome, bairro_id, municipio_id) values ($1,$2,$3,$4) returning id`, [
        tipo.id,
        nomeLogr,
        bairro.id,
        mun.id,
      ])
    ).rows[0];
    await c.query(
      `insert into cad.unidade (nome, tipo_unidade, tipo_estabelecimento, logradouro_id, numero, bairro_id, municipio_id, esfera_administrativa, propria, prestadora, ativo)
       values ($1,$2,$3,$4,$5,$6,$7,'MUNICIPAL',true,$8,true)`,
      [u.nome, u.tipo, u.cnesTipo, logr.id, u.numero, bairro.id, mun.id, ['POLICLINICA', 'CEM', 'UPA', 'CEO', 'CER'].includes(u.tipo)],
    );
  }
}

/** Operador administrador inicial com senha temporária de troca obrigatória. */
export async function carregarAdministrador(c: pg.PoolClient): Promise<string | null> {
  const existe = (await c.query(`select 1 from seg.operador where administrador limit 1`)).rowCount;
  if (existe) return null;
  const senha = process.env.ADMIN_SENHA_INICIAL ?? gerarSenhaTemporaria();
  const pessoa = (
    await c.query(
      `insert into cad.pessoa (nome, data_nascimento, sexo, raca_cor, situacao, mae_desconhecida, email)
       values ('ADMINISTRADOR DO SISTEMA', '1980-01-01', 'I', '99', 'ATIVO', true, $1) returning id`,
      [process.env.ADMIN_EMAIL ?? null],
    )
  ).rows[0];
  const op = (
    await c.query(
      `insert into seg.operador (pessoa_id, login, senha_hash, administrador, senha_expirada, senha_alterada_em, ativo, oficial_protecao_dados)
       values ($1, 'admin', $2, true, $3, now(), true, true) returning id`,
      [pessoa.id, await gerarHashSenha(senha), !process.env.ADMIN_SENHA_INICIAL],
    )
  ).rows[0];
  const perfil = (await c.query(`select id from seg.perfil where nome = 'Administrador'`)).rows[0];
  if (perfil) await c.query(`insert into seg.operador_perfil (operador_id, perfil_id) values ($1,$2)`, [op.id, perfil.id]);
  return senha;
}
