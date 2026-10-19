// Relatórios do ambulatório de saúde mental: pacientes por programas e oficinas, atendimentos e acolhimentos (TR 1.2.46.9).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';

const base = { modulo: 'CAPS', permissao: 'caps_atendimento:exportar' };
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);
const PROGRAMA: FiltroRelatorio = { nome: 'programaId', rotulo: 'Programa', tipo: 'ref', ref: 'caps_programa' };
const OFICINA: FiltroRelatorio = { nome: 'oficinaId', rotulo: 'Oficina', tipo: 'ref', ref: 'caps_oficina' };

registrarRelatorio({
  ...base,
  id: 'caps-pacientes-programa-oficina',
  grupo: 'Programas e oficinas',
  titulo: 'Pacientes por programas e oficinas',
  tr: ['1.2.46.9'],
  filtros: [
    PROGRAMA,
    OFICINA,
    { nome: 'situacao', rotulo: 'Situação da inscrição', tipo: 'opcao', opcoes: [['ATIVO', 'Ativo'], ['ALTA', 'Alta'], ['DESLIGADO', 'Desligado'], ['TRANSFERIDO', 'Transferido']], padrao: 'ATIVO' },
  ],
  async gerar(f) {
    const linhas = await consultar(
      `select p.nome programa, coalesce(o.nome, 'Sem oficina') oficina, pa.nome paciente, pa.cns, extract(year from age(pa.data_nascimento))::int idade, coalesce(pa.celular, pa.telefone) telefone,
              i.data_inicio::text inicio, i.situacao, coalesce(r.nome, '-') referencia,
              (select count(*)::int from caps.atendimento a where a.paciente_id = i.paciente_id and a.programa_id = i.programa_id and (i.oficina_id is null or a.oficina_id = i.oficina_id)) atendimentos
         from caps.inscricao i join caps.programa p on p.id = i.programa_id left join caps.oficina o on o.id = i.oficina_id join cad.pessoa pa on pa.id = i.paciente_id
         left join cad.profissional r on r.id = i.profissional_referencia_id
        where ($1::bigint is null or i.programa_id = $1) and ($2::bigint is null or i.oficina_id = $2) and ($3::text is null or i.situacao = $3)
        order by 1, 2, 3`,
      [nul(f.programaId), nul(f.oficinaId), nul(f.situacao)],
    );
    return {
      linhas,
      agrupar: ['programa', 'oficina'],
      colunas: [
        { campo: 'programa', titulo: 'Programa' },
        { campo: 'oficina', titulo: 'Oficina' },
        { campo: 'paciente', titulo: 'Paciente' },
        { campo: 'cns', titulo: 'CNS' },
        { campo: 'idade', titulo: 'Idade', formato: 'inteiro' },
        { campo: 'telefone', titulo: 'Telefone' },
        { campo: 'inicio', titulo: 'Inclusão', formato: 'data' },
        { campo: 'situacao', titulo: 'Situação' },
        { campo: 'referencia', titulo: 'Técnico de referência' },
        { campo: 'atendimentos', titulo: 'Atendimentos', formato: 'inteiro', total: true },
      ],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'caps-atendimentos',
  grupo: 'Atendimentos',
  titulo: 'Atendimentos por programa, oficina e tipo',
  tr: ['1.2.46.7'],
  filtros: [...PERIODO, PROGRAMA, { nome: 'profissionalId', rotulo: 'Profissional', tipo: 'ref', ref: 'profissional' }],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(p.nome, 'Sem programa') programa, coalesce(o.nome, '-') oficina, initcap(lower(a.tipo)) tipo, count(*)::int atendimentos, count(distinct a.paciente_id)::int usuarios
         from caps.atendimento a left join caps.programa p on p.id = a.programa_id left join caps.oficina o on o.id = a.oficina_id
        where a.data between $1 and $2 and ($3::bigint is null or a.programa_id = $3) and ($4::bigint is null or a.profissional_id = $4)
        group by 1, 2, 3 order by 1, 2, 3`,
      [f.de, f.ate, nul(f.programaId), nul(f.profissionalId)],
    );
    return {
      linhas,
      agrupar: ['programa'],
      grafico: { tipo: 'barra', x: 'tipo', y: 'atendimentos' },
      colunas: [
        { campo: 'programa', titulo: 'Programa' },
        { campo: 'oficina', titulo: 'Oficina' },
        { campo: 'tipo', titulo: 'Tipo' },
        { campo: 'atendimentos', titulo: 'Atendimentos', formato: 'inteiro', total: true },
        { campo: 'usuarios', titulo: 'Usuários', formato: 'inteiro', total: true },
      ],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'caps-acolhimentos',
  grupo: 'Atendimentos',
  titulo: 'Acolhimentos por forma de chegada, risco e conduta',
  tr: ['1.2.46.8'],
  filtros: [...PERIODO],
  async gerar(f) {
    const linhas = await consultar(
      `select a.data_hora::date::text data, pa.nome paciente, a.demanda, coalesce(a.risco, '-') risco, coalesce(a.conduta, '-') conduta, coalesce(pf.nome, '-') profissional
         from caps.acolhimento a join cad.pessoa pa on pa.id = a.paciente_id left join cad.profissional pf on pf.id = a.profissional_id
        where a.data_hora::date between $1 and $2 order by a.data_hora`,
      [f.de, f.ate],
    );
    return {
      linhas,
      colunas: [
        { campo: 'data', titulo: 'Data', formato: 'data' },
        { campo: 'paciente', titulo: 'Usuário' },
        { campo: 'demanda', titulo: 'Forma de chegada' },
        { campo: 'risco', titulo: 'Risco' },
        { campo: 'conduta', titulo: 'Conduta' },
        { campo: 'profissional', titulo: 'Profissional' },
      ],
    };
  },
});
