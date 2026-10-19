// Parâmetros do aplicativo do ACS e dados fictícios de demonstração: território da microárea 01
// da USF com famílias (Ficha A), liberação do ACS de demonstração e visitas georreferenciadas.
import { randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { obterEntidade } from '../../meta/registro.js';
import { lancarProducao } from '../faturamento/producao.js';
import { PROCEDIMENTO_VISITA_ACS } from './servico.js';

registrarParametro('acs.max_tentativas', 3, 'Tentativas de login inválidas no aplicativo do ACS antes do bloqueio', 'ACS');

// Centro aproximado do bairro de referência da USF demonstrativa (Cabreúva/SP).
const CENTRO = { lat: -23.3076, lng: -47.1329 };
const jitter = (v: number, m: number) => v + (randomInt(-1000, 1000) / 1000) * (m / 111_000);
const primeira = (campo: string, indice = 0) => {
  const op = obterEntidade('familia')!.campos.find((c) => c.nome === campo)?.opcoes ?? [];
  return op[Math.min(indice, op.length - 1)]?.[0] ?? null;
};

export async function demonstracaoAcs(c: pg.PoolClient, ctx: { pacientes: number[]; profissionais: Record<string, number>; unidades: Record<string, number> }) {
  const usf = ctx.unidades.usf;
  const acsProf = ctx.profissionais.acs;
  if (!usf || !acsProf) return;
  const op = (await c.query(`select id from seg.operador where profissional_id = $1 order by id limit 1`, [acsProf])).rows[0];
  if (op) {
    await c.query(
      `insert into acs.acesso (operador_id, profissional_id, unidade_id, area, microarea, validade_carga_dias, situacao, liberado_em, observacao)
       values ($1,$2,$3,'0001','01',30,'LIBERADO',now(),'Liberação de demonstração') on conflict do nothing`,
      [op.id, acsProf, usf],
    );
  }
  if ((await c.query(`select 1 from cad.familia where codigo like 'MA01-%' limit 1`)).rowCount) return;

  const pessoas = (
    await c.query(
      `select id, extract(year from age(current_date, data_nascimento))::int idade, municipio_id, bairro_id from cad.pessoa
        where id = any($1) and familia_id is null and situacao = 'ATIVO' and unidade_referencia_id = $2 order by id`,
      [ctx.pacientes, usf],
    )
  ).rows;
  const adultos = pessoas.filter((p) => p.idade >= 18);
  const menores = pessoas.filter((p) => p.idade < 18);
  const nFamilias = Math.min(8, adultos.length);
  if (!nFamilias) return;
  const logradouros = (await c.query(`select id, bairro_id, cep from cad.logradouro where municipio_id = $1 order by id limit 8`, [adultos[0].municipio_id])).rows;
  const membros: { id: number; parentesco: string }[][] = Array.from({ length: nFamilias }, (_, i) => [{ id: adultos[i].id, parentesco: 'RESPONSAVEL' }]);
  menores.forEach((m, i) => membros[i % nFamilias].push({ id: m.id, parentesco: 'FILHO' }));
  adultos.slice(nFamilias, nFamilias * 2).forEach((a, i) => membros[i].push({ id: a.id, parentesco: 'CONJUGE' }));

  for (let i = 0; i < nFamilias; i++) {
    const resp = adultos[i];
    const lg = logradouros.length ? logradouros[i % logradouros.length] : null;
    const lat = jitter(CENTRO.lat, 600);
    const lng = jitter(CENTRO.lng, 600);
    const f = (
      await c.query(
        `insert into cad.familia (codigo, responsavel_id, responsavel_nome, unidade_id, area, microarea, acs_id, municipio_id, logradouro_id, bairro_id, cep, numero,
                                  latitude, longitude, tipo_localidade, tipo_domicilio, situacao_domicilio, comodos, dormitorios, pessoas_por_dormitorio, tipo_piso,
                                  tipo_parede, agua_canalizada, abastecimento_agua, tratamento_agua, banheiro, destino_fezes, destino_lixo, iluminacao, acesso_domicilio,
                                  acessibilidade, area_risco, area_dificil_acesso, area_conflito, plano_saude, grupos_comunitarios, meios_comunicacao, meios_transporte, renda_familiar, ativo)
         select $1, p.id, p.nome, $2, '0001', '01', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 2, $15, $16, $17, true, $18, $19, true, $20, $21, $22, $23,
                $24, false, $25, false, false, $26, $27, $28, '3', true
           from cad.pessoa p where p.id = $29 returning id`,
        [
          `MA01-${String(i + 1).padStart(3, '0')}`, usf, acsProf, resp.municipio_id, lg?.id ?? null, lg?.bairro_id ?? resp.bairro_id, lg?.cep ?? null, String(100 + i * 12),
          lat, lng, primeira('tipo_localidade'), primeira('tipo_domicilio'), primeira('situacao_domicilio', i % 3), 4 + (i % 3), membros[i].length / 2,
          primeira('tipo_piso'), primeira('tipo_parede'), primeira('abastecimento_agua'), primeira('tratamento_agua', i % 2 ? 2 : 0), primeira('destino_fezes'),
          primeira('destino_lixo'), primeira('iluminacao'), primeira('acesso_domicilio'), i % 4 !== 0, i === 5,
          i % 3 === 0 ? 'Grupo de caminhada da USF' : null, ['TV', 'INTERNET'], i % 2 ? ['ONIBUS'] : ['CARRO', 'A_PE'], resp.id,
        ],
      )
    ).rows[0];
    for (const m of membros[i]) {
      await c.query(`update cad.pessoa set familia_id = $2, parentesco = $3, microarea = '01', latitude = $4, longitude = $5 where id = $1`, [m.id, f.id, m.parentesco, lat, lng]);
    }
    // Visitas anteriores georreferenciadas (mapa de calor da cobertura).
    const nVisitas = 1 + (i % 3);
    for (let k = 0; k < nVisitas; k++) {
      const quando = new Date(Date.now() - (5 + k * 21 + i) * 86_400_000);
      quando.setUTCHours(13 + (k % 4), 10 * k, 0, 0);
      const pessoa = membros[i][k % membros[i].length].id;
      const desfecho = k === 2 ? 'AUSENTE' : 'REALIZADA';
      const v = (
        await c.query(
          `insert into acs.visita (uuid, grupo_uuid, data_hora, turno, profissional_id, unidade_id, microarea, tipo_imovel, familia_id, pessoa_id, motivos, desfecho,
                                   compartilhada, parecer_tecnico, latitude, longitude, precisao_gps, origem, sincronizada_em, pa_sistolica, pa_diastolica)
           values ($1,$2,$3,'T',$4,$5,'01','01',$6,$7,$8,$9,$10,$11,$12,$13,8,'APLICATIVO',$3,$14,$15) returning id`,
          [
            randomUUID(), randomUUID(), quando.toISOString(), acsProf, usf, f.id, pessoa,
            k === 0 ? ['CADASTRAMENTO', 'VISITA_PERIODICA'] : ['VISITA_PERIODICA', i % 2 ? 'HIPERTENSAO' : 'CRIANCA'], desfecho, k === 1,
            desfecho === 'AUSENTE' ? 'Ninguém em casa; retornar no período da manhã.' : 'Família orientada sobre calendário vacinal e consultas de rotina.',
            jitter(lat, 15), jitter(lng, 15), i % 2 && desfecho === 'REALIZADA' ? 130 + i : null, i % 2 && desfecho === 'REALIZADA' ? 85 : null,
          ],
        )
      ).rows[0];
      if (desfecho === 'REALIZADA') {
        const prod = await lancarProducao(c, { data: quando.toISOString().slice(0, 10), unidadeId: usf, profissionalId: acsProf, pacienteId: pessoa, procedimentoCodigo: PROCEDIMENTO_VISITA_ACS, origem: 'VISITA_ACS', referencia: `visita:${v.id}` });
        if (prod) await c.query(`update acs.visita set producao_id = $2 where id = $1`, [v.id, prod.id]);
      }
    }
  }
}

registrarCargaDemonstracao('Aplicativo do ACS: território e visitas', demonstracaoAcs);
