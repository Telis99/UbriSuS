// Parâmetros e carga do módulo de AIH: órgão emissor municipal, faixa numérica e laudos de demonstração.
import type pg from 'pg';
import { registrarCarga, registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { gerarHashSenha } from '../../seguranca/senha.js';
import type { Usuario } from '../../seguranca/usuario.js';
import { aprovar, autorizar, internar, montarNumero, registrarSaida } from './servico.js';

registrarParametro('aih.cancelamento_exige_liberador', true, 'Exigir senha de um operador liberador para cancelar a autorização de AIH (TR 1.2.37.14)', 'AIH');
registrarParametro('aih.webservice', { ativo: false }, 'Web service de recebimento de laudos AIH de sistemas de terceiros: { ativo } (TR 1.2.38.2)', 'AIH');

// Órgão emissor do gestor municipal (código M + IBGE do município).
registrarCarga('Órgão emissor municipal de AIH/APAC', async (c) => {
  await c.query(
    `insert into aih.orgao_emissor (codigo, nome, esfera, ambito, municipio_id, gestao_plena, ativo)
     select 'M' || substr(m.codigo_ibge, 1, 6), 'SECRETARIA MUNICIPAL DE SAÚDE DE ' || upper(m.nome), 'MUNICIPAL', array['HOSPITALAR','AMBULATORIAL'], m.id, true, true
       from cad.municipio m where m.codigo_ibge = '3508405'
        and not exists (select 1 from aih.orgao_emissor o where o.codigo = 'M' || substr(m.codigo_ibge, 1, 6))`,
  );
});

// Procedimentos hospitalares frequentes (SIGTAP, instrumento 03 - AIH) para a demonstração.
const PROCEDIMENTOS_AIH: [string, string, number, number, string | null][] = [
  ['0303140151', 'TRATAMENTO DE PNEUMONIAS OU INFLUENZA (GRIPE)', 410.98, 82.57, null],
  ['0310010039', 'PARTO NORMAL', 443.4, 249.42, 'F'],
  ['0411010034', 'PARTO CESARIANO', 545.73, 401.58, 'F'],
  ['0407030026', 'COLECISTECTOMIA', 547.53, 239.74, null],
  ['0303060212', 'TRATAMENTO DE INSUFICIÊNCIA CARDÍACA', 584.06, 109.97, null],
  ['0303040149', 'TRATAMENTO DE ACIDENTE VASCULAR CEREBRAL - AVC (ISQUÊMICO OU HEMORRÁGICO AGUDO)', 413.45, 113.52, null],
];

export async function cargaProcedimentosAih(c: pg.PoolClient) {
  for (const [codigo, nome, sh, sp, sexo] of PROCEDIMENTOS_AIH) {
    await c.query(
      `insert into cad.procedimento (codigo, nome, grupo, subgrupo, forma_organizacao, complexidade, instrumentos, valor_sh, valor_sp, sexo, competencia, ativo)
       select $1::varchar, $2::varchar, substr($1, 1, 2), substr($1, 1, 4), substr($1, 1, 6), '2', array['03'], $3::numeric, $4::numeric, coalesce($5, 'A'), to_char(current_date, 'YYYYMM'), true
        where not exists (select 1 from cad.procedimento where codigo = $1)`,
      [codigo, nome, sh, sp, sexo],
    );
  }
}

registrarCargaDemonstracao('AIH', async (c, ctx) => {
  await cargaProcedimentosAih(c);
  const orgao = (await c.query(`select id from aih.orgao_emissor order by id limit 1`)).rows[0];
  if (!orgao) return;
  if ((await c.query(`select 1 from aih.laudo limit 1`)).rowCount) return;
  const ano = new Date().getFullYear();
  const base = `35${String(ano).slice(2)}10000000`; // UF 35, ano, tipo 1, sequencial
  await c.query(
    `insert into aih.faixa (tipo, orgao_emissor_id, esfera, validade_inicio, validade_fim, numero_inicial, quantidade, numero_final, ativo)
     values ('AIH', $1, 'MUNICIPAL', $2, $3, $4, 500, $5, true)`,
    [orgao.id, `${ano}-01-01`, `${ano}-12-31`, montarNumero(base), montarNumero(BigInt(base) + 499n)],
  );
  const hospital = (await c.query(`select id from cad.unidade where nome ilike 'UPA%' limit 1`)).rows[0]?.id ?? ctx.unidades.upa;
  const admin = (await c.query(`select id from seg.operador where login = 'admin'`)).rows[0]?.id ?? null;
  const u = { id: admin, nome: 'Carga de demonstração' } as Usuario;
  const proc = async (codigo: string) => (await c.query(`select id from cad.procedimento where codigo = $1`, [codigo])).rows[0].id;
  const cid = async (codigo: string) => (await c.query(`select id from cad.cid where codigo = $1`, [codigo])).rows[0]?.id ?? null;
  const pacientes = (await c.query(`select id, sexo from cad.pessoa where id = any($1) and situacao = 'ATIVO' and data_nascimento < current_date - interval '18 years' order by id`, [ctx.pacientes])).rows;
  const fem = pacientes.filter((p) => p.sexo === 'F');
  const masc = pacientes.filter((p) => p.sexo === 'M');
  const casos: { paciente: number | undefined; proc: string; cid: string; clinica: string; carater: string; etapa: number }[] = [
    { paciente: masc[0]?.id, proc: '0303140151', cid: 'J189', clinica: '03', carater: '02', etapa: 4 },
    { paciente: fem[0]?.id, proc: '0310010039', cid: 'O80', clinica: '02', carater: '02', etapa: 3 },
    { paciente: masc[1]?.id, proc: '0407030026', cid: 'K802', clinica: '01', carater: '01', etapa: 2 },
    { paciente: fem[1]?.id, proc: '0303060212', cid: 'I500', clinica: '03', carater: '02', etapa: 1 },
    { paciente: masc[2]?.id, proc: '0303040149', cid: 'I64', clinica: '03', carater: '02', etapa: 0 },
  ];
  for (const [i, k] of casos.entries()) {
    if (!k.paciente) continue;
    const p = await proc(k.proc);
    const v = (await c.query(`select coalesce(valor_sh, 0) sh, coalesce(valor_sp, 0) sp from cad.procedimento where id = $1`, [p])).rows[0];
    const l = (
      await c.query(
        `insert into aih.laudo (data_hora, unidade_solicitante_id, unidade_executante_id, paciente_id, prontuario, clinica, carater, procedimento_id, profissional_solicitante_id,
                                sinais_sintomas, condicoes_internacao, diagnostico_inicial, cid_principal_id, situacao, origem, valor_sh, valor_sp, valor_total)
         values (now() - ($1 || ' days')::interval, $2, $3, $4, (select prontuario from cad.pessoa where id = $4), $5, $6, $7, $8,
                 'Quadro clínico descrito no atendimento de origem.', 'Necessidade de cuidados hospitalares contínuos.', 'Diagnóstico inicial conforme CID informado.', $9, 'SOLICITADO', 'DIGITADO', $10::numeric, $11::numeric, $10::numeric + $11::numeric)
         returning id`,
        [String(10 - i), ctx.unidades.upa, hospital, k.paciente, k.clinica, k.carater, p, ctx.profissionais.medico ?? ctx.profissionais.plantonista, await cid(k.cid), v.sh, v.sp],
      )
    ).rows[0];
    await c.query(`update aih.laudo set numero_laudo = $2 where id = $1`, [l.id, `${ano}${String(l.id).padStart(6, '0')}`]);
    if (k.etapa >= 1) await aprovar(c, l.id, u);
    if (k.etapa >= 2 && ctx.profissionais.medico) await autorizar(c, l.id, { autorizadorId: ctx.profissionais.medico }, u);
    if (k.etapa >= 3) await internar(c, l.id, { data: new Date(Date.now() - (8 - i) * 86_400_000).toISOString().slice(0, 10) }, u);
    if (k.etapa >= 4) await registrarSaida(c, l.id, { data: new Date().toISOString().slice(0, 10), motivo: '12' }, u);
  }
  // Usuário de demonstração do web service (serviço permanece desativado até a administração ativar).
  await c.query(
    `insert into aih.integracao (login, sistema, senha_hash, unidade_id, laudos_recebidos, ativo) select 'hospital_demo', 'Sistema hospitalar de demonstração', $1, $2, 0, true
      where not exists (select 1 from aih.integracao where login = 'hospital_demo')`,
    [await gerarHashSenha('Integra@2026'), hospital],
  );
});
