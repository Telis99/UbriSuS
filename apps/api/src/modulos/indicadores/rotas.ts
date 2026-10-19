// Indicadores de gestão da saúde: painéis gráficos e contadores por período (TR 1.2.14.1 a 1.2.14.24).
import type { FastifyInstance } from 'fastify';
import { consultar, consultarUm } from '../../db/pool.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { ErroHttp, exigirPermissao } from '../../seguranca/usuario.js';
import './relatorios.js';

registrarPermissao('indicadores', 'Painéis de indicadores de gestão', 'IND', ['consultar', 'exportar']);

const anoAtual = () => new Date().getFullYear();
const n = (v: unknown) => (v === undefined || v === '' || v === null ? null : Number(v));
const lista = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map((x) => Number(x))
    .filter(Boolean);

// Consultas: médicas = especialidades não odontológicas; odontológicas = especialidades de odontologia (TR 1.2.14.6, 1.2.14.7).
const ODONTO = `(cad.fn_normalizar(coalesce(e.nome, '')) like '%ODONTO%' or cad.fn_normalizar(coalesce(e.nome, '')) like '%DENTI%')`;

const SERIES: Record<string, string> = {
  dispensacoes: `select extract(year from d.data_hora)::int ano, extract(month from d.data_hora)::int mes, sum(di.quantidade)::numeric total
                   from far.dispensacao d join far.dispensacao_item di on di.dispensacao_id = d.id
                  where d.situacao = 'EFETIVADA' and extract(year from d.data_hora) between $1 and $2 and ($3::bigint is null or d.unidade_id = $3) group by 1,2`,
  atendimentos_farmacia: `select extract(year from d.data_hora)::int ano, extract(month from d.data_hora)::int mes, count(*)::numeric total from far.dispensacao d
                  where d.situacao = 'EFETIVADA' and extract(year from d.data_hora) between $1 and $2 and ($3::bigint is null or d.unidade_id = $3) group by 1,2`,
  consultas_medicas: `select extract(year from a.data)::int ano, extract(month from a.data)::int mes, count(*)::numeric total from age.agendamento a left join cad.especialidade e on e.id = a.especialidade_id
                  where a.tipo in ('CONSULTA','RETORNO','AVALIACAO','TELECONSULTA') and not ${ODONTO} and a.situacao not in ('CANCELADO','TRANSFERIDO')
                    and extract(year from a.data) between $1 and $2 and ($3::bigint is null or a.unidade_id = $3) group by 1,2`,
  consultas_odonto: `select extract(year from a.data)::int ano, extract(month from a.data)::int mes, count(*)::numeric total from age.agendamento a left join cad.especialidade e on e.id = a.especialidade_id
                  where a.tipo in ('CONSULTA','RETORNO','AVALIACAO') and ${ODONTO} and a.situacao not in ('CANCELADO','TRANSFERIDO')
                    and extract(year from a.data) between $1 and $2 and ($3::bigint is null or a.unidade_id = $3) group by 1,2`,
};

