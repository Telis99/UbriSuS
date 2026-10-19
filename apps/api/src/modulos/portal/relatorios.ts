// Relatórios do atendimento remoto: uso do aplicativo do cidadão.
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio } from '../../servicos/catalogo.js';

registrarRelatorio({
  id: 'app-agendamentos',
  modulo: 'APP',
  grupo: 'Aplicativo do cidadão',
  titulo: 'Agendamentos e cancelamentos pelo aplicativo',
  permissao: 'portal_conta:exportar',
  tr: ['1.2.41.7.11'],
  filtros: [...PERIODO, { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(e.nome, 'Exames / outros') especialidade, u.nome unidade,
              count(*) filter (where ev.evento in ('AGENDAMENTO','SOLICITACAO'))::int agendados,
              count(*) filter (where ev.evento = 'CANCELAMENTO')::int cancelados,
              count(*) filter (where ev.evento = 'TRANSFERENCIA')::int transferidos,
              count(*) filter (where ev.evento = 'RECUSA')::int recusados
         from portal.evento_agendamento ev join age.agendamento a on a.id = ev.agendamento_id
         left join cad.especialidade e on e.id = a.especialidade_id left join cad.unidade u on u.id = a.unidade_id
        where ev.data_hora::date between $1 and $2 and ($3::bigint is null or a.unidade_id = $3)
        group by 1, 2 order by 1, 2`,
      [f.de, f.ate, f.unidadeId ?? null],
    );
    return {
      linhas,
      grafico: { tipo: 'barra', x: 'especialidade', y: 'agendados' },
      colunas: [
        { campo: 'especialidade', titulo: 'Especialidade' },
        { campo: 'unidade', titulo: 'Unidade' },
        { campo: 'agendados', titulo: 'Agendados', formato: 'inteiro', total: true },
        { campo: 'cancelados', titulo: 'Cancelados', formato: 'inteiro', total: true },
        { campo: 'transferidos', titulo: 'Transferidos', formato: 'inteiro', total: true },
        { campo: 'recusados', titulo: 'Recusados pela unidade', formato: 'inteiro', total: true },
      ],
    };
  },
});

registrarRelatorio({
  id: 'app-contas',
  modulo: 'APP',
  grupo: 'Aplicativo do cidadão',
  titulo: 'Contas do aplicativo por unidade e situação',
  permissao: 'portal_conta:exportar',
  tr: ['1.2.41.3'],
  filtros: [{ nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(u.nome, '(sem unidade)') unidade,
              count(*) filter (where c.situacao = 'SOLICITADA')::int solicitadas, count(*) filter (where c.situacao = 'ATIVA')::int ativas,
              count(*) filter (where c.situacao = 'BLOQUEADA')::int bloqueadas, count(*) filter (where c.situacao = 'RECUSADA')::int recusadas,
              count(*) filter (where c.ultimo_acesso_em >= now() - interval '30 days')::int acessaram_30_dias
         from portal.conta c left join cad.unidade u on u.id = c.unidade_id
        where ($1::bigint is null or c.unidade_id = $1) group by 1 order by 1`,
      [f.unidadeId ?? null],
    );
    return {
      linhas,
      grafico: { tipo: 'barra', x: 'unidade', y: 'ativas' },
      colunas: [
        { campo: 'unidade', titulo: 'Unidade' },
        { campo: 'solicitadas', titulo: 'Aguardando liberação', formato: 'inteiro', total: true },
        { campo: 'ativas', titulo: 'Liberadas', formato: 'inteiro', total: true },
        { campo: 'bloqueadas', titulo: 'Bloqueadas', formato: 'inteiro', total: true },
        { campo: 'recusadas', titulo: 'Recusadas', formato: 'inteiro', total: true },
        { campo: 'acessaram_30_dias', titulo: 'Acessaram nos últimos 30 dias', formato: 'inteiro', total: true },
      ],
    };
  },
});
