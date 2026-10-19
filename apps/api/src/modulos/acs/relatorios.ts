// Relatórios e indicadores das visitas dos agentes comunitários de saúde e exportação da
// Ficha de Visita Domiciliar e Territorial (e-SUS APS) (TR 1.2.49.13.8).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio } from '../../servicos/catalogo.js';
import { DESFECHO_VISITA, MOTIVOS_VISITA, TIPO_IMOVEL } from './entidades.js';

const rotulo = (lista: [string, string][], v: string) => lista.find(([k]) => k === v)?.[1] ?? v;

registrarRelatorio({
  id: 'acs-visitas-agente',
  modulo: 'ACS',
  grupo: 'Visitas domiciliares',
  titulo: 'Visitas por agente comunitário e desfecho',
  permissao: 'acs_visita:exportar',
  tr: ['1.2.49.2'],
  filtros: [...PERIODO, { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = await consultar(
      `select pr.nome agente, coalesce(v.microarea, '-') microarea, count(*)::int visitas,
              count(*) filter (where v.desfecho = 'REALIZADA')::int realizadas, count(*) filter (where v.desfecho = 'AUSENTE')::int ausentes,
              count(*) filter (where v.desfecho = 'RECUSADA')::int recusadas, count(*) filter (where v.compartilhada)::int compartilhadas,
              count(distinct v.familia_id)::int familias, count(*) filter (where v.latitude is not null)::int georreferenciadas
         from acs.visita v join cad.profissional pr on pr.id = v.profissional_id
        where v.data_hora::date between $1 and $2 and ($3::bigint is null or v.unidade_id = $3)
        group by 1, 2 order by 1, 2`,
      [f.de, f.ate, f.unidadeId ?? null],
    );
    return {
      linhas,
      grafico: { tipo: 'barra', x: 'agente', y: 'visitas' },
      colunas: [
        { campo: 'agente', titulo: 'Agente comunitário' },
        { campo: 'microarea', titulo: 'Microárea' },
        { campo: 'visitas', titulo: 'Visitas', formato: 'inteiro', total: true },
        { campo: 'realizadas', titulo: 'Realizadas', formato: 'inteiro', total: true },
        { campo: 'ausentes', titulo: 'Ausentes', formato: 'inteiro', total: true },
        { campo: 'recusadas', titulo: 'Recusadas', formato: 'inteiro', total: true },
        { campo: 'compartilhadas', titulo: 'Compartilhadas', formato: 'inteiro', total: true },
        { campo: 'familias', titulo: 'Famílias visitadas', formato: 'inteiro', total: true },
        { campo: 'georreferenciadas', titulo: 'Com GPS', formato: 'inteiro', total: true },
      ],
    };
  },
});

registrarRelatorio({
  id: 'acs-visitas-motivo',
  modulo: 'ACS',
  grupo: 'Visitas domiciliares',
  titulo: 'Visitas por motivo',
  permissao: 'acs_visita:exportar',
  tr: ['1.2.49.13.5.2'],
  filtros: [...PERIODO, { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = (
      await consultar(
        `select m motivo, count(*)::int visitas from acs.visita v cross join unnest(v.motivos) m
          where v.data_hora::date between $1 and $2 and ($3::bigint is null or v.unidade_id = $3) group by 1 order by 2 desc`,
        [f.de, f.ate, f.unidadeId ?? null],
      )
    ).map((l) => ({ ...l, motivo: rotulo(MOTIVOS_VISITA, l.motivo) }));
    return {
      linhas,
      grafico: { tipo: 'barra', x: 'motivo', y: 'visitas' },
      colunas: [
        { campo: 'motivo', titulo: 'Motivo da visita' },
        { campo: 'visitas', titulo: 'Visitas', formato: 'inteiro', total: true },
      ],
    };
  },
});

registrarRelatorio({
  id: 'acs-ficha-visita-esus',
  modulo: 'ACS',
  grupo: 'Visitas domiciliares',
  titulo: 'Ficha de visita domiciliar e territorial (e-SUS APS)',
  descricao: 'Transposição das visitas coletadas no aplicativo para o e-SUS APS (exportável em XML/CSV)',
  permissao: 'acs_visita:exportar',
  tr: ['1.2.49.13.8'],
  filtros: [...PERIODO, { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = (
      await consultar(
        `select v.data_hora, v.turno, u.cnes, vi.ine, pr.nome profissional, cb.codigo cbo, v.microarea, v.tipo_imovel, p.cns cns_cidadao, p.nome cidadao,
                p.data_nascimento::text nascimento, p.sexo, v.motivos, v.desfecho, v.compartilhada, v.peso, v.altura, v.pa_sistolica, v.pa_diastolica,
                v.glicemia, v.latitude, v.longitude, v.uuid
           from acs.visita v join cad.unidade u on u.id = v.unidade_id join cad.profissional pr on pr.id = v.profissional_id
           left join lateral (select x.ine, x.cbo_id from cad.vinculo x where x.profissional_id = v.profissional_id order by (x.unidade_id = v.unidade_id) desc limit 1) vi on true
           left join cad.cbo cb on cb.id = vi.cbo_id left join cad.pessoa p on p.id = v.pessoa_id
          where v.data_hora::date between $1 and $2 and ($3::bigint is null or v.unidade_id = $3) order by v.data_hora`,
        [f.de, f.ate, f.unidadeId ?? null],
      )
    ).map((l) => ({
      ...l,
      tipo_imovel: `${l.tipo_imovel} - ${rotulo(TIPO_IMOVEL, l.tipo_imovel)}`,
      motivos: (l.motivos ?? []).map((m: string) => rotulo(MOTIVOS_VISITA, m)).join('; '),
      desfecho: rotulo(DESFECHO_VISITA, l.desfecho),
    }));
    return {
      linhas,
      orientacao: 'landscape',
      colunas: [
        { campo: 'data_hora', titulo: 'Data/hora', formato: 'data_hora' },
        { campo: 'turno', titulo: 'Turno' },
        { campo: 'cnes', titulo: 'CNES' },
        { campo: 'ine', titulo: 'INE' },
        { campo: 'profissional', titulo: 'Profissional' },
        { campo: 'cbo', titulo: 'CBO' },
        { campo: 'microarea', titulo: 'Microárea' },
        { campo: 'tipo_imovel', titulo: 'Tipo de imóvel' },
        { campo: 'cns_cidadao', titulo: 'CNS do cidadão' },
        { campo: 'cidadao', titulo: 'Cidadão' },
        { campo: 'nascimento', titulo: 'Nascimento', formato: 'data' },
        { campo: 'sexo', titulo: 'Sexo' },
        { campo: 'motivos', titulo: 'Motivos' },
        { campo: 'desfecho', titulo: 'Desfecho' },
        { campo: 'compartilhada', titulo: 'Compartilhada', formato: 'booleano' },
        { campo: 'peso', titulo: 'Peso', formato: 'decimal' },
        { campo: 'altura', titulo: 'Altura', formato: 'decimal' },
        { campo: 'pa_sistolica', titulo: 'PAS', formato: 'inteiro' },
        { campo: 'pa_diastolica', titulo: 'PAD', formato: 'inteiro' },
        { campo: 'glicemia', titulo: 'Glicemia', formato: 'inteiro' },
        { campo: 'latitude', titulo: 'Latitude', formato: 'decimal' },
        { campo: 'longitude', titulo: 'Longitude', formato: 'decimal' },
        { campo: 'uuid', titulo: 'UUID da ficha' },
      ],
    };
  },
});

registrarRelatorio({
  id: 'acs-cobertura-microarea',
  modulo: 'ACS',
  grupo: 'Território',
  titulo: 'Cobertura das famílias por microárea',
  permissao: 'acs_visita:exportar',
  tr: ['1.2.49.2.1'],
  filtros: [...PERIODO, { nome: 'unidadeId', rotulo: 'Unidade', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = await consultar(
      `select u.nome unidade, coalesce(fa.microarea, '-') microarea, count(*)::int familias,
              count(*) filter (where exists (select 1 from acs.visita v where v.familia_id = fa.id and v.data_hora::date between $1 and $2 and v.desfecho = 'REALIZADA'))::int visitadas,
              (select count(*)::int from cad.pessoa p where p.familia_id = any(array_agg(fa.id)) and p.situacao <> 'FALECIDO') pessoas
         from cad.familia fa join cad.unidade u on u.id = fa.unidade_id
        where fa.ativo is not false and ($3::bigint is null or fa.unidade_id = $3) group by u.nome, fa.microarea order by 1, 2`,
      [f.de, f.ate, f.unidadeId ?? null],
    );
    return {
      linhas: linhas.map((l) => ({ ...l, cobertura: l.familias ? (100 * l.visitadas) / l.familias : 0 })),
      grafico: { tipo: 'barra', x: 'microarea', y: 'cobertura' },
      colunas: [
        { campo: 'unidade', titulo: 'Unidade' },
        { campo: 'microarea', titulo: 'Microárea' },
        { campo: 'familias', titulo: 'Famílias', formato: 'inteiro', total: true },
        { campo: 'pessoas', titulo: 'Pessoas', formato: 'inteiro', total: true },
        { campo: 'visitadas', titulo: 'Famílias visitadas', formato: 'inteiro', total: true },
        { campo: 'cobertura', titulo: 'Cobertura (%)', formato: 'percentual' },
      ],
    };
  },
});
