// Ecografia: carga inicial (exames do SIGTAP, estruturas, modelos de resultado, cabeçalho, perfil e parâmetros)
// e dados de demonstração sobre a agenda 'ULTRASSONOGRAFIA - CEM'.
import type pg from 'pg';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { registrarCarga, registrarCargaDemonstracao, type ContextoDemonstracao } from '../../db/carga/modulos.js';
import { agendaDemo, agendamentosDemo, cargaBaseImagem, procedimentosDemo, profissionalDemo, type DadosCargaImagem } from '../radiologia/imagem-carga.js';
import { ECO } from './config.js';

registrarParametro('eco.assinatura_confirmar_senha', true, 'Ecografia: exigir a senha do profissional ao assinar o laudo', 'ECO');
registrarParametro('eco.laudo_cabecalho', 'PRESTADOR', 'Ecografia: cabeçalho padrão do resultado (PRESTADOR ou SOLICITANTE) (TR 1.2.50.7)', 'ECO');
registrarParametro('eco.alerta_dias_laudo', 30, 'Ecografia: dias em que o laudo liberado é destacado no cabeçalho do paciente no atendimento', 'ECO');

export const PERFIL_ECOGRAFIA = 'Ecografia (ultrassonografistas)';

const ABDOME = `Fígado com dimensões normais, contornos regulares e ecotextura homogênea.
Vesícula biliar normodistendida, de paredes finas, sem cálculos no seu interior.
Vias biliares intra e extra-hepáticas sem dilatação.
Pâncreas de aspecto ecográfico normal nos segmentos visualizados.
Baço de dimensões e ecotextura normais.
Rins tópicos, com dimensões, contornos e ecogenicidade normais; boa diferenciação corticomedular; sem dilatação pielocalicinal ou cálculos.
Bexiga com boa repleção, paredes finas e conteúdo anecoico.
Aorta abdominal de calibre normal. Ausência de líquido livre na cavidade.`;

const TRANSVAGINAL = `Útero em anteversoflexão, de contornos regulares e ecotextura miometrial homogênea, medindo ___ x ___ x ___ cm.
Endométrio centrado, homogêneo, com espessura de ___ mm.
Ovário direito tópico, de dimensões normais, com folículos de aspecto habitual.
Ovário esquerdo tópico, de dimensões normais, com folículos de aspecto habitual.
Fundo de saco posterior livre.`;

