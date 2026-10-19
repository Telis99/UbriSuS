// Demonstração da APAC: procedimento de alta complexidade, faixa numérica e uma APAC autorizada com produção.
import { registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import type { Usuario } from '../../seguranca/usuario.js';
import { montarNumero } from '../aih/servico.js';
import { autorizarApac } from './servico.js';

registrarCargaDemonstracao('APAC', async (c, ctx) => {
  await c.query(
    `insert into cad.procedimento (codigo, nome, grupo, subgrupo, forma_organizacao, complexidade, instrumentos, valor_sa, sexo, competencia, ativo)
     select '0305010107', 'HEMODIÁLISE (MÁXIMO 3 SESSÕES POR SEMANA)', '03', '0305', '030501', '3', array['06'], 218.47, 'A', to_char(current_date, 'YYYYMM'), true
      where not exists (select 1 from cad.procedimento where codigo = '0305010107')`,
  );
  const orgao = (await c.query(`select id from aih.orgao_emissor order by id limit 1`)).rows[0];
  if (!orgao || (await c.query(`select 1 from apac.laudo limit 1`)).rowCount) return;
  const ano = new Date().getFullYear();
  const base = `35${String(ano).slice(2)}40000000`;
  if (!(await c.query(`select 1 from aih.faixa where tipo = 'APAC'`)).rowCount)
    await c.query(
      `insert into aih.faixa (tipo, orgao_emissor_id, esfera, validade_inicio, validade_fim, numero_inicial, quantidade, numero_final, ativo) values ('APAC', $1, 'MUNICIPAL', $2, $3, $4, 300, $5, true)`,
      [orgao.id, `${ano}-01-01`, `${ano}-12-31`, montarNumero(base), montarNumero(BigInt(base) + 299n)],
    );
  const pac = (await c.query(`select id from cad.pessoa where id = any($1) and data_nascimento < current_date - interval '40 years' and situacao = 'ATIVO' order by id desc limit 1`, [ctx.pacientes])).rows[0];
  const proc = (await c.query(`select id from cad.procedimento where codigo = '0305010107'`)).rows[0];
  const cid = (await c.query(`select id from cad.cid where codigo = 'N180'`)).rows[0];
  if (!pac || !proc || !ctx.profissionais.medico) return;
  const l = (
    await c.query(
      `insert into apac.laudo (data_solicitacao, unidade_solicitante_id, unidade_executante_id, paciente_id, tipo_apac, carater, procedimento_id, quantidade, profissional_solicitante_id,
                               cid_principal_id, justificativa, situacao, motivo_saida)
       values (current_date - 5, $1, $2, $3, '1', '01', $4, 12, $5, $6, 'Doença renal crônica estágio 5 em programa de hemodiálise.', 'SOLICITADO', '21') returning id`,
      [ctx.unidades.usf, ctx.unidades.cem, pac.id, proc.id, ctx.profissionais.medico, cid?.id ?? null],
    )
  ).rows[0];
  await c.query(`update apac.laudo set numero_laudo = $2 where id = $1`, [l.id, `AP${ano}${String(l.id).padStart(6, '0')}`]);
  const admin = (await c.query(`select id from seg.operador where login = 'admin'`)).rows[0]?.id ?? null;
  await autorizarApac(c, l.id, { autorizadorId: ctx.profissionais.medico, data: new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10) }, { id: admin } as Usuario);
  const competencia = new Date().toISOString().slice(0, 7).replace('-', '');
  await c.query(
    `insert into apac.procedimento (laudo_id, competencia, data, procedimento_id, quantidade, profissional_id, valor) values ($1, $2, current_date - 2, $3, 8, $4, 8 * 218.47)`,
    [l.id, competencia, proc.id, ctx.profissionais.medico],
  );
});
