// Radiologia: carga inicial (exames do SIGTAP, estruturas, modelos de resultado, cabeçalho, perfil e
// parâmetros) e dados de demonstração (agenda de radiografias, equipe, exames em todas as etapas).
import type pg from 'pg';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { registrarCarga, registrarCargaDemonstracao, type ContextoDemonstracao } from '../../db/carga/modulos.js';
import { RAD } from './config.js';
import { agendaDemo, agendamentosDemo, cargaBaseImagem, procedimentosDemo, profissionalDemo, type DadosCargaImagem } from './imagem-carga.js';

registrarParametro('rad.assinatura_confirmar_senha', true, 'Radiologia: exigir a senha do profissional ao assinar o laudo', 'RAD');
registrarParametro('rad.laudo_cabecalho', 'PRESTADOR', 'Radiologia: cabeçalho padrão do resultado (PRESTADOR ou SOLICITANTE) (TR 1.2.45.7)', 'RAD');
registrarParametro('rad.alerta_dias_laudo', 30, 'Radiologia: dias em que o laudo liberado é destacado no cabeçalho do paciente no atendimento', 'RAD');

export const PERFIL_RADIOLOGIA = 'Radiologia (técnicos e médicos radiologistas)';

const TORAX = `Exame realizado nas incidências {estrutura}.

Transparência pulmonar preservada.
Seios costofrênicos e cardiofrênicos livres.
Área cardíaca dentro dos limites da normalidade.
Hilos pulmonares de aspecto habitual.
Mediastino centrado, sem alargamentos.
Cúpulas diafragmáticas regulares.
Arcabouço ósseo íntegro.`;

const DADOS: DadosCargaImagem = {
  cabecalho: 'Serviço de Radiologia e Diagnóstico por Imagem',
  perfil: { nome: PERFIL_RADIOLOGIA, descricao: 'Recepção, execução, laudo, assinatura e entrega de exames de radiologia', permissoes: ['RAD:*', 'AGE:consultar', 'paciente:consultar', 'prontuario:consultar'] },
  estruturas: [
    ['TÓRAX', null],
    ['CRÂNIO', null],
    ['SEIOS DA FACE', null],
    ['COLUNA CERVICAL', null],
    ['COLUNA TORÁCICA', null],
    ['COLUNA LOMBO-SACRA', null],
    ['ABDOME', null],
    ['BACIA', null],
    ['OMBRO', null, true],
    ['COTOVELO', null, true],
    ['PUNHO', null, true],
    ['MÃO', null, true],
    ['QUADRIL', null, true],
    ['JOELHO', null, true],
    ['TORNOZELO', null, true],
    ['PÉ', null, true],
    ['MAMAS', null],
  ],
  modelos: [
    {
      codigo: null,
      nome: 'RADIOGRAFIA - MODELO GERAL',
      texto: `Exame radiográfico de {estrutura} {lateralidade}, realizado nas incidências habituais.

Estruturas ósseas com densidade e morfologia preservadas.
Espaços articulares conservados.
Partes moles sem alterações.`,
      conclusao: 'Estudo radiográfico sem alterações significativas.',
    },
    { codigo: '0204030153', nome: 'TÓRAX PA E PERFIL - NORMAL', texto: TORAX.replace('{estrutura}', 'PA e perfil'), conclusao: 'Radiografia de tórax sem alterações significativas.', padrao: true },
    {
      codigo: '0204030153',
      nome: 'TÓRAX PA E PERFIL - PNEUMONIA',
      texto: `Exame realizado nas incidências PA e perfil.

Opacidade alveolar com broncograma aéreo em lobo inferior {lateralidade}.
Seios costofrênicos livres.
Área cardíaca dentro dos limites da normalidade.
Mediastino centrado.`,
      conclusao: 'Achados compatíveis com processo inflamatório/infeccioso pulmonar. Correlacionar com a clínica.',
    },
    { codigo: '0204030170', nome: 'TÓRAX PA - NORMAL', texto: TORAX.replace('{estrutura}', 'PA'), conclusao: 'Radiografia de tórax sem alterações significativas.', padrao: true },
    {
      codigo: '0204020107',
      nome: 'COLUNA LOMBO-SACRA - NORMAL',
      texto: `Exame realizado nas incidências AP e perfil.

Alinhamento vertebral preservado.
Corpos vertebrais com altura e densidade normais.
Espaços discais conservados.
Pedículos e processos espinhosos íntegros.
Articulações sacroilíacas sem alterações.`,
      conclusao: 'Radiografia de coluna lombo-sacra sem alterações significativas.',
      padrao: true,
    },
    {
      codigo: '0204060150',
      nome: 'JOELHO AP E PERFIL - NORMAL',
      texto: `Radiografia do joelho {lateralidade} nas incidências AP e perfil.

Estruturas ósseas com densidade e morfologia normais.
Espaços articulares femorotibiais preservados.
Patela tópica.
Partes moles sem alterações.`,
      conclusao: 'Radiografia do joelho sem alterações significativas.',
      padrao: true,
    },
    {
      codigo: '0204030188',
      nome: 'MAMOGRAFIA BILATERAL - BI-RADS 1',
      texto: `Mamografia bilateral nas incidências crânio-caudal e médio-lateral oblíqua.

Mamas com padrão fibroglandular disperso.
Ausência de nódulos, calcificações suspeitas ou distorções arquiteturais.
Linfonodos axilares de aspecto habitual.
Pele e complexo areolopapilar sem alterações.`,
      conclusao: 'BI-RADS 1 - Negativo. Recomenda-se controle mamográfico de rotina conforme a faixa etária.',
      padrao: true,
    },
  ],
};

registrarCarga('Radiologia: exames, estruturas, modelos de resultado e perfil', (c) => cargaBaseImagem(c, RAD, DADOS));

