// Relatórios da farmácia e do almoxarifado (TR 1.2.21, 1.2.23, 1.2.24.9, 1.2.26, 1.2.27.45 a 1.2.27.52).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';

const UNIDADE: FiltroRelatorio = { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' };
const PRODUTO: FiltroRelatorio = { nome: 'produtoId', rotulo: 'Produto', tipo: 'ref', ref: 'produto' };
const GRUPO: FiltroRelatorio = { nome: 'grupoId', rotulo: 'Grupo', tipo: 'ref', ref: 'grupo_produto' };
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);
const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const PRODUTO_SQL = `pr.nome || coalesce(' ' || pr.concentracao, '')`;
const FILTRO_PADRAO = `($3::bigint is null or X.unidade_id = $3) and ($4::bigint is null or pr.id = $4) and ($5::bigint is null or pr.grupo_id = $5)`;
const params = (f: Record<string, any>) => [f.de, f.ate, nul(f.unidadeId), nul(f.produtoId), nul(f.grupoId)];
const filtroDe = (alias: string) => FILTRO_PADRAO.replace(/X\./g, `${alias}.`);

const M = 'FAR';
const base = { modulo: M, permissao: 'dispensacao:exportar' };

// --------------------------------------------------------------------------- Consumo (dispensações)
const consumo = `from far.dispensacao d join far.dispensacao_item di on di.dispensacao_id = d.id join far.produto pr on pr.id = di.produto_id
  join cad.unidade u on u.id = d.unidade_id left join far.grupo_produto g on g.id = pr.grupo_id left join far.subgrupo_produto sg on sg.id = pr.subgrupo_id
  join cad.pessoa p on p.id = d.paciente_id left join seg.operador o on o.id = d.operador_id
 where d.situacao = 'EFETIVADA' and d.data_hora::date between $1 and $2 and ${filtroDe('d')}`;

