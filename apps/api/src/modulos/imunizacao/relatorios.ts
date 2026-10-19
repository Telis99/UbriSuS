// Relatórios de imunização (TR 1.2.39.2.1 a 1.2.39.2.9).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';
import { ESTRATEGIAS } from './entidades.js';

const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);
const UNIDADE: FiltroRelatorio = { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' };
const IMUNO: FiltroRelatorio = { nome: 'imunobiologicoId', rotulo: 'Imunobiológico', tipo: 'ref', ref: 'imunobiologico' };
const ESTRATEGIA: FiltroRelatorio = { nome: 'estrategia', rotulo: 'Estratégia', tipo: 'opcao', opcoes: ESTRATEGIAS };
const ANALITICO: FiltroRelatorio = { nome: 'analitico', rotulo: 'Analítico', tipo: 'booleano', padrao: false };
const base = { modulo: 'IMU', permissao: 'vacinacao:exportar', grupo: 'Aplicações' };
const where = `v.tipo in ('APLICACAO','RESGATE') and v.data between $1 and $2 and ($3::bigint is null or v.unidade_id = $3) and ($4::bigint is null or v.imunobiologico_id = $4) and ($5::text is null or v.estrategia = $5)`;
const params = (f: Record<string, any>) => [f.de, f.ate, nul(f.unidadeId), nul(f.imunobiologicoId), nul(f.estrategia)];
const juncoes = `from imu.vacinacao v join imu.imunobiologico i on i.id = v.imunobiologico_id left join imu.dose d on d.id = v.dose_id
  left join cad.unidade u on u.id = v.unidade_id left join cad.profissional pr on pr.id = v.profissional_id join cad.pessoa p on p.id = v.paciente_id
  left join far.estoque_lote l on l.id = v.lote_id`;
const analitico = (f: Record<string, any>) => f.analitico === true || f.analitico === 'true';

registrarRelatorio({
  ...base,
  id: 'imu-unidade-profissional',
  titulo: 'Aplicações e resgates por unidade, profissional e imunobiológico',
  tr: ['1.2.39.2.5'],
  filtros: [...PERIODO, UNIDADE, IMUNO, ESTRATEGIA, ANALITICO],
  async gerar(f) {
    if (analitico(f)) {
      const linhas = await consultar(
        `select coalesce(u.nome, 'Resgates externos') unidade, coalesce(pr.nome, v.profissional_texto, '-') profissional, i.nome imunobiologico, v.data::text data, p.nome paciente, d.sigla dose, v.tipo,
                coalesce(l.lote, v.lote_texto) lote, case when v.inadvertida then 'Sim' else '' end inadvertida ${juncoes} where ${where} order by 1,2,3,4`,
        params(f),
      );
      return { linhas, agrupar: ['unidade', 'profissional', 'imunobiologico'], orientacao: 'landscape', colunas: [col('unidade', 'Unidade'), col('profissional', 'Profissional'), col('imunobiologico', 'Imunobiológico'), col('data', 'Data', 'data'), col('paciente', 'Paciente'), col('dose', 'Dose'), col('tipo', 'Registro'), col('lote', 'Lote'), col('inadvertida', 'Inadvertida')] };
    }
    const linhas = await consultar(
      `select coalesce(u.nome, 'Resgates externos') unidade, coalesce(pr.nome, v.profissional_texto, '-') profissional, i.nome imunobiologico,
              count(*) filter (where v.tipo = 'APLICACAO')::int aplicacoes, count(*) filter (where v.tipo = 'RESGATE')::int resgates ${juncoes} where ${where} group by 1,2,3 order by 1,2,3`,
      params(f),
    );
    return { linhas, agrupar: ['unidade', 'profissional'], colunas: [col('unidade', 'Unidade'), col('profissional', 'Profissional'), col('imunobiologico', 'Imunobiológico'), col('aplicacoes', 'Aplicações', 'inteiro', true), col('resgates', 'Resgates', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'imu-unidade-dose',
  titulo: 'Aplicações e resgates por unidade, imunobiológico e dose',
  tr: ['1.2.39.2.6'],
  filtros: [...PERIODO, UNIDADE, IMUNO, ESTRATEGIA, ANALITICO],
  async gerar(f) {
    if (analitico(f)) {
      const linhas = await consultar(
        `select coalesce(u.nome, 'Resgates externos') unidade, i.nome imunobiologico, coalesce(d.nome, '-') dose, v.data::text data, p.nome paciente, p.data_nascimento::text nascimento, v.tipo, coalesce(l.lote, v.lote_texto) lote
           ${juncoes} where ${where} order by 1,2,3,4`,
        params(f),
      );
      return { linhas, agrupar: ['unidade', 'imunobiologico', 'dose'], colunas: [col('unidade', 'Unidade'), col('imunobiologico', 'Imunobiológico'), col('dose', 'Dose'), col('data', 'Data', 'data'), col('paciente', 'Paciente'), col('nascimento', 'Nascimento', 'data'), col('tipo', 'Registro'), col('lote', 'Lote')] };
    }
    const linhas = await consultar(
      `select coalesce(u.nome, 'Resgates externos') unidade, i.nome imunobiologico, coalesce(d.nome, '-') dose,
              count(*) filter (where v.tipo = 'APLICACAO')::int aplicacoes, count(*) filter (where v.tipo = 'RESGATE')::int resgates ${juncoes} where ${where} group by 1,2,3 order by 1,2,3`,
      params(f),
    );
    return { linhas, agrupar: ['unidade', 'imunobiologico'], colunas: [col('unidade', 'Unidade'), col('imunobiologico', 'Imunobiológico'), col('dose', 'Dose'), col('aplicacoes', 'Aplicações', 'inteiro', true), col('resgates', 'Resgates', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'imu-idade',
  titulo: 'Aplicações por idade',
  tr: ['1.2.39.2.9'],
  filtros: [...PERIODO, UNIDADE, IMUNO, ESTRATEGIA],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(u.nome, '-') unidade, i.nome imunobiologico, coalesce(d.sigla, '-') dose,
              case when age(v.data, p.data_nascimento) < interval '1 year' then '< 1 ano' else extract(year from age(v.data, p.data_nascimento))::int || ' ano(s)' end idade,
              extract(year from age(v.data, p.data_nascimento))::int ordem, count(*)::int aplicacoes
         ${juncoes} where ${where} and v.tipo = 'APLICACAO' group by 1,2,3,4,5 order by 1,2,3,5`,
      params(f),
    );
    return { linhas, agrupar: ['unidade', 'imunobiologico', 'dose'], colunas: [col('unidade', 'Unidade'), col('imunobiologico', 'Imunobiológico'), col('dose', 'Dose'), col('idade', 'Idade'), col('aplicacoes', 'Aplicações', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'imu-consolidado-mensal',
  titulo: 'Consolidado de doses aplicadas e resgatadas por mês',
  tr: ['1.2.39.2.4'],
  filtros: [{ nome: 'ano', rotulo: 'Ano', tipo: 'inteiro', obrigatorio: true, padrao: new Date().getFullYear() }, UNIDADE, IMUNO, ESTRATEGIA],
  async gerar(f) {
    const linhas = await consultar(
      `select i.nome imunobiologico, coalesce(d.sigla, '-') dose,
              ${Array.from({ length: 12 }, (_, m) => `count(*) filter (where extract(month from v.data) = ${m + 1})::int m${m + 1}`).join(', ')}, count(*)::int total
         ${juncoes} where v.tipo in ('APLICACAO','RESGATE') and extract(year from v.data) = $1 and ($2::bigint is null or v.unidade_id = $2) and ($3::bigint is null or v.imunobiologico_id = $3) and ($4::text is null or v.estrategia = $4)
        group by 1,2 order by 1,2`,
      [Number(f.ano), nul(f.unidadeId), nul(f.imunobiologicoId), nul(f.estrategia)],
    );
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return { linhas, orientacao: 'landscape', colunas: [col('imunobiologico', 'Imunobiológico'), col('dose', 'Dose'), ...meses.map((m, i) => col(`m${i + 1}`, m, 'inteiro', true)), col('total', 'Total', 'inteiro', true)] };
  },
});

const camp = { modulo: 'IMU', permissao: 'campanha_vacinacao:exportar', grupo: 'Campanhas' };
const CAMPANHA: FiltroRelatorio = { nome: 'campanhaId', rotulo: 'Campanha', tipo: 'ref', ref: 'campanha_vacinacao', obrigatorio: true };

registrarRelatorio({
  ...camp,
  id: 'imu-campanha-faixas',
  titulo: 'Campanha: aplicações por grupo e faixa etária',
  tr: ['1.2.39.2.1'],
  filtros: [CAMPANHA, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select g.nome grupo, i.sigla imunobiologico, coalesce(u.nome, '-') unidade, count(v.id)::int aplicacoes
         from imu.campanha_grupo g join imu.imunobiologico i on i.id = g.imunobiologico_id
         left join imu.vacinacao v on v.grupo_id = g.id and v.tipo = 'APLICACAO' and ($2::bigint is null or v.unidade_id = $2)
         left join cad.unidade u on u.id = v.unidade_id where g.campanha_id = $1 group by 1,2,3 order by 1,3`,
      [f.campanhaId, nul(f.unidadeId)],
    );
    return { linhas, agrupar: ['grupo'], colunas: [col('grupo', 'Grupo / faixa etária'), col('imunobiologico', 'Imunobiológico'), col('unidade', 'Unidade'), col('aplicacoes', 'Aplicações', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...camp,
  id: 'imu-campanha-metas',
  titulo: 'Campanha: acompanhamento das metas (gráfico)',
  tr: ['1.2.39.2.2', '1.2.39.1.55'],
  filtros: [CAMPANHA],
  async gerar(f) {
    const linhas = await consultar(
      `select g.nome grupo, coalesce(g.populacao_alvo, 0) populacao, round(coalesce(g.populacao_alvo, 0) * coalesce(g.meta_percentual, 100) / 100.0) meta,
              (select count(*)::int from imu.vacinacao v where v.grupo_id = g.id and v.tipo = 'APLICACAO') aplicadas
         from imu.campanha_grupo g where g.campanha_id = $1 order by 1`,
      [f.campanhaId],
    );
    for (const l of linhas) l.percentual = Number(l.meta) ? Math.round((l.aplicadas / Number(l.meta)) * 1000) / 10 : 0;
    const grafico = linhas.flatMap((l) => [
      { grupo: l.grupo, serie: 'Meta', valor: Number(l.meta) },
      { grupo: l.grupo, serie: 'Aplicadas', valor: l.aplicadas },
    ]);
    return {
      linhas,
      grafico: { tipo: 'barra', x: 'grupo', y: 'valor', serie: 'serie', dados: grafico },
      colunas: [col('grupo', 'Grupo'), col('populacao', 'População alvo', 'inteiro', true), col('meta', 'Meta (doses)', 'inteiro', true), col('aplicadas', 'Aplicadas', 'inteiro', true), col('percentual', '% da meta', 'percentual')],
    };
  },
});

registrarRelatorio({
  modulo: 'IMU',
  permissao: 'vacinacao:exportar',
  grupo: 'Estoque',
  id: 'imu-movimentacao-sipni',
  titulo: 'Movimentação de imunobiológicos (padrão SI-PNI)',
  tr: ['1.2.39.2.3'],
  filtros: [...PERIODO, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(i.codigo_sipni, '-') || ' - ' || i.nome produto, coalesce(ap.nome, '-') apresentacao, coalesce(fb.codigo_sipni || ' - ', '') || coalesce(fb.nome, '-') produtor,
              coalesce(sum(m.quantidade) filter (where m.tipo in ('ENTRADA','TRANSFERENCIA_ENTRADA')), 0) recebidas,
              coalesce(-sum(m.quantidade) filter (where m.tipo in ('VACINACAO','ESTORNO_VACINACAO')), 0) utilizadas,
              coalesce(-sum(m.quantidade) filter (where m.tipo = 'INUTILIZACAO'), 0) perdas,
              coalesce(-sum(m.quantidade) filter (where m.tipo = 'TRANSFERENCIA_SAIDA'), 0) remanejadas
         from far.movimento_estoque m join imu.imunobiologico i on i.produto_id = m.produto_id join far.produto p on p.id = m.produto_id
         left join far.apresentacao ap on ap.id = p.apresentacao_id join far.estoque_lote l on l.id = m.lote_id left join far.fabricante fb on fb.id = l.fabricante_id
        where m.data_hora::date between $1 and $2 and ($3::bigint is null or m.unidade_id = $3) group by 1,2,3 order by 1`,
      [f.de, f.ate, nul(f.unidadeId)],
    );
    return { linhas, agrupar: ['produto'], colunas: [col('produto', 'Imunobiológico (código SI-PNI)'), col('apresentacao', 'Apresentação'), col('produtor', 'Produtor'), col('recebidas', 'Recebidas', 'decimal', true), col('utilizadas', 'Utilizadas', 'decimal', true), col('perdas', 'Perdas', 'decimal', true), col('remanejadas', 'Remanejadas', 'decimal', true)] };
  },
});
