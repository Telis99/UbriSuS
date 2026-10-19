// Relatórios do transporte sanitário (TR 1.2.40.29.1 a 1.2.40.29.9).
import { consultar } from '../../db/pool.js';
import { fmtData, PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';

const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const nul = (v: unknown) => (v === undefined || v === '' || v === null ? null : v);
const ROTA: FiltroRelatorio = { nome: 'rotaId', rotulo: 'Rota', tipo: 'ref', ref: 'rota' };
const VEICULO: FiltroRelatorio = { nome: 'veiculoId', rotulo: 'Veículo', tipo: 'ref', ref: 'veiculo' };
const CONDUTOR: FiltroRelatorio = { nome: 'condutorId', rotulo: 'Motorista', tipo: 'ref', ref: 'condutor' };
const MOTIVO: FiltroRelatorio = { nome: 'motivoId', rotulo: 'Motivo', tipo: 'ref', ref: 'motivo_viagem' };
const MUNICIPIO: FiltroRelatorio = { nome: 'municipioId', rotulo: 'Município de destino', tipo: 'ref', ref: 'municipio' };
const SO_CONCLUIDAS: FiltroRelatorio = { nome: 'concluidas', rotulo: 'Somente viagens concluídas (efetuadas)', tipo: 'booleano', padrao: true };

const base = { modulo: 'TRA', permissao: 'viagem:exportar' };
const concluidas = (f: Record<string, any>) => f.concluidas !== false && f.concluidas !== 'false';

/** Filtro padrão das viagens: período, situação, rota, veículo, motorista, motivo e município ($1 a $7). */
const FILTRO_VIAGEM = `v.data_saida between $1 and $2 and (case when $8::boolean then v.situacao = 'CONCLUIDA' else v.situacao <> 'CANCELADA' end)
  and ($3::bigint is null or v.rota_id = $3) and ($4::bigint is null or v.veiculo_id = $4) and ($5::bigint is null or v.condutor_id = $5)
  and ($6::bigint is null or v.motivo_id = $6) and ($7::bigint is null or v.municipio_destino_id = $7)`;
const params = (f: Record<string, any>) => [f.de, f.ate, nul(f.rotaId), nul(f.veiculoId), nul(f.condutorId), nul(f.motivoId), nul(f.municipioId), concluidas(f)];
const JOINS = `left join tra.rota r on r.id = v.rota_id left join cad.municipio m on m.id = v.municipio_destino_id left join tra.local_destino ld on ld.id = v.local_destino_id
  left join tra.motivo_viagem mv on mv.id = v.motivo_id left join tra.veiculo ve on ve.id = v.veiculo_id left join tra.condutor co on co.id = v.condutor_id`;
const VEICULO_SQL = `coalesce(ve.placa || ' ' || coalesce(ve.modelo, ''), '-')`;
const periodoTexto = (f: Record<string, any>) => `Período: ${fmtData(f.de)} a ${fmtData(f.ate)}`;

// Evolução mensal: pacientes, % sobre o mês anterior, despesas, km/litro e valor médio do litro (TR 1.2.40.29.1).
registrarRelatorio({
  ...base,
  id: 'tra-evolucao-mensal',
  grupo: 'Gerenciais',
  titulo: 'Evolução mensal dos transportes',
  tr: ['1.2.40.29.1'],
  filtros: [...PERIODO, ROTA, VEICULO],
  async gerar(f) {
    const linhas = await consultar(
      `with v as (select v.* from tra.viagem v where ${FILTRO_VIAGEM}),
            meses as (select to_char(v.data_saida, 'YYYY-MM') mes, count(*)::int viagens, sum(greatest(coalesce(v.km_final - v.km_inicial, 0), 0))::numeric km from v group by 1),
            pac as (select to_char(v.data_saida, 'YYYY-MM') mes, count(*)::int pacientes from v join tra.viagem_passageiro vp on vp.viagem_id = v.id
                     where vp.situacao in ('PRESENTE','CONFIRMADO','AGENDADO') group by 1),
            desp as (select to_char(v.data_saida, 'YYYY-MM') mes, sum(d.valor_total)::numeric despesas,
                            sum(case when t.combustivel then d.quantidade else 0 end)::numeric litros, sum(case when t.combustivel then d.valor_total else 0 end)::numeric valor_combustivel
                       from v join tra.viagem_despesa d on d.viagem_id = v.id join tra.despesa t on t.id = d.despesa_id group by 1)
       select meses.mes, meses.viagens, coalesce(pac.pacientes, 0) pacientes, coalesce(desp.despesas, 0) despesas, meses.km, coalesce(desp.litros, 0) litros,
              case when coalesce(desp.litros, 0) > 0 then round(meses.km / desp.litros, 2) end km_litro,
              case when coalesce(desp.litros, 0) > 0 then round(desp.valor_combustivel / desp.litros, 3) end valor_litro
         from meses left join pac using (mes) left join desp using (mes) order by meses.mes`,
      params({ ...f, concluidas: true }),
    );
    let anterior: number | null = null;
    for (const l of linhas) {
      l.evolucao = anterior ? Math.round(((l.pacientes - anterior) / anterior) * 10000) / 100 : null;
      anterior = l.pacientes;
      l.mes_rotulo = `${l.mes.slice(5, 7)}/${l.mes.slice(0, 4)}`;
    }
    return {
      linhas,
      grafico: { tipo: 'linha', x: 'mes_rotulo', y: 'pacientes', titulo: 'Pacientes transportados' },
      colunas: [
        col('mes_rotulo', 'Mês'),
        col('viagens', 'Viagens', 'inteiro', true),
        col('pacientes', 'Pacientes transportados', 'inteiro', true),
        col('evolucao', 'Evolução s/ mês anterior (%)', 'percentual'),
        col('despesas', 'Despesas (R$)', 'moeda', true),
        col('km', 'Km rodados', 'inteiro', true),
        col('litros', 'Combustível (L)', 'decimal', true),
        col('km_litro', 'Média km/litro', 'decimal'),
        col('valor_litro', 'Média R$/litro', 'moeda'),
      ],
    };
  },
});

// Absenteísmo por paciente (TR 1.2.40.29.2).
registrarRelatorio({
  ...base,
  id: 'tra-absenteismo',
  grupo: 'Pacientes',
  titulo: 'Absenteísmo por paciente',
  tr: ['1.2.40.29.2'],
  filtros: [...PERIODO, ROTA, MOTIVO, MUNICIPIO],
  async gerar(f) {
    const linhas = await consultar(
      `select p.nome paciente, coalesce(mp.nome, m.nome) destino, v.data_saida::text data, to_char(coalesce(vp.hora_saida, v.hora_saida), 'HH24:MI') horario, coalesce(r.nome, 'Viagem extra') rota,
              coalesce(vp.local_destino, ld.nome) local_destino, coalesce(mvp.nome, mv.nome) motivo, vp.observacao_ausencia observacao
         from tra.viagem v ${JOINS} join tra.viagem_passageiro vp on vp.viagem_id = v.id join cad.pessoa p on p.id = vp.paciente_id
         left join cad.municipio mp on mp.id = vp.municipio_destino_id left join tra.motivo_viagem mvp on mvp.id = vp.motivo_id
        where vp.situacao = 'FALTA' and ${FILTRO_VIAGEM} order by p.nome, v.data_saida`,
      params({ ...f, concluidas: false }),
    );
    return {
      linhas,
      agrupar: ['paciente'],
      orientacao: 'landscape',
      colunas: [col('paciente', 'Paciente'), col('destino', 'Destino'), col('data', 'Data', 'data'), col('horario', 'Horário'), col('rota', 'Rota'), col('local_destino', 'Local de destino'), col('motivo', 'Motivo'), col('observacao', 'Observação sobre a ausência')],
    };
  },
});

// Despesas de viagem por rota, veículo, motorista e viagem com indicadores de custo (TR 1.2.40.29.3).
registrarRelatorio({
  ...base,
  id: 'tra-despesas',
  grupo: 'Despesas',
  titulo: 'Despesas de viagem',
  tr: ['1.2.40.29.3'],
  filtros: [...PERIODO, ROTA, VEICULO, CONDUTOR],
  async gerar(f) {
    const p = params({ ...f, concluidas: false });
    const linhas = await consultar(
      `select coalesce(r.nome, 'Viagem extra') rota, ${VEICULO_SQL} veiculo, coalesce(co.nome, '-') motorista, 'Viagem nº ' || v.id || ' de ' || to_char(v.data_saida, 'DD/MM/YYYY') viagem,
              t.nome || coalesce(' - ' || d.descricao, '') descricao, g.nome grupo, d.data::text data, d.quantidade, d.valor_unitario, d.valor_total
         from tra.viagem v ${JOINS} join tra.viagem_despesa d on d.viagem_id = v.id join tra.despesa t on t.id = d.despesa_id join tra.grupo_despesa g on g.id = t.grupo_id
        where ${FILTRO_VIAGEM} order by 1, 2, 3, v.data_saida, v.id, d.data`,
      p,
    );
    const ind = (
      await consultar(
        `with v as (select v.* from tra.viagem v where ${FILTRO_VIAGEM})
         select coalesce((select sum(d.valor_total) from v join tra.viagem_despesa d on d.viagem_id = v.id), 0)::numeric total,
                coalesce((select sum(d.quantidade) from v join tra.viagem_despesa d on d.viagem_id = v.id join tra.despesa t on t.id = d.despesa_id where t.combustivel), 0)::numeric litros,
                coalesce((select sum(d.valor_total) from v join tra.viagem_despesa d on d.viagem_id = v.id join tra.despesa t on t.id = d.despesa_id where t.combustivel), 0)::numeric valor_combustivel,
                coalesce((select sum(greatest(coalesce(km_final - km_inicial, 0), 0)) from v), 0)::numeric km,
                coalesce((select count(*) from v join tra.viagem_passageiro vp on vp.viagem_id = v.id where vp.situacao = 'PRESENTE'), 0)::int passageiros`,
        p,
      )
    )[0];
    const div = (a: number, b: number, casas = 2) => (b > 0 ? (a / b).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : '-');
    return {
      linhas,
      agrupar: ['rota', 'veiculo', 'motorista', 'viagem'],
      orientacao: 'landscape',
      grafico: { tipo: 'barra', x: 'grupo', y: 'valor_total', titulo: 'Despesas por grupo' },
      filtrosTexto: [
        periodoTexto(f),
        `Total de despesas: R$ ${div(ind.total, 1)}`,
        `Custo médio por passageiro: R$ ${div(ind.total, ind.passageiros)}`,
        `Custo médio por km: R$ ${div(ind.total, ind.km)}`,
        `Consumo médio de combustível: ${div(ind.litros, ind.km, 3)} L/km`,
        `Custo médio por litro: R$ ${div(ind.valor_combustivel, ind.litros, 3)}`,
      ],
      colunas: [
        col('rota', 'Rota'),
        col('veiculo', 'Veículo'),
        col('motorista', 'Motorista'),
        col('viagem', 'Viagem'),
        col('descricao', 'Descrição'),
        col('data', 'Data', 'data'),
        col('quantidade', 'Quantidade', 'decimal'),
        col('valor_unitario', 'Valor unitário', 'moeda'),
        col('valor_total', 'Valor total', 'moeda', true),
      ],
    };
  },
});

// Indicadores de custo por viagem (complemento do TR 1.2.40.29.3 e custo por paciente, TR 1.2.40.9).
registrarRelatorio({
  ...base,
  id: 'tra-custos-viagem',
  grupo: 'Despesas',
  titulo: 'Custos por viagem e por paciente',
  tr: ['1.2.40.9', '1.2.40.29.3'],
  filtros: [...PERIODO, ROTA, VEICULO, CONDUTOR],
  async gerar(f) {
    const linhas = await consultar(
      `select v.id, v.data_saida::text data, coalesce(r.nome, 'Viagem extra') rota, ${VEICULO_SQL} veiculo, coalesce(co.nome, '-') motorista, v.valor_viagem,
              (select count(*) from tra.viagem_passageiro vp where vp.viagem_id = v.id and vp.situacao = 'PRESENTE')::int passageiros,
              greatest(coalesce(v.km_final - v.km_inicial, 0), 0) km,
              coalesce((select sum(d.valor_total) from tra.viagem_despesa d where d.viagem_id = v.id), 0)::numeric despesas,
              coalesce((select sum(d.quantidade) from tra.viagem_despesa d join tra.despesa t on t.id = d.despesa_id where d.viagem_id = v.id and t.combustivel), 0)::numeric litros,
              v.custo_paciente
         from tra.viagem v ${JOINS} where ${FILTRO_VIAGEM} order by v.data_saida, v.id`,
      params({ ...f, concluidas: true }),
    );
    for (const l of linhas) {
      l.custo_km = l.km > 0 ? Math.round((l.despesas / l.km) * 100) / 100 : null;
      l.litros_km = l.km > 0 && l.litros > 0 ? Math.round((l.litros / l.km) * 1000) / 1000 : null;
    }
    return {
      linhas,
      orientacao: 'landscape',
      colunas: [
        col('data', 'Data', 'data'),
        col('rota', 'Rota'),
        col('veiculo', 'Veículo'),
        col('motorista', 'Motorista'),
        col('passageiros', 'Pacientes', 'inteiro', true),
        col('km', 'Km', 'inteiro', true),
        col('valor_viagem', 'Valor da viagem', 'moeda', true),
        col('despesas', 'Despesas', 'moeda', true),
        col('custo_paciente', 'Custo por paciente', 'moeda'),
        col('custo_km', 'Despesa por km', 'moeda'),
        col('litros_km', 'Litros por km', 'decimal'),
      ],
    };
  },
});

// Viagens por motivo, local de destino e veículo (TR 1.2.40.29.4).
registrarRelatorio({
  ...base,
  id: 'tra-viagens-motivo',
  grupo: 'Viagens',
  titulo: 'Viagens por motivo',
  tr: ['1.2.40.29.4'],
  filtros: [...PERIODO, MOTIVO, VEICULO, SO_CONCLUIDAS],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(mv.nome, 'Não informado') motivo, coalesce(ld.nome, m.nome, '-') local_destino, ${VEICULO_SQL} veiculo, v.data_saida::text data, coalesce(r.nome, 'Viagem extra') rota,
              (select count(*) from tra.viagem_passageiro vp where vp.viagem_id = v.id and vp.situacao not in ('CANCELADO','FALTA'))::int passageiros,
              greatest(coalesce(v.km_final - v.km_inicial, 0), 0) km
         from tra.viagem v ${JOINS} where ${FILTRO_VIAGEM} order by 1, 2, 3, v.data_saida`,
      params(f),
    );
    return {
      linhas,
      agrupar: ['motivo', 'local_destino', 'veiculo'],
      colunas: [col('motivo', 'Motivo'), col('local_destino', 'Local de destino'), col('veiculo', 'Veículo'), col('data', 'Data', 'data'), col('rota', 'Rota'), col('passageiros', 'Passageiros', 'inteiro', true), col('km', 'Km rodados', 'inteiro', true)],
    };
  },
});

// Viagens por paciente, destino, motorista e veículo (TR 1.2.40.29.5).
registrarRelatorio({
  ...base,
  id: 'tra-viagens-paciente',
  grupo: 'Pacientes',
  titulo: 'Viagens por paciente',
  tr: ['1.2.40.29.5'],
  filtros: [...PERIODO, { nome: 'pacienteId', rotulo: 'Paciente', tipo: 'ref', ref: 'paciente' }, MUNICIPIO, SO_CONCLUIDAS],
  async gerar(f) {
    const linhas = await consultar(
      `select p.nome paciente, coalesce(mp.nome, m.nome, '-') destino, coalesce(co.nome, '-') motorista, ${VEICULO_SQL} veiculo, v.data_saida::text data, coalesce(r.nome, 'Viagem extra') rota,
              coalesce(vp.local_destino, ld.nome) local_destino, coalesce(mvp.nome, mv.nome) motivo, vp.situacao
         from tra.viagem v ${JOINS} join tra.viagem_passageiro vp on vp.viagem_id = v.id join cad.pessoa p on p.id = vp.paciente_id
         left join cad.municipio mp on mp.id = vp.municipio_destino_id left join tra.motivo_viagem mvp on mvp.id = vp.motivo_id
        where vp.situacao <> 'CANCELADO' and ($9::bigint is null or vp.paciente_id = $9) and ${FILTRO_VIAGEM} order by 1, 2, 3, 4, v.data_saida`,
      [...params(f), nul(f.pacienteId)],
    );
    return {
      linhas,
      agrupar: ['paciente', 'destino', 'motorista', 'veiculo'],
      orientacao: 'landscape',
      colunas: [col('paciente', 'Paciente'), col('destino', 'Destino'), col('motorista', 'Motorista'), col('veiculo', 'Veículo'), col('data', 'Data', 'data'), col('rota', 'Rota'), col('local_destino', 'Local de destino'), col('motivo', 'Motivo'), col('situacao', 'Situação')],
    };
  },
});

// Gráficos de viagens por município e por motivo (TR 1.2.40.29.6, 1.2.40.29.7).
for (const [id, titulo, campo, expr, tr] of [
  ['tra-grafico-municipio', 'Gráfico de viagens por município', 'municipio', `coalesce(m.nome, 'Não informado')`, '1.2.40.29.6'],
  ['tra-grafico-motivo', 'Gráfico de viagens por motivo', 'motivo', `coalesce(mv.nome, 'Não informado')`, '1.2.40.29.7'],
] as const) {
  registrarRelatorio({
    ...base,
    id,
    grupo: 'Gráficos',
    titulo,
    tr: [tr],
    filtros: [...PERIODO, ROTA, VEICULO, SO_CONCLUIDAS],
    async gerar(f) {
      const linhas = await consultar(
        `select ${expr} ${campo}, count(*)::int viagens,
                sum((select count(*) from tra.viagem_passageiro vp where vp.viagem_id = v.id and vp.situacao not in ('CANCELADO','FALTA')))::int pacientes
           from tra.viagem v ${JOINS} where ${FILTRO_VIAGEM} group by 1 order by 2 desc`,
        params(f),
      );
      return {
        linhas,
        grafico: { tipo: 'barra', x: campo, y: 'viagens', titulo: 'Viagens' },
        colunas: [col(campo, campo === 'municipio' ? 'Município de destino' : 'Motivo'), col('viagens', 'Viagens', 'inteiro', true), col('pacientes', 'Pacientes', 'inteiro', true)],
      };
    },
  });
}

// Consolidado de viagens efetuadas e pacientes transportados por mês e município de destino (TR 1.2.40.29.8).
registrarRelatorio({
  ...base,
  id: 'tra-consolidado-mes-municipio',
  grupo: 'Gerenciais',
  titulo: 'Consolidado de viagens e pacientes por mês e município',
  tr: ['1.2.40.29.8'],
  filtros: [...PERIODO, MUNICIPIO],
  async gerar(f) {
    const linhas = await consultar(
      `select to_char(v.data_saida, 'MM/YYYY') mes, to_char(v.data_saida, 'YYYY-MM') ordem, coalesce(m.nome, 'Não informado') municipio, count(*)::int viagens,
              sum((select count(*) from tra.viagem_passageiro vp where vp.viagem_id = v.id and vp.situacao = 'PRESENTE'))::int pacientes
         from tra.viagem v ${JOINS} where ${FILTRO_VIAGEM} group by 1, 2, 3 order by 2, 3`,
      params({ ...f, concluidas: true }),
    );
    return {
      linhas,
      agrupar: ['mes'],
      grafico: { tipo: 'barra', x: 'mes', y: 'pacientes', serie: 'municipio', titulo: 'Pacientes transportados' },
      colunas: [col('mes', 'Mês'), col('municipio', 'Município de destino'), col('viagens', 'Viagens efetuadas', 'inteiro', true), col('pacientes', 'Pacientes transportados', 'inteiro', true)],
    };
  },
});

// Viagens por data: motorista, veículo, rota, município e horário (TR 1.2.40.29.9).
registrarRelatorio({
  ...base,
  id: 'tra-viagens-data',
  grupo: 'Viagens',
  titulo: 'Viagens por data',
  tr: ['1.2.40.29.9'],
  filtros: [...PERIODO, CONDUTOR, VEICULO, ROTA, SO_CONCLUIDAS],
  async gerar(f) {
    const linhas = await consultar(
      `select v.data_saida::text data, coalesce(co.nome, '-') motorista, ${VEICULO_SQL} veiculo, coalesce(r.nome, 'Viagem extra') rota, coalesce(m.nome, '-') municipio,
              to_char(v.hora_saida, 'HH24:MI') horario, v.situacao
         from tra.viagem v ${JOINS} where ${FILTRO_VIAGEM} order by v.data_saida, v.hora_saida`,
      params(f),
    );
    return {
      linhas,
      agrupar: ['data'],
      colunas: [col('data', 'Data', 'data'), col('motorista', 'Motorista'), col('veiculo', 'Veículo'), col('rota', 'Rota'), col('municipio', 'Município'), col('horario', 'Horário'), col('situacao', 'Situação')],
    };
  },
});
