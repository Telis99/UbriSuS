// Calendário Nacional de Vacinação (PNI) como carga inicial e dados de demonstração.
import type pg from 'pg';
import { registrarCarga, registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { loteNaUnidade } from '../farmacia/servico.js';

const M = (meses: number) => Math.round(meses * 30.44);
const A = (anos: number) => Math.round(anos * 365.25);

const DOSES: [string, string, string, number][] = [
  ['D1', '1ª dose', '1', 1],
  ['D2', '2ª dose', '2', 2],
  ['D3', '3ª dose', '3', 3],
  ['R1', '1º reforço', '6', 4],
  ['R2', '2º reforço', '7', 5],
  ['DU', 'Dose única', '9', 0],
  ['REF', 'Reforço', '5', 6],
  ['DA', 'Dose adicional', '38', 7],
];

// [sigla, nome, código SI-PNI, via, doses por frasco, ordem, exige diluente, tipo, exibir na carteira]
const IMUNOS: [string, string, string, string, number, number, boolean, string, boolean][] = [
  ['BCG', 'BCG', '15', 'ID', 10, 1, true, 'VACINA', true],
  ['HEP B', 'HEPATITE B', '09', 'IM', 10, 2, false, 'VACINA', true],
  ['PENTA', 'PENTAVALENTE (DTP/HIB/HB)', '42', 'IM', 1, 3, false, 'VACINA', true],
  ['VIP', 'POLIOMIELITE INATIVADA (VIP)', '22', 'IM', 10, 4, false, 'VACINA', true],
  ['PNM10', 'PNEUMOCÓCICA 10-VALENTE', '26', 'IM', 1, 5, false, 'VACINA', true],
  ['VRH', 'ROTAVÍRUS HUMANO (VRH)', '28', 'VO', 1, 6, false, 'VACINA', true],
  ['MNG C', 'MENINGOCÓCICA C (CONJUGADA)', '27', 'IM', 1, 7, false, 'VACINA', true],
  ['FA', 'FEBRE AMARELA', '05', 'SC', 5, 8, true, 'VACINA', true],
  ['SCR', 'TRÍPLICE VIRAL (SARAMPO, CAXUMBA, RUBÉOLA)', '24', 'SC', 10, 9, true, 'VACINA', true],
  ['HEP A', 'HEPATITE A', '88', 'IM', 1, 10, false, 'VACINA', true],
  ['DTP', 'TRÍPLICE BACTERIANA (DTP)', '46', 'IM', 10, 11, false, 'VACINA', true],
  ['VZ', 'VARICELA', '91', 'SC', 1, 12, false, 'VACINA', true],
  ['HPV4', 'HPV QUADRIVALENTE', '67', 'IM', 1, 13, false, 'VACINA', true],
  ['ACWY', 'MENINGOCÓCICA ACWY', '89', 'IM', 1, 14, false, 'VACINA', true],
  ['dT', 'DUPLA ADULTO (dT)', '25', 'IM', 10, 15, false, 'VACINA', true],
  ['dTpa', 'TRÍPLICE BACTERIANA ACELULAR ADULTO (dTpa)', '57', 'IM', 1, 16, false, 'VACINA', true],
  ['INF', 'INFLUENZA', '33', 'IM', 10, 17, false, 'VACINA', true],
  ['TETRA', 'TETRA VIRAL (SCR + VARICELA)', '56', 'SC', 1, 90, true, 'VACINA', false],
  ['SAR', 'SORO ANTIRRÁBICO', '63', 'IM', 1, 95, false, 'SORO', false],
];

// [imuno, dose, faixa, idade mín (dias), idade máx (dias), próxima dose, intervalo (dias), sexo, gestante]
const QUADRO: [string, string, string, number, number | null, string | null, number | null, string?, string?][] = [
  ['BCG', 'DU', 'CRIANCA', 0, A(5) - 1, null, null],
  ['HEP B', 'D1', 'CRIANCA', 0, 30, null, null],
  ['PENTA', 'D1', 'CRIANCA', M(2), A(7) - 1, 'D2', 60],
  ['PENTA', 'D2', 'CRIANCA', M(4), A(7) - 1, 'D3', 60],
  ['PENTA', 'D3', 'CRIANCA', M(6), A(7) - 1, null, null],
  ['VIP', 'D1', 'CRIANCA', M(2), A(5) - 1, 'D2', 60],
  ['VIP', 'D2', 'CRIANCA', M(4), A(5) - 1, 'D3', 60],
  ['VIP', 'D3', 'CRIANCA', M(6), A(5) - 1, 'R1', 270],
  ['VIP', 'R1', 'CRIANCA', M(15), A(5) - 1, null, null],
  ['PNM10', 'D1', 'CRIANCA', M(2), A(5) - 1, 'D2', 60],
  ['PNM10', 'D2', 'CRIANCA', M(4), A(5) - 1, 'R1', 240],
  ['PNM10', 'R1', 'CRIANCA', M(12), A(5) - 1, null, null],
  ['VRH', 'D1', 'CRIANCA', M(2), M(3) + 15, 'D2', 60],
  ['VRH', 'D2', 'CRIANCA', M(4), M(8) - 1, null, null],
  ['MNG C', 'D1', 'CRIANCA', M(3), A(5) - 1, 'D2', 60],
  ['MNG C', 'D2', 'CRIANCA', M(5), A(5) - 1, 'R1', 210],
  ['MNG C', 'R1', 'CRIANCA', M(12), A(5) - 1, null, null],
  ['FA', 'D1', 'CRIANCA', M(9), A(5) - 1, 'R1', A(3)],
  ['FA', 'R1', 'CRIANCA', A(4), A(5) - 1, null, null],
  ['SCR', 'D1', 'CRIANCA', M(12), A(30) - 1, 'D2', 90],
  ['SCR', 'D2', 'CRIANCA', M(15), A(30) - 1, null, null],
  ['HEP A', 'DU', 'CRIANCA', M(15), A(5) - 1, null, null],
  ['DTP', 'R1', 'CRIANCA', M(15), A(7) - 1, 'R2', A(3) - M(15) + M(36)],
  ['DTP', 'R2', 'CRIANCA', A(4), A(7) - 1, null, null],
  ['VZ', 'D1', 'CRIANCA', M(15), A(7) - 1, 'D2', A(4) - M(15)],
  ['VZ', 'D2', 'CRIANCA', A(4), A(7) - 1, null, null],
  ['HPV4', 'DU', 'ADOLESCENTE', A(9), A(15) - 1, null, null],
  ['ACWY', 'DU', 'ADOLESCENTE', A(11), A(15) - 1, null, null],
  ['dT', 'REF', 'ADULTO', A(20), null, null, null],
  ['HEP B', 'D1', 'ADULTO', A(20), null, 'D2', 30],
  ['HEP B', 'D2', 'ADULTO', A(20), null, 'D3', 150],
  ['HEP B', 'D3', 'ADULTO', A(20), null, null, null],
  ['INF', 'DU', 'IDOSO', A(60), null, null, null],
  ['dTpa', 'DU', 'GESTANTE', A(10), A(50) - 1, null, null, 'F', 'RECOMENDADO'],
  ['INF', 'DU', 'GESTANTE', A(10), A(50) - 1, null, null, 'F', 'RECOMENDADO'],
  ['TETRA', 'D1', 'CRIANCA', M(15), A(7) - 1, null, null],
  ['SAR', 'DU', 'ADULTO', 0, null, null, null],
];

registrarCarga('Calendário nacional de vacinação', async (c) => {
  for (const [sigla, nome, cod, ordem] of DOSES)
    await c.query(`insert into imu.dose (sigla, nome, codigo_sipni, ordem) select $1::varchar, $2::varchar, $3::varchar, $4 where not exists (select 1 from imu.dose where sigla = $1)`, [sigla, nome, cod, ordem]);
  const grupo = (await c.query(`select id from far.grupo_produto where nome = 'IMUNOBIOLÓGICOS'`)).rows[0]?.id;
  const ap = (await c.query(`select id from far.apresentacao where nome = 'FRASCO-AMPOLA'`)).rows[0]?.id;
  const diluentes = new Map<string, number>();
  for (const [sigla, nome, cod, via, dpf, ordem, diluente, tipo, exibir] of IMUNOS) {
    if ((await c.query(`select 1 from imu.imunobiologico where sigla = $1`, [sigla])).rowCount) continue;
    const prod = (
      await c.query(
        `insert into far.produto (nome, concentracao, tipo, grupo_id, apresentacao_id, doses_frasco, tipo_receita, nao_fracionavel, rename, preco_custo)
         values ($1, $2, 'IMUNOBIOLOGICO', $3, $4, $5, 'BASICA', true, true, $6) returning id`,
        [`VACINA ${nome}`.replace('VACINA SORO', 'SORO'), dpf > 1 ? `FRASCO ${dpf} DOSES` : 'DOSE ÚNICA', grupo, ap, dpf, dpf > 1 ? 25 : 40],
      )
    ).rows[0].id;
    const imuno = (
      await c.query(
        `insert into imu.imunobiologico (nome, sigla, codigo_sipni, tipo, via, produto_id, exige_diluente, doses_tratamento, exibir_carteira, ordem_carteira)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [nome, sigla, cod, tipo, via, prod, diluente, tipo === 'SORO' ? 5 : null, exibir, ordem],
      )
    ).rows[0].id;
    if (diluente) {
      const dil = (await c.query(`insert into far.produto (nome, concentracao, tipo, grupo_id, doses_frasco, nao_fracionavel, preco_custo) values ($1, $2, 'DILUENTE', $3, $4, true, 1) returning id`, [`DILUENTE PARA ${nome}`, `${dpf} DOSES`, grupo, dpf])).rows[0].id;
      diluentes.set(sigla, dil);
      await c.query(`insert into imu.imunobiologico_diluente (imunobiologico_id, produto_id) values ($1,$2)`, [imuno, dil]);
    }
  }
  const id = async (t: string, sigla: string) => (await c.query(`select id from ${t} where sigla = $1`, [sigla])).rows[0].id as number;
  if (!(await c.query(`select 1 from imu.quadro_cobertura limit 1`)).rowCount)
    for (const [im, dose, faixa, min, max, prox, intervalo, sexo, gest] of QUADRO)
      await c.query(
        `insert into imu.quadro_cobertura (imunobiologico_id, dose_id, estrategia, faixa_carteira, idade_minima_dias, idade_maxima_dias, sexo, gestante, proxima_dose_id, intervalo_proxima_dias)
         values ($1,$2,'ROTINA',$3,$4,$5,$6,$7,$8,$9)`,
        [await id('imu.imunobiologico', im), await id('imu.dose', dose), faixa, min, max, sexo ?? 'A', gest ?? 'INDIFERENTE', prox ? await id('imu.dose', prox) : null, intervalo],
      );
  if (!(await c.query(`select 1 from imu.imunobiologico_incompatibilidade limit 1`)).rowCount) {
    await c.query(`insert into imu.imunobiologico_incompatibilidade (imunobiologico_id, incompativel_id, intervalo_dias) values ($1,$2,30)`, [await id('imu.imunobiologico', 'FA'), await id('imu.imunobiologico', 'SCR')]);
    // Tetra viral equivale à 2ª dose da tríplice viral e à 1ª dose da varicela.
    await c.query(`insert into imu.imunobiologico_equivalencia (imunobiologico_id, dose_id, equivale_id, equivale_dose_id) values ($1,$2,$3,$4),($1,$2,$5,$6)`, [
      await id('imu.imunobiologico', 'TETRA'),
      await id('imu.dose', 'D1'),
      await id('imu.imunobiologico', 'SCR'),
      await id('imu.dose', 'D2'),
      await id('imu.imunobiologico', 'VZ'),
      await id('imu.dose', 'D1'),
    ]);
  }
});

registrarCargaDemonstracao('Imunização (estoque de vacinas, carteiras e campanha)', async (c, ctx) => {
  const { usf, usf2 } = ctx.unidades;
  const fab = (await c.query(`insert into far.fabricante (nome, codigo_sipni) values ('INSTITUTO BUTANTAN', '01'), ('FIOCRUZ / BIO-MANGUINHOS', '02') returning id`)).rows.map((r) => r.id);
  const produtos = (await c.query(`select id, nome, doses_frasco, tipo from far.produto where tipo in ('IMUNOBIOLOGICO','DILUENTE') order by id`)).rows;
  let n = 0;
  for (const p of produtos)
    for (const un of [usf, usf2]) {
      const lid = await loteNaUnidade(c, { unidadeId: un, produtoId: p.id, lote: `V${26100 + ++n}`, validade: new Date(Date.now() + (180 + (n % 7) * 30) * 86_400_000).toISOString().slice(0, 10), fabricanteId: fab[n % 2], custo: p.tipo === 'DILUENTE' ? 1 : 30, dosesFrasco: p.doses_frasco });
      await c.query(`update far.estoque_lote set quantidade = 40 where id = $1`, [lid]);
      await c.query(`insert into far.movimento_estoque (data_hora, unidade_id, produto_id, lote_id, tipo, quantidade, saldo_apos, documento) values (now() - interval '20 days', $1, $2, $3, 'ENTRADA', 40, 40, 'GRADE SES/SP')`, [un, p.id, lid]);
    }
  // Histórico de vacinação das crianças da demonstração: tudo em dia exceto uma dose (vacina em atraso).
  const criancas = (await c.query(`select id, data_nascimento::text nasc from cad.pessoa where id = any($1) and data_nascimento > current_date - interval '9 years'`, [ctx.pacientes])).rows;
  const quadro = (await c.query(`select q.imunobiologico_id, q.dose_id, q.idade_minima_dias, i.sigla from imu.quadro_cobertura q join imu.imunobiologico i on i.id = q.imunobiologico_id where q.faixa_carteira = 'CRIANCA' and i.exibir_carteira`)).rows;
  const prof = ctx.profissionais.enfermeira ?? null;
  let k = 0;
  for (const cr of criancas) {
    const idade = Math.floor((Date.now() - new Date(cr.nasc + 'T12:00:00').getTime()) / 86_400_000);
    for (const q of quadro) {
      if (q.idade_minima_dias > idade) continue;
      if (++k % 9 === 0) continue; // deixa doses em atraso para a busca ativa
      const data = new Date(new Date(cr.nasc + 'T12:00:00').getTime() + (q.idade_minima_dias + 3) * 86_400_000).toISOString().slice(0, 10);
      await c.query(
        `insert into imu.vacinacao (paciente_id, imunobiologico_id, dose_id, tipo, data, unidade_id, profissional_id, lote_texto, estrategia) values ($1,$2,$3,'APLICACAO',$4,$5,$6,$7,'ROTINA')`,
        [cr.id, q.imunobiologico_id, q.dose_id, data, usf, prof, `L${(k * 37) % 9000}`],
      );
    }
  }
  const inf = (await c.query(`select id from imu.imunobiologico where sigla = 'INF'`)).rows[0].id;
  const du = (await c.query(`select id from imu.dose where sigla = 'DU'`)).rows[0].id;
  const camp = (await c.query(`insert into imu.campanha (nome, estrategia, inicio, fim) values ('CAMPANHA NACIONAL DE VACINAÇÃO CONTRA A INFLUENZA 2026', 'CAMPANHA', current_date - 30, current_date + 60) returning id`)).rows[0].id;
  await c.query(
    `insert into imu.campanha_grupo (campanha_id, nome, imunobiologico_id, dose_id, idade_minima_dias, idade_maxima_dias, populacao_alvo, meta_percentual) values
     ($1, 'CRIANÇAS DE 6 MESES A 5 ANOS', $2, $3, ${M(6)}, ${A(6) - 1}, 2850, 90),
     ($1, 'IDOSOS (60 ANOS OU MAIS)', $2, $3, ${A(60)}, null, 6200, 90),
     ($1, 'TRABALHADORES DA SAÚDE', $2, $3, ${A(18)}, null, 950, 90),
     ($1, 'GESTANTES E PUÉRPERAS', $2, $3, ${A(10)}, ${A(50) - 1}, 420, 90)`,
    [camp, inf, du],
  );
  const grupos = (await c.query(`select id, idade_minima_dias, idade_maxima_dias from imu.campanha_grupo where campanha_id = $1`, [camp])).rows;
  const todos = (await c.query(`select id, current_date - data_nascimento idade from cad.pessoa where id = any($1)`, [ctx.pacientes])).rows;
  let j = 0;
  for (const p of todos) {
    const g = grupos.find((x) => p.idade >= x.idade_minima_dias && (x.idade_maxima_dias == null || p.idade <= x.idade_maxima_dias));
    if (!g || ++j % 2) continue;
    await c.query(
      `insert into imu.vacinacao (paciente_id, imunobiologico_id, dose_id, tipo, data, unidade_id, profissional_id, lote_texto, estrategia, campanha_id, grupo_id) values ($1,$2,$3,'APLICACAO',current_date - $4::int,$5,$6,'INF2026A','CAMPANHA',$7,$8)`,
      [p.id, inf, du, j % 25, usf, prof, camp, g.id],
    );
  }
});
