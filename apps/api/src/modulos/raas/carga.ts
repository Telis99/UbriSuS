// Demonstração do RAAS: ações psicossociais (instrumento 09) e de atenção domiciliar (instrumento 08) da
// tabela SIGTAP e RAAS-AD de exemplo para a equipe Melhor em Casa.
import type pg from 'pg';
import { registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { registrarAcaoRaas } from './servico.js';

export const PROCEDIMENTOS_RAAS: [string, string, string][] = [
  ['0301080208', 'ATENDIMENTO INDIVIDUAL DE PACIENTE EM CENTRO DE ATENÇÃO PSICOSSOCIAL', '09'],
  ['0301080216', 'ATENDIMENTO EM GRUPO DE PACIENTE EM CENTRO DE ATENÇÃO PSICOSSOCIAL', '09'],
  ['0301080224', 'ATENDIMENTO FAMILIAR EM CENTRO DE ATENÇÃO PSICOSSOCIAL', '09'],
  ['0301080232', 'ACOLHIMENTO INICIAL POR CENTRO DE ATENÇÃO PSICOSSOCIAL', '09'],
  ['0301080240', 'ATENDIMENTO DOMICILIAR PARA PACIENTES DE CENTRO DE ATENÇÃO PSICOSSOCIAL E/OU FAMILIARES', '09'],
  ['0301080259', 'AÇÕES DE ARTICULAÇÃO DE REDES INTRA E INTERSETORIAIS', '09'],
  ['0301080275', 'PRÁTICAS CORPORAIS EM CENTRO DE ATENÇÃO PSICOSSOCIAL', '09'],
  ['0301080283', 'PRÁTICAS EXPRESSIVAS E COMUNICATIVAS EM CENTRO DE ATENÇÃO PSICOSSOCIAL', '09'],
  ['0301080291', 'ATENÇÃO ÀS SITUAÇÕES DE CRISE', '09'],
  ['0301080348', 'AÇÕES DE REABILITAÇÃO PSICOSSOCIAL', '09'],
  ['0301050139', 'ATENDIMENTO DOMICILIAR POR PROFISSIONAL DE NÍVEL SUPERIOR (EMAD)', '08'],
  ['0301050147', 'ATENDIMENTO DOMICILIAR POR PROFISSIONAL DE NÍVEL SUPERIOR (EMAP)', '08'],
  ['0301050155', 'ATENDIMENTO DOMICILIAR POR PROFISSIONAL DE NÍVEL MÉDIO (EMAD)', '08'],
];

export async function cargaProcedimentosRaas(c: pg.PoolClient) {
  for (const [codigo, nome, instrumento] of PROCEDIMENTOS_RAAS) {
    await c.query(
      `insert into cad.procedimento (codigo, nome, grupo, subgrupo, forma_organizacao, complexidade, instrumentos, valor_sa, sexo, competencia, ativo)
       select $1::varchar, $2::varchar, '03', substr($1, 1, 4), substr($1, 1, 6), '2', array[$3::varchar], 0, 'A', to_char(current_date, 'YYYYMM'), true
        where not exists (select 1 from cad.procedimento where codigo = $1)`,
      [codigo, nome, instrumento],
    );
  }
}

registrarCargaDemonstracao('RAAS', async (c, ctx) => {
  await cargaProcedimentosRaas(c);
  const sad = (await c.query(`select id from cad.unidade where nome ilike 'MELHOR EM CASA%' limit 1`)).rows[0]?.id;
  if (!sad || (await c.query(`select 1 from raas.registro where tipo = 'DOMICILIAR' limit 1`)).rowCount) return;
  const idosos = (await c.query(`select id from cad.pessoa where id = any($1) and situacao = 'ATIVO' and data_nascimento < current_date - interval '70 years' order by id limit 2`, [ctx.pacientes])).rows;
  const proc = async (codigo: string) => (await c.query(`select id from cad.procedimento where codigo = $1`, [codigo])).rows[0].id;
  const hoje = new Date();
  for (const [i, p] of idosos.entries()) {
    for (let d = 0; d < 3; d++) {
      const data = new Date(hoje.getFullYear(), hoje.getMonth(), Math.max(1, hoje.getDate() - 2 * d - i)).toISOString().slice(0, 10);
      await registrarAcaoRaas(c, {
        tipo: 'DOMICILIAR',
        unidadeId: sad,
        pacienteId: p.id,
        data,
        procedimentoId: await proc(d === 1 ? '0301050155' : '0301050139'),
        profissionalId: d === 1 ? ctx.profissionais.enfermeira : ctx.profissionais.medico,
        local: 'D',
        origem: `demonstracao:ad:${p.id}:${d}`,
      });
    }
    await c.query(`update raas.registro set cuidador = 'CUIDADOR(A) FAMILIAR', modalidade_ad = 'AD2', origem = '05' where paciente_id = $1 and tipo = 'DOMICILIAR'`, [p.id]);
  }
});
