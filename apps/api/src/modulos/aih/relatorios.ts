// Relatórios de laudos de internação e de AIHs autorizadas (TR 1.2.37.17.1 a 1.2.37.17.16).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';
import { CARATER_ATENDIMENTO } from '../cadastros/opcoes.js';
import { SITUACAO_LAUDO } from './opcoes.js';

const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);
const base = { modulo: 'AIH', permissao: 'aih_laudo:exportar' };
const SOLICITANTE: FiltroRelatorio = { nome: 'unidadeSolicitanteId', rotulo: 'Unidade solicitante', tipo: 'ref', ref: 'unidade' };
const EXECUTANTE: FiltroRelatorio = { nome: 'unidadeExecutanteId', rotulo: 'Unidade executante', tipo: 'ref', ref: 'unidade' };
const SITUACAO: FiltroRelatorio = { nome: 'situacao', rotulo: 'Situação', tipo: 'opcao', opcoes: SITUACAO_LAUDO };
const caraterSql = `case l.carater ${CARATER_ATENDIMENTO.map(([k, v]) => `when '${k}' then '${v.replace(/'/g, "''")}'`).join(' ')} end`;
const situacaoSql = `case l.situacao ${SITUACAO_LAUDO.map(([k, v]) => `when '${k}' then '${v.split(' (')[0]}'`).join(' ')} end`;

const juncoes = `from aih.laudo l join cad.pessoa pa on pa.id = l.paciente_id join cad.procedimento pr on pr.id = l.procedimento_id
  left join cad.unidade us on us.id = l.unidade_solicitante_id left join cad.unidade ue on ue.id = l.unidade_executante_id
  left join cad.profissional ps on ps.id = l.profissional_solicitante_id left join cad.profissional pe on pe.id = coalesce(l.profissional_executante_id, l.profissional_solicitante_id)
  left join cad.cid cp on cp.id = l.cid_principal_id
  left join cad.municipio mu on mu.id = coalesce(us.municipio_id, pa.municipio_id) left join cad.bairro b on b.id = pa.bairro_id left join cad.logradouro lg on lg.id = pa.logradouro_id`;

const camposLaudo = `coalesce(us.nome, '-') unidade_solicitante, coalesce(ue.nome, 'Não definida') unidade_executante, coalesce(ps.nome, '-') profissional_solicitante,
  coalesce(pe.nome, '-') profissional_executante, coalesce(mu.nome || '/' || mu.uf_sigla, '-') municipio, pa.nome paciente, l.data_hora::date::text emissao,
  ${caraterSql} carater, coalesce(l.prontuario, pa.prontuario) prontuario, pr.codigo || ' - ' || pr.nome procedimento, coalesce(l.valor_total, 0) valor,
  coalesce(cp.codigo, '-') cid, ${situacaoSql} situacao`;

/** Filtros e parâmetros comuns: período pela data de emissão (laudos) ou de autorização (AIHs). */
function filtro(f: Record<string, any>, campoData: 'l.data_hora' | 'l.autorizado_em') {
  const params = [f.de, f.ate, nul(f.unidadeSolicitanteId), nul(f.unidadeExecutanteId), nul(f.situacao)];
  const sql = `${campoData}::date between $1 and $2 and ($3::bigint is null or l.unidade_solicitante_id = $3) and ($4::bigint is null or l.unidade_executante_id = $4)
    and ($5::text is null or l.situacao = $5)${campoData === 'l.autorizado_em' ? ' and l.numero_aih is not null' : ''}`;
  return { sql, params };
}

const colunasLaudo = (grupo: Coluna[]): Coluna[] => [
  ...grupo,
  col('paciente', 'Paciente'),
  col('emissao', 'Emissão', 'data'),
  col('carater', 'Caráter'),
  col('prontuario', 'Prontuário'),
  col('procedimento', 'Procedimento'),
  col('valor', 'Valor', 'moeda', true),
  col('cid', 'CID'),
  col('situacao', 'Situação'),
];

// Relatórios analíticos de laudos de internação (TR 1.2.37.17.1 a 1.2.37.17.5).
const analiticosLaudo: [string, string, string, string[], Coluna[], string][] = [
  ['aih-laudos-unidade-solicitante', 'Laudos de internação por unidade solicitante', '1.2.37.17.1', ['unidade_solicitante', 'unidade_executante'], [col('unidade_solicitante', 'Unidade solicitante'), col('unidade_executante', 'Unidade executante')], '1, 2, 7'],
  ['aih-laudos-unidade-executante', 'Laudos de internação por unidade executante', '1.2.37.17.2', ['unidade_executante'], [col('unidade_executante', 'Unidade executante')], '2, 7'],
  ['aih-laudos-profissional-solicitante', 'Laudos de internação por profissional solicitante', '1.2.37.17.3', ['profissional_solicitante', 'unidade_executante'], [col('profissional_solicitante', 'Profissional solicitante'), col('unidade_executante', 'Unidade executante')], '3, 2, 7'],
  ['aih-laudos-profissional-executante', 'Laudos de internação por profissional executante', '1.2.37.17.4', ['profissional_executante', 'unidade_executante'], [col('profissional_executante', 'Profissional executante'), col('unidade_executante', 'Unidade executante')], '4, 2, 7'],
  ['aih-laudos-municipio-analitico', 'Laudos de internação por município solicitante (analítico)', '1.2.37.17.5', ['municipio', 'unidade_executante'], [col('municipio', 'Município solicitante'), col('unidade_executante', 'Unidade executante')], '5, 2, 7'],
];
for (const [id, titulo, tr, agrupar, grupo, ordem] of analiticosLaudo) {
  registrarRelatorio({
    ...base,
    id,
    grupo: 'Laudos de internação',
    titulo,
    tr: [tr],
    filtros: [...PERIODO, SOLICITANTE, EXECUTANTE, SITUACAO],
    async gerar(f) {
      const { sql, params } = filtro(f, 'l.data_hora');
      const linhas = await consultar(`select ${camposLaudo} ${juncoes} where ${sql} order by ${ordem}, 6`, params);
      return { linhas, agrupar, orientacao: 'landscape', colunas: colunasLaudo(grupo) };
    },
  });
}

// Relatórios sintéticos de laudos (TR 1.2.37.17.6 a 1.2.37.17.8).
const sinteticosLaudo: [string, string, string, string, string, string][] = [
  ['aih-laudos-municipio-sintetico', 'Laudos de internação por município solicitante (sintético)', '1.2.37.17.6', `coalesce(mu.nome || '/' || mu.uf_sigla, '-')`, 'municipio', 'Município'],
  ['aih-laudos-data-sintetico', 'Laudos de internação por data da solicitação (sintético)', '1.2.37.17.7', `l.data_hora::date::text`, 'data', 'Data da solicitação'],
  ['aih-laudos-cid-sintetico', 'Laudos de internação por CID (sintético)', '1.2.37.17.8', `coalesce(cp.codigo || ' - ' || cp.nome, '-')`, 'cid', 'CID-10'],
];
for (const [id, titulo, tr, expr, campo, rotulo] of sinteticosLaudo) {
  registrarRelatorio({
    ...base,
    id,
    grupo: 'Laudos de internação',
    titulo,
    tr: [tr],
    filtros: [...PERIODO, SOLICITANTE, EXECUTANTE, SITUACAO],
    async gerar(f) {
      const { sql, params } = filtro(f, 'l.data_hora');
      const linhas = await consultar(`select ${expr} ${campo}, count(*)::int procedimentos, coalesce(sum(l.valor_total), 0) valor ${juncoes} where ${sql} group by 1 order by 1`, params);
      return {
        linhas,
        grafico: { tipo: 'barra', x: campo, y: 'procedimentos' },
        colunas: [col(campo, rotulo, campo === 'data' ? 'data' : undefined), col('procedimentos', 'Qtd. de procedimentos', 'inteiro', true), col('valor', 'Valor', 'moeda', true)],
      };
    },
  });
}

// AIHs autorizadas (TR 1.2.37.17.9 a 1.2.37.17.13).
const camposAih = `coalesce(us.nome, '-') unidade_solicitante, coalesce(ue.nome, 'Não definida') unidade_executante, coalesce(ps.nome, '-') profissional_solicitante,
  coalesce(pe.nome, '-') profissional_executante, coalesce(mu.nome || '/' || mu.uf_sigla, '-') municipio, pa.nome paciente, l.autorizado_em::date::text autorizacao,
  ${caraterSql} carater, coalesce(l.prontuario, pa.prontuario) prontuario, pr.codigo || ' - ' || pr.nome procedimento, coalesce(l.valor_sh, 0) valor_sh, coalesce(l.valor_sp, 0) valor_sp,
  coalesce(cp.codigo, '-') cid, l.numero_aih`;
const colunasAih = (grupo: Coluna[]): Coluna[] => [
  ...grupo,
  col('paciente', 'Paciente'),
  col('autorizacao', 'Autorização', 'data'),
  col('carater', 'Caráter'),
  col('prontuario', 'Prontuário'),
  col('procedimento', 'Procedimento'),
  col('valor_sh', 'Valor hospitalar', 'moeda', true),
  col('valor_sp', 'Valor profissional', 'moeda', true),
  col('cid', 'CID'),
  col('numero_aih', 'Nº AIH'),
];
const analiticosAih: [string, string, string, string[], Coluna[], string][] = [
  ['aih-aihs-unidade-solicitante', 'AIHs por unidade solicitante', '1.2.37.17.9', ['unidade_solicitante', 'unidade_executante'], [col('unidade_solicitante', 'Unidade solicitante'), col('unidade_executante', 'Unidade executante')], '1, 2, 7'],
  ['aih-aihs-unidade-executante', 'AIHs por unidade executante', '1.2.37.17.10', ['unidade_executante', 'unidade_solicitante'], [col('unidade_executante', 'Unidade executante'), col('unidade_solicitante', 'Unidade solicitante')], '2, 1, 7'],
  ['aih-aihs-profissional-solicitante', 'AIHs por profissional solicitante', '1.2.37.17.11', ['profissional_solicitante', 'unidade_executante'], [col('profissional_solicitante', 'Profissional solicitante'), col('unidade_executante', 'Unidade executante')], '3, 2, 7'],
  ['aih-aihs-profissional-executante', 'AIHs por profissional executante', '1.2.37.17.12', ['profissional_executante', 'unidade_solicitante'], [col('profissional_executante', 'Profissional executante'), col('unidade_solicitante', 'Unidade solicitante')], '4, 1, 7'],
  ['aih-aihs-municipio-analitico', 'AIHs por município solicitante (analítico)', '1.2.37.17.13', ['municipio', 'unidade_executante'], [col('municipio', 'Município solicitante'), col('unidade_executante', 'Unidade executante')], '5, 2, 7'],
];
for (const [id, titulo, tr, agrupar, grupo, ordem] of analiticosAih) {
  registrarRelatorio({
    ...base,
    id,
    grupo: 'AIHs autorizadas',
    titulo,
    tr: [tr],
    filtros: [...PERIODO, SOLICITANTE, EXECUTANTE],
    async gerar(f) {
      const { sql, params } = filtro(f, 'l.autorizado_em');
      const linhas = await consultar(`select ${camposAih} ${juncoes} where ${sql} order by ${ordem}, 6`, params);
      return { linhas, agrupar, orientacao: 'landscape', colunas: colunasAih(grupo) };
    },
  });
}

registrarRelatorio({
  ...base,
  id: 'aih-aihs-municipio-sintetico',
  grupo: 'AIHs autorizadas',
  titulo: 'AIHs por município solicitante (sintético)',
  tr: ['1.2.37.17.14'],
  filtros: [...PERIODO, SOLICITANTE, EXECUTANTE],
  async gerar(f) {
    const { sql, params } = filtro(f, 'l.autorizado_em');
    const linhas = await consultar(
      `select coalesce(mu.nome || '/' || mu.uf_sigla, '-') municipio, count(*)::int procedimentos, coalesce(sum(l.valor_sh), 0) valor_sh, coalesce(sum(l.valor_sp), 0) valor_sp
         ${juncoes} where ${sql} group by 1 order by 1`,
      params,
    );
    return {
      linhas,
      grafico: { tipo: 'barra', x: 'municipio', y: 'procedimentos' },
      colunas: [col('municipio', 'Município'), col('procedimentos', 'Qtd. de procedimentos', 'inteiro', true), col('valor_sh', 'Valor hospitalar', 'moeda', true), col('valor_sp', 'Valor profissional', 'moeda', true)],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'aih-aihs-cid-sintetico',
  grupo: 'AIHs autorizadas',
  titulo: 'AIHs por CID (sintético)',
  tr: ['1.2.37.17.15'],
  filtros: [...PERIODO, SOLICITANTE, EXECUTANTE],
  async gerar(f) {
    const { sql, params } = filtro(f, 'l.autorizado_em');
    const linhas = await consultar(
      `select coalesce(ue.nome, 'Não definida') unidade_executante, coalesce(cp.codigo || ' - ' || cp.nome, '-') cid, count(*)::int procedimentos ${juncoes} where ${sql} group by 1, 2 order by 1, 3 desc`,
      params,
    );
    return { linhas, agrupar: ['unidade_executante'], colunas: [col('unidade_executante', 'Unidade executante'), col('cid', 'CID-10'), col('procedimentos', 'Qtd. de procedimentos', 'inteiro', true)] };
  },
});

registrarRelatorio({
  ...base,
  id: 'aih-aihs-bairro',
  grupo: 'AIHs autorizadas',
  titulo: 'AIHs por bairro (analítico)',
  tr: ['1.2.37.17.16'],
  filtros: [...PERIODO, SOLICITANTE, EXECUTANTE, { nome: 'bairroId', rotulo: 'Bairro', tipo: 'ref', ref: 'bairro' }],
  async gerar(f) {
    const { sql, params } = filtro(f, 'l.autorizado_em');
    const linhas = await consultar(
      `select coalesce(ue.nome, 'Não definida') unidade_executante, coalesce(b.nome, 'Sem bairro') bairro, pa.nome paciente,
              trim(coalesce(lg.nome, '') || ' ' || coalesce(pa.numero, '') || ' ' || coalesce(pa.complemento, '')) endereco, coalesce(cp.codigo, '-') cid,
              pr.codigo || ' - ' || pr.nome procedimento, l.numero_aih, pa.data_nascimento::text nascimento, coalesce(l.data_internacao, l.autorizado_em::date)::text internacao
         ${juncoes} where ${sql} and ($6::bigint is null or pa.bairro_id = $6) order by 1, 2, 3`,
      [...params, nul(f.bairroId)],
    );
    return {
      linhas,
      agrupar: ['unidade_executante', 'bairro'],
      orientacao: 'landscape',
      colunas: [
        col('unidade_executante', 'Unidade executante'),
        col('bairro', 'Bairro'),
        col('paciente', 'Paciente'),
        col('endereco', 'Endereço'),
        col('cid', 'CID'),
        col('procedimento', 'Procedimento'),
        col('numero_aih', 'Nº AIH'),
        col('nascimento', 'Nascimento', 'data'),
        col('internacao', 'Internação', 'data'),
      ],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'aih-pagas',
  grupo: 'AIHs autorizadas',
  titulo: 'AIHs pagas e pendentes de pagamento',
  tr: ['1.2.37.6'],
  filtros: [...PERIODO, EXECUTANTE, { nome: 'paga', rotulo: 'Pagamento', tipo: 'opcao', opcoes: [['S', 'Pagas'], ['N', 'Não pagas']] }],
  async gerar(f) {
    const { sql, params } = filtro({ ...f, situacao: null }, 'l.autorizado_em');
    const linhas = await consultar(
      `select coalesce(ue.nome, 'Não definida') unidade_executante, l.numero_aih, pa.nome paciente, l.autorizado_em::date::text autorizacao, coalesce(l.valor_total, 0) valor,
              case when l.paga then 'Paga' else 'Não paga' end pagamento, l.paga_em::date::text paga_em
         ${juncoes} where ${sql} and ($6::text is null or l.paga = ($6 = 'S')) order by 1, 2`,
      [...params, nul(f.paga)],
    );
    return {
      linhas,
      agrupar: ['unidade_executante'],
      colunas: [col('unidade_executante', 'Unidade executante'), col('numero_aih', 'Nº AIH'), col('paciente', 'Paciente'), col('autorizacao', 'Autorização', 'data'), col('valor', 'Valor', 'moeda', true), col('pagamento', 'Pagamento'), col('paga_em', 'Identificada em', 'data')],
    };
  },
});
