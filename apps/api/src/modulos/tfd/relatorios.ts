// Relatórios do Tratamento Fora do Domicílio (TR 1.2.35.19 a 1.2.35.23.1).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';
import type { Coluna } from '../../servicos/exportar.js';
import { SITUACAO_LAUDO } from './entidades.js';
import { SQL_SITUACAO_ATUAL } from './servico.js';

const col = (campo: string, titulo: string, formato?: Coluna['formato'], total?: boolean): Coluna => ({ campo, titulo, formato, total });
const nul = (v: unknown) => (v === undefined || v === '' || v === null ? null : v);
const UNIDADE: FiltroRelatorio = { nome: 'unidadeId', rotulo: 'Unidade solicitante', tipo: 'ref', ref: 'unidade' };
const PROFISSIONAL: FiltroRelatorio = { nome: 'profissionalId', rotulo: 'Profissional solicitante', tipo: 'ref', ref: 'profissional' };
const PROCEDIMENTO: FiltroRelatorio = { nome: 'procedimentoId', rotulo: 'Procedimento', tipo: 'ref', ref: 'procedimento' };
const SITUACAO: FiltroRelatorio = { nome: 'situacao', rotulo: 'Situação do laudo', tipo: 'opcao', opcoes: SITUACAO_LAUDO };
const base = { modulo: 'TFD', permissao: 'laudo_tfd:exportar' };

/** Laudos abertos no período com os filtros comuns ($1 a $6). */
const BASE_LAUDO = `from tfd.laudo l join cad.pessoa p on p.id = l.paciente_id join cad.unidade un on un.id = l.unidade_solicitante_id
  join cad.profissional pf on pf.id = l.profissional_solicitante_id join cad.procedimento pr on pr.id = l.procedimento_id
 where l.data_abertura between $1 and $2 and ($3::bigint is null or l.unidade_solicitante_id = $3) and ($4::bigint is null or l.profissional_solicitante_id = $4)
   and ($5::bigint is null or l.procedimento_id = $5) and ($6::text is null or l.situacao = $6)`;
const params = (f: Record<string, any>) => [f.de, f.ate, nul(f.unidadeId), nul(f.profissionalId), nul(f.procedimentoId), nul(f.situacao)];
const CAMPOS = `l.data_abertura::text data, l.numero, p.nome paciente, pf.nome profissional, pr.codigo || ' - ' || pr.nome procedimento, ${SQL_SITUACAO_ATUAL('l')} situacao_atual, un.nome unidade`;

// Processos por unidade solicitante (TR 1.2.35.19, 1.2.35.19.1).
registrarRelatorio({
  ...base,
  id: 'tfd-processos-unidade',
  grupo: 'Processos',
  titulo: 'Processos de TFD por unidade solicitante',
  tr: ['1.2.35.19', '1.2.35.19.1'],
  filtros: [...PERIODO, UNIDADE, SITUACAO],
  async gerar(f) {
    const linhas = await consultar(`select ${CAMPOS} ${BASE_LAUDO} order by un.nome, l.data_abertura, l.numero`, params(f));
    return {
      linhas,
      agrupar: ['unidade'],
      orientacao: 'landscape',
      grafico: { tipo: 'barra', x: 'unidade', y: 'quantidade', titulo: 'Processos por unidade', dados: contar(linhas, 'unidade') },
      colunas: [col('unidade', 'Unidade solicitante'), col('data', 'Data', 'data'), col('numero', 'Número'), col('paciente', 'Paciente'), col('profissional', 'Profissional solicitante'), col('procedimento', 'Procedimento'), col('situacao_atual', 'Situação atual')],
    };
  },
});

