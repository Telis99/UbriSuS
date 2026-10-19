// Prévias e boletins impressos do faturamento e acompanhamento dos gastos do paciente (TR 1.2.13.1.27, 1.2.13.1.28, 1.2.13.1.40 a 1.2.13.1.42).
import { consultar } from '../../db/pool.js';
import { registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';

const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);
const COMPETENCIA: FiltroRelatorio = { nome: 'competencia', rotulo: 'Competência (AAAAMM)', tipo: 'texto', obrigatorio: true, padrao: new Date().toISOString().slice(0, 7).replace('-', '') };
const UNIDADE: FiltroRelatorio = { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' };
const PROFISSIONAL: FiltroRelatorio = { nome: 'profissionalId', rotulo: 'Profissional', tipo: 'ref', ref: 'profissional' };
const SITUACAO: FiltroRelatorio = { nome: 'situacao', rotulo: 'Situação', tipo: 'opcao', opcoes: [['VALIDO', 'Válido'], ['CRITICA', 'Com crítica'], ['EXPORTADO', 'Exportado']] };
const base = { modulo: 'FAT', permissao: 'producao:exportar' };
const juncoes = `from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id join cad.unidade u on u.id = p.unidade_id
  left join cad.profissional pf on pf.id = p.profissional_id left join cad.pessoa pa on pa.id = p.paciente_id`;
const filtro = `p.competencia = $1 and ($2::bigint is null or p.unidade_id = $2) and ($3::bigint is null or p.profissional_id = $3) and ($4::text is null or p.situacao = $4)`;
const params = (f: Record<string, any>) => [f.competencia, nul(f.unidadeId), nul(f.profissionalId), nul(f.situacao)];

registrarRelatorio({
  ...base,
  id: 'fat-previa-unidade',
  grupo: 'Prévias',
  titulo: 'Prévia do faturamento por unidade e procedimento',
  tr: ['1.2.13.1.28', '1.2.13.1.42'],
  filtros: [COMPETENCIA, UNIDADE, SITUACAO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.cnes || ' - ' || u.nome unidade, p.instrumento, pr.codigo || ' - ' || pr.nome procedimento, sum(p.quantidade)::int quantidade, coalesce(sum(p.valor), 0) valor,
              count(*) filter (where p.situacao = 'CRITICA')::int criticas
         ${juncoes} where ${filtro} group by 1,2,3 order by 1,2,3`,
      [f.competencia, nul(f.unidadeId), null, nul(f.situacao)],
    );
    return { linhas, agrupar: ['unidade', 'instrumento'], colunas: [col('unidade', 'Unidade'), col('instrumento', 'Instrumento'), col('procedimento', 'Procedimento'), col('quantidade', 'Qtd.', 'inteiro', true), col('valor', 'Valor', 'moeda', true), col('criticas', 'Críticas', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'fat-previa-profissional',
  grupo: 'Prévias',
  titulo: 'Prévia do faturamento por profissional',
  tr: ['1.2.13.1.28'],
  filtros: [COMPETENCIA, UNIDADE, PROFISSIONAL, SITUACAO],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(pf.nome, 'Sem profissional') profissional, coalesce(p.cbo_codigo, '-') cbo, pr.codigo || ' - ' || pr.nome procedimento, sum(p.quantidade)::int quantidade, coalesce(sum(p.valor), 0) valor
         ${juncoes} where ${filtro} group by 1,2,3 order by 1,2,3`,
      params(f),
    );
    return { linhas, agrupar: ['profissional', 'cbo'], colunas: [col('profissional', 'Profissional'), col('cbo', 'CBO'), col('procedimento', 'Procedimento'), col('quantidade', 'Qtd.', 'inteiro', true), col('valor', 'Valor', 'moeda', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'fat-bpa-consolidado',
  grupo: 'Boletins impressos',
  titulo: 'BPA consolidado (impresso)',
  tr: ['1.2.13.1.40'],
  filtros: [COMPETENCIA, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select u.cnes || ' - ' || u.nome unidade, coalesce(p.cbo_codigo, '') cbo, pr.codigo procedimento, pr.nome descricao, coalesce(p.idade, 0) idade, sum(p.quantidade)::int quantidade
         ${juncoes} where ${filtro} and p.instrumento = 'BPA_C' and p.situacao <> 'CRITICA' group by 1,2,3,4,5 order by 1,3,2,5`,
      [f.competencia, nul(f.unidadeId), null, null],
    );
    linhas.forEach((l, i) => ((l.folha = Math.floor(i / 20) + 1), (l.seq = (i % 20) + 1)));
    return { linhas, agrupar: ['unidade'], colunas: [col('unidade', 'Estabelecimento'), col('folha', 'Folha', 'inteiro'), col('seq', 'Seq.', 'inteiro'), col('procedimento', 'Procedimento'), col('descricao', 'Descrição'), col('cbo', 'CBO'), col('idade', 'Idade', 'inteiro'), col('quantidade', 'Qtd.', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'fat-bpa-individualizado',
  grupo: 'Boletins impressos',
  titulo: 'BPA individualizado (impresso)',
  tr: ['1.2.13.1.41'],
  filtros: [COMPETENCIA, UNIDADE, PROFISSIONAL],
  async gerar(f) {
    const linhas = await consultar(
      `select u.cnes || ' - ' || u.nome unidade, coalesce(pf.nome, '-') || ' (CBO ' || coalesce(p.cbo_codigo, '-') || ')' profissional, p.data::text data, pa.cns, pa.nome paciente, pa.sexo,
              p.idade, pr.codigo procedimento, p.cid_codigo cid, p.carater, p.quantidade
         ${juncoes} where ${filtro} and p.instrumento = 'BPA_I' and p.situacao <> 'CRITICA' order by 1, 2, p.data`,
      [f.competencia, nul(f.unidadeId), nul(f.profissionalId), null],
    );
    return {
      linhas,
      agrupar: ['unidade', 'profissional'],
      orientacao: 'landscape',
      colunas: [col('unidade', 'Estabelecimento'), col('profissional', 'Profissional'), col('data', 'Data', 'data'), col('cns', 'CNS'), col('paciente', 'Paciente'), col('sexo', 'Sexo'), col('idade', 'Idade', 'inteiro'), col('procedimento', 'Procedimento'), col('cid', 'CID'), col('carater', 'Caráter'), col('quantidade', 'Qtd.', 'inteiro', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'fat-criticas',
  grupo: 'Prévias',
  titulo: 'Produção com críticas SIGTAP',
  tr: ['1.2.13.1.35'],
  filtros: [COMPETENCIA, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, p.data::text data, pr.codigo || ' - ' || pr.nome procedimento, coalesce(pf.nome, '-') profissional, p.cbo_codigo cbo, pa.nome paciente, p.critica
         ${juncoes} where ${filtro} and p.situacao = 'CRITICA' order by 1, 2`,
      [f.competencia, nul(f.unidadeId), null, null],
    );
    return { linhas, agrupar: ['unidade'], orientacao: 'landscape', colunas: [col('unidade', 'Unidade'), col('data', 'Data', 'data'), col('procedimento', 'Procedimento'), col('profissional', 'Profissional'), col('cbo', 'CBO'), col('paciente', 'Paciente'), col('critica', 'Crítica')] };
  },
});

registrarRelatorio({
  ...base,
  id: 'fat-gastos-paciente',
  grupo: 'Gastos',
  titulo: 'Acompanhamento dos gastos do paciente',
  tr: ['1.2.13.1.27'],
  filtros: [
    { nome: 'pacienteId', rotulo: 'Paciente', tipo: 'ref', ref: 'paciente', obrigatorio: true },
    { nome: 'de', rotulo: 'De', tipo: 'data', padrao: 'inicio_mes' },
    { nome: 'ate', rotulo: 'Até', tipo: 'data', padrao: 'hoje' },
  ],
  async gerar(f) {
    const linhas = await consultar(
      `select * from (
         select p.data::text data, 'Ambulatorial' tipo, u.nome local, pr.codigo || ' - ' || pr.nome item, p.quantidade, coalesce(p.valor, 0) valor
           from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id join cad.unidade u on u.id = p.unidade_id
          where p.paciente_id = $1 and p.data between coalesce($2::date, '1900-01-01') and coalesce($3::date, '2999-12-31')
         union all
         select d.data_hora::date::text, 'Medicamentos', u.nome, pr.nome || coalesce(' ' || pr.concentracao, ''), di.quantidade, di.quantidade * coalesce(di.custo_unitario, pr.preco_custo, 0)
           from far.dispensacao d join far.dispensacao_item di on di.dispensacao_id = d.id join far.produto pr on pr.id = di.produto_id join cad.unidade u on u.id = d.unidade_id
          where d.paciente_id = $1 and d.situacao = 'EFETIVADA' and d.data_hora::date between coalesce($2::date, '1900-01-01') and coalesce($3::date, '2999-12-31')
         union all
         select v.data::text, 'Imunização', coalesce(u.nome, '-'), i.nome, 1, coalesce(l.custo_unitario / nullif(coalesce(l.doses_frasco, 1), 0), 0)
           from imu.vacinacao v join imu.imunobiologico i on i.id = v.imunobiologico_id left join cad.unidade u on u.id = v.unidade_id left join far.estoque_lote l on l.id = v.lote_id
          where v.paciente_id = $1 and v.tipo = 'APLICACAO' and v.data between coalesce($2::date, '1900-01-01') and coalesce($3::date, '2999-12-31')
       ) x order by data`,
      [f.pacienteId, nul(f.de), nul(f.ate)],
    );
    return { linhas, agrupar: ['tipo'], colunas: [col('tipo', 'Tipo'), col('data', 'Data', 'data'), col('local', 'Local'), col('item', 'Procedimento / item'), col('quantidade', 'Qtd.', 'decimal'), col('valor', 'Valor', 'moeda', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'fat-evolucao-producao',
  grupo: 'Gastos',
  titulo: 'Evolução mensal da produção ambulatorial',
  tr: ['1.2.13.1.28'],
  filtros: [{ nome: 'ano', rotulo: 'Ano', tipo: 'inteiro', obrigatorio: true, padrao: new Date().getFullYear() }, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select substr(p.competencia, 5, 2) mes, p.instrumento, sum(p.quantidade)::int quantidade, coalesce(sum(p.valor), 0) valor
         from fat.producao p where substr(p.competencia, 1, 4) = $1::text and ($2::bigint is null or p.unidade_id = $2) group by 1,2 order by 1,2`,
      [String(f.ano), nul(f.unidadeId)],
    );
    return { linhas, grafico: { tipo: 'barra', x: 'mes', y: 'quantidade', serie: 'instrumento' }, colunas: [col('mes', 'Mês'), col('instrumento', 'Instrumento'), col('quantidade', 'Procedimentos', 'inteiro', true), col('valor', 'Valor', 'moeda', true)] };
  },
});
