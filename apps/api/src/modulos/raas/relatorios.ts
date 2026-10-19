// Relatórios do RAAS: espelho do atendimento domiciliar e psicossocial com escolha do destino (PDF,
// planilha, documento, CSV...) e ações realizadas no período (TR 1.2.44.6, 1.2.44.7).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio, type FiltroRelatorio } from '../../servicos/catalogo.js';

const base = { modulo: 'RAAS', permissao: 'raas_registro:exportar' };
const TIPO: FiltroRelatorio = { nome: 'tipo', rotulo: 'Tipo', tipo: 'opcao', opcoes: [['PSICOSSOCIAL', 'Psicossocial'], ['DOMICILIAR', 'Atenção domiciliar']] };
const UNIDADE: FiltroRelatorio = { nome: 'unidadeId', rotulo: 'Estabelecimento', tipo: 'ref', ref: 'unidade' };
const nul = (v: unknown) => (v === undefined || v === '' ? null : v);
const LOCAL = `case a.local when 'T' then 'Território' when 'D' then 'Domicílio' else 'Serviço' end`;

registrarRelatorio({
  ...base,
  id: 'raas-espelho',
  grupo: 'RAAS',
  titulo: 'Espelho do RAAS (atenção domiciliar e psicossocial)',
  descricao: 'Escolha o destino da emissão: PDF, DOCX, XLSX, CSV, HTML, XML ou TXT.',
  tr: ['1.2.44.6'],
  filtros: [{ nome: 'competencia', rotulo: 'Competência (AAAAMM)', tipo: 'texto', obrigatorio: true, padrao: new Date().toISOString().slice(0, 7).replace('-', '') }, TIPO, UNIDADE, { nome: 'pacienteId', rotulo: 'Usuário', tipo: 'ref', ref: 'paciente' }],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome || ' (CNES ' || u.cnes || ')' estabelecimento,
              case r.tipo when 'DOMICILIAR' then 'RAAS-AD' else 'RAAS-PS' end || ' · ' || pa.nome || ' · CNS ' || coalesce(pa.cns, '-') || ' · admissão ' || to_char(r.data_inicio, 'DD/MM/YYYY')
                || coalesce(' · CID ' || cp.codigo, '') usuario,
              a.data::text data, pr.codigo || ' - ' || pr.nome acao, a.quantidade, coalesce(pf.nome, '-') || coalesce(' (CBO ' || a.cbo_codigo || ')', '') profissional, ${LOCAL} local
         from raas.registro r join raas.acao a on a.registro_id = r.id join cad.unidade u on u.id = r.unidade_id join cad.pessoa pa on pa.id = r.paciente_id
         join cad.procedimento pr on pr.id = a.procedimento_id left join cad.profissional pf on pf.id = a.profissional_id left join cad.cid cp on cp.id = r.cid_principal_id
        where r.competencia = $1 and ($2::text is null or r.tipo = $2) and ($3::bigint is null or r.unidade_id = $3) and ($4::bigint is null or r.paciente_id = $4)
        order by 1, 2, a.data`,
      [f.competencia, nul(f.tipo), nul(f.unidadeId), nul(f.pacienteId)],
    );
    return {
      linhas,
      agrupar: ['estabelecimento', 'usuario'],
      colunas: [
        { campo: 'estabelecimento', titulo: 'Estabelecimento' },
        { campo: 'usuario', titulo: 'Usuário' },
        { campo: 'data', titulo: 'Data', formato: 'data' },
        { campo: 'acao', titulo: 'Ação realizada' },
        { campo: 'quantidade', titulo: 'Qtd.', formato: 'inteiro', total: true },
        { campo: 'profissional', titulo: 'Profissional' },
        { campo: 'local', titulo: 'Local' },
      ],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'raas-acoes-periodo',
  grupo: 'RAAS',
  titulo: 'Ações domiciliares e psicossociais por período',
  tr: ['1.2.44.7'],
  filtros: [...PERIODO, TIPO, UNIDADE, { nome: 'profissionalId', rotulo: 'Profissional', tipo: 'ref', ref: 'profissional' }],
  async gerar(f) {
    const linhas = await consultar(
      `select case r.tipo when 'DOMICILIAR' then 'Atenção domiciliar' else 'Psicossocial' end tipo, pr.codigo || ' - ' || pr.nome acao,
              count(distinct r.paciente_id)::int usuarios, sum(a.quantidade)::int quantidade,
              sum(a.quantidade) filter (where a.local = 'T')::int territorio, sum(a.quantidade) filter (where a.local = 'D')::int domicilio
         from raas.acao a join raas.registro r on r.id = a.registro_id join cad.procedimento pr on pr.id = a.procedimento_id
        where a.data between $1 and $2 and ($3::text is null or r.tipo = $3) and ($4::bigint is null or r.unidade_id = $4) and ($5::bigint is null or a.profissional_id = $5)
        group by 1, 2 order by 1, 4 desc`,
      [f.de, f.ate, nul(f.tipo), nul(f.unidadeId), nul(f.profissionalId)],
    );
    return {
      linhas,
      agrupar: ['tipo'],
      grafico: { tipo: 'barra', x: 'acao', y: 'quantidade', serie: 'tipo' },
      colunas: [
        { campo: 'tipo', titulo: 'RAAS' },
        { campo: 'acao', titulo: 'Ação' },
        { campo: 'usuarios', titulo: 'Usuários', formato: 'inteiro', total: true },
        { campo: 'quantidade', titulo: 'Ações', formato: 'inteiro', total: true },
        { campo: 'territorio', titulo: 'No território', formato: 'inteiro', total: true },
        { campo: 'domicilio', titulo: 'No domicílio', formato: 'inteiro', total: true },
      ],
    };
  },
});

registrarRelatorio({
  ...base,
  id: 'raas-acoes-analitico',
  grupo: 'RAAS',
  titulo: 'Ações domiciliares e psicossociais por período (analítico)',
  tr: ['1.2.44.7'],
  filtros: [...PERIODO, TIPO, UNIDADE],
  async gerar(f) {
    const linhas = await consultar(
      `select a.data::text data, case r.tipo when 'DOMICILIAR' then 'AD' else 'PS' end tipo, pa.nome usuario, pr.codigo || ' - ' || pr.nome acao, a.quantidade, coalesce(pf.nome, '-') profissional, ${LOCAL} local
         from raas.acao a join raas.registro r on r.id = a.registro_id join cad.pessoa pa on pa.id = r.paciente_id join cad.procedimento pr on pr.id = a.procedimento_id
         left join cad.profissional pf on pf.id = a.profissional_id
        where a.data between $1 and $2 and ($3::text is null or r.tipo = $3) and ($4::bigint is null or r.unidade_id = $4) order by a.data, pa.nome`,
      [f.de, f.ate, nul(f.tipo), nul(f.unidadeId)],
    );
    return {
      linhas,
      colunas: [
        { campo: 'data', titulo: 'Data', formato: 'data' },
        { campo: 'tipo', titulo: 'RAAS' },
        { campo: 'usuario', titulo: 'Usuário' },
        { campo: 'acao', titulo: 'Ação' },
        { campo: 'quantidade', titulo: 'Qtd.', formato: 'inteiro', total: true },
        { campo: 'profissional', titulo: 'Profissional' },
        { campo: 'local', titulo: 'Local' },
      ],
    };
  },
});