export default async function rotasIndicadores(app: FastifyInstance) {
  // Séries mensais por ano para comparação entre os meses (TR 1.2.14.1, 1.2.14.2, 1.2.14.6, 1.2.14.7).
  app.get('/api/indicadores/serie/:tipo', async (req) => {
    exigirPermissao(req, 'indicadores:consultar');
    const sql = SERIES[(req.params as any).tipo];
    if (!sql) throw new ErroHttp(404, 'Indicador inexistente.');
    const q = req.query as any;
    return consultar(`${sql} order by 1,2`, [n(q.anoInicial) ?? anoAtual() - 2, n(q.anoFinal) ?? anoAtual(), n(q.unidadeId)]);
  });

  // Quantidade dispensada de produtos escolhidos por ano (TR 1.2.14.3).
  app.get('/api/indicadores/produtos-anual', async (req) => {
    exigirPermissao(req, 'indicadores:consultar');
    const q = req.query as any;
    const ids = lista(q.produtos);
    return consultar(
      `select pr.nome || coalesce(' ' || pr.concentracao, '') produto, extract(year from d.data_hora)::int ano, sum(di.quantidade)::numeric total
         from far.dispensacao d join far.dispensacao_item di on di.dispensacao_id = d.id join far.produto pr on pr.id = di.produto_id
        where d.situacao = 'EFETIVADA' and extract(year from d.data_hora) between $1 and $2 and ($4::bigint is null or d.unidade_id = $4)
          and pr.id = any(case when cardinality($3::bigint[]) > 0 then $3::bigint[] else array(
                select di2.produto_id from far.dispensacao_item di2 join far.dispensacao d2 on d2.id = di2.dispensacao_id
                 where d2.situacao = 'EFETIVADA' and extract(year from d2.data_hora) between $1 and $2 group by 1 order by sum(di2.quantidade) desc limit 5) end)
        group by 1,2 order by 1,2`,
      [n(q.anoInicial) ?? anoAtual() - 2, n(q.anoFinal) ?? anoAtual(), ids, n(q.unidadeId)],
    );
  });

  // Produtos com maior demanda reprimida e maior movimentação na competência (TR 1.2.14.4, 1.2.14.5).
  app.get('/api/indicadores/demanda-reprimida', async (req) => {
    exigirPermissao(req, 'indicadores:consultar');
    const q = req.query as any;
    return consultar(
      `select pr.nome produto, sum(dr.quantidade - dr.quantidade_atendida)::numeric reprimida from far.demanda_reprimida dr join far.produto pr on pr.id = dr.produto_id
        where to_char(dr.data, 'YYYYMM') = $1 and dr.situacao in ('ABERTA','PARCIAL') group by 1 order by 2 desc limit $2`,
      [q.competencia ?? new Date().toISOString().slice(0, 7).replace('-', ''), n(q.limite) ?? 10],
    );
  });
  app.get('/api/indicadores/movimentacao', async (req) => {
    exigirPermissao(req, 'indicadores:consultar');
    const q = req.query as any;
    return consultar(
      `select pr.nome produto,
              coalesce(sum(m.quantidade) filter (where m.quantidade > 0), 0)::numeric entradas,
              coalesce(-sum(m.quantidade) filter (where m.quantidade < 0), 0)::numeric saidas,
              coalesce((select sum(dr.quantidade - dr.quantidade_atendida) from far.demanda_reprimida dr where dr.produto_id = pr.id and to_char(dr.data, 'YYYYMM') = $1), 0)::numeric demanda
         from far.movimento_estoque m join far.produto pr on pr.id = m.produto_id
        where to_char(m.data_hora, 'YYYYMM') = $1 and ($3::bigint is null or m.unidade_id = $3)
        group by pr.id order by coalesce(-sum(m.quantidade) filter (where m.quantidade < 0), 0) + coalesce(sum(m.quantidade) filter (where m.quantidade > 0), 0) desc limit $2`,
      [q.competencia ?? new Date().toISOString().slice(0, 7).replace('-', ''), n(q.limite) ?? 10, n(q.unidadeId)],
    );
  });

  // Dias necessários para conseguir vaga por especialidade, eletiva e urgência (TR 1.2.14.8).
  app.get('/api/indicadores/dias-agendamento', async (req) => {
    exigirPermissao(req, 'indicadores:consultar');
    return consultar(
      `select e.nome especialidade,
              (select min(h.data) - current_date from age.horario h join age.agenda a on a.id = h.agenda_id where a.especialidade_id = e.id and a.ativo and h.situacao = 'LIVRE' and h.tipo_vaga = 'ELETIVA' and h.data >= current_date) eletiva,
              (select min(h.data) - current_date from age.horario h join age.agenda a on a.id = h.agenda_id where a.especialidade_id = e.id and a.ativo and h.situacao = 'LIVRE' and h.tipo_vaga = 'URGENCIA' and h.data >= current_date) urgencia
         from cad.especialidade e where exists (select 1 from age.agenda a where a.especialidade_id = e.id and a.ativo) order by 1`,
    );
  });

  // Pacientes cadastrados por faixa etária (TR 1.2.14.9).
  app.get('/api/indicadores/pacientes-faixa', async (req) => {
    exigirPermissao(req, 'indicadores:consultar');
    return consultar(
      `select faixa, count(*)::int pacientes, count(*) filter (where sexo = 'F')::int feminino, count(*) filter (where sexo = 'M')::int masculino from (
         select sexo, case when a < 1 then '00 < 1 ano' when a < 5 then '01 1-4' when a < 10 then '02 5-9' when a < 15 then '03 10-14' when a < 20 then '04 15-19'
                           when a < 30 then '05 20-29' when a < 40 then '06 30-39' when a < 50 then '07 40-49' when a < 60 then '08 50-59' when a < 70 then '09 60-69'
                           when a < 80 then '10 70-79' else '11 80+' end faixa
           from (select sexo, extract(year from age(data_nascimento)) a from cad.pessoa where situacao in ('ATIVO','PRE_CADASTRO') and data_nascimento is not null
                   and not exists (select 1 from cad.profissional pf where pf.pessoa_id = cad.pessoa.id)) x) y
       group by faixa order by faixa`,
    ).then((r) => r.map((x) => ({ ...x, faixa: x.faixa.slice(3) })));
  });

  // Cobertura vacinal por ano e imunobiológico: vacinados com a dose do esquema sobre a população na faixa etária (TR 1.2.14.10).
  app.get('/api/indicadores/cobertura-vacinal', async (req) => {
    exigirPermissao(req, 'indicadores:consultar');
    const q = req.query as any;
    const ids = lista(q.imunobiologicos);
    return consultar(
      `with esquema as (
         select q.imunobiologico_id, i.sigla, max(q.dose_id) filter (where q.proxima_dose_id is null) dose_final,
                min(q.idade_minima_dias) idade_min, max(coalesce(q.idade_maxima_dias, 36500)) idade_max
           from imu.quadro_cobertura q join imu.imunobiologico i on i.id = q.imunobiologico_id
          where q.estrategia = 'ROTINA' and q.faixa_carteira = 'CRIANCA' and (cardinality($3::bigint[]) = 0 or q.imunobiologico_id = any($3))
          group by 1,2
       ), anos as (select generate_series($1::int, $2::int) ano)
       select a.ano, e.sigla,
              (select count(distinct v.paciente_id) from imu.vacinacao v where v.imunobiologico_id = e.imunobiologico_id and v.dose_id = e.dose_final and v.tipo in ('APLICACAO','RESGATE')
                  and extract(year from v.data) = a.ano)::int vacinados,
              (select count(*) from cad.pessoa p where p.data_nascimento is not null and p.situacao <> 'FALECIDO'
                  and (make_date(a.ano, 12, 31) - p.data_nascimento) between e.idade_min and e.idade_min + 365)::int populacao
         from anos a cross join esquema e order by 1, 2`,
      [n(q.anoInicial) ?? anoAtual() - 2, n(q.anoFinal) ?? anoAtual(), ids],
    ).then((r) => r.map((x) => ({ ...x, cobertura: x.populacao ? Math.min(100, Math.round((1000 * x.vacinados) / x.populacao) / 10) : null })));
  });

  // Contadores do período (TR 1.2.14.15 a 1.2.14.24).
  app.get('/api/indicadores/contadores', async (req) => {
    exigirPermissao(req, 'indicadores:consultar');
    const q = req.query as any;
    const de = q.de ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const ate = q.ate ?? new Date().toISOString().slice(0, 10);
    const un = n(q.unidadeId);
    const consultas = (atencao: string, situacoes: string) =>
      `(select count(*) from age.agendamento a join cad.especialidade e on e.id = a.especialidade_id
         where e.atencao = '${atencao}' and a.situacao in (${situacoes}) and a.data between $1 and $2 and ($3::bigint is null or a.unidade_id = $3))::int`;
    const tabelaExiste = async (t: string) => !!(await consultarUm(`select to_regclass($1) r`, [t]))?.r;
    const r = await consultarUm(
      `select ${consultas('BASICA', `'REALIZADO','ATENDIDO','PRESENTE'`)} consultas_basica,
              ${consultas('BASICA', `'FALTA'`)} perdidas_basica,
              ${consultas('ESPECIALIZADA', `'REALIZADO','ATENDIDO','PRESENTE'`)} consultas_especializada,
              ${consultas('ESPECIALIZADA', `'FALTA'`)} perdidas_especializada,
              (select count(*) from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id
                where (pr.codigo like '030105%' or p.origem = 'DOMICILIAR') and p.data between $1 and $2 and ($3::bigint is null or p.unidade_id = $3))::int atendimentos_domiciliares,
              (select coalesce(sum(p.quantidade), 0) from fat.producao p where p.origem = 'VISITA_ACS' and p.data between $1 and $2 and ($3::bigint is null or p.unidade_id = $3))::int visitas_acs,
              (select coalesce(sum(p.quantidade), 0) from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id
                where (pr.codigo like '0307%' or pr.codigo like '01010200%' or pr.codigo like '0414%' or p.origem = 'ODONTOLOGIA') and p.data between $1 and $2 and ($3::bigint is null or p.unidade_id = $3))::int procedimentos_odontologicos,
              (select coalesce(sum(p.quantidade), 0) from fat.producao p
                where (p.cbo_codigo like '2235%' or p.cbo_codigo like '3222%') and p.data between $1 and $2 and ($3::bigint is null or p.unidade_id = $3))::int procedimentos_enfermagem,
              (select count(*) from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id
                where s.data between $1 and $2 and ($3::bigint is null or s.unidade_id = $3))::int exames_solicitados,
              (select count(*) from imu.vacinacao v where v.tipo = 'APLICACAO' and v.data between $1 and $2 and ($3::bigint is null or v.unidade_id = $3))::int vacinas_aplicadas`,
      [de, ate, un],
    );
    // Visitas registradas no aplicativo do ACS, quando o módulo estiver instalado.
    if (await tabelaExiste('acs.visita')) {
      const v = await consultarUm(`select count(*)::int n from acs.visita where data_hora::date between $1 and $2`, [de, ate]).catch(() => null);
      if (v) r.visitas_acs += v.n;
    }
    return { de, ate, ...r };
  });
}