// Processos agendados por unidade de destino (TR 1.2.35.20).
registrarRelatorio({
  ...base,
  id: 'tfd-agendados-destino',
  grupo: 'Processos',
  titulo: 'Processos de TFD agendados por destino',
  tr: ['1.2.35.20'],
  filtros: [
    { nome: 'de', rotulo: 'Agendamento de', tipo: 'data', obrigatorio: true, padrao: 'inicio_mes' },
    { nome: 'ate', rotulo: 'Agendamento até', tipo: 'data', obrigatorio: true, padrao: 'hoje' },
    UNIDADE,
    { nome: 'localId', rotulo: 'Unidade de destino', tipo: 'ref', ref: 'local_destino' },
  ],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(ld.nome, 'Destino não informado') || coalesce(' (' || m.nome || ')', '') destino, x.agendamento, to_char(x.agendamento at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') data_hora,
              x.origem, l.data_abertura::text data_laudo, l.numero, p.nome paciente, pf.nome profissional, pr.codigo || ' - ' || pr.nome procedimento
         from tfd.laudo l
         join lateral (
              select l.agendamento_data_hora agendamento, 'Atendimento no destino' origem where l.agendamento_data_hora is not null
              union all
              select (v.data_saida + coalesce(vp.hora_saida, v.hora_saida, '00:00')) at time zone 'America/Sao_Paulo', 'Transporte (' || coalesce(vp.protocolo, '') || ')'
                from tra.viagem_passageiro vp join tra.viagem v on v.id = vp.viagem_id where vp.tfd_laudo_id = l.id and vp.situacao <> 'CANCELADO') x on true
         join cad.pessoa p on p.id = l.paciente_id join cad.profissional pf on pf.id = l.profissional_solicitante_id join cad.procedimento pr on pr.id = l.procedimento_id
         left join tra.local_destino ld on ld.id = l.local_tratamento_id left join cad.municipio m on m.id = ld.municipio_id
        where (x.agendamento at time zone 'America/Sao_Paulo')::date between $1 and $2 and ($3::bigint is null or l.unidade_solicitante_id = $3) and ($4::bigint is null or l.local_tratamento_id = $4)
        order by 1, x.agendamento`,
      [f.de, f.ate, nul(f.unidadeId), nul(f.localId)],
    );
    return {
      linhas,
      agrupar: ['destino'],
      orientacao: 'landscape',
      colunas: [col('destino', 'Unidade de destino'), col('data_hora', 'Data e hora do agendamento'), col('origem', 'Agendamento'), col('data_laudo', 'Data do laudo', 'data'), col('numero', 'Número do laudo'), col('paciente', 'Paciente'), col('profissional', 'Profissional solicitante'), col('procedimento', 'Procedimento')],
    };
  },
});

// Processos por procedimento, separados por unidade solicitante e procedimento (TR 1.2.35.21, 1.2.35.22).
registrarRelatorio({
  ...base,
  id: 'tfd-processos-procedimento',
  grupo: 'Processos',
  titulo: 'Processos de TFD por procedimento',
  tr: ['1.2.35.21', '1.2.35.22'],
  filtros: [...PERIODO, UNIDADE, PROCEDIMENTO, SITUACAO],
  async gerar(f) {
    const linhas = await consultar(`select ${CAMPOS} ${BASE_LAUDO} order by un.nome, pr.nome, l.data_abertura`, params(f));
    return {
      linhas,
      agrupar: ['unidade', 'procedimento'],
      orientacao: 'landscape',
      colunas: [col('unidade', 'Unidade solicitante'), col('procedimento', 'Procedimento solicitado'), col('data', 'Data', 'data'), col('numero', 'Número'), col('paciente', 'Paciente'), col('profissional', 'Profissional solicitante'), col('situacao_atual', 'Situação atual')],
    };
  },
});

// Processos por profissional solicitante, separados por unidade e profissional (TR 1.2.35.23, 1.2.35.23.1).
registrarRelatorio({
  ...base,
  id: 'tfd-processos-profissional',
  grupo: 'Processos',
  titulo: 'Processos de TFD por profissional solicitante',
  tr: ['1.2.35.23', '1.2.35.23.1'],
  filtros: [...PERIODO, UNIDADE, PROFISSIONAL, SITUACAO],
  async gerar(f) {
    const linhas = await consultar(`select ${CAMPOS} ${BASE_LAUDO} order by un.nome, pf.nome, l.data_abertura`, params(f));
    return {
      linhas,
      agrupar: ['unidade', 'profissional'],
      orientacao: 'landscape',
      colunas: [col('unidade', 'Unidade solicitante'), col('profissional', 'Profissional solicitante'), col('data', 'Data', 'data'), col('numero', 'Número'), col('paciente', 'Paciente'), col('procedimento', 'Procedimento'), col('situacao_atual', 'Situação atual')],
    };
  },
});

// Ajudas de custo concedidas por processo.
registrarRelatorio({
  ...base,
  id: 'tfd-ajudas-custo',
  grupo: 'Financeiro',
  titulo: 'Ajudas de custo do TFD',
  filtros: [...PERIODO, { nome: 'situacaoAjuda', rotulo: 'Situação', tipo: 'opcao', opcoes: [['PENDENTE', 'Pendente'], ['PAGO', 'Pago'], ['CANCELADO', 'Cancelado']] }],
  async gerar(f) {
    const linhas = await consultar(
      `select p.nome paciente, l.numero, a.data::text data, a.tipo, a.beneficiario, a.quantidade, a.valor_unitario, a.valor, a.situacao
         from tfd.ajuda_custo a join tfd.laudo l on l.id = a.laudo_id join cad.pessoa p on p.id = l.paciente_id
        where a.data between $1 and $2 and ($3::text is null or a.situacao = $3) order by p.nome, a.data`,
      [f.de, f.ate, nul(f.situacaoAjuda)],
    );
    return {
      linhas,
      agrupar: ['paciente'],
      colunas: [col('paciente', 'Paciente'), col('numero', 'Laudo'), col('data', 'Data', 'data'), col('tipo', 'Tipo'), col('beneficiario', 'Beneficiário'), col('quantidade', 'Qtd.', 'inteiro', true), col('valor_unitario', 'Valor unitário', 'moeda'), col('valor', 'Valor', 'moeda', true), col('situacao', 'Situação')],
    };
  },
});

function contar(linhas: Record<string, any>[], campo: string) {
  const m = new Map<string, number>();
  for (const l of linhas) m.set(l[campo], (m.get(l[campo]) ?? 0) + 1);
  return [...m].map(([k, quantidade]) => ({ [campo]: k, quantidade }));
}