registrarRelatorio({
  ...base,
  id: 'far-consumo-produto',
  grupo: 'Consumo',
  titulo: 'Consumo por produto (sintético)',
  tr: ['1.2.26.2'],
  filtros: [...PERIODO, UNIDADE, GRUPO, PRODUTO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, coalesce(sg.nome, '-') subgrupo, ${PRODUTO_SQL} produto, sum(di.quantidade) quantidade ${consumo} group by 1,2,3,4 order by 1,2,3,4`,
      params(f),
    );
    return { linhas, agrupar: ['unidade', 'grupo', 'subgrupo'], colunas: [col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('subgrupo', 'Subgrupo'), col('produto', 'Produto'), col('quantidade', 'Quantidade', 'decimal', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-consumo-unidade',
  grupo: 'Consumo',
  titulo: 'Consumo por unidade (analítico/sintético)',
  tr: ['1.2.26.3', '1.2.26.4'],
  filtros: [...PERIODO, UNIDADE, GRUPO, PRODUTO, { nome: 'analitico', rotulo: 'Analítico (por paciente)', tipo: 'booleano' }],
  async gerar(f) {
    const analitico = f.analitico === true || f.analitico === 'true';
    const linhas = await consultar(
      `select u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, coalesce(sg.nome, '-') subgrupo, ${analitico ? 'p.nome paciente,' : ''} ${PRODUTO_SQL} produto,
              avg(coalesce(di.custo_unitario, pr.preco_custo, 0)) custo, sum(di.quantidade) quantidade, sum(di.quantidade * coalesce(di.custo_unitario, pr.preco_custo, 0)) valor
         ${consumo} group by 1,2,3,4${analitico ? ',5' : ''} order by 1,2,3,4`,
      params(f),
    );
    return {
      linhas,
      agrupar: ['unidade', 'grupo', 'subgrupo'],
      colunas: [col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('subgrupo', 'Subgrupo'), ...(analitico ? [col('paciente', 'Paciente')] : []), col('produto', 'Produto'), col('custo', 'Custo', 'moeda'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor total', 'moeda', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-consumo-paciente',
  grupo: 'Consumo',
  titulo: 'Consumo de produtos por paciente',
  tr: ['1.2.26.5', '1.2.26.6'],
  filtros: [...PERIODO, UNIDADE, PRODUTO, { nome: 'pacienteId', rotulo: 'Paciente', tipo: 'ref', ref: 'paciente' }, { nome: 'analitico', rotulo: 'Analítico', tipo: 'booleano', padrao: true }],
  async gerar(f) {
    const analitico = f.analitico !== false && f.analitico !== 'false';
    const extra = f.pacienteId ? ` and p.id = ${Number(f.pacienteId)}` : '';
    const linhas = analitico
      ? await consultar(
          `select u.nome unidade, p.nome paciente, d.data_hora::date::text data, ${PRODUTO_SQL} produto, coalesce(di.custo_unitario, pr.preco_custo, 0) custo, di.quantidade,
                  di.quantidade * coalesce(di.custo_unitario, pr.preco_custo, 0) valor ${consumo}${extra} order by 1, 2, 3`,
          params(f),
        )
      : await consultar(`select u.nome unidade, p.nome paciente, sum(di.quantidade) quantidade, sum(di.quantidade * coalesce(di.custo_unitario, pr.preco_custo, 0)) valor ${consumo}${extra} group by 1,2 order by 1,2`, params(f));
    return {
      linhas,
      agrupar: analitico ? ['unidade', 'paciente'] : ['unidade'],
      colunas: analitico
        ? [col('unidade', 'Unidade'), col('paciente', 'Paciente'), col('data', 'Data', 'data'), col('produto', 'Produto'), col('custo', 'Custo', 'moeda'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor', 'moeda', true)]
        : [col('unidade', 'Unidade'), col('paciente', 'Paciente'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor', 'moeda', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-prescricoes-profissional',
  grupo: 'Consumo',
  titulo: 'Prescrições de produtos por profissional',
  tr: ['1.2.26.7'],
  filtros: [...PERIODO, UNIDADE, PRODUTO, GRUPO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, coalesce(d.prescritor, 'Não informado') profissional, d.data_hora::date::text data, ${PRODUTO_SQL} produto, di.quantidade,
              coalesce(di.custo_unitario, pr.preco_custo, 0) custo, di.quantidade * coalesce(di.custo_unitario, pr.preco_custo, 0) valor ${consumo} order by 1, 2, 3`,
      params(f),
    );
    return { linhas, agrupar: ['unidade', 'profissional'], colunas: [col('unidade', 'Unidade'), col('profissional', 'Profissional'), col('data', 'Data', 'data'), col('produto', 'Produto'), col('quantidade', 'Qtd.', 'decimal', true), col('custo', 'Custo', 'moeda'), col('valor', 'Valor', 'moeda', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-consumo-dia',
  grupo: 'Consumo',
  titulo: 'Consumo de produtos por dia',
  tr: ['1.2.26.8'],
  filtros: [...PERIODO, UNIDADE, PRODUTO, GRUPO],
  async gerar(f) {
    const linhas = await consultar(
      `select d.data_hora::date::text dia, ${PRODUTO_SQL} produto, u.nome unidade, avg(coalesce(di.custo_unitario, pr.preco_custo, 0)) custo, sum(di.quantidade) quantidade,
              sum(di.quantidade * coalesce(di.custo_unitario, pr.preco_custo, 0)) valor ${consumo} group by 1,2,3 order by 1,2`,
      params(f),
    );
    return { linhas, agrupar: ['dia'], colunas: [col('dia', 'Dia', 'data'), col('produto', 'Produto'), col('unidade', 'Unidade'), col('custo', 'Custo', 'moeda'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor', 'moeda', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-consumo-acao-terapeutica',
  grupo: 'Consumo',
  titulo: 'Consumo por ação terapêutica',
  tr: ['1.2.26.9'],
  filtros: [...PERIODO, UNIDADE, GRUPO],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(at.nome, 'Sem classificação') acao, ${PRODUTO_SQL} produto, avg(coalesce(di.custo_unitario, pr.preco_custo, 0)) custo, sum(di.quantidade) quantidade,
              sum(di.quantidade * coalesce(di.custo_unitario, pr.preco_custo, 0)) valor ${consumo.replace('left join far.grupo_produto', 'left join far.acao_terapeutica at on at.id = pr.acao_terapeutica_id left join far.grupo_produto')}
        group by 1,2 order by 1,2`,
      params(f),
    );
    return { linhas, agrupar: ['acao'], colunas: [col('acao', 'Ação terapêutica'), col('produto', 'Produto'), col('custo', 'Custo', 'moeda'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor', 'moeda', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-consumo-medio-mensal',
  grupo: 'Consumo',
  titulo: 'Consumo médio mensal',
  tr: ['1.2.21.5', '1.2.21.5.1', '1.2.26.1'],
  filtros: [...PERIODO, UNIDADE, GRUPO, { ...PRODUTO, obrigatorio: false }],
  async gerar(f) {
    const linhas = await consultar(
      `select extract(year from d.data_hora)::int::text ano, to_char(d.data_hora, 'MM') mes, u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, ${PRODUTO_SQL} produto,
              sum(di.quantidade) quantidade, extract(day from (date_trunc('month', min(d.data_hora)) + interval '1 month - 1 day'))::int dias,
              round(sum(di.quantidade) / extract(day from (date_trunc('month', min(d.data_hora)) + interval '1 month - 1 day')), 2) media_diaria
         ${consumo} group by 1,2,3,4,5 order by 1,2,3,4,5`,
      params(f),
    );
    return {
      linhas,
      agrupar: ['ano', 'mes', 'unidade', 'grupo'],
      grafico: { tipo: 'linha', x: 'mes', y: 'quantidade', serie: 'ano', titulo: 'Consumo por mês (uma linha por ano)' },
      colunas: [col('ano', 'Ano'), col('mes', 'Mês'), col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('produto', 'Produto'), col('quantidade', 'Qtd. total', 'decimal', true), col('dias', 'Dias do mês', 'inteiro'), col('media_diaria', 'Média diária', 'decimal')],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-psicotropicos',
  grupo: 'Controlados (Portaria 344/98)',
  titulo: 'Consumo de psicotrópicos (analítico)',
  tr: ['1.2.26.10'],
  filtros: [...PERIODO, UNIDADE, PRODUTO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, ${PRODUTO_SQL} || ' (lista ' || pr.lista_344 || ')' produto, d.data_hora::date::text data, p.nome paciente, d.prescritor, d.numero_receita,
              l.lote, di.dias_consumo, di.quantidade
         ${consumo.replace('join cad.pessoa p', 'left join far.estoque_lote l on l.id = di.lote_id join cad.pessoa p')} and pr.lista_344 is not null order by 1, 2, 3`,
      params(f),
    );
    return { linhas, agrupar: ['unidade', 'produto'], colunas: [col('unidade', 'Unidade'), col('produto', 'Psicotrópico'), col('data', 'Data', 'data'), col('paciente', 'Paciente'), col('prescritor', 'Profissional'), col('numero_receita', 'Receita'), col('lote', 'Lote'), col('dias_consumo', 'Dias', 'inteiro'), col('quantidade', 'Qtd.', 'decimal', true)] };
  },
});

// Livro de registro e balanço (BMPO) de controlados (TR 1.2.26.19, 1.2.26.20, 1.2.27.45).
registrarRelatorio({
  ...base,
  id: 'far-livro-344',
  grupo: 'Controlados (Portaria 344/98)',
  titulo: 'Livro de registro específico - movimentação de controlados',
  tr: ['1.2.26.19', '1.2.26.20'],
  filtros: [...PERIODO, { ...UNIDADE, obrigatorio: true }, PRODUTO],
  async gerar(f) {
    const linhas = await consultar(
      `select ${PRODUTO_SQL} || ' - lista ' || pr.lista_344 produto, m.data_hora::date::text data, m.tipo, m.documento, l.lote,
              case when m.quantidade > 0 then m.quantidade end entrada, case when m.quantidade < 0 then -m.quantidade end saida, m.saldo_apos saldo_lote, p.nome paciente, o.nome operador
         from far.movimento_estoque m join far.produto pr on pr.id = m.produto_id left join far.estoque_lote l on l.id = m.lote_id
         left join cad.pessoa p on p.id = m.paciente_id left join seg.operador o on o.id = m.operador_id
        where pr.lista_344 is not null and m.data_hora::date between $1 and $2 and m.unidade_id = $3 and ($4::bigint is null or pr.id = $4) and ($5::bigint is null or pr.grupo_id = $5)
        order by 1, m.data_hora`,
      params(f),
    );
    return {
      linhas,
      agrupar: ['produto'],
      orientacao: 'landscape',
      colunas: [col('produto', 'Medicamento'), col('data', 'Data', 'data'), col('tipo', 'Movimento'), col('documento', 'Documento'), col('lote', 'Lote'), col('entrada', 'Entrada', 'decimal', true), col('saida', 'Saída', 'decimal', true), col('saldo_lote', 'Saldo lote', 'decimal'), col('paciente', 'Paciente'), col('operador', 'Responsável')],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-bmpo',
  grupo: 'Controlados (Portaria 344/98)',
  titulo: 'Balanço de medicamentos psicoativos e outros sujeitos a controle especial (BMPO)',
  tr: ['1.2.26.20', '1.2.27.45'],
  filtros: [...PERIODO, { ...UNIDADE, obrigatorio: true }],
  async gerar(f) {
    const linhas = await consultar(
      `select pr.lista_344 lista, ${PRODUTO_SQL} produto, ap.nome apresentacao,
              coalesce((select sum(m2.quantidade) from far.movimento_estoque m2 where m2.produto_id = pr.id and m2.unidade_id = $3 and m2.data_hora::date < $1), 0) estoque_inicial,
              coalesce(sum(m.quantidade) filter (where m.quantidade > 0), 0) entradas,
              coalesce(-sum(m.quantidade) filter (where m.quantidade < 0), 0) saidas,
              coalesce((select sum(m2.quantidade) from far.movimento_estoque m2 where m2.produto_id = pr.id and m2.unidade_id = $3 and m2.data_hora::date <= $2), 0) estoque_final
         from far.produto pr left join far.apresentacao ap on ap.id = pr.apresentacao_id
         left join far.movimento_estoque m on m.produto_id = pr.id and m.unidade_id = $3 and m.data_hora::date between $1 and $2
        where pr.lista_344 is not null group by pr.id, ap.nome order by 1, 2`,
      [f.de, f.ate, f.unidadeId],
    );
    return { linhas, agrupar: ['lista'], colunas: [col('lista', 'Lista'), col('produto', 'Medicamento'), col('apresentacao', 'Apresentação'), col('estoque_inicial', 'Estoque inicial', 'decimal'), col('entradas', 'Entradas', 'decimal', true), col('saidas', 'Saídas', 'decimal', true), col('estoque_final', 'Estoque final', 'decimal')] };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-rmnra',
  grupo: 'Controlados (Portaria 344/98)',
  titulo: 'RMNRA - Relação mensal de notificações de receita "A"',
  tr: ['1.2.26.21', '1.2.27.46'],
  filtros: [...PERIODO, { ...UNIDADE, obrigatorio: true }],
  async gerar(f) {
    const linhas = await consultar(
      `select d.numero_receita notificacao, d.data_hora::date::text data, p.nome paciente, coalesce(lg.nome, '') endereco, d.prescritor, ${PRODUTO_SQL} produto, di.quantidade, l.lote
         from far.dispensacao d join far.dispensacao_item di on di.dispensacao_id = d.id join far.produto pr on pr.id = di.produto_id
         join cad.pessoa p on p.id = d.paciente_id left join cad.logradouro lg on lg.id = p.logradouro_id left join far.estoque_lote l on l.id = di.lote_id
        where d.situacao = 'EFETIVADA' and d.data_hora::date between $1 and $2 and d.unidade_id = $3 and (pr.lista_344 in ('A1','A2','A3') or d.tipo_receita = 'AMARELA_A')
        order by 2, 1`,
      [f.de, f.ate, f.unidadeId],
    );
    return { linhas, orientacao: 'landscape', colunas: [col('notificacao', 'Nº notificação'), col('data', 'Data', 'data'), col('paciente', 'Paciente'), col('endereco', 'Endereço'), col('prescritor', 'Prescritor'), col('produto', 'Medicamento'), col('quantidade', 'Qtd.', 'decimal', true), col('lote', 'Lote')] };
  },
});

// --------------------------------------------------------------------------- Atendimentos da farmácia
registrarRelatorio({
  ...base,
  id: 'far-atendimentos-faixa-etaria',
  grupo: 'Atendimentos',
  titulo: 'Atendimentos da farmácia por faixa etária',
  tr: ['1.2.26.11'],
  filtros: [...PERIODO, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select case when a < 2 then '0-1' when a < 10 then '02-09' when a < 20 then '10-19' when a < 40 then '20-39' when a < 60 then '40-59' when a < 80 then '60-79' else '80+' end faixa, count(*)::int atendimentos
         from (select extract(year from age(d.data_hora, p.data_nascimento)) a from far.dispensacao d join cad.pessoa p on p.id = d.paciente_id
                where d.situacao = 'EFETIVADA' and d.data_hora::date between $1 and $2 and ($3::bigint is null or d.unidade_id = $3)) x group by 1 order by 1`,
      [f.de, f.ate, nul(f.unidadeId)],
    );
    return { linhas, grafico: { tipo: 'barra', x: 'faixa', y: 'atendimentos' }, colunas: [col('faixa', 'Faixa etária'), col('atendimentos', 'Atendimentos', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-atendimentos-sexo',
  grupo: 'Atendimentos',
  titulo: 'Atendimentos da farmácia por sexo',
  tr: ['1.2.26.12'],
  filtros: [...PERIODO, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select case p.sexo when 'F' then 'Feminino' when 'M' then 'Masculino' else 'Ignorado' end sexo, count(*)::int atendimentos
         from far.dispensacao d join cad.pessoa p on p.id = d.paciente_id where d.situacao = 'EFETIVADA' and d.data_hora::date between $1 and $2 and ($3::bigint is null or d.unidade_id = $3)
        group by 1 order by 1`,
      [f.de, f.ate, nul(f.unidadeId)],
    );
    return { linhas, grafico: { tipo: 'barra', x: 'sexo', y: 'atendimentos' }, colunas: [col('sexo', 'Sexo'), col('atendimentos', 'Atendimentos', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-atendimentos-mes',
  grupo: 'Atendimentos',
  titulo: 'Comparativo mensal de atendimentos por ano',
  tr: ['1.2.26.13'],
  filtros: [...PERIODO, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select extract(year from d.data_hora)::int::text ano, to_char(d.data_hora, 'MM') mes, count(*)::int atendimentos from far.dispensacao d
        where d.situacao = 'EFETIVADA' and d.data_hora::date between $1 and $2 and ($3::bigint is null or d.unidade_id = $3) group by 1,2 order by 2,1`,
      [f.de, f.ate, nul(f.unidadeId)],
    );
    return { linhas, grafico: { tipo: 'barra', x: 'mes', y: 'atendimentos', serie: 'ano' }, colunas: [col('mes', 'Mês'), col('ano', 'Ano'), col('atendimentos', 'Atendimentos', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'far-atendimentos-atendente',
  grupo: 'Atendimentos',
  titulo: 'Atendimentos por atendente / horário',
  tr: ['1.2.26.14', '1.2.26.15', '1.2.26.16'],
  filtros: [...PERIODO, UNIDADE, { nome: 'visao', rotulo: 'Visão', tipo: 'opcao', opcoes: [['horario', 'Analítico por horário'], ['atendente', 'Analítico por atendente'], ['sintetico', 'Sintético por atendente']], padrao: 'horario' }],
  async gerar(f) {
    const visao = f.visao ?? 'horario';
    if (visao === 'sintetico') {
      const linhas = await consultar(
        `select u.nome unidade, o.nome atendente, count(*)::int atendimentos, round(100.0 * count(*) / sum(count(*)) over (partition by u.nome), 2) percentual
           from far.dispensacao d join cad.unidade u on u.id = d.unidade_id left join seg.operador o on o.id = d.operador_id
          where d.situacao = 'EFETIVADA' and d.data_hora::date between $1 and $2 and ($3::bigint is null or d.unidade_id = $3) group by 1,2 order by 1,3 desc`,
        [f.de, f.ate, nul(f.unidadeId)],
      );
      return { linhas, agrupar: ['unidade'], colunas: [col('unidade', 'Unidade'), col('atendente', 'Atendente'), col('atendimentos', 'Atendimentos', 'inteiro', true), col('percentual', '%', 'percentual')] };
    }
    const linhas = await consultar(
      `select u.nome unidade, d.data_hora::date::text data, to_char(d.data_hora, 'HH24:MI') hora, o.nome atendente, p.nome paciente, d.prescritor,
              (select string_agg(pr.nome || ' (' || di.quantidade || ')', '; ') from far.dispensacao_item di join far.produto pr on pr.id = di.produto_id where di.dispensacao_id = d.id) produtos
         from far.dispensacao d join cad.unidade u on u.id = d.unidade_id join cad.pessoa p on p.id = d.paciente_id left join seg.operador o on o.id = d.operador_id
        where d.situacao = 'EFETIVADA' and d.data_hora::date between $1 and $2 and ($3::bigint is null or d.unidade_id = $3)
        order by 1, ${visao === 'atendente' ? '4, 2, 3' : '2, 3'}`,
      [f.de, f.ate, nul(f.unidadeId)],
    );
    return {
      linhas,
      agrupar: visao === 'atendente' ? ['unidade', 'atendente'] : ['unidade', 'data'],
      orientacao: 'landscape',
      colunas: [col('unidade', 'Unidade'), ...(visao === 'atendente' ? [col('atendente', 'Atendente'), col('data', 'Data', 'data')] : [col('data', 'Data', 'data'), col('atendente', 'Atendente')]), col('hora', 'Hora'), col('paciente', 'Paciente'), col('prescritor', 'Prescritor'), col('produtos', 'Produtos')],
    };
  },
});

// --------------------------------------------------------------------------- Estoque
const est = { modulo: M, permissao: 'estoque_lote:exportar' };

registrarRelatorio({
  ...est,
  id: 'far-saldo-fisico-financeiro',
  grupo: 'Estoque',
  titulo: 'Saldo de estoque físico e financeiro',
  tr: ['1.2.21.8'],
  filtros: [UNIDADE, GRUPO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, coalesce(sg.nome, '-') subgrupo, ${PRODUTO_SQL} produto,
              round(sum(l.quantidade * coalesce(l.custo_unitario, pr.preco_custo, 0)) / nullif(sum(l.quantidade), 0), 4) valor_unitario, sum(l.quantidade) saldo,
              sum(l.quantidade * coalesce(l.custo_unitario, pr.preco_custo, 0)) valor_total
         from far.estoque_lote l join far.produto pr on pr.id = l.produto_id join cad.unidade u on u.id = l.unidade_id
         left join far.grupo_produto g on g.id = pr.grupo_id left join far.subgrupo_produto sg on sg.id = pr.subgrupo_id
        where l.quantidade > 0 and ($1::bigint is null or l.unidade_id = $1) and ($2::bigint is null or pr.grupo_id = $2)
        group by 1,2,3,4 order by 1,2,3,4`,
      [nul(f.unidadeId), nul(f.grupoId)],
    );
    return { linhas, agrupar: ['unidade', 'grupo', 'subgrupo'], colunas: [col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('subgrupo', 'Subgrupo'), col('produto', 'Produto'), col('valor_unitario', 'Valor unitário', 'moeda'), col('saldo', 'Saldo', 'decimal'), col('valor_total', 'Valor total', 'moeda', true)] };
  },
});

registrarRelatorio({
  ...est,
  id: 'far-lotes-validade',
  grupo: 'Estoque',
  titulo: 'Lotes por validade',
  tr: ['1.2.26.17'],
  filtros: [UNIDADE, GRUPO, { nome: 'ate', rotulo: 'Vencendo até', tipo: 'data' }],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, l.validade::text validade, ${PRODUTO_SQL} produto, l.lote, fb.nome fabricante, l.quantidade, (l.validade - current_date) dias,
              case when l.validade < current_date then 'VENCIDO' when l.bloqueado then 'BLOQUEADO' else '' end situacao
         from far.estoque_lote l join far.produto pr on pr.id = l.produto_id join cad.unidade u on u.id = l.unidade_id left join far.fabricante fb on fb.id = l.fabricante_id
        where l.quantidade > 0 and ($1::bigint is null or l.unidade_id = $1) and ($2::bigint is null or pr.grupo_id = $2) and ($3::date is null or l.validade <= $3)
        order by 1, 2, 3`,
      [nul(f.unidadeId), nul(f.grupoId), nul(f.ate)],
    );
    return { linhas, agrupar: ['unidade'], colunas: [col('unidade', 'Unidade'), col('validade', 'Validade', 'data'), col('produto', 'Produto'), col('lote', 'Lote'), col('fabricante', 'Fabricante'), col('quantidade', 'Qtd.', 'decimal', true), col('dias', 'Dias p/ vencer', 'inteiro'), col('situacao', 'Situação')] };
  },
});

registrarRelatorio({
  ...est,
  id: 'far-inventario',
  grupo: 'Estoque',
  titulo: 'Lista para conferência de estoque (inventário)',
  tr: ['1.2.26.18'],
  filtros: [{ ...UNIDADE, obrigatorio: true }, GRUPO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, pr.id codigo, ${PRODUTO_SQL} produto, ap.nome apresentacao, pr.tarja, coalesce(sum(l.quantidade), 0) estoque, '' contagem
         from far.produto pr join far.estoque_lote l on l.produto_id = pr.id and l.unidade_id = $1 join cad.unidade u on u.id = l.unidade_id
         left join far.apresentacao ap on ap.id = pr.apresentacao_id where ($2::bigint is null or pr.grupo_id = $2)
        group by 1,2,3,4,5 order by 3`,
      [f.unidadeId, nul(f.grupoId)],
    );
    return { linhas, agrupar: ['unidade'], colunas: [col('unidade', 'Unidade'), col('codigo', 'Código'), col('produto', 'Produto'), col('apresentacao', 'Apresentação'), col('tarja', 'Tarja'), col('estoque', 'Estoque atual', 'decimal'), { campo: 'contagem', titulo: 'Contagem física', largura: 90 }] };
  },
});

registrarRelatorio({
  ...est,
  id: 'far-reposicao',
  grupo: 'Estoque',
  titulo: 'Produtos com necessidade de reposição',
  tr: ['1.2.21.1'],
  filtros: [UNIDADE, GRUPO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, ${PRODUTO_SQL} produto, coalesce(sum(l.quantidade - l.reservado) filter (where l.validade >= current_date and not l.bloqueado), 0) saldo,
              coalesce(pu.estoque_minimo, pr.estoque_minimo) minimo, pu.estoque_ideal ideal,
              coalesce((select -sum(m.quantidade) from far.movimento_estoque m where m.unidade_id = u.id and m.produto_id = pr.id and m.tipo = 'DISPENSACAO' and m.data_hora > now() - interval '90 days'), 0) / 3 consumo_mensal
         from far.produto pr cross join cad.unidade u
         left join far.estoque_lote l on l.produto_id = pr.id and l.unidade_id = u.id
         left join far.produto_unidade pu on pu.produto_id = pr.id and pu.unidade_id = u.id
        where pr.ativo and ($1::bigint is null or u.id = $1) and ($2::bigint is null or pr.grupo_id = $2)
          and (pu.id is not null or exists (select 1 from far.estoque_lote x where x.produto_id = pr.id and x.unidade_id = u.id))
        group by u.id, u.nome, pr.id, pu.estoque_minimo, pu.estoque_ideal
       having coalesce(sum(l.quantidade - l.reservado) filter (where l.validade >= current_date and not l.bloqueado), 0) < coalesce(pu.estoque_minimo, pr.estoque_minimo, 0)
        order by 1, 2`,
      [nul(f.unidadeId), nul(f.grupoId)],
    );
    for (const l of linhas) l.sugerido = Math.max(0, Number(l.ideal ?? l.minimo ?? 0) * (l.ideal ? 1 : 2) - Number(l.saldo));
    return { linhas, agrupar: ['unidade'], colunas: [col('unidade', 'Unidade'), col('produto', 'Produto'), col('saldo', 'Saldo', 'decimal'), col('minimo', 'Mínimo', 'decimal'), col('ideal', 'Ideal', 'decimal'), col('consumo_mensal', 'Consumo mensal (90d)', 'decimal'), col('sugerido', 'Reposição sugerida', 'decimal', true)] };
  },
});

registrarRelatorio({
  ...est,
  id: 'far-historico-produto',
  grupo: 'Estoque',
  titulo: 'Histórico de movimentação por produto e dia',
  tr: ['1.2.21.6'],
  filtros: [...PERIODO, UNIDADE, { ...PRODUTO, obrigatorio: true }],
  async gerar(f) {
    const linhas = await consultar(
      `select ${PRODUTO_SQL} produto, u.nome unidade, m.data_hora::date::text dia, m.tipo, sum(m.quantidade) filter (where m.quantidade > 0) entradas,
              -sum(m.quantidade) filter (where m.quantidade < 0) saidas, count(*)::int movimentos
         from far.movimento_estoque m join far.produto pr on pr.id = m.produto_id join cad.unidade u on u.id = m.unidade_id
        where m.data_hora::date between $1 and $2 and ($3::bigint is null or m.unidade_id = $3) and pr.id = $4 group by 1,2,3,4 order by 1,2,3`,
      params(f).slice(0, 4),
    );
    return { linhas, agrupar: ['produto', 'unidade'], colunas: [col('produto', 'Produto'), col('unidade', 'Unidade'), col('dia', 'Dia', 'data'), col('tipo', 'Movimento'), col('entradas', 'Entradas', 'decimal', true), col('saidas', 'Saídas', 'decimal', true), col('movimentos', 'Nº mov.', 'inteiro')] };
  },
});

registrarRelatorio({
  ...est,
  id: 'far-fisico-financeiro',
  grupo: 'Estoque',
  titulo: 'Movimentação físico-financeira',
  tr: ['1.2.21.7', '1.2.21.4'],
  filtros: [...PERIODO, UNIDADE, GRUPO, PRODUTO],
  async gerar(f) {
    const linhas = await consultar(
      `with mov as (
         select m.unidade_id, m.produto_id, m.tipo, m.quantidade, m.quantidade * coalesce(m.custo_unitario, 0) valor, m.data_hora::date dia from far.movimento_estoque m
       )
       select u.nome unidade, ${PRODUTO_SQL} produto,
              coalesce(sum(x.quantidade) filter (where x.dia < $1), 0) inicial,
              coalesce(sum(x.quantidade) filter (where x.dia between $1 and $2 and x.tipo = 'ENTRADA'), 0) entradas,
              coalesce(sum(x.quantidade) filter (where x.dia between $1 and $2 and x.tipo = 'TRANSFERENCIA_ENTRADA'), 0) transf_recebidas,
              coalesce(-sum(x.quantidade) filter (where x.dia between $1 and $2 and x.tipo = 'TRANSFERENCIA_SAIDA'), 0) transf_enviadas,
              coalesce(-sum(x.quantidade) filter (where x.dia between $1 and $2 and x.tipo in ('DISPENSACAO','ESTORNO_DISPENSACAO','KIT','ESTORNO_KIT','VACINACAO','ESTORNO_VACINACAO','CONSUMO','ADMINISTRACAO')), 0) dispensacoes,
              coalesce(-sum(x.quantidade) filter (where x.dia between $1 and $2 and x.tipo = 'INUTILIZACAO'), 0) inutilizacoes,
              coalesce(sum(x.quantidade) filter (where x.dia between $1 and $2 and x.tipo in ('ACERTO_ENTRADA','ACERTO_SAIDA')), 0) acertos,
              coalesce(sum(x.quantidade) filter (where x.dia <= $2), 0) final,
              coalesce(sum(x.valor) filter (where x.dia <= $2), 0) valor_final
         from mov x join far.produto pr on pr.id = x.produto_id join cad.unidade u on u.id = x.unidade_id
        where ${filtroDe('x')} group by 1,2 order by 1,2`,
      params(f),
    );
    return {
      linhas,
      agrupar: ['unidade'],
      orientacao: 'landscape',
      colunas: [col('unidade', 'Unidade'), col('produto', 'Produto'), col('inicial', 'Est. inicial', 'decimal'), col('entradas', 'Entradas', 'decimal', true), col('transf_recebidas', 'Transf. receb.', 'decimal', true), col('transf_enviadas', 'Transf. env.', 'decimal', true), col('dispensacoes', 'Saídas/disp.', 'decimal', true), col('inutilizacoes', 'Inutiliz.', 'decimal', true), col('acertos', 'Acertos', 'decimal', true), col('final', 'Est. final', 'decimal'), col('valor_final', 'Valor final', 'moeda', true)],
    };
  },
});

// Previsão sazonal por regressão linear simples (tendência anual) e índices de sazonalidade mensal (TR 1.2.21.2, 1.2.21.3).
registrarRelatorio({
  ...est,
  id: 'far-previsao-consumo',
  grupo: 'Planejamento',
  titulo: 'Previsão de consumo sazonal e estimativa de compra',
  tr: ['1.2.21.2', '1.2.21.2.1', '1.2.21.3'],
  filtros: [{ ...PRODUTO, obrigatorio: true }, UNIDADE, { nome: 'meses', rotulo: 'Meses a prever', tipo: 'inteiro', padrao: 6 }, { nome: 'analitico', rotulo: 'Analítico (inclui histórico)', tipo: 'booleano', padrao: true }],
  async gerar(f) {
    const hist = await consultar<{ mes: string; qtd: string }>(
      `select to_char(date_trunc('month', m.data_hora), 'YYYY-MM') mes, -sum(m.quantidade) qtd from far.movimento_estoque m
        where m.produto_id = $1 and ($2::bigint is null or m.unidade_id = $2) and m.tipo in ('DISPENSACAO','ESTORNO_DISPENSACAO','KIT','ESTORNO_KIT','VACINACAO','ESTORNO_VACINACAO','CONSUMO')
          and m.data_hora >= date_trunc('month', now()) - interval '36 months' and m.data_hora < date_trunc('month', now())
        group by 1 order by 1`,
      [f.produtoId, nul(f.unidadeId)],
    );
    const serie = preencherMeses(hist.map((h) => ({ mes: h.mes, qtd: Number(h.qtd) })));
    const meses = Math.min(24, Math.max(1, Number(f.meses ?? 6)));
    const prev = preverSazonal(serie, meses);
    const saldo = Number(
      (
        await consultar(`select coalesce(sum(quantidade - reservado), 0) s from far.estoque_lote where produto_id = $1 and ($2::bigint is null or unidade_id = $2) and validade >= current_date and not bloqueado`, [
          f.produtoId,
          nul(f.unidadeId),
        ])
      )[0].s,
    );
    const demanda = prev.reduce((s, p) => s + p.qtd, 0);
    const mediaPrev = demanda / meses || 0;
    const analitico = f.analitico !== false && f.analitico !== 'false';
    const linhas = [...(analitico ? serie.map((s) => ({ mes: s.mes, tipo: 'Consumo realizado', quantidade: s.qtd })) : []), ...prev.map((p) => ({ mes: p.mes, tipo: 'Previsão', quantidade: Math.round(p.qtd) }))];
    return {
      linhas,
      grafico: { tipo: 'linha', x: 'mes', y: 'quantidade', serie: 'tipo' },
      filtrosTexto: [
        `Demanda prevista (${meses} meses): ${Math.round(demanda)}`,
        `Saldo atual: ${saldo}`,
        `Compra sugerida: ${Math.max(0, Math.round(demanda - saldo))}`,
        `Duração prevista do estoque: ${mediaPrev > 0 ? (saldo / mediaPrev).toFixed(1) + ' meses' : 'indeterminada'}`,
      ],
      colunas: [col('mes', 'Mês'), col('tipo', 'Tipo'), col('quantidade', 'Quantidade', 'decimal', true)],
    };
  },
});

function preencherMeses(s: { mes: string; qtd: number }[]) {
  if (!s.length) return [];
  const out: { mes: string; qtd: number }[] = [];
  const mapa = new Map(s.map((x) => [x.mes, x.qtd]));
  let [a, m] = s[0].mes.split('-').map(Number);
  const fim = s[s.length - 1].mes;
  for (;;) {
    const chave = `${a}-${String(m).padStart(2, '0')}`;
    out.push({ mes: chave, qtd: mapa.get(chave) ?? 0 });
    if (chave === fim) break;
    if (++m > 12) (m = 1), a++;
  }
  return out;
}

/** Tendência por regressão linear simples e sazonalidade mensal multiplicativa. */
export function preverSazonal(serie: { mes: string; qtd: number }[], horizonte: number) {
  const nPts = serie.length;
  if (!nPts) return [];
  const xs = serie.map((_, i) => i);
  const mx = xs.reduce((s, x) => s + x, 0) / nPts;
  const my = serie.reduce((s, p) => s + p.qtd, 0) / nPts;
  const b = nPts > 1 ? xs.reduce((s, x, i) => s + (x - mx) * (serie[i].qtd - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0) : 0;
  const a = my - b * mx;
  const indices = new Map<number, number[]>();
  serie.forEach((p, i) => {
    const t = a + b * i;
    if (t > 0) indices.set(Number(p.mes.slice(5)), [...(indices.get(Number(p.mes.slice(5))) ?? []), p.qtd / t]);
  });
  const indice = (mes: number) => {
    const v = indices.get(mes);
    return v?.length && nPts >= 12 ? v.reduce((s, x) => s + x, 0) / v.length : 1;
  };
  let [ano, mes] = serie[nPts - 1].mes.split('-').map(Number);
  const out: { mes: string; qtd: number }[] = [];
  for (let h = 1; h <= horizonte; h++) {
    if (++mes > 12) (mes = 1), ano++;
    out.push({ mes: `${ano}-${String(mes).padStart(2, '0')}`, qtd: Math.max(0, (a + b * (nPts - 1 + h)) * indice(mes)) });
  }
  return out;
}

// --------------------------------------------------------------------------- Entradas
const ent = { modulo: M, permissao: 'entrada:exportar' };
const entradasBase = `from far.entrada e join far.entrada_item i on i.entrada_id = e.id join far.produto pr on pr.id = i.produto_id join cad.unidade u on u.id = e.unidade_id
  left join far.grupo_produto g on g.id = pr.grupo_id left join far.subgrupo_produto sg on sg.id = pr.subgrupo_id left join far.fornecedor fo on fo.id = e.fornecedor_id
  left join seg.operador o on o.id = e.criado_por
 where e.situacao = 'CONFIRMADA' and e.data_entrada between $1 and $2 and ${filtroDe('e')}`;

const RELATORIOS_ENTRADA: { id: string; titulo: string; tr: string; sql: string; agrupar: string[]; colunas: Coluna[] }[] = [
  {
    id: 'far-entradas-grupo-analitico',
    titulo: 'Entradas por grupo (analítico)',
    tr: '1.2.23.1',
    sql: `select u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, coalesce(sg.nome, '-') subgrupo, coalesce(fo.nome, e.doador, e.tipo) fornecedor, ${PRODUTO_SQL} produto, e.data_entrada::text data, i.lote, i.valor_unitario custo, i.quantidade, i.quantidade * coalesce(i.valor_unitario, 0) valor ${entradasBase} order by 1,2,3,4,6`,
    agrupar: ['unidade', 'grupo', 'subgrupo', 'fornecedor'],
    colunas: [col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('subgrupo', 'Subgrupo'), col('fornecedor', 'Fornecedor'), col('produto', 'Produto'), col('data', 'Data', 'data'), col('lote', 'Lote'), col('custo', 'Custo', 'moeda'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor', 'moeda', true)],
  },
  {
    id: 'far-entradas-grupo-sintetico',
    titulo: 'Entradas por grupo (sintético)',
    tr: '1.2.23.2',
    sql: `select u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, ${PRODUTO_SQL} produto, sum(i.quantidade) quantidade, sum(i.quantidade * coalesce(i.valor_unitario, 0)) valor ${entradasBase} group by 1,2,3 order by 1,2,3`,
    agrupar: ['unidade', 'grupo'],
    colunas: [col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('produto', 'Produto'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor', 'moeda', true)],
  },
  {
    id: 'far-entradas-tipo',
    titulo: 'Entradas por fornecedor ou doação (sintético)',
    tr: '1.2.23.4',
    sql: `select u.nome unidade, e.tipo, coalesce(fo.nome, e.doador, '-') origem, sum(i.quantidade * coalesce(i.valor_unitario, 0)) valor ${entradasBase} group by 1,2,3 order by 1,2,3`,
    agrupar: ['unidade', 'tipo'],
    colunas: [col('unidade', 'Unidade'), col('tipo', 'Tipo de entrada'), col('origem', 'Origem'), col('valor', 'Valor total', 'moeda', true)],
  },
  {
    id: 'far-entradas-produto',
    titulo: 'Entradas por produto',
    tr: '1.2.23.5',
    sql: `select ${PRODUTO_SQL} produto, e.data_entrada::text data, coalesce(fo.nome, e.doador) fornecedor, e.nota_numero, e.empenho, o.nome usuario, i.quantidade ${entradasBase} order by 1, 2`,
    agrupar: ['produto'],
    colunas: [col('produto', 'Produto'), col('data', 'Data', 'data'), col('fornecedor', 'Fornecedor'), col('nota_numero', 'Nota fiscal'), col('empenho', 'Empenho'), col('usuario', 'Usuário'), col('quantidade', 'Qtd.', 'decimal', true)],
  },
  {
    id: 'far-entradas-fornecedor-sintetico',
    titulo: 'Entradas por fornecedor (sintético)',
    tr: '1.2.23.6',
    sql: `select coalesce(fo.nome, e.doador, e.tipo) fornecedor, count(distinct e.id)::int entradas, round(100.0 * count(distinct e.id) / sum(count(distinct e.id)) over (), 2) percentual,
                 sum(i.quantidade) quantidade, sum(i.quantidade * coalesce(i.valor_unitario, 0)) valor ${entradasBase} group by 1 order by 5 desc`,
    agrupar: [],
    colunas: [col('fornecedor', 'Fornecedor'), col('entradas', 'Nº entradas', 'inteiro', true), col('percentual', '% entradas', 'percentual'), col('quantidade', 'Qtd. produtos', 'decimal', true), col('valor', 'Valor', 'moeda', true)],
  },
  {
    id: 'far-entradas-fornecedor-analitico',
    titulo: 'Entradas por fornecedor (analítico)',
    tr: '1.2.23.7',
    sql: `select coalesce(fo.nome, e.doador, e.tipo) fornecedor, 'NF ' || coalesce(e.nota_numero, '-') nota, e.data_entrada::text data, e.empenho, ${PRODUTO_SQL} produto, i.lote, i.validade::text validade, i.valor_unitario, i.quantidade,
                 i.quantidade * coalesce(i.valor_unitario, 0) valor ${entradasBase} order by 1, 2, 5`,
    agrupar: ['fornecedor', 'nota'],
    colunas: [col('fornecedor', 'Fornecedor'), col('nota', 'Nota'), col('data', 'Data', 'data'), col('empenho', 'Empenho'), col('produto', 'Produto'), col('lote', 'Lote'), col('validade', 'Validade', 'data'), col('valor_unitario', 'Vl. unit.', 'moeda'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor', 'moeda', true)],
  },
  {
    id: 'far-entradas-lote-produto',
    titulo: 'Entradas por lote do produto',
    tr: '1.2.23.8',
    sql: `select i.lote, e.data_entrada::text data, ${PRODUTO_SQL} produto, e.nota_numero, e.empenho, o.nome usuario, i.quantidade ${entradasBase} order by 1, 2`,
    agrupar: ['lote'],
    colunas: [col('lote', 'Lote'), col('data', 'Data', 'data'), col('produto', 'Produto'), col('nota_numero', 'Nota fiscal'), col('empenho', 'Empenho'), col('usuario', 'Usuário'), col('quantidade', 'Qtd.', 'decimal', true)],
  },
  {
    id: 'far-entradas-lote-entrada',
    titulo: 'Entradas por lote da entrada',
    tr: '1.2.23.9',
    sql: `select coalesce(e.lote_entrada, '(sem lote de entrega)') lote_entrada, coalesce(fo.nome, e.doador) fornecedor, ${PRODUTO_SQL} produto, i.lote, i.quantidade, i.quantidade * coalesce(i.valor_unitario, 0) valor ${entradasBase} order by 1, 2, 3`,
    agrupar: ['lote_entrada'],
    colunas: [col('lote_entrada', 'Lote da entrada'), col('fornecedor', 'Fornecedor'), col('produto', 'Produto'), col('lote', 'Lote'), col('quantidade', 'Qtd.', 'decimal', true), col('valor', 'Valor', 'moeda', true)],
  },
];
for (const r of RELATORIOS_ENTRADA)
  registrarRelatorio({
    ...ent,
    id: r.id,
    grupo: 'Entradas',
    titulo: r.titulo,
    tr: [r.tr],
    filtros: [...PERIODO, UNIDADE, GRUPO, PRODUTO],
    async gerar(f) {
      return { linhas: await consultar(r.sql, params(f)), agrupar: r.agrupar, colunas: r.colunas, orientacao: r.colunas.length > 7 ? 'landscape' : undefined };
    },
  });

registrarRelatorio({
  ...ent,
  id: 'far-entradas-transferencia',
  grupo: 'Entradas',
  titulo: 'Entradas por transferência (sintético)',
  tr: ['1.2.23.3'],
  filtros: [...PERIODO, UNIDADE, GRUPO, PRODUTO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, m.data_hora::date::text data, ${PRODUTO_SQL} produto, sum(m.quantidade) quantidade
         from far.movimento_estoque m join far.produto pr on pr.id = m.produto_id join cad.unidade u on u.id = m.unidade_id left join far.grupo_produto g on g.id = pr.grupo_id
        where m.tipo = 'TRANSFERENCIA_ENTRADA' and m.data_hora::date between $1 and $2 and ${filtroDe('m')} group by 1,2,3,4 order by 1,2,3`,
      params(f),
    );
    return { linhas, agrupar: ['unidade', 'grupo'], colunas: [col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('data', 'Data', 'data'), col('produto', 'Produto'), col('quantidade', 'Qtd.', 'decimal', true)] };
  },
});

registrarRelatorio({
  modulo: M,
  permissao: 'inutilizacao:exportar',
  id: 'far-inutilizacoes',
  grupo: 'Estoque',
  titulo: 'Inutilizações por período',
  tr: ['1.2.24.9'],
  filtros: [...PERIODO, UNIDADE, GRUPO, PRODUTO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, mo.nome motivo, x.data::text data, ${PRODUTO_SQL} produto, l.lote, l.validade::text validade, x.quantidade, x.valor_total
         from far.inutilizacao x join far.produto pr on pr.id = x.produto_id join cad.unidade u on u.id = x.unidade_id join far.estoque_lote l on l.id = x.lote_id
         left join far.grupo_produto g on g.id = pr.grupo_id left join far.motivo_inutilizacao mo on mo.id = x.motivo_id
        where x.data between $1 and $2 and ${filtroDe('x')} order by 1,2,3,4`,
      params(f),
    );
    return { linhas, agrupar: ['unidade', 'grupo', 'motivo'], colunas: [col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('motivo', 'Motivo'), col('data', 'Data', 'data'), col('produto', 'Produto'), col('lote', 'Lote'), col('validade', 'Validade', 'data'), col('quantidade', 'Qtd.', 'decimal', true), col('valor_total', 'Valor', 'moeda', true)] };
  },
});

// --------------------------------------------------------------------------- Processos judiciais
const jud = { modulo: M, permissao: 'processo_judicial:exportar' };
registrarRelatorio({
  ...jud,
  id: 'far-processos-judiciais',
  grupo: 'Processos judiciais',
  titulo: 'Processos judiciais (itens, dispensações e trâmites)',
  tr: ['1.2.27.50'],
  filtros: [{ nome: 'situacao', rotulo: 'Situação', tipo: 'opcao', opcoes: [['ABERTO', 'Aberto'], ['EM_ANDAMENTO', 'Em andamento'], ['UNICO', 'Único'], ['CUMPRIDO', 'Cumprido'], ['DEVOLVIDO', 'Devolvido'], ['SUSPENSO', 'Suspenso'], ['INATIVO', 'Inativo']] }],
  async gerar(f) {
    const linhas = await consultar(
      `select pj.numero || ' - ' || p.nome || ' (' || pj.situacao || ')' processo, pr.nome produto, i.quantidade, coalesce(i.quantidade_entregue, 0) entregue,
              i.quantidade - coalesce(i.quantidade_entregue, 0) saldo, i.frequencia_dias, i.ultima_entrega::text ultima, a.nome advogado
         from far.processo_judicial pj join cad.pessoa p on p.id = pj.paciente_id left join far.processo_judicial_item i on i.processo_id = pj.id
         left join far.produto pr on pr.id = i.produto_id left join far.advogado a on a.id = pj.advogado_id
        where ($1::text is null or pj.situacao = $1) order by pj.numero, pr.nome`,
      [nul(f.situacao)],
    );
    return { linhas, agrupar: ['processo'], colunas: [col('processo', 'Processo'), col('produto', 'Item'), col('quantidade', 'Qtd. processo', 'decimal'), col('entregue', 'Entregue', 'decimal', true), col('saldo', 'Saldo', 'decimal', true), col('frequencia_dias', 'Frequência (dias)', 'inteiro'), col('ultima', 'Última entrega', 'data'), col('advogado', 'Advogado')] };
  },
});

registrarRelatorio({
  ...jud,
  id: 'far-processos-incidencia',
  grupo: 'Processos judiciais',
  titulo: 'Incidência de medicamentos nos processos, médicos e advogados',
  tr: ['1.2.27.51', '1.2.27.52'],
  filtros: [],
  async gerar() {
    const linhas = await consultar(
      `select pr.nome produto, count(distinct pj.id)::int processos, round(100.0 * count(distinct pj.id) / nullif((select count(*) from far.processo_judicial), 0), 2) percentual,
              count(distinct pj.profissional)::int medicos, count(distinct pj.advogado_id)::int advogados
         from far.processo_judicial_item i join far.processo_judicial pj on pj.id = i.processo_id join far.produto pr on pr.id = i.produto_id group by 1 order by 2 desc`,
    );
    return { linhas, colunas: [col('produto', 'Medicamento / material'), col('processos', 'Nº processos', 'inteiro'), col('percentual', '% dos processos', 'percentual'), col('medicos', 'Médicos', 'inteiro'), col('advogados', 'Advogados', 'inteiro')] };
  },
});

registrarRelatorio({
  modulo: M,
  permissao: 'demanda_reprimida:exportar',
  id: 'far-demanda-reprimida',
  grupo: 'Demanda reprimida',
  titulo: 'Demanda reprimida',
  tr: ['1.2.28.2'],
  filtros: [...PERIODO, UNIDADE, PRODUTO],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, dr.data::text data, dr.situacao, dr.data_necessaria::text necessaria, p.nome paciente, pr.nome produto, dr.quantidade, dr.quantidade_atendida,
              dr.quantidade - dr.quantidade_atendida reprimida,
              (select coalesce(sum(l.quantidade - l.reservado), 0) from far.estoque_lote l where l.unidade_id = dr.unidade_id and l.produto_id = dr.produto_id and l.validade >= current_date and not l.bloqueado) estoque
         from far.demanda_reprimida dr join far.produto pr on pr.id = dr.produto_id join cad.pessoa p on p.id = dr.paciente_id join cad.unidade u on u.id = dr.unidade_id
        where dr.data between $1 and $2 and ($3::bigint is null or dr.unidade_id = $3) and ($4::bigint is null or dr.produto_id = $4) order by 1, 2`,
      [f.de, f.ate, nul(f.unidadeId), nul(f.produtoId)],
    );
    return { linhas, agrupar: ['unidade'], orientacao: 'landscape', colunas: [col('unidade', 'Unidade'), col('data', 'Inclusão', 'data'), col('situacao', 'Situação'), col('necessaria', 'Necessária em', 'data'), col('paciente', 'Paciente'), col('produto', 'Produto'), col('quantidade', 'Necessária', 'decimal', true), col('quantidade_atendida', 'Atendida', 'decimal', true), col('reprimida', 'Reprimida', 'decimal', true), col('estoque', 'Estoque', 'decimal')] };
  },
});

