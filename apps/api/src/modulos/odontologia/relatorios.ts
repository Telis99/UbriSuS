// Relatórios do prontuário odontológico: procedimentos executados, produção SIGTAP, índices
// CPO-D / ceo-d, tratamentos iniciados x concluídos, vigilância em saúde bucal e materiais fornecidos.
import { consultar, pool } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';
import { MATERIAIS_ODONTO, VIGILANCIA_SAUDE_BUCAL } from './entidades.js';
import { estadoOdontograma, indicesCpo, marcacoesPaciente } from './servico.js';

const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);
const UNIDADE: FiltroRelatorio = { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' };
const PROFISSIONAL: FiltroRelatorio = { nome: 'profissionalId', rotulo: 'Profissional', tipo: 'ref', ref: 'profissional' };
const ANALITICO: FiltroRelatorio = { nome: 'analitico', rotulo: 'Analítico', tipo: 'booleano', padrao: false };
const base = { modulo: 'ODO', permissao: 'odo_marcacao:exportar' };
const analitico = (f: Record<string, any>) => f.analitico === true || f.analitico === 'true';

registrarRelatorio({
  ...base,
  grupo: 'Produção',
  id: 'odo-procedimentos',
  titulo: 'Procedimentos odontológicos executados',
  filtros: [...PERIODO, UNIDADE, PROFISSIONAL, ANALITICO],
  async gerar(f) {
    const where = `m.status = 'EXECUTADO' and m.executado_em::date between $1 and $2 and ($3::bigint is null or m.unidade_id = $3) and ($4::bigint is null or m.executado_profissional_id = $4)`;
    const params = [f.de, f.ate, nul(f.unidadeId), nul(f.profissionalId)];
    if (analitico(f)) {
      const linhas = await consultar(
        `select u.nome unidade, pr.nome profissional, m.executado_em::date::text data, p.nome paciente, po.nome procedimento,
                coalesce('Dente ' || m.dente || coalesce(' (' || array_to_string(m.faces, '') || ')', ''), initcap(lower(m.marcacao))) elemento
           from odo.marcacao m join odo.procedimento po on po.id = m.procedimento_odonto_id join cad.pessoa p on p.id = m.paciente_id
           left join cad.unidade u on u.id = m.unidade_id left join cad.profissional pr on pr.id = m.executado_profissional_id where ${where} order by 1,2,3`,
        params,
      );
      return { linhas, agrupar: ['unidade', 'profissional'], orientacao: 'landscape', colunas: [col('unidade', 'Unidade'), col('profissional', 'Profissional'), col('data', 'Data', 'data'), col('paciente', 'Paciente'), col('procedimento', 'Procedimento'), col('elemento', 'Dente / região')] };
    }
    const linhas = await consultar(
      `select u.nome unidade, po.nome procedimento, count(*)::int quantidade, count(distinct m.paciente_id)::int pacientes
         from odo.marcacao m join odo.procedimento po on po.id = m.procedimento_odonto_id left join cad.unidade u on u.id = m.unidade_id
        where ${where} group by 1,2 order by 1,3 desc`,
      params,
    );
    return { linhas, agrupar: ['unidade'], grafico: { tipo: 'barra', x: 'procedimento', y: 'quantidade' }, colunas: [col('unidade', 'Unidade'), col('procedimento', 'Procedimento'), col('quantidade', 'Executados', 'inteiro', true), col('pacientes', 'Pacientes', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  grupo: 'Produção',
  id: 'odo-producao-sigtap',
  titulo: 'Produção odontológica por procedimento SIGTAP (BPA)',
  filtros: [...PERIODO, UNIDADE, PROFISSIONAL],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, pc.codigo, pc.nome procedimento, sum(fp.quantidade)::int quantidade,
              count(*) filter (where fp.situacao = 'CRITICA')::int criticas, sum(fp.valor)::numeric(15,2) valor
         from fat.producao fp join cad.procedimento pc on pc.id = fp.procedimento_id join cad.unidade u on u.id = fp.unidade_id
        where fp.origem = 'ODONTOLOGIA' and fp.data between $1 and $2 and ($3::bigint is null or fp.unidade_id = $3) and ($4::bigint is null or fp.profissional_id = $4)
        group by 1,2,3 order by 1,2`,
      [f.de, f.ate, nul(f.unidadeId), nul(f.profissionalId)],
    );
    return {
      linhas,
      agrupar: ['unidade'],
      colunas: [col('unidade', 'Unidade'), col('codigo', 'Código'), col('procedimento', 'Procedimento'), col('quantidade', 'Quantidade', 'inteiro', true), col('criticas', 'Com crítica', 'inteiro', true), col('valor', 'Valor (R$)', 'moeda', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  grupo: 'Epidemiologia',
  id: 'odo-cpod',
  titulo: 'Índices CPO-D e ceo-d dos pacientes atendidos',
  filtros: [...PERIODO, UNIDADE],
  async gerar(f) {
    const pacientes = await consultar(
      `select distinct p.id, p.nome, p.data_nascimento::text nascimento, extract(year from age(p.data_nascimento))::int idade, u.nome unidade
         from amb.atendimento a join cad.pessoa p on p.id = a.paciente_id join cad.unidade u on u.id = a.unidade_id
        where a.tipo_unidade = 'ODONTOLOGIA' and a.entrada_em::date between $1 and $2 and ($3::bigint is null or a.unidade_id = $3) and a.situacao in ('FINALIZADO','EM_ATENDIMENTO')
        order by p.nome limit 2000`,
      [f.de, f.ate, nul(f.unidadeId)],
    );
    const linhas = [];
    for (const p of pacientes) {
      const ind = indicesCpo(estadoOdontograma(await marcacoesPaciente(pool, p.id)));
      linhas.push({ ...p, c: ind.cpod.C, pp: ind.cpod.P, o: ind.cpod.O, cpod: ind.cpod.total, ceod: ind.ceod.total });
    }
    return {
      linhas,
      agrupar: ['unidade'],
      colunas: [col('unidade', 'Unidade'), col('nome', 'Paciente'), col('idade', 'Idade', 'inteiro'), col('c', 'C', 'inteiro', true), col('pp', 'P', 'inteiro', true), col('o', 'O', 'inteiro', true), col('cpod', 'CPO-D', 'inteiro', true), col('ceod', 'ceo-d', 'inteiro', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  grupo: 'Indicadores',
  id: 'odo-tratamentos',
  titulo: 'Primeiras consultas programáticas x tratamentos concluídos',
  filtros: [...PERIODO, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade,
              count(*) filter (where p.primeira_consulta and p.data_inicio between $1 and $2)::int primeiras,
              count(*) filter (where p.situacao = 'CONCLUIDO' and p.data_conclusao between $1 and $2)::int concluidos,
              count(*) filter (where p.situacao = 'INTERROMPIDO' and p.data_conclusao between $1 and $2)::int interrompidos,
              count(*) filter (where p.situacao = 'EM_ANDAMENTO')::int em_andamento
         from odo.plano_tratamento p join cad.unidade u on u.id = p.unidade_id where ($3::bigint is null or p.unidade_id = $3) group by 1 order by 1`,
      [f.de, f.ate, nul(f.unidadeId)],
    );
    for (const l of linhas) l.razao = l.primeiras ? Math.round((l.concluidos / l.primeiras) * 1000) / 10 : null;
    return {
      linhas,
      grafico: { tipo: 'barra', x: 'unidade', y: 'concluidos' },
      colunas: [col('unidade', 'Unidade'), col('primeiras', 'Primeiras consultas', 'inteiro', true), col('concluidos', 'Tratamentos concluídos', 'inteiro', true), col('interrompidos', 'Interrompidos', 'inteiro', true), col('em_andamento', 'Em andamento', 'inteiro', true), col('razao', 'Concluídos / iniciados (%)', 'decimal')],
    };
  },
});

registrarRelatorio({
  ...base,
  grupo: 'Epidemiologia',
  id: 'odo-vigilancia',
  titulo: 'Vigilância em saúde bucal',
  filtros: [...PERIODO, UNIDADE],
  async gerar(f) {
    const linhas = (
      await consultar(
        `select u.nome unidade, v condicao, count(*)::int atendimentos from amb.atendimento a cross join lateral unnest(a.saude_bucal) v join cad.unidade u on u.id = a.unidade_id
          where a.entrada_em::date between $1 and $2 and ($3::bigint is null or a.unidade_id = $3) group by 1,2 order by 1,3 desc`,
        [f.de, f.ate, nul(f.unidadeId)],
      )
    ).map((l) => ({ ...l, condicao: VIGILANCIA_SAUDE_BUCAL.find(([k]) => k === l.condicao)?.[1] ?? l.condicao }));
    return { linhas, agrupar: ['unidade'], grafico: { tipo: 'barra', x: 'condicao', y: 'atendimentos' }, colunas: [col('unidade', 'Unidade'), col('condicao', 'Condição'), col('atendimentos', 'Atendimentos', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  grupo: 'Produção',
  id: 'odo-materiais',
  titulo: 'Fornecimento de material odontológico',
  filtros: [...PERIODO, UNIDADE],
  async gerar(f) {
    const linhas = (
      await consultar(
        `select u.nome unidade, m.key material, sum(m.value::int)::int quantidade, count(distinct a.paciente_id)::int pacientes
           from amb.atendimento a cross join lateral jsonb_each_text(a.material_odonto) m join cad.unidade u on u.id = a.unidade_id
          where a.material_odonto is not null and a.entrada_em::date between $1 and $2 and ($3::bigint is null or a.unidade_id = $3) group by 1,2 order by 1,2`,
        [f.de, f.ate, nul(f.unidadeId)],
      )
    ).map((l) => ({ ...l, material: MATERIAIS_ODONTO.find(([k]) => k === l.material)?.[1] ?? l.material }));
    return { linhas, agrupar: ['unidade'], colunas: [col('unidade', 'Unidade'), col('material', 'Material'), col('quantidade', 'Quantidade', 'inteiro', true), col('pacientes', 'Pacientes', 'inteiro', true)] };
  },
});
