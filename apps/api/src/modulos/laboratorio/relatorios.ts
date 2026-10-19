// Relatórios do laboratório e do interfaceamento no catálogo (filtros, gráfico e exportação em
// PDF/DOCX/XLSX/CSV/HTML/XML/TXT com código de validação).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';

const nul = (v: unknown) => (v === undefined || v === '' ? null : v);
const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const PRESTADOR: FiltroRelatorio = { nome: 'laboratorioId', rotulo: 'Prestador (laboratório)', tipo: 'ref', ref: 'lab_laboratorio' };
const SECAO: FiltroRelatorio = { nome: 'secaoId', rotulo: 'Seção', tipo: 'ref', ref: 'lab_secao' };
const UNIDADE: FiltroRelatorio = { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' };
const base = { modulo: 'LAB', permissao: 'lab_requisicao:exportar' };

// Produção laboratorial: exames liberados no período, valor do exame (ou SIGTAP).
const producao = `from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id
  join cad.procedimento pr on pr.id = e.procedimento_id join lab.laboratorio l on l.id = coalesce(i.laboratorio_id, r.laboratorio_id)
  left join lab.secao s on s.id = e.secao_id join cad.pessoa p on p.id = r.paciente_id
 where i.situacao = 'LIBERADO' and i.liberado_em::date between $1 and $2 and ($3::bigint is null or l.id = $3) and ($4::bigint is null or e.secao_id = $4)`;
const pProd = (f: Record<string, any>) => [f.de, f.ate, nul(f.laboratorioId), nul(f.secaoId)];

registrarRelatorio({
  ...base,
  id: 'lab-producao-prestador-sintetico',
  grupo: 'Produção',
  titulo: 'Produção laboratorial por prestador (sintético)',
  tr: ['1.2.47.44.1'],
  filtros: [...PERIODO, PRESTADOR, SECAO],
  async gerar(f) {
    const linhas = await consultar(
      `select l.nome prestador, pr.codigo || ' - ' || pr.nome procedimento, count(*)::int quantidade, avg(coalesce(i.valor, pr.valor_sa, 0)) valor, sum(coalesce(i.valor, pr.valor_sa, 0)) total
         ${producao} group by 1, 2 order by 1, 2`,
      pProd(f),
    );
    return {
      linhas,
      agrupar: ['prestador'],
      grafico: { tipo: 'barra', x: 'prestador', y: 'total' },
      colunas: [col('prestador', 'Prestador'), col('procedimento', 'Procedimento'), col('quantidade', 'Quantidade', 'inteiro', true), col('valor', 'Valor', 'moeda'), col('total', 'Valor total', 'moeda', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'lab-producao-prestador-analitico',
  grupo: 'Produção',
  titulo: 'Produção laboratorial por prestador (analítico)',
  tr: ['1.2.47.44.2'],
  filtros: [...PERIODO, PRESTADOR, SECAO],
  async gerar(f) {
    const linhas = await consultar(
      `select l.nome prestador, pr.codigo || ' - ' || pr.nome procedimento, 1 quantidade, p.nome paciente, i.liberado_em::date::text data, coalesce(i.valor, pr.valor_sa, 0) valor, r.numero requisicao
         ${producao} order by 1, 5, 4`,
      pProd(f),
    );
    return {
      linhas,
      agrupar: ['prestador'],
      orientacao: 'landscape',
      colunas: [col('prestador', 'Prestador'), col('procedimento', 'Procedimento'), col('quantidade', 'Qtd.', 'inteiro', true), col('paciente', 'Paciente'), col('data', 'Data', 'data'), col('requisicao', 'Requisição'), col('valor', 'Valor', 'moeda', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'lab-producao-secao',
  grupo: 'Produção',
  titulo: 'Produção laboratorial por seção (sintético)',
  tr: ['1.2.47.44.3'],
  filtros: [...PERIODO, PRESTADOR, SECAO],
  async gerar(f) {
    const linhas = await consultar(
      `select l.nome prestador, coalesce(s.nome, 'Sem seção') secao, pr.codigo || ' - ' || pr.nome procedimento, count(*)::int quantidade, avg(coalesce(i.valor, pr.valor_sa, 0)) valor, sum(coalesce(i.valor, pr.valor_sa, 0)) total
         ${producao} group by 1, 2, 3 order by 1, 2, 3`,
      pProd(f),
    );
    return {
      linhas,
      agrupar: ['prestador', 'secao'],
      grafico: { tipo: 'barra', x: 'secao', y: 'quantidade' },
      colunas: [col('prestador', 'Prestador'), col('secao', 'Seção'), col('procedimento', 'Procedimento'), col('quantidade', 'Quantidade', 'inteiro', true), col('valor', 'Valor', 'moeda'), col('total', 'Valor total', 'moeda', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'lab-agendamento-prestador',
  grupo: 'Agendamento',
  titulo: 'Agendamento laboratorial por prestador (sintético)',
  tr: ['1.2.47.44.4'],
  filtros: [...PERIODO, PRESTADOR],
  async gerar(f) {
    const linhas = await consultar(
      `select l.nome prestador, pr.codigo || ' - ' || pr.nome procedimento, count(*)::int quantidade
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id join cad.procedimento pr on pr.id = e.procedimento_id
         join lab.laboratorio l on l.id = coalesce(i.laboratorio_id, r.laboratorio_id)
        where i.situacao <> 'CANCELADO' and r.data_agendada between $1 and $2 and ($3::bigint is null or l.id = $3) group by 1, 2 order by 1, 2`,
      [f.de, f.ate, nul(f.laboratorioId)],
    );
    return { linhas, agrupar: ['prestador'], grafico: { tipo: 'barra', x: 'procedimento', y: 'quantidade' }, colunas: [col('prestador', 'Prestador'), col('procedimento', 'Procedimento'), col('quantidade', 'Quantidade', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'lab-ocorrencias',
  grupo: 'Ocorrências',
  titulo: 'Ocorrências por paciente, origem, período e seção',
  tr: ['1.2.47.22'],
  filtros: [...PERIODO, { nome: 'pacienteId', rotulo: 'Paciente', tipo: 'ref', ref: 'paciente' }, { nome: 'unidadeId', rotulo: 'Origem (unidade solicitante)', tipo: 'ref', ref: 'unidade' }, SECAO, { nome: 'motivoId', rotulo: 'Motivo', tipo: 'ref', ref: 'lab_motivo_ocorrencia' }],
  async gerar(f) {
    const linhas = await consultar(
      `select o.data_hora::date::text data, coalesce(us.nome, r.origem) origem, coalesce(s.nome, '-') secao, p.nome paciente, r.numero requisicao, coalesce(e.sigla, '-') exame, m.nome motivo, o.descricao,
              case when o.notificado then 'Sim' else 'Não' end notificado
         from lab.ocorrencia o join lab.requisicao r on r.id = o.requisicao_id join cad.pessoa p on p.id = r.paciente_id join lab.motivo_ocorrencia m on m.id = o.motivo_id
         left join cad.unidade us on us.id = r.unidade_solicitante_id left join lab.requisicao_exame i on i.id = o.item_id left join lab.exame e on e.id = i.exame_id left join lab.secao s on s.id = e.secao_id
        where o.data_hora::date between $1 and $2 and ($3::bigint is null or r.paciente_id = $3) and ($4::bigint is null or r.unidade_solicitante_id = $4)
          and ($5::bigint is null or e.secao_id = $5) and ($6::bigint is null or o.motivo_id = $6)
        order by 2, 1`,
      [f.de, f.ate, nul(f.pacienteId), nul(f.unidadeId), nul(f.secaoId), nul(f.motivoId)],
    );
    return {
      linhas,
      agrupar: ['origem'],
      orientacao: 'landscape',
      colunas: [col('data', 'Data', 'data'), col('origem', 'Origem'), col('secao', 'Seção'), col('paciente', 'Paciente'), col('requisicao', 'Requisição'), col('exame', 'Exame'), col('motivo', 'Motivo'), col('descricao', 'Descrição'), col('notificado', 'Solicitante notificado')],
    };
  },
});

// Pedidos repassados a laboratórios de apoio, em PDF ou CSV pelo catálogo (TR 1.2.48.15).
registrarRelatorio({
  ...base,
  id: 'lab-repassados',
  grupo: 'Laboratórios de apoio',
  titulo: 'Pedidos repassados a laboratórios de apoio',
  tr: ['1.2.48.15', '1.2.48.13'],
  filtros: [...PERIODO, { nome: 'laboratorioId', rotulo: 'Laboratório de apoio', tipo: 'ref', ref: 'lab_laboratorio' }, { nome: 'situacao', rotulo: 'Situação', tipo: 'opcao', opcoes: [['PENDENTE', 'Aguardando resultado'], ['LIBERADO', 'Resultado liberado']] }],
  async gerar(f) {
    const linhas = await consultar(
      `select l.nome laboratorio, r.criado_em::date::text data, r.numero requisicao, p.nome paciente, p.cns, e.sigla || ' - ' || e.nome exame, pr.codigo procedimento,
              coalesce(i.valor, pr.valor_sa, 0) valor, i.situacao, i.liberado_em::date::text liberado
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.laboratorio l on l.id = i.laboratorio_id and l.tipo = 'APOIO'
         join lab.exame e on e.id = i.exame_id join cad.procedimento pr on pr.id = e.procedimento_id join cad.pessoa p on p.id = r.paciente_id
        where i.situacao <> 'CANCELADO' and r.criado_em::date between $1 and $2 and ($3::bigint is null or l.id = $3)
          and ($4::text is null or ($4 = 'LIBERADO' and i.situacao = 'LIBERADO') or ($4 = 'PENDENTE' and i.situacao <> 'LIBERADO'))
        order by 1, 2, 3`,
      [f.de, f.ate, nul(f.laboratorioId), nul(f.situacao)],
    );
    return {
      linhas,
      agrupar: ['laboratorio'],
      orientacao: 'landscape',
      colunas: [col('laboratorio', 'Laboratório'), col('data', 'Data', 'data'), col('requisicao', 'Requisição'), col('paciente', 'Paciente'), col('cns', 'CNS'), col('exame', 'Exame'), col('procedimento', 'SIGTAP'), col('valor', 'Valor', 'moeda', true), col('situacao', 'Situação'), col('liberado', 'Liberado em', 'data')],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'lab-prazos',
  grupo: 'Gestão',
  titulo: 'Exames em atraso e tempo de liberação por seção',
  tr: ['1.2.47.4', '1.2.47.17'],
  filtros: [...PERIODO, SECAO],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(s.nome, 'Sem seção') secao, e.sigla || ' - ' || e.nome exame, count(*)::int exames,
              count(*) filter (where i.situacao <> 'LIBERADO' and r.data_prevista_entrega < current_date)::int em_atraso,
              count(*) filter (where i.situacao = 'LIBERADO' and i.liberado_em::date > r.data_prevista_entrega)::int liberados_fora_prazo,
              round(avg(extract(epoch from (i.liberado_em - a.coletada_em)) / 3600)::numeric, 1) horas_coleta_liberacao, max(e.prazo_liberacao_horas) prazo_horas
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id left join lab.secao s on s.id = e.secao_id
         left join lateral (select min(coletada_em) coletada_em from lab.amostra a where a.itens @> jsonb_build_array(i.id) and a.situacao <> 'DESCARTADA') a on true
        where i.situacao <> 'CANCELADO' and r.criado_em::date between $1 and $2 and ($3::bigint is null or e.secao_id = $3) group by 1, 2 order by 1, 2`,
      [f.de, f.ate, nul(f.secaoId)],
    );
    return {
      linhas,
      agrupar: ['secao'],
      colunas: [col('secao', 'Seção'), col('exame', 'Exame'), col('exames', 'Exames', 'inteiro', true), col('em_atraso', 'Em atraso', 'inteiro', true), col('liberados_fora_prazo', 'Liberados após a previsão', 'inteiro', true), col('horas_coleta_liberacao', 'Horas coleta→liberação (média)', 'decimal'), col('prazo_horas', 'Prazo de liberação (h)', 'inteiro')],
    };
  },
});

// ---------------------------------------------------------------------------
// Materiais, entradas e inutilizações do laboratório (TR 1.2.47.40.4, 1.2.47.41.5 a 1.2.47.41.8, 1.2.47.42.5)
// ---------------------------------------------------------------------------
const baseEstoque = { modulo: 'LAB', permissao: 'produto:consultar' };

registrarRelatorio({
  ...baseEstoque,
  id: 'lab-necessidade-materiais',
  grupo: 'Materiais',
  titulo: 'Necessidade de materiais (estoque ideal e mínimo por unidade)',
  tr: ['1.2.47.40.4', '1.2.47.40.9'],
  filtros: [UNIDADE, { nome: 'somenteAbaixo', rotulo: 'Somente abaixo do mínimo', tipo: 'booleano' }],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, p.nome material, coalesce(pu.estoque_minimo, p.estoque_minimo, 0) minimo, coalesce(pu.estoque_ideal, 0) ideal,
              coalesce((select sum(l.quantidade) from far.estoque_lote l where l.produto_id = p.id and l.unidade_id = u.id and not l.bloqueado and l.validade >= current_date), 0) saldo,
              concat_ws(' / ', pu.local, pu.sala, pu.estante, pu.prateleira) armazenamento
         from far.produto_unidade pu join far.produto p on p.id = pu.produto_id and p.tipo = 'LABORATORIO' and p.ativo join cad.unidade u on u.id = pu.unidade_id
        where ($1::bigint is null or u.id = $1) order by 1, 2`,
      [nul(f.unidadeId)],
    );
    const out = linhas
      .map((l) => ({ ...l, necessidade: Math.max(0, Number(l.ideal || l.minimo) - Number(l.saldo)), situacao: Number(l.saldo) < Number(l.minimo) ? 'ABAIXO DO MÍNIMO' : 'OK' }))
      .filter((l) => !(f.somenteAbaixo === true || f.somenteAbaixo === 'true') || l.situacao !== 'OK');
    return {
      linhas: out,
      agrupar: ['unidade'],
      colunas: [col('unidade', 'Unidade'), col('material', 'Material'), col('armazenamento', 'Local / sala / estante / prateleira'), col('minimo', 'Mínimo', 'decimal'), col('ideal', 'Ideal', 'decimal'), col('saldo', 'Saldo', 'decimal'), col('necessidade', 'Necessidade', 'decimal', true), col('situacao', 'Situação')],
    };
  },
});

const entradas = `from far.entrada e join far.entrada_item i on i.entrada_id = e.id join far.produto p on p.id = i.produto_id and p.tipo = 'LABORATORIO'
  join cad.unidade u on u.id = e.unidade_id left join far.fornecedor f on f.id = e.fornecedor_id left join far.grupo_produto g on g.id = p.grupo_id
 where e.situacao = 'CONFIRMADA' and e.data_entrada between $1 and $2 and ($3::bigint is null or e.unidade_id = $3)`;
for (const [id, titulo, campo, expr, tr] of [
  ['lab-entradas-unidade', 'Entradas de materiais com custos por unidade', 'unidade', 'u.nome', '1.2.47.41.5'],
  ['lab-entradas-grupo', 'Entradas de materiais com custos por grupo de produto', 'grupo', `coalesce(g.nome, 'Sem grupo')`, '1.2.47.41.6'],
  ['lab-entradas-fornecedor', 'Entradas de materiais com custos por fornecedor', 'fornecedor', `coalesce(f.nome, 'Sem fornecedor')`, '1.2.47.41.7'],
  ['lab-entradas-periodo', 'Entradas de materiais com custos por período (mês)', 'periodo', `to_char(e.data_entrada, 'YYYY-MM')`, '1.2.47.41.8'],
] as const)
  registrarRelatorio({
    ...baseEstoque,
    permissao: 'entrada:exportar',
    id,
    grupo: 'Entradas',
    titulo,
    tr: [tr],
    filtros: [...PERIODO, UNIDADE],
    async gerar(f) {
      const linhas = await consultar(
        `select ${expr} ${campo}, p.nome material, sum(i.quantidade) quantidade, avg(coalesce(i.valor_unitario, 0)) custo_medio, sum(i.quantidade * coalesce(i.valor_unitario, 0)) total
           ${entradas} group by 1, 2 order by 1, 2`,
        [f.de, f.ate, nul(f.unidadeId)],
      );
      return {
        linhas,
        agrupar: [campo],
        grafico: { tipo: 'barra', x: campo, y: 'total' },
        colunas: [col(campo, campo === 'periodo' ? 'Período' : campo[0].toUpperCase() + campo.slice(1)), col('material', 'Material'), col('quantidade', 'Quantidade', 'decimal', true), col('custo_medio', 'Custo médio', 'moeda'), col('total', 'Custo total', 'moeda', true)],
      };
    },
  });

registrarRelatorio({
  ...baseEstoque,
  permissao: 'inutilizacao:exportar',
  id: 'lab-inutilizacoes',
  grupo: 'Inutilizações',
  titulo: 'Inutilizações de materiais por unidade, grupo e motivo',
  tr: ['1.2.47.42.5'],
  filtros: [...PERIODO, UNIDADE, { nome: 'todos', rotulo: 'Incluir produtos de outros setores', tipo: 'booleano' }],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, coalesce(g.nome, 'Sem grupo') grupo, m.nome motivo, i.data::text data, p.nome produto, l.lote, l.validade::text validade, i.quantidade, i.valor_total
         from far.inutilizacao i join far.produto p on p.id = i.produto_id join far.estoque_lote l on l.id = i.lote_id join cad.unidade u on u.id = i.unidade_id
         join far.motivo_inutilizacao m on m.id = i.motivo_id left join far.grupo_produto g on g.id = p.grupo_id
        where i.data between $1 and $2 and ($3::bigint is null or i.unidade_id = $3) and ($4::boolean or p.tipo = 'LABORATORIO') order by 1, 2, 3, 4`,
      [f.de, f.ate, nul(f.unidadeId), f.todos === true || f.todos === 'true'],
    );
    return {
      linhas,
      agrupar: ['unidade', 'grupo', 'motivo'],
      colunas: [col('unidade', 'Unidade'), col('grupo', 'Grupo'), col('motivo', 'Motivo'), col('data', 'Data', 'data'), col('produto', 'Produto'), col('lote', 'Lote'), col('validade', 'Validade', 'data'), col('quantidade', 'Quantidade', 'decimal', true), col('valor_total', 'Valor total', 'moeda', true)],
    };
  },
});

// ---------------------------------------------------------------------------
// Interfaceamento e controle de qualidade
// ---------------------------------------------------------------------------
registrarRelatorio({
  modulo: 'INT',
  permissao: 'int_controle:exportar',
  id: 'int-controle-qualidade',
  grupo: 'Controle de qualidade',
  titulo: 'Controle interno de qualidade (Westgard)',
  tr: ['1.2.48.3'],
  filtros: [...PERIODO, { nome: 'equipamentoId', rotulo: 'Equipamento', tipo: 'ref', ref: 'int_equipamento' }],
  async gerar(f) {
    const linhas = await consultar(
      `select eq.nome equipamento, c.nome || ' (' || c.nivel || ')' controle, r.data_hora::date::text data, r.valor, c.media, c.desvio_padrao, r.desvios, coalesce(r.violacoes, '-') violacoes, r.situacao, r.origem
         from lab.cq_resultado r join lab.cq_controle c on c.id = r.controle_id join lab.equipamento eq on eq.id = c.equipamento_id
        where r.data_hora::date between $1 and $2 and ($3::bigint is null or eq.id = $3) order by 1, 2, r.data_hora`,
      [f.de, f.ate, nul(f.equipamentoId)],
    );
    return {
      linhas,
      agrupar: ['equipamento', 'controle'],
      orientacao: 'landscape',
      colunas: [col('equipamento', 'Equipamento'), col('controle', 'Controle'), col('data', 'Data', 'data'), col('valor', 'Valor', 'decimal'), col('media', 'Média', 'decimal'), col('desvio_padrao', 'DP', 'decimal'), col('desvios', 'z', 'decimal'), col('violacoes', 'Regras violadas'), col('situacao', 'Situação'), col('origem', 'Origem')],
    };
  },
});

registrarRelatorio({
  modulo: 'INT',
  permissao: 'int_mensagem:exportar',
  id: 'int-mensagens',
  grupo: 'Comunicação',
  titulo: 'Mensagens trocadas com os equipamentos',
  tr: ['1.2.48.10'],
  filtros: [...PERIODO, { nome: 'equipamentoId', rotulo: 'Equipamento', tipo: 'ref', ref: 'int_equipamento' }],
  async gerar(f) {
    const linhas = await consultar(
      `select eq.nome equipamento, m.direcao, m.situacao, count(*)::int mensagens, coalesce(sum(m.resultados), 0)::int resultados
         from lab.interface_mensagem m join lab.equipamento eq on eq.id = m.equipamento_id
        where m.data_hora::date between $1 and $2 and ($3::bigint is null or eq.id = $3) group by 1, 2, 3 order by 1, 2, 3`,
      [f.de, f.ate, nul(f.equipamentoId)],
    );
    return { linhas, agrupar: ['equipamento'], colunas: [col('equipamento', 'Equipamento'), col('direcao', 'Direção'), col('situacao', 'Situação'), col('mensagens', 'Mensagens', 'inteiro', true), col('resultados', 'Resultados importados', 'inteiro', true)] };
  },
});
