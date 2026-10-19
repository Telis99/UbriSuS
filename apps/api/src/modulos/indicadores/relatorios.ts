// Relatórios gerenciais de cadastro e agendamento (TR 1.2.14.11 a 1.2.14.14).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';

const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const ANOS: FiltroRelatorio[] = [
  { nome: 'anoInicial', rotulo: 'Ano inicial', tipo: 'inteiro', obrigatorio: true, padrao: new Date().getFullYear() - 1 },
  { nome: 'anoFinal', rotulo: 'Ano final', tipo: 'inteiro', obrigatorio: true, padrao: new Date().getFullYear() },
];
const base = { modulo: 'IND', permissao: 'indicadores:exportar' };

registrarRelatorio({
  ...base,
  id: 'ind-cadastramento',
  grupo: 'Cadastro da população',
  titulo: 'Índice de cadastramento e atualização cadastral',
  tr: ['1.2.14.11'],
  filtros: ANOS,
  async gerar(f) {
    const linhas = await consultar(
      `with anos as (select generate_series($1::int, $2::int) ano)
       select a.ano::text ano,
              (select count(*) from cad.pessoa p where extract(year from p.criado_em) = a.ano)::int novos,
              (select count(*) from cad.pessoa p where extract(year from p.cadastro_atualizado_em) = a.ano)::int atualizados,
              (select count(*) from cad.pessoa p where p.criado_em < make_date(a.ano + 1, 1, 1) and p.situacao <> 'FALECIDO')::int base,
              (select count(*) from cad.pessoa p where p.criado_em < make_date(a.ano + 1, 1, 1) and p.cns is not null)::int com_cns
         from anos a order by 1`,
      [Number(f.anoInicial), Number(f.anoFinal)],
    );
    for (const l of linhas) {
      l.perc_atualizado = l.base ? Math.round((1000 * l.atualizados) / l.base) / 10 : 0;
      l.perc_cns = l.base ? Math.round((1000 * l.com_cns) / l.base) / 10 : 0;
    }
    return {
      linhas,
      grafico: { tipo: 'barra', x: 'ano', y: 'novos', titulo: 'Novos cadastros' },
      colunas: [col('ano', 'Ano'), col('novos', 'Novos cadastros', 'inteiro', true), col('atualizados', 'Cadastros atualizados', 'inteiro', true), col('base', 'População cadastrada', 'inteiro'), col('perc_atualizado', '% atualizado', 'percentual'), col('perc_cns', '% com CNS', 'percentual')],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'ind-evolucao-agendamentos',
  grupo: 'Agendamentos',
  titulo: 'Evolução dos agendamentos de consultas',
  tr: ['1.2.14.12'],
  filtros: ANOS,
  async gerar(f) {
    const linhas = await consultar(
      `select extract(year from a.data)::int::text ano, to_char(a.data, 'MM/YYYY') competencia, count(*)::int agendados,
              count(*) filter (where a.situacao in ('REALIZADO','ATENDIDO','PRESENTE'))::int atendidos,
              count(*) filter (where a.situacao in ('FALTA','ATRASO'))::int faltosos,
              count(*) filter (where a.situacao = 'NAO_ATENDIDO')::int nao_atendidos,
              count(*) filter (where a.situacao in ('AGENDADO','CONFIRMADO') and a.data < current_date)::int nao_registrados
         from age.agendamento a where a.tipo in ('CONSULTA','RETORNO','AVALIACAO','TELECONSULTA') and a.situacao not in ('CANCELADO','TRANSFERIDO')
          and extract(year from a.data) between $1 and $2 group by 1, 2, date_trunc('month', a.data) order by date_trunc('month', a.data)`,
      [Number(f.anoInicial), Number(f.anoFinal)],
    );
    let anterior: number | null = null;
    for (const l of linhas) {
      l.evolucao = anterior ? Math.round((1000 * (l.agendados - anterior)) / anterior) / 10 : null;
      l.perc_atendidos = l.agendados ? Math.round((1000 * l.atendidos) / l.agendados) / 10 : 0;
      anterior = l.agendados;
    }
    return {
      linhas,
      agrupar: ['ano'],
      grafico: { tipo: 'linha', x: 'competencia', y: 'agendados' },
      orientacao: 'landscape',
      colunas: [col('ano', 'Ano'), col('competencia', 'Competência'), col('agendados', 'Agendamentos', 'inteiro', true), col('evolucao', '% evolução', 'percentual'), col('atendidos', 'Atendidos', 'inteiro', true), col('perc_atendidos', '% atendidos', 'percentual'), col('faltosos', 'Faltosos', 'inteiro', true), col('nao_atendidos', 'Não atendidos', 'inteiro', true), col('nao_registrados', 'Não registrados', 'inteiro', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'ind-agendamentos-bairro',
  grupo: 'Agendamentos',
  titulo: 'Agendamentos por bairro (sintético)',
  tr: ['1.2.14.13'],
  filtros: PERIODO,
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(b.nome, 'Não informado') bairro, count(*) filter (where a.tipo in ('CONSULTA','TELECONSULTA'))::int consultas,
              count(*) filter (where a.tipo = 'RETORNO')::int retornos, count(*) filter (where a.tipo = 'AVALIACAO')::int avaliacoes, count(*)::int total
         from age.agendamento a join cad.pessoa p on p.id = a.paciente_id left join cad.bairro b on b.id = p.bairro_id
        where a.tipo in ('CONSULTA','RETORNO','AVALIACAO','TELECONSULTA') and a.situacao not in ('CANCELADO','TRANSFERIDO') and a.data between $1 and $2
        group by 1 order by 5 desc`,
      [f.de, f.ate],
    );
    return { linhas, colunas: [col('bairro', 'Bairro'), col('consultas', 'Consultas', 'inteiro', true), col('retornos', 'Retornos', 'inteiro', true), col('avaliacoes', 'Avaliações', 'inteiro', true), col('total', 'Total', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'ind-agendamentos-faixa-sexo',
  grupo: 'Agendamentos',
  titulo: 'Agendamentos de consultas por faixa etária e sexo',
  tr: ['1.2.14.14'],
  filtros: PERIODO,
  async gerar(f) {
    const linhas = await consultar(
      `select faixa, sexo, count(*) filter (where tipo in ('CONSULTA','TELECONSULTA'))::int consultas, count(*) filter (where tipo = 'RETORNO')::int retornos,
              count(*) filter (where tipo = 'AVALIACAO')::int avaliacoes, count(*)::int total
         from (select a.tipo, case p.sexo when 'F' then 'Feminino' when 'M' then 'Masculino' else 'Ignorado' end sexo,
                      case when x.i < 10 then '00-09' when x.i < 20 then '10-19' when x.i < 40 then '20-39' when x.i < 60 then '40-59' else '60+' end faixa
                 from age.agendamento a join cad.pessoa p on p.id = a.paciente_id cross join lateral (select extract(year from age(a.data, p.data_nascimento))::int i) x
                where a.tipo in ('CONSULTA','RETORNO','AVALIACAO','TELECONSULTA') and a.situacao not in ('CANCELADO','TRANSFERIDO') and a.data between $1 and $2) y
        group by 1,2 order by 1,2`,
      [f.de, f.ate],
    );
    return {
      linhas,
      agrupar: ['faixa'],
      grafico: { tipo: 'barra', x: 'faixa', y: 'total', serie: 'sexo' },
      colunas: [col('faixa', 'Faixa etária'), col('sexo', 'Sexo'), col('consultas', 'Consultas', 'inteiro', true), col('retornos', 'Retornos', 'inteiro', true), col('avaliacoes', 'Avaliações', 'inteiro', true), col('total', 'Total', 'inteiro', true)],
    };
  },
});
