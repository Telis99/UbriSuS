// Relatórios comuns à Radiologia e à Ecografia: produção analítica e sintética por unidade do prestador,
// agendamentos, faltosos, resultados não retirados e laudos pendentes.
import { consultar, transacao } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';
import { nomes, SITUACAO_LAUDO, type ConfigImagem } from './imagem.js';
import { sincronizarAgenda } from './imagem-servico.js';

export type ChaveRelatorio = 'analitico' | 'sintetico' | 'agendamentos' | 'faltosos' | 'naoRetirados' | 'pendentes';

const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);

export function registrarRelatoriosImagem(cfg: ConfigImagem, tr: Record<ChaveRelatorio, { tr: string[] }>) {
  const n = nomes(cfg);
  const s = cfg.esquema;
  const UNIDADE: FiltroRelatorio = { nome: 'unidadeId', rotulo: 'Unidade do prestador', tipo: 'ref', ref: 'unidade' };
  const EXAME: FiltroRelatorio = { nome: 'exameId', rotulo: 'Exame', tipo: 'ref', ref: n.exame };
  const SOLICITANTE: FiltroRelatorio = { nome: 'unidadeSolicitanteId', rotulo: 'Unidade solicitante', tipo: 'ref', ref: 'unidade' };
  const base = { modulo: cfg.sigla, permissao: `${n.atendimento}:exportar` };
  const juncoes = `from ${s}.atendimento t join ${s}.exame e on e.id = t.exame_id join cad.pessoa p on p.id = t.paciente_id
    left join cad.procedimento pr on pr.id = t.procedimento_id left join cad.unidade up on up.id = t.unidade_id
    left join cad.unidade us on us.id = t.unidade_solicitante_id left join cad.profissional pt on pt.id = t.tecnico_id
    left join cad.profissional pa on pa.id = t.assinante_id`;
  const filtro = `t.data between $1 and $2 and ($3::bigint is null or t.unidade_id = $3) and ($4::bigint is null or t.exame_id = $4) and ($5::bigint is null or t.unidade_solicitante_id = $5)`;
  const params = (f: Record<string, any>) => [f.de, f.ate, nul(f.unidadeId), nul(f.exameId), nul(f.unidadeSolicitanteId)];
  const laudo = `case t.situacao_laudo ${SITUACAO_LAUDO.map(([k, v]) => `when '${k}' then '${v}'`).join(' ')} end`;

  registrarRelatorio({
    ...base,
    grupo: 'Produção',
    id: `${s}-producao-analitico`,
    titulo: `Produção analítica por unidade do prestador - ${cfg.titulo}`,
    tr: tr.analitico.tr,
    filtros: [...PERIODO, UNIDADE, EXAME, SOLICITANTE],
    async gerar(f) {
      const linhas = await consultar(
        `select coalesce(up.nome, '-') unidade, t.data::text data, p.nome paciente, pr.codigo, coalesce(e.nome, pr.nome) exame, t.estrutura, us.nome solicitante,
                pt.nome executante, pa.nome assinante, ${laudo} laudo, ${cfg.execucaoRadiologica ? 'coalesce(t.filmes_quantidade, 0)' : '0'}::int filmes,
                coalesce(e.valor, pr.valor_municipal, pr.valor_sa, 0)::numeric valor
           ${juncoes} where t.situacao = 'REALIZADO' and ${filtro} order by 1, 2, 3`,
        params(f),
      );
      const colunas = [
        col('unidade', 'Unidade do prestador'),
        col('data', 'Data', 'data'),
        col('paciente', 'Paciente'),
        col('codigo', 'SIGTAP'),
        col('exame', 'Exame'),
        col('estrutura', 'Estrutura/órgão'),
        col('solicitante', 'Unidade solicitante'),
        col('executante', 'Executante'),
        col('assinante', 'Laudo assinado por'),
        col('laudo', 'Status do laudo'),
        ...(cfg.execucaoRadiologica ? [col('filmes', 'Filmes', 'inteiro', true)] : []),
        col('valor', 'Valor', 'moeda', true),
      ];
      return { linhas, agrupar: ['unidade'], orientacao: 'landscape', colunas };
    },
  });

  registrarRelatorio({
    ...base,
    grupo: 'Produção',
    id: `${s}-producao-sintetico`,
    titulo: `Produção sintética por unidade do prestador - ${cfg.titulo}`,
    tr: tr.sintetico.tr,
    filtros: [...PERIODO, UNIDADE, EXAME, SOLICITANTE],
    async gerar(f) {
      const linhas = await consultar(
        `select coalesce(up.nome, '-') unidade, pr.codigo, coalesce(e.nome, pr.nome) exame, count(*)::int realizados,
                count(*) filter (where t.situacao_laudo in ('ASSINADO','ANEXADO','IMPRESSO'))::int laudos_liberados,
                count(*) filter (where t.situacao_entrega = 'RETIRADO')::int retirados,
                ${cfg.execucaoRadiologica ? 'coalesce(sum(t.filmes_quantidade), 0)' : '0'}::int filmes,
                sum(coalesce(e.valor, pr.valor_municipal, pr.valor_sa, 0))::numeric valor
           ${juncoes} where t.situacao = 'REALIZADO' and ${filtro} group by 1, 2, 3 order by 1, 3`,
        params(f),
      );
      return {
        linhas,
        agrupar: ['unidade'],
        grafico: { tipo: 'barra', x: 'exame', y: 'realizados' },
        colunas: [
          col('unidade', 'Unidade do prestador'),
          col('codigo', 'SIGTAP'),
          col('exame', 'Exame'),
          col('realizados', 'Realizados', 'inteiro', true),
          col('laudos_liberados', 'Laudos liberados', 'inteiro', true),
          col('retirados', 'Resultados retirados', 'inteiro', true),
          ...(cfg.execucaoRadiologica ? [col('filmes', 'Filmes', 'inteiro', true)] : []),
          col('valor', 'Valor', 'moeda', true),
        ],
      };
    },
  });

  registrarRelatorio({
    ...base,
    grupo: 'Agendamentos',
    id: `${s}-agendamentos-sintetico`,
    titulo: `Agendamentos de exames de ${cfg.exame}s (sintético)`,
    tr: tr.agendamentos.tr,
    filtros: [...PERIODO, UNIDADE, EXAME, SOLICITANTE],
    async gerar(f) {
      await transacao({ rotina: `${s}:sincronizar` }, (c) => sincronizarAgenda(c, cfg, f.de, f.ate));
      const linhas = await consultar(
        `select coalesce(up.nome, '-') unidade, coalesce(e.nome, pr.nome) exame, count(*)::int total,
                count(*) filter (where t.agendamento_id is not null)::int agendados, count(*) filter (where t.agendamento_id is null)::int sem_agendamento,
                count(*) filter (where t.situacao = 'REALIZADO')::int realizados, count(*) filter (where t.situacao = 'FALTOSO')::int faltosos,
                count(*) filter (where t.situacao = 'CANCELADO')::int cancelados, count(*) filter (where t.situacao in ('AGENDADO','PRESENTE'))::int aguardando,
                round(100.0 * count(*) filter (where t.situacao = 'FALTOSO') / nullif(count(*) filter (where t.situacao <> 'CANCELADO'), 0), 1)::numeric perc_falta
           ${juncoes} where ${filtro} group by 1, 2 order by 1, 2`,
        params(f),
      );
      return {
        linhas,
        agrupar: ['unidade'],
        grafico: { tipo: 'barra', x: 'exame', y: 'agendados' },
        colunas: [
          col('unidade', 'Unidade do prestador'),
          col('exame', 'Exame'),
          col('agendados', 'Agendados', 'inteiro', true),
          col('sem_agendamento', 'Sem agendamento', 'inteiro', true),
          col('realizados', 'Realizados', 'inteiro', true),
          col('faltosos', 'Faltosos', 'inteiro', true),
          col('cancelados', 'Cancelados', 'inteiro', true),
          col('aguardando', 'Aguardando', 'inteiro', true),
          col('perc_falta', '% faltas', 'decimal'),
        ],
      };
    },
  });

  registrarRelatorio({
    ...base,
    grupo: 'Recepção',
    id: `${s}-faltosos`,
    titulo: `Pacientes faltosos - ${cfg.titulo}`,
    tr: tr.faltosos.tr,
    filtros: [...PERIODO, UNIDADE, EXAME, SOLICITANTE],
    async gerar(f) {
      const linhas = await consultar(
        `select coalesce(up.nome, '-') unidade, t.data::text data, p.nome paciente, p.cns, coalesce(e.nome, pr.nome) exame, us.nome solicitante, t.requisicao, t.falta_motivo motivo
           ${juncoes} where t.situacao = 'FALTOSO' and ${filtro} order by 1, 2, 3`,
        params(f),
      );
      return {
        linhas,
        agrupar: ['unidade'],
        colunas: [col('unidade', 'Unidade'), col('data', 'Data', 'data'), col('paciente', 'Paciente'), col('cns', 'CNS'), col('exame', 'Exame'), col('solicitante', 'Unidade solicitante'), col('requisicao', 'Requisição'), col('motivo', 'Motivo')],
      };
    },
  });

  registrarRelatorio({
    ...base,
    grupo: 'Entrega de resultados',
    id: `${s}-nao-retirados`,
    titulo: `Resultados não retirados - ${cfg.titulo}`,
    tr: tr.naoRetirados.tr,
    filtros: [...PERIODO, UNIDADE, EXAME, SOLICITANTE, { nome: 'diasMinimos', rotulo: 'Liberados há pelo menos (dias)', tipo: 'inteiro', padrao: 0 }],
    async gerar(f) {
      const linhas = await consultar(
        `select coalesce(up.nome, '-') unidade, t.data::text data, p.nome paciente, p.cns, coalesce(e.nome, pr.nome) exame, us.nome solicitante,
                coalesce(t.assinado_em, t.anexado_em)::date::text liberado, (current_date - coalesce(t.assinado_em, t.anexado_em)::date)::int dias,
                case t.situacao_entrega when 'NAO_RETIRADO' then 'Não retirado (registrado)' else 'Aguardando retirada' end situacao, t.nao_retirado_motivo motivo
           ${juncoes} where t.situacao_laudo in ('ASSINADO','ANEXADO','IMPRESSO') and t.situacao_entrega in ('PENDENTE','NAO_RETIRADO') and ${filtro}
            and coalesce(t.assinado_em, t.anexado_em) <= now() - make_interval(days => $6::int) order by 1, 2, 3`,
        [...params(f), Number(f.diasMinimos ?? 0) || 0],
      );
      return {
        linhas,
        agrupar: ['unidade'],
        orientacao: 'landscape',
        colunas: [
          col('unidade', 'Unidade'),
          col('data', 'Exame em', 'data'),
          col('paciente', 'Paciente'),
          col('cns', 'CNS'),
          col('exame', 'Exame'),
          col('solicitante', 'Unidade solicitante'),
          col('liberado', 'Liberado em', 'data'),
          col('dias', 'Dias', 'inteiro'),
          col('situacao', 'Situação'),
          col('motivo', 'Observação'),
        ],
      };
    },
  });

  registrarRelatorio({
    ...base,
    grupo: 'Laudos',
    id: `${s}-laudos-status`,
    titulo: `Laudos por status e profissional - ${cfg.titulo}`,
    tr: tr.pendentes.tr,
    filtros: [...PERIODO, UNIDADE, EXAME, SOLICITANTE],
    async gerar(f) {
      const linhas = await consultar(
        `select ${laudo} status, coalesce(pa.nome, pl.nome, '(sem laudista)') profissional, count(*)::int exames,
                round(avg(extract(epoch from (coalesce(t.assinado_em, t.anexado_em) - t.executado_em)) / 3600)::numeric, 1) horas_liberacao
           ${juncoes} left join cad.profissional pl on pl.id = t.laudista_id where t.situacao = 'REALIZADO' and ${filtro} group by 1, 2 order by 1, 2`,
        params(f),
      );
      return {
        linhas,
        agrupar: ['status'],
        grafico: { tipo: 'barra', x: 'status', y: 'exames' },
        colunas: [col('status', 'Status do laudo'), col('profissional', 'Profissional'), col('exames', 'Exames', 'inteiro', true), col('horas_liberacao', 'Tempo médio até liberação (h)', 'decimal')],
      };
    },
  });
}
