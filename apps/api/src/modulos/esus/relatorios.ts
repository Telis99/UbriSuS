// Relatórios do e-SUS AB: inscrições das ações programáticas, eventos e prazos, benefícios concedidos e
// reuniões de equipes (TR 1.2.36.5 a 1.2.36.9.4, 1.2.36.13).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';

const base = { modulo: 'ESUS', permissao: 'esus_inscricao:exportar' };
const ACAO: FiltroRelatorio = { nome: 'acaoId', rotulo: 'Ação programática', tipo: 'ref', ref: 'esus_acao' };
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);

registrarRelatorio({
  ...base,
  id: 'esus-inscricoes',
  grupo: 'Ações programáticas',
  titulo: 'Inscritos por ação programática e situação',
  tr: ['1.2.36.5', '1.2.36.6', '1.2.36.7', '1.2.36.8', '1.2.36.9'],
  filtros: [ACAO, { nome: 'situacao', rotulo: 'Situação', tipo: 'opcao', opcoes: [['ATIVO', 'Ativo'], ['DESISTENTE', 'Desistente'], ['DESLIGADO', 'Desligado']] }],
  async gerar(f) {
    const linhas = await consultar(
      `select a.nome acao, pa.nome cidadao, pa.cns, i.data_inicial::text inicio, i.data_final::text fim, case when i.recebe_beneficio then 'Sim' else 'Não' end beneficio, i.situacao,
              (select count(*)::int from esus.inscricao_evento e where e.inscricao_id = i.id and e.situacao = 'REALIZADO') realizados,
              (select count(*)::int from esus.inscricao_evento e where e.inscricao_id = i.id and e.situacao = 'PREVISTO' and e.prazo_limite < current_date) atrasados
         from esus.inscricao i join esus.acao_programatica a on a.id = i.acao_id join cad.pessoa pa on pa.id = i.paciente_id
        where ($1::bigint is null or i.acao_id = $1) and ($2::text is null or i.situacao = $2) order by 1, 2`,
      [nul(f.acaoId), nul(f.situacao)],
    );
    return {
      linhas,
      agrupar: ['acao'],
      colunas: [
        { campo: 'acao', titulo: 'Ação' },
        { campo: 'cidadao', titulo: 'Cidadão' },
        { campo: 'cns', titulo: 'CNS' },
        { campo: 'inicio', titulo: 'Data inicial', formato: 'data' },
        { campo: 'fim', titulo: 'Data final', formato: 'data' },
        { campo: 'beneficio', titulo: 'Benefício' },
        { campo: 'situacao', titulo: 'Situação' },
        { campo: 'realizados', titulo: 'Eventos realizados', formato: 'inteiro', total: true },
        { campo: 'atrasados', titulo: 'Eventos com prazo vencido', formato: 'inteiro', total: true },
      ],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'esus-eventos-prazos',
  grupo: 'Ações programáticas',
  titulo: 'Eventos previstos, frequência e prazos',
  tr: ['1.2.36.9.2', '1.2.36.9.3', '1.2.36.9.4'],
  filtros: [...PERIODO, ACAO, { nome: 'situacao', rotulo: 'Situação', tipo: 'opcao', opcoes: [['PREVISTO', 'Previsto'], ['REALIZADO', 'Realizado'], ['FALTOU', 'Não compareceu']] }],
  async gerar(f) {
    const linhas = await consultar(
      `select a.nome acao, pa.nome cidadao, e.nome evento, e.frequencia_dias, e.data_prevista::text prevista, e.prazo_limite::text prazo, e.data_realizacao::text realizacao,
              case when e.situacao = 'PREVISTO' and e.prazo_limite < current_date then 'PRAZO VENCIDO' else e.situacao end situacao
         from esus.inscricao_evento e join esus.inscricao i on i.id = e.inscricao_id join esus.acao_programatica a on a.id = i.acao_id join cad.pessoa pa on pa.id = i.paciente_id
        where e.data_prevista between $1 and $2 and ($3::bigint is null or i.acao_id = $3) and ($4::text is null or e.situacao = $4) order by 1, e.data_prevista, 2`,
      [f.de, f.ate, nul(f.acaoId), nul(f.situacao)],
    );
    return {
      linhas,
      agrupar: ['acao'],
      colunas: [
        { campo: 'acao', titulo: 'Ação' },
        { campo: 'cidadao', titulo: 'Cidadão' },
        { campo: 'evento', titulo: 'Evento' },
        { campo: 'frequencia_dias', titulo: 'Frequência (dias)', formato: 'inteiro' },
        { campo: 'prevista', titulo: 'Previsto', formato: 'data' },
        { campo: 'prazo', titulo: 'Prazo', formato: 'data' },
        { campo: 'realizacao', titulo: 'Realizado', formato: 'data' },
        { campo: 'situacao', titulo: 'Situação' },
      ],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'esus-beneficios',
  grupo: 'Ações programáticas',
  titulo: 'Benefícios concedidos',
  tr: ['1.2.36.9.1'],
  filtros: [...PERIODO, ACAO],
  async gerar(f) {
    const linhas = await consultar(
      `select a.nome acao, coalesce(b.descricao, '-') beneficio, pa.nome cidadao, b.data::text data, b.quantidade, b.proxima_concessao::text proxima
         from esus.inscricao_beneficio b join esus.inscricao i on i.id = b.inscricao_id join esus.acao_programatica a on a.id = i.acao_id join cad.pessoa pa on pa.id = i.paciente_id
        where b.data between $1 and $2 and ($3::bigint is null or i.acao_id = $3) order by 1, 2, b.data`,
      [f.de, f.ate, nul(f.acaoId)],
    );
    return {
      linhas,
      agrupar: ['acao', 'beneficio'],
      colunas: [
        { campo: 'acao', titulo: 'Ação' },
        { campo: 'beneficio', titulo: 'Benefício' },
        { campo: 'cidadao', titulo: 'Cidadão' },
        { campo: 'data', titulo: 'Concedido em', formato: 'data' },
        { campo: 'quantidade', titulo: 'Quantidade', formato: 'decimal', total: true },
        { campo: 'proxima', titulo: 'Próxima concessão', formato: 'data' },
      ],
    };
  },
});

registrarRelatorio({
  ...base,
  permissao: 'esus_reuniao:exportar',
  id: 'esus-reunioes',
  grupo: 'Equipes',
  titulo: 'Reuniões de equipes multiprofissionais',
  tr: ['1.2.36.13'],
  filtros: [...PERIODO, { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, r.data::text data, to_char(r.hora_inicio, 'HH24:MI') hora, coalesce(r.equipe, '-') equipe, r.situacao, coalesce(jsonb_array_length(r.participantes), 0) participantes, left(coalesce(r.pauta, ''), 200) pauta
         from esus.reuniao r join cad.unidade u on u.id = r.unidade_id where r.data between $1 and $2 and ($3::bigint is null or r.unidade_id = $3) order by 1, 2`,
      [f.de, f.ate, nul(f.unidadeId)],
    );
    return {
      linhas,
      agrupar: ['unidade'],
      colunas: [
        { campo: 'unidade', titulo: 'Unidade' },
        { campo: 'data', titulo: 'Data', formato: 'data' },
        { campo: 'hora', titulo: 'Hora' },
        { campo: 'equipe', titulo: 'Equipe' },
        { campo: 'situacao', titulo: 'Situação' },
        { campo: 'participantes', titulo: 'Participantes', formato: 'inteiro', total: true },
        { campo: 'pauta', titulo: 'Pauta' },
      ],
    };
  },
});