const DADOS: DadosCargaImagem = {
  cabecalho: 'Serviço de Ultrassonografia',
  perfil: { nome: PERFIL_ECOGRAFIA, descricao: 'Recepção, execução, laudo, assinatura e entrega de exames de ultrassonografia', permissoes: ['ECO:*', 'AGE:consultar', 'paciente:consultar', 'prontuario:consultar'] },
  estruturas: [
    ['ABDOME TOTAL', null],
    ['ABDOME SUPERIOR', null],
    ['FÍGADO E VIAS BILIARES', null],
    ['RINS E VIAS URINÁRIAS', null],
    ['BEXIGA', null],
    ['PRÓSTATA', null],
    ['ÚTERO E ANEXOS', null],
    ['OVÁRIOS', null],
    ['GESTAÇÃO / FETO', null],
    ['MAMAS', null],
    ['TIREOIDE', null],
    ['BOLSA ESCROTAL', null],
    ['PARTES MOLES', null, true],
    ['ARTICULAÇÃO', null, true],
  ],
  modelos: [
    {
      codigo: null,
      nome: 'ULTRASSONOGRAFIA - MODELO GERAL',
      texto: `Exame realizado com transdutor de alta resolução, em tempo real, avaliando {estrutura} {lateralidade}.

Estruturas avaliadas com dimensões, contornos e ecotextura preservados.
Ausência de coleções ou imagens nodulares.`,
      conclusao: 'Estudo ultrassonográfico sem alterações significativas.',
    },
    { codigo: '0205020046', nome: 'ABDOME TOTAL - NORMAL', texto: ABDOME, conclusao: 'Ultrassonografia de abdome total dentro dos padrões da normalidade.', padrao: true },
    {
      codigo: '0205020046',
      nome: 'ABDOME TOTAL - COLELITÍASE',
      texto: ABDOME.replace('sem cálculos no seu interior', 'com imagens ecogênicas móveis, produtoras de sombra acústica posterior, a maior medindo ___ mm'),
      conclusao: 'Colelitíase. Demais estruturas abdominais sem alterações.',
    },
    { codigo: '0205020186', nome: 'TRANSVAGINAL - NORMAL', texto: TRANSVAGINAL, conclusao: 'Ultrassonografia transvaginal dentro dos padrões da normalidade.', padrao: true },
    {
      codigo: '0205020143',
      nome: 'OBSTÉTRICA - GESTAÇÃO TÓPICA',
      texto: `Útero gravídico contendo saco gestacional único, tópico, com embrião/feto único.
Batimentos cardíacos fetais presentes e rítmicos, frequência de ___ bpm.
Movimentos fetais presentes.
Placenta de inserção ___, grau ___.
Líquido amniótico em quantidade normal.
Biometria fetal compatível com ___ semanas e ___ dias.`,
      conclusao: 'Gestação tópica única, feto vivo, com idade gestacional ecográfica de ___ semanas e ___ dias.',
      padrao: true,
    },
    {
      codigo: '0205020097',
      nome: 'MAMÁRIA BILATERAL - BI-RADS 1',
      texto: `Pele e tecido subcutâneo sem alterações.
Parênquima mamário com ecotextura fibroglandular habitual, bilateralmente.
Ausência de nódulos sólidos ou císticos.
Regiões axilares sem linfonodomegalias.`,
      conclusao: 'BI-RADS 1 - Exame negativo.',
      padrao: true,
    },
    {
      codigo: '0205020160',
      nome: 'PÉLVICA (GINECOLÓGICA) - NORMAL',
      texto: TRANSVAGINAL.replace('Fundo de saco posterior livre.', 'Bexiga com boa repleção. Fundo de saco livre.'),
      conclusao: 'Ultrassonografia pélvica dentro dos padrões da normalidade.',
      padrao: true,
    },
  ],
};

registrarCarga('Ecografia: exames, estruturas, modelos de resultado e perfil', (c) => cargaBaseImagem(c, ECO, DADOS));

