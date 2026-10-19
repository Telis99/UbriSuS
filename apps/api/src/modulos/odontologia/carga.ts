// Carga inicial do prontuário odontológico: procedimentos SIGTAP de saúde bucal com as regras de CBO,
// faces e situações dentárias (cores e símbolos), procedimentos odontológicos pré-cadastrados,
// grupos de atendimento, anamnese odontológica, materiais (escova, creme e fio dental) e parâmetros.
// Todas as cargas são idempotentes. Dados fictícios de demonstração ao final.
import type pg from 'pg';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { registrarCarga, registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { loteNaUnidade } from '../farmacia/servico.js';
import { lancarItens, itensSigtap } from './servico.js';

registrarParametro('odontologia.fila_atualizacao_segundos', 30, 'Intervalo (segundos) de atualização automática da fila odontológica', 'ODO');
registrarParametro('odontologia.receita.impressao', { cabecalho: true, rodape: true, logoSus: true, duasViasMesmaPagina: false, duasViasSimples: false, duasViasOutros: false, textoCabecalho: '' }, 'Configuração da impressão das receitas odontológicas', 'ODO');
registrarParametro('odontologia.materiais_produtos', { ESCOVA: null, CREME: null, FIO: null }, 'Produtos do estoque baixados no fornecimento de material odontológico', 'ODO');
registrarParametro('odontologia.baixar_estoque_materiais', true, 'Baixar do estoque da unidade os materiais odontológicos fornecidos', 'ODO');

const DENTISTAS = ['223208', '223293', '223212', '223236', '223248'];
const TSB_ASB = ['322405', '322415', '322430'];

// código, nome, instrumentos, CBOs habilitados (além dos cirurgiões-dentistas)
const SIGTAP: [string, string, string[], string[]][] = [
  ['0101020058', 'APLICAÇÃO DE CARIOSTÁTICO (POR DENTE)', ['01', '10'], TSB_ASB],
  ['0101020066', 'APLICAÇÃO DE SELANTE (POR DENTE)', ['01', '10'], TSB_ASB],
  ['0101020074', 'APLICAÇÃO TÓPICA DE FLÚOR (INDIVIDUAL POR SESSÃO)', ['01', '10'], TSB_ASB],
  ['0101020082', 'EVIDENCIAÇÃO DE PLACA BACTERIANA', ['01', '10'], TSB_ASB],
  ['0101020090', 'SELAMENTO PROVISÓRIO DE CAVIDADE DENTÁRIA', ['01', '10'], TSB_ASB],
  ['0307010015', 'CAPEAMENTO PULPAR', ['01', '10'], []],
  ['0307010023', 'RESTAURAÇÃO DE DENTE DECÍDUO', ['01', '10'], []],
  ['0307010031', 'RESTAURAÇÃO DE DENTE PERMANENTE ANTERIOR', ['01', '10'], []],
  ['0307010040', 'RESTAURAÇÃO DE DENTE PERMANENTE POSTERIOR', ['01', '10'], []],
  ['0307020010', 'ACESSO À POLPA DENTÁRIA E MEDICAÇÃO (POR DENTE)', ['01', '10'], []],
  ['0307020029', 'CURATIVO DE DEMORA C/ OU S/ PREPARO BIOMECÂNICO', ['01', '10'], []],
  ['0307020037', 'OBTURAÇÃO DE DENTE DECÍDUO', ['01', '02'], []],
  ['0307020045', 'OBTURAÇÃO EM DENTE PERMANENTE BIRRADICULAR', ['01', '02'], []],
  ['0307020053', 'OBTURAÇÃO EM DENTE PERMANENTE C/ TRÊS OU MAIS RAÍZES', ['01', '02'], []],
  ['0307020061', 'OBTURAÇÃO EM DENTE PERMANENTE UNIRRADICULAR', ['01', '02'], []],
  ['0307020070', 'PULPOTOMIA DENTÁRIA', ['01', '10'], []],
  ['0307030016', 'RASPAGEM ALISAMENTO E POLIMENTO SUPRAGENGIVAIS (POR SEXTANTE)', ['01', '10'], []],
  ['0307030024', 'RASPAGEM ALISAMENTO SUBGENGIVAIS (POR SEXTANTE)', ['01', '10'], []],
  ['0307030059', 'PROFILAXIA / REMOÇÃO DA PLACA BACTERIANA', ['01', '10'], TSB_ASB],
  ['0414020120', 'EXODONTIA DE DENTE DECÍDUO', ['01', '10'], []],
  ['0414020138', 'EXODONTIA DE DENTE PERMANENTE', ['01', '10'], []],
  ['0414020146', 'EXODONTIA MÚLTIPLA COM ALVEOLOPLASTIA POR SEXTANTE', ['01', '02'], []],
];

const FACES: [string, string, number][] = [
  ['M', 'Mesial', 1],
  ['D', 'Distal', 2],
  ['O', 'Oclusal / incisal', 3],
  ['V', 'Vestibular', 4],
  ['L', 'Lingual / palatina', 5],
];

// código, nome, abrangência, cor, símbolo, componente CPO, necessita tratamento
const SITUACOES: [string, string, string, string, string, string, boolean][] = [
  ['HIG', 'Hígido', 'DENTE', '#ffffff', '', 'H', false],
  ['CAR', 'Cárie', 'FACE', '#e03131', '', 'C', true],
  ['RES', 'Restaurado', 'FACE', '#1c7ed6', '', 'O', false],
  ['RCA', 'Restaurado com cárie', 'FACE', '#f76707', '', 'C', true],
  ['SEL', 'Selante', 'FACE', '#37b24d', '', 'H', false],
  ['FRA', 'Fraturado', 'DENTE', '#e8590c', 'F', 'C', true],
  ['AUS', 'Ausente / perdido', 'DENTE', '#495057', 'X', 'P', false],
  ['EXI', 'Extração indicada', 'DENTE', '#c2255c', 'EI', 'EI', true],
  ['RRA', 'Resto radicular', 'DENTE', '#862e9c', 'RR', 'EI', true],
  ['NEN', 'Necessidade de endodontia', 'DENTE', '#ae3ec9', 'NE', 'C', true],
  ['END', 'Tratamento endodôntico realizado', 'DENTE', '#5f3dc4', 'TC', 'O', false],
  ['COR', 'Coroa / prótese fixa', 'DENTE', '#f59f00', 'CO', 'O', false],
  ['PRR', 'Prótese removível', 'DENTE', '#fcc419', 'PR', 'P', false],
  ['IMP', 'Implante', 'DENTE', '#1098ad', 'IM', 'P', false],
  ['NIR', 'Não irrompido', 'DENTE', '#adb5bd', 'NI', 'N', false],
  ['MOB', 'Mobilidade', 'DENTE', '#fab005', 'MB', 'N', true],
];

// nome, marcação, dentição, situação resultante, cor, itens [código SIGTAP, aplica a, quantidade, por elemento]
const PROCEDIMENTOS: [string, string, string, string | null, string, [string, string, number, boolean][]][] = [
  ['Restauração', 'FACE', 'AMBAS', 'RES', '#1c7ed6', [['0307010023', 'DECIDUO', 1, true], ['0307010031', 'PERMANENTE_ANTERIOR', 1, true], ['0307010040', 'PERMANENTE_POSTERIOR', 1, true]]],
  [
    'Tratamento endodôntico (canal)',
    'DENTE',
    'AMBAS',
    'END',
    '#5f3dc4',
    [
      ['0307020010', 'TODOS', 1, true],
      ['0307020029', 'TODOS', 1, true],
      ['0307020037', 'DECIDUO', 1, true],
      ['0307020061', 'UNIRRADICULAR', 1, true],
      ['0307020045', 'BIRRADICULAR', 1, true],
      ['0307020053', 'MULTIRRADICULAR', 1, true],
    ],
  ],
  ['Pulpotomia', 'DENTE', 'AMBAS', null, '#9c36b5', [['0307020070', 'TODOS', 1, true]]],
  ['Capeamento pulpar', 'FACE', 'AMBAS', null, '#3bc9db', [['0307010015', 'TODOS', 1, true]]],
  ['Exodontia', 'DENTE', 'AMBAS', 'AUS', '#495057', [['0414020120', 'DECIDUO', 1, true], ['0414020138', 'PERMANENTE', 1, true]]],
  ['Aplicação de selante', 'FACE', 'AMBAS', 'SEL', '#37b24d', [['0101020066', 'TODOS', 1, true]]],
  ['Aplicação de cariostático', 'DENTE', 'AMBAS', null, '#74b816', [['0101020058', 'TODOS', 1, true]]],
  ['Selamento provisório de cavidade', 'FACE', 'AMBAS', null, '#82c91e', [['0101020090', 'TODOS', 1, true]]],
  ['Raspagem supragengival', 'SEXTANTE', 'PERMANENTE', null, '#0ca678', [['0307030016', 'TODOS', 1, true]]],
  ['Raspagem subgengival', 'SEXTANTE', 'PERMANENTE', null, '#099268', [['0307030024', 'TODOS', 1, true]]],
  ['Exodontia múltipla com alveoloplastia', 'SEXTANTE', 'PERMANENTE', null, '#343a40', [['0414020146', 'TODOS', 1, true]]],
  ['Profilaxia / remoção de placa', 'BOCA', 'AMBAS', null, '#15aabf', [['0307030059', 'TODOS', 1, false]]],
  ['Aplicação tópica de flúor', 'BOCA', 'AMBAS', null, '#4dabf7', [['0101020074', 'TODOS', 1, false]]],
  ['Evidenciação de placa bacteriana', 'BOCA', 'AMBAS', null, '#da77f2', [['0101020082', 'TODOS', 1, false]]],
];

const GRUPOS: [string, string][] = [
  ['01', 'Atenção básica em saúde bucal'],
  ['02', 'Atenção especializada (CEO)'],
  ['03', 'Urgência odontológica'],
  ['04', 'Pacientes com necessidades especiais'],
  ['05', 'Gestantes (pré-natal odontológico)'],
  ['06', 'Saúde bucal na escola (PSE)'],
];

// Anamnese odontológica: [pergunta, tipo, obrigatória, opções [texto, condição e-SUS, ação], depende da opção (pergunta, opção)]
const ANAMNESE: [string, string, boolean, [string, string | null, string?][], [number, number]?][] = [
  ['Está em tratamento médico atualmente?', 'UNICA_OBS', true, [['Sim', null], ['Não', null]]],
  [
    'Possui alguma das condições abaixo?',
    'MULTIPLA',
    true,
    [['Hipertensão arterial', 'hipertensao'], ['Diabetes', 'diabetes'], ['Doença cardíaca', 'cardiaca'], ['Problema nos rins', 'rins'], ['Doença respiratória', 'respiratoria'], ['Nenhuma', null]],
  ],
  ['É fumante?', 'UNICA', true, [['Sim', 'fumante', 'ATRIBUIR'], ['Não', 'fumante', 'REMOVER']]],
  ['Está gestante?', 'UNICA', false, [['Sim', 'gestante', 'ATRIBUIR'], ['Não', null]]],
  ['Já teve reação à anestesia odontológica?', 'UNICA', true, [['Sim', null], ['Não', null]]],
  ['Descreva a reação à anestesia', 'TEXTO', true, [], [4, 0]],
  ['Apresenta sangramento gengival ao escovar?', 'UNICA', true, [['Sim', null], ['Não', null]]],
  ['Quantas vezes escova os dentes por dia?', 'SELECAO', true, [['Nenhuma', null], ['1 vez', null], ['2 vezes', null], ['3 vezes ou mais', null]]],
  ['Usa fio dental?', 'UNICA', false, [['Sim', null], ['Não', null]]],
  ['Queixa principal odontológica', 'TEXTO', false, []],
];

export async function cargaOdontologia(c: pg.PoolClient) {
  for (const [codigo, nome, instrumentos, cbosExtra] of SIGTAP) {
    await c.query(
      `insert into cad.procedimento (codigo, nome, grupo, subgrupo, forma_organizacao, complexidade, instrumentos, sexo, ativo)
       values ($1,$2,$3,$4,$5,'1',$6,'A',true) on conflict (codigo) do nothing`,
      [codigo, nome, codigo.slice(0, 2), codigo.slice(0, 4), codigo.slice(0, 6), instrumentos],
    );
    // Regras de compatibilidade procedimento x CBO (validação SIGTAP, TR 1.2.34.30).
    await c.query(
      `insert into cad.procedimento_cbo (procedimento_id, cbo_id)
       select p.id, cb.id from cad.procedimento p join cad.cbo cb on cb.codigo = any($2::text[])
        where p.codigo = $1 and not exists (select 1 from cad.procedimento_cbo x where x.procedimento_id = p.id and x.cbo_id = cb.id)`,
      [codigo, [...DENTISTAS, ...cbosExtra]],
    );
  }
  for (const [codigo, nome, ordem] of FACES)
    await c.query(`insert into odo.face (codigo, nome, ordem, ativo) select $1::varchar,$2::varchar,$3::int,true where not exists (select 1 from odo.face where codigo = $1::varchar)`, [codigo, nome, ordem]);
  for (const [i, [codigo, nome, abr, cor, simbolo, cpo, nec]] of SITUACOES.entries())
    await c.query(
      `insert into odo.situacao (codigo, nome, abrangencia, cor, simbolo, componente_cpo, necessita_tratamento, ordem, ativo)
       select $1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::varchar,$6::varchar,$7::boolean,$8::int,true where not exists (select 1 from odo.situacao where codigo = $1::varchar)`,
      [codigo, nome, abr, cor, simbolo || null, cpo, nec, i + 1],
    );
  for (const [i, [nome, marcacao, denticao, resultante, cor, itens]] of PROCEDIMENTOS.entries()) {
    const novo = (
      await c.query(
        `insert into odo.procedimento (nome, marcacao, denticao, situacao_resultante_id, cor, ordem, ativo)
         select $1::varchar,$2::varchar,$3::varchar,(select id from odo.situacao where codigo = $4::varchar),$5::varchar,$6::int,true
          where not exists (select 1 from odo.procedimento where nome = $1::varchar) returning id`,
        [nome, marcacao, denticao, resultante, cor, i + 1],
      )
    ).rows[0];
    if (!novo) continue;
    for (const [codigo, aplica, qtd, porElemento] of itens)
      await c.query(
        `insert into odo.procedimento_item (procedimento_odonto_id, procedimento_id, aplica_a, quantidade, por_elemento)
         select $1, id, $3, $4, $5 from cad.procedimento where codigo = $2`,
        [novo.id, codigo, aplica, qtd, porElemento],
      );
  }
  for (const [codigo, nome] of GRUPOS)
    await c.query(`insert into odo.grupo_atendimento (codigo, nome, ativo) select $1::varchar,$2::varchar,true where not exists (select 1 from odo.grupo_atendimento where codigo = $1::varchar)`, [codigo, nome]);

  // Modelo de anamnese odontológica (perguntas dependentes e doenças/agravantes do e-SUS).
  const anam = (
    await c.query(`insert into cad.anamnese (nome, tipo, ativo) select 'ANAMNESE ODONTOLÓGICA', 'ODONTOLOGICO', true where not exists (select 1 from cad.anamnese where nome = 'ANAMNESE ODONTOLÓGICA') returning id`)
  ).rows[0];
  if (anam) {
    const opcoesPorPergunta: number[][] = [];
    for (const [i, [texto, tipo, obrigatoria, opcoes, depende]] of ANAMNESE.entries()) {
      const dep = depende ? opcoesPorPergunta[depende[0]]?.[depende[1]] ?? null : null;
      const p = (
        await c.query(
          `insert into cad.anamnese_pergunta (anamnese_id, ordem, texto, tipo_resposta, tipo_observacao, depende_opcao_id, obrigatoria) values ($1,$2,$3,$4,'AMBOS',$5,$6) returning id`,
          [anam.id, i + 1, texto, tipo, dep, obrigatoria],
        )
      ).rows[0];
      const ids: number[] = [];
      for (const [j, [ot, cond, acao]] of opcoes.entries())
        ids.push(
          (await c.query(`insert into cad.anamnese_opcao (pergunta_id, ordem, texto, condicao_saude, acao_condicao) values ($1,$2,$3,$4,$5) returning id`, [p.id, j + 1, ot, cond, acao ?? 'ATRIBUIR'])).rows[0].id,
        );
      opcoesPorPergunta.push(ids);
    }
  }

  // Materiais de higiene bucal fornecidos no atendimento (TR 1.2.34.36, 1.2.34.37).
  const materiais: Record<string, number> = {};
  for (const [chave, nome] of [
    ['ESCOVA', 'ESCOVA DENTAL'],
    ['CREME', 'CREME DENTAL COM FLÚOR'],
    ['FIO', 'FIO DENTAL'],
  ]) {
    await c.query(
      `insert into far.produto (nome, tipo, tipo_receita, unidade_fornecimento, ativo) select $1::varchar, 'ODONTOLOGICO', 'BASICA', 'UN', true where not exists (select 1 from far.produto where nome = $1::varchar)`,
      [nome],
    );
    materiais[chave] = (await c.query(`select id from far.produto where nome = $1 order by id limit 1`, [nome])).rows[0].id;
  }
  await c.query(
    `update sis.parametro set valor = $1 where chave = 'odontologia.materiais_produtos' and (valor is null or valor = '{"FIO": null, "CREME": null, "ESCOVA": null}'::jsonb)`,
    [JSON.stringify(materiais)],
  );

  // O perfil Odontologia registra o atendimento clínico e consulta o prontuário (telas compartilhadas do PEP).
  await c.query(
    `update seg.perfil set permissoes = (select jsonb_agg(distinct x) from jsonb_array_elements(coalesce(permissoes, '[]') || $1::jsonb) x)
      where nome = 'Odontologia' and not (permissoes @> $1::jsonb)`,
    [JSON.stringify(['atendimento_clinico:executar', 'prontuario:consultar', 'prontuario:exportar', 'sigiloso:consultar', 'paciente:consultar'])],
  );
}

registrarCarga('Odontologia (SIGTAP saúde bucal, odontograma, anamnese e materiais)', cargaOdontologia);

registrarCargaDemonstracao('Odontologia', async (c, ctx) => {
  const dentista = ctx.profissionais.dentista;
  const ceo = ctx.unidades.ceo;
  if (!dentista || !ceo) return;
  if ((await c.query(`select 1 from odo.marcacao limit 1`)).rowCount) return;

  // Estoque de materiais de higiene bucal no CEO e na USF.
  const materiais = (await c.query(`select valor from sis.parametro where chave = 'odontologia.materiais_produtos'`)).rows[0]?.valor ?? {};
  for (const un of [ceo, ctx.unidades.usf].filter(Boolean)) {
    for (const pid of Object.values(materiais).filter(Boolean) as number[]) {
      const validade = new Date(Date.now() + 700 * 86_400_000).toISOString().slice(0, 10);
      const lote = await loteNaUnidade(c, { unidadeId: un, produtoId: pid, lote: `OD${pid}${un}`, validade, custo: 1.5 });
      await c.query(`update far.estoque_lote set quantidade = 500 where id = $1`, [lote]);
      await c.query(
        `insert into far.movimento_estoque (data_hora, unidade_id, produto_id, lote_id, tipo, quantidade, saldo_apos, custo_unitario, documento) values (now(),$1,$2,$3,'ENTRADA',500,500,1.5,'CARGA INICIAL')`,
        [un, pid, lote],
      );
    }
  }

  const sit = async (codigo: string) => (await c.query(`select id from odo.situacao where codigo = $1`, [codigo])).rows[0]?.id as number;
  const proc = async (nome: string) => (await c.query(`select id from odo.procedimento where nome = $1`, [nome])).rows[0]?.id as number;
  const fila = (await c.query(`select id from amb.fila where unidade_id = $1 and tipo = 'ODONTOLOGIA' limit 1`, [ceo])).rows[0]?.id ?? null;
  const esp = (await c.query(`select id from cad.especialidade where nome = 'ODONTOLOGIA - CLÍNICO GERAL'`)).rows[0]?.id ?? null;
  const adultos = (await c.query(`select id from cad.pessoa where id = any($1) and data_nascimento < current_date - interval '18 years' order by id limit 3`, [ctx.pacientes])).rows.map((r) => r.id);
  const crianca = (await c.query(`select id from cad.pessoa where id = any($1) and data_nascimento between current_date - interval '10 years' and current_date - interval '5 years' order by id limit 1`, [ctx.pacientes])).rows[0]?.id;

  for (const [n, pacienteId] of adultos.entries()) {
    // Primeira consulta odontológica programática (finalizada há 20 dias) com exame e plano de tratamento.
    const dias = 20 - n * 5;
    const at = (
      await c.query(
        `insert into amb.atendimento (paciente_id, unidade_id, fila_id, senha, entrada_em, inicio_em, fim_em, situacao, especialidade_id, profissional_id, tipo_unidade, tipo_atendimento_sia,
                                      subjetivo, avaliacao, plano, saude_bucal, material_odonto, desfecho)
         values ($1,$2,$3,'O00' || $4, now() - ($5 || ' days')::interval, now() - ($5 || ' days')::interval, now() - ($5 || ' days')::interval + interval '40 minutes', 'FINALIZADO', $6, $7,
                 'ODONTOLOGIA', '01', 'Paciente relata sensibilidade e dor ao mastigar.', 'Cáries em molares; necessidade de restaurações e raspagem.', 'Plano de tratamento em 3 etapas.',
                 $8, '{"ESCOVA": 1, "CREME": 1, "FIO": 1}', 'RETORNO_AGENDADO') returning *`,
        [pacienteId, ceo, fila, n + 1, dias, esp, dentista, n === 0 ? ['DOR_DENTE'] : []],
      )
    ).rows[0];
    await c.query(`insert into odo.atendimento_odonto (atendimento_id, paciente_id, tipo_consulta, grupo_atendimento_id, denticao, condutas) values ($1,$2,'PRIMEIRA_PROGRAMATICA',(select id from odo.grupo_atendimento where codigo = '01'),'PERMANENTE','{RETORNO_AGENDADO}')`, [at.id, pacienteId]);
    const plano = (
      await c.query(
        `insert into odo.plano_tratamento (paciente_id, unidade_id, profissional_id, atendimento_id, data_inicio, primeira_consulta, situacao)
         values ($1,$2,$3,$4,(now() - ($5 || ' days')::interval)::date,true,'EM_ANDAMENTO') returning id`,
        [pacienteId, ceo, dentista, at.id, dias],
      )
    ).rows[0].id;
    const etapas: number[] = [];
    for (const [i, d] of ['Adequação do meio bucal e periodontia', 'Restaurações', 'Manutenção e prevenção'].entries())
      etapas.push((await c.query(`insert into odo.plano_etapa (plano_id, ordem, descricao, situacao) values ($1,$2,$3,'PENDENTE') returning id`, [plano, i + 1, d])).rows[0].id);
    const marca = (dente: number | null, faces: string[] | null, situacao: number | null, procedimento: number | null, status: string, etapa: number | null, extra: Record<string, unknown> = {}) =>
      c.query(
        `insert into odo.marcacao (paciente_id, atendimento_id, plano_id, etapa_id, data, profissional_id, unidade_id, marcacao, dente, faces, sextante, situacao_id, procedimento_odonto_id, status,
                                   executado_em, executado_atendimento_id, executado_profissional_id, producao)
         values ($1,$2,$3,$4,(now() - ($5 || ' days')::interval)::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
        [
          pacienteId,
          at.id,
          procedimento ? plano : null,
          etapa,
          dias,
          dentista,
          ceo,
          extra.sextante ? 'SEXTANTE' : faces ? 'FACE' : 'DENTE',
          dente,
          faces,
          extra.sextante ?? null,
          situacao,
          procedimento,
          status,
          status === 'EXECUTADO' ? at.entrada_em : null,
          status === 'EXECUTADO' ? at.id : null,
          status === 'EXECUTADO' ? dentista : null,
          JSON.stringify(extra.producao ?? []),
        ],
      );
    await marca(16, ['O', 'M'], await sit('CAR'), null, 'EXISTENTE', null);
    await marca(36, ['O'], await sit('CAR'), null, 'EXISTENTE', null);
    await marca(26, ['O', 'D'], await sit('RES'), null, 'EXISTENTE', null);
    await marca(47, null, await sit('NEN'), null, 'EXISTENTE', null);
    await marca(18, null, await sit('AUS'), null, 'EXISTENTE', null);
    await marca(38, null, await sit('NIR'), null, 'EXISTENTE', null);
    await marca(11, ['V'], await sit('SEL'), null, 'EXISTENTE', null);
    // Procedimento executado na primeira consulta, com produção lançada no BPA.
    const pid = await proc('Profilaxia / remoção de placa');
    const producao = await lancarItens(c, await itensSigtap(c, pid, { dente: null, elementos: 1 }), { id: at.id, unidade_id: ceo, paciente_id: pacienteId }, dentista);
    await c.query(
      `insert into odo.marcacao (paciente_id, atendimento_id, plano_id, etapa_id, data, profissional_id, unidade_id, marcacao, procedimento_odonto_id, status, executado_em, executado_atendimento_id, executado_profissional_id, producao)
       values ($1,$2,$3,$4,$5::date,$6,$7,'BOCA',$8,'EXECUTADO',$5,$2,$6,$9)`,
      [pacienteId, at.id, plano, etapas[0], at.entrada_em, dentista, ceo, pid, JSON.stringify(producao)],
    );
    // Procedimentos planejados nas etapas do plano.
    await marca(null, null, null, await proc('Raspagem supragengival'), 'PLANEJADO', etapas[0], { sextante: 1 });
    await marca(16, ['O', 'M'], null, await proc('Restauração'), 'PLANEJADO', etapas[1]);
    await marca(36, ['O'], null, await proc('Restauração'), 'PLANEJADO', etapas[1]);
    await marca(47, null, null, await proc('Tratamento endodôntico (canal)'), 'PLANEJADO', etapas[1]);
  }

  if (crianca) {
    const at = (
      await c.query(
        `insert into amb.atendimento (paciente_id, unidade_id, fila_id, senha, entrada_em, inicio_em, fim_em, situacao, especialidade_id, profissional_id, tipo_unidade, tipo_atendimento_sia, desfecho)
         values ($1,$2,$3,'O010', now() - interval '7 days', now() - interval '7 days', now() - interval '7 days' + interval '30 minutes','FINALIZADO',$4,$5,'ODONTOLOGIA','01','ALTA') returning *`,
        [crianca, ceo, fila, esp, dentista],
      )
    ).rows[0];
    await c.query(`insert into odo.atendimento_odonto (atendimento_id, paciente_id, tipo_consulta, denticao) values ($1,$2,'MANUTENCAO','MISTA')`, [at.id, crianca]);
    for (const [dente, faces, codigo] of [
      [55, ['O'], 'CAR'],
      [64, ['O'], 'RES'],
      [75, null, 'EXI'],
      [16, ['O'], 'SEL'],
      [46, ['O'], 'SEL'],
    ] as [number, string[] | null, string][])
      await c.query(
        `insert into odo.marcacao (paciente_id, atendimento_id, data, profissional_id, unidade_id, marcacao, dente, faces, situacao_id, status) values ($1,$2,current_date - 7,$3,$4,$5,$6,$7,(select id from odo.situacao where codigo = $8),'EXISTENTE')`,
        [crianca, at.id, dentista, ceo, faces ? 'FACE' : 'DENTE', dente, faces, codigo],
      );
  }
});