/** Dados de demonstração da Radiologia (executado também sobre uma base já povoada, sem duplicar). */
export async function demonstracaoRadiologia(c: pg.PoolClient, ctx: ContextoDemonstracao) {
  const cem = ctx.unidades.cem;
  await procedimentosDemo(c, [
    ['0204030170', 'RADIOGRAFIA DE TÓRAX (PA)', 'A', 6.88, ['225320', '324115']],
    ['0204020107', 'RADIOGRAFIA DE COLUNA LOMBO-SACRA', 'A', 10.96, ['225320', '324115']],
    ['0204060150', 'RADIOGRAFIA DE JOELHO (AP + LATERAL)', 'A', 6.78, ['225320', '324115']],
    ['0204030153', 'RADIOGRAFIA DE TÓRAX (PA E PERFIL)', 'A', 9.5, ['225320', '324115']],
    ['0204030188', 'MAMOGRAFIA BILATERAL PARA RASTREAMENTO', 'F', 45, ['225320', '324115']],
  ]);
  await cargaBaseImagem(c, RAD, DADOS);
  const ja = (await c.query(`select 1 from rad.atendimento limit 1`)).rowCount;
  for (const [nome, sala] of [
    ['APARELHO DE RAIOS X FIXO 500 MA', 'SALA 1'],
    ['MAMÓGRAFO DIGITAL', 'SALA 2'],
  ])
    await c.query(`insert into rad.equipamento (nome, unidade_id, sala, ativo) select $1::varchar, $2::bigint, $3::varchar, true where not exists (select 1 from rad.equipamento where nome = $1::varchar)`, [nome, cem, sala]);
  const radiologista = await profissionalDemo(c, {
    login: 'radiologista',
    nome: 'FERNANDO AUGUSTO MORAES',
    sexo: 'M',
    nascimento: '1976-08-19',
    cbo: '225320',
    conselho: 'CRM',
    registro: '567123',
    unidades: [cem],
    perfis: [PERFIL_RADIOLOGIA],
    assinatura: true,
  });
  const tecnico = await profissionalDemo(c, {
    login: 'tecradiologia',
    nome: 'LUCAS GABRIEL FERREIRA',
    sexo: 'M',
    nascimento: '1992-02-11',
    cbo: '324115',
    conselho: 'CRTR',
    registro: '12345',
    unidades: [cem],
    perfis: [PERFIL_RADIOLOGIA],
  });
  await c.query(
    `insert into rad.assinante (profissional_id, titulo, ativo) select $1, 'Médico radiologista', true where not exists (select 1 from rad.assinante where profissional_id = $1)`,
    [radiologista.profissionalId],
  );
  const agenda = await agendaDemo(c, {
    nome: 'RADIOLOGIA - CEM',
    unidadeId: cem,
    local: 'Sala de raios X',
    cor: '#7048e8',
    codigos: ['0204030153', '0204030170', '0204020107', '0204060150', '0204030188'],
    cotaDiaria: 15,
    cotaMensal: 250,
  });
  if (ja) return;
  const pac = (
    await c.query(
      `select id, sexo, extract(year from age(data_nascimento))::int idade from cad.pessoa where id = any($1) and data_nascimento < current_date - interval '18 years' order by id`,
      [ctx.pacientes],
    )
  ).rows;
  if (!pac.length) return;
  const qualquer = (i: number) => pac[i % pac.length].id as number;
  const mulher = pac.find((p) => p.sexo === 'F' && p.idade >= 40)?.id ?? qualquer(4);
  const equipamento = (await c.query(`select id from rad.equipamento where nome = 'APARELHO DE RAIOS X FIXO 500 MA'`)).rows[0]?.id ?? null;
  await agendamentosDemo(
    c,
    RAD,
    ctx,
    agenda,
    [
      { paciente: qualquer(0), codigo: '0204030153', estrutura: 'TÓRAX', hora: '07:30', requisicao: true },
      { paciente: qualquer(1), codigo: '0204020107', estrutura: 'COLUNA LOMBO-SACRA', hora: '07:45', estagio: 'PRESENTE' },
      { paciente: qualquer(2), codigo: '0204060150', estrutura: 'JOELHO', hora: '08:00', requisicao: true, estagio: 'REALIZADO' },
      { paciente: qualquer(3), codigo: '0204030170', estrutura: 'TÓRAX', hora: '08:15', estagio: 'DIGITADO', laudo: TORAX.replace('{estrutura}', 'PA'), conclusao: 'Radiografia de tórax sem alterações significativas.' },
      { paciente: mulher, codigo: '0204030188', estrutura: 'MAMAS', hora: '08:30', requisicao: true },
      { paciente: qualquer(5), codigo: '0204030153', estrutura: 'TÓRAX', hora: '09:00', diasAtras: 3, requisicao: true, estagio: 'ASSINADO', laudo: TORAX.replace('{estrutura}', 'PA e perfil'), conclusao: 'Radiografia de tórax sem alterações significativas.' },
      { paciente: qualquer(6), codigo: '0204060150', estrutura: 'JOELHO', hora: '09:15', diasAtras: 3, estagio: 'RETIRADO', laudo: 'Radiografia do joelho nas incidências AP e perfil sem alterações.', conclusao: 'Exame normal.' },
      { paciente: qualquer(7), codigo: '0204020107', estrutura: 'COLUNA LOMBO-SACRA', hora: '09:30', diasAtras: 2, estagio: 'FALTOSO' },
    ],
    { executante: tecnico.profissionalId, operador: tecnico.operadorId, assinante: radiologista.profissionalId, equipamento },
  );
}

registrarCargaDemonstracao('Radiologia (agenda de radiografias, equipe e laudos)', demonstracaoRadiologia);