/** Dados de demonstração da Ecografia (executado também sobre uma base já povoada, sem duplicar). */
export async function demonstracaoEcografia(c: pg.PoolClient, ctx: ContextoDemonstracao) {
  const cem = ctx.unidades.cem;
  await procedimentosDemo(c, [
    ['0205020097', 'ULTRASSONOGRAFIA MAMÁRIA BILATERAL', 'A', 24.2, ['225320', '225250']],
    ['0205020143', 'ULTRASSONOGRAFIA OBSTÉTRICA', 'F', 24.2, ['225320', '225250']],
    ['0205020160', 'ULTRASSONOGRAFIA PÉLVICA (GINECOLÓGICA)', 'F', 24.2, ['225320', '225250']],
    ['0205020046', 'ULTRASSONOGRAFIA DE ABDÔMEN TOTAL', 'A', 37.95, ['225320']],
    ['0205020186', 'ULTRASSONOGRAFIA TRANSVAGINAL', 'F', 24.2, ['225320', '225250']],
  ]);
  await cargaBaseImagem(c, ECO, DADOS);
  const ja = (await c.query(`select 1 from eco.atendimento limit 1`)).rowCount;
  await c.query(
    `insert into eco.equipamento (nome, unidade_id, sala, ativo) select 'APARELHO DE ULTRASSOM COM DOPPLER', $1, 'SALA DE ULTRASSOM', true
      where not exists (select 1 from eco.equipamento where nome = 'APARELHO DE ULTRASSOM COM DOPPLER')`,
    [cem],
  );
  // O médico radiologista da demonstração também realiza e assina ultrassonografias; a ginecologista assina os exames ginecológicos/obstétricos.
  const medico = await profissionalDemo(c, {
    login: 'radiologista',
    nome: 'FERNANDO AUGUSTO MORAES',
    sexo: 'M',
    nascimento: '1976-08-19',
    cbo: '225320',
    conselho: 'CRM',
    registro: '567123',
    unidades: [cem],
    perfis: [PERFIL_ECOGRAFIA],
    assinatura: true,
  });
  await c.query(
    `insert into eco.assinante (profissional_id, titulo, ativo) select $1, 'Médico ultrassonografista', true where not exists (select 1 from eco.assinante where profissional_id = $1)`,
    [medico.profissionalId],
  );
  if (ctx.profissionais.ginecologista) {
    for (const codigo of ['0205020186', '0205020143', '0205020160'])
      await c.query(
        `insert into eco.assinante (profissional_id, exame_id, titulo, ativo)
         select $1, e.id, 'Médica ginecologista e obstetra', true from eco.exame e join cad.procedimento p on p.id = e.procedimento_id
          where p.codigo = $2 and not exists (select 1 from eco.assinante a where a.profissional_id = $1 and a.exame_id = e.id)`,
        [ctx.profissionais.ginecologista, codigo],
      );
    await c.query(
      `insert into seg.operador_perfil (operador_id, perfil_id) select o.id, p.id from seg.operador o, seg.perfil p where o.profissional_id = $1 and p.nome = $2
        and not exists (select 1 from seg.operador_perfil x where x.operador_id = o.id and x.perfil_id = p.id)`,
      [ctx.profissionais.ginecologista, PERFIL_ECOGRAFIA],
    );
  }
  const agenda = await agendaDemo(c, {
    nome: 'ULTRASSONOGRAFIA - CEM',
    unidadeId: cem,
    local: 'Sala de ultrassom',
    cor: '#15aabf',
    codigos: ['0205020046', '0205020186', '0205020143', '0205020097', '0205020160'],
    cotaDiaria: 8,
    cotaMensal: 100,
  });
  if (ja) return;
  const pac = (
    await c.query(
      `select id, sexo, extract(year from age(data_nascimento))::int idade from cad.pessoa where id = any($1) and data_nascimento < current_date - interval '18 years' order by id desc`,
      [ctx.pacientes],
    )
  ).rows;
  if (!pac.length) return;
  const qualquer = (i: number) => pac[i % pac.length].id as number;
  const mulheres = pac.filter((p) => p.sexo === 'F' && p.idade < 60).map((p) => p.id as number);
  const mulher = (i: number) => mulheres[i % Math.max(1, mulheres.length)] ?? qualquer(i);
  const equipamento = (await c.query(`select id from eco.equipamento where nome = 'APARELHO DE ULTRASSOM COM DOPPLER'`)).rows[0]?.id ?? null;
  await agendamentosDemo(
    c,
    ECO,
    ctx,
    agenda,
    [
      { paciente: qualquer(0), codigo: '0205020046', estrutura: 'ABDOME TOTAL', hora: '08:00', requisicao: true },
      { paciente: mulher(0), codigo: '0205020186', estrutura: 'ÚTERO E ANEXOS', hora: '08:20', estagio: 'PRESENTE' },
      { paciente: mulher(1), codigo: '0205020097', estrutura: 'MAMAS', hora: '08:40', requisicao: true, estagio: 'DIGITADO', laudo: 'Parênquima mamário com ecotextura fibroglandular habitual. Ausência de nódulos.', conclusao: 'BI-RADS 1 - Exame negativo.' },
      { paciente: qualquer(3), codigo: '0205020046', estrutura: 'ABDOME TOTAL', hora: '09:00', diasAtras: 2, requisicao: true, estagio: 'ASSINADO', laudo: ABDOME, conclusao: 'Ultrassonografia de abdome total dentro dos padrões da normalidade.' },
      { paciente: mulher(2), codigo: '0205020160', estrutura: 'ÚTERO E ANEXOS', hora: '09:20', diasAtras: 2, estagio: 'RETIRADO', laudo: TRANSVAGINAL, conclusao: 'Exame pélvico normal.' },
    ],
    { executante: medico.profissionalId, operador: medico.operadorId, assinante: medico.profissionalId, equipamento },
  );
}

registrarCargaDemonstracao('Ecografia (agenda de ultrassonografias e laudos)', demonstracaoEcografia);
