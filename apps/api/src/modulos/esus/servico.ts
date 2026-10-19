// Regras do e-SUS AB: cronograma de eventos e benefícios das ações programáticas, cadastro e arquivo do
// HIPERDIA, situação automática dos critérios de indicadores (solicitado/realizado) e envio de registros
// de atendimento clínico à RNDS (TR 1.2.36.3 a 1.2.36.12, 1.2.13.1.37).
import https from 'node:https';
import type pg from 'pg';
import { consultarUm } from '../../db/pool.js';
import { decifrar } from '../../servicos/cripto.js';
import { ErroHttp } from '../../seguranca/usuario.js';
import { aaaammdd, digitos, montarLinha, type CampoLayout } from '../aih/layout.js';

const DIA = 86_400_000;
const somaDias = (data: string, dias: number) => new Date(new Date(data + 'T12:00:00Z').getTime() + dias * DIA).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Ações programáticas
// ---------------------------------------------------------------------------
/** Gera os eventos previstos da inscrição pela periodicidade e prazos definidos na ação (TR 1.2.36.9.2 a 1.2.36.9.4). */
export async function gerarCronograma(c: pg.PoolClient, inscricaoId: number) {
  const i = (
    await c.query(
      `select i.*, i.data_inicial::text di, i.data_final::text df, a.data_fim::text acao_fim from esus.inscricao i join esus.acao_programatica a on a.id = i.acao_id where i.id = $1`,
      [inscricaoId],
    )
  ).rows[0];
  if (!i) return 0;
  await c.query(`delete from esus.inscricao_evento where inscricao_id = $1 and situacao = 'PREVISTO' and data_prevista >= current_date`, [inscricaoId]);
  if (i.situacao !== 'ATIVO') return 0;
  const fim = i.df ?? i.acao_fim ?? somaDias(i.di, 365);
  const eventos = (await c.query(`select * from esus.acao_evento where acao_id = $1`, [i.acao_id])).rows;
  let criados = 0;
  for (const e of eventos) {
    const existentes = new Set((await c.query(`select data_prevista::text d from esus.inscricao_evento where inscricao_id = $1 and evento_id = $2`, [inscricaoId, e.id])).rows.map((r) => r.d));
    for (let d = i.di, n = 0; d <= fim && n < 120; d = somaDias(d, e.periodicidade_dias), n++) {
      if (d < new Date().toISOString().slice(0, 10) && existentes.size) continue;
      if (existentes.has(d)) continue;
      await c.query(
        `insert into esus.inscricao_evento (inscricao_id, evento_id, nome, frequencia_dias, data_prevista, prazo_limite, situacao) values ($1,$2,$3,$4,$5,$6,'PREVISTO')`,
        [inscricaoId, e.id, e.nome, e.periodicidade_dias, d, somaDias(d, e.prazo_dias ?? 0)],
      );
      criados++;
    }
  }
  return criados;
}

export async function validarInscricao(c: pg.PoolClient, d: Record<string, any>, atualId?: number) {
  const a = (await c.query(`select *, data_inicio::text di, data_fim::text df from esus.acao_programatica where id = $1`, [d.acao_id])).rows[0];
  if (!a) throw new ErroHttp(422, 'Ação programática não encontrada.');
  if (!a.ativo) throw new ErroHttp(422, 'Ação programática inativa.');
  if (d.data_inicial < a.di || (a.df && d.data_inicial > a.df)) throw new ErroHttp(422, `A inscrição deve estar dentro da vigência da ação (${a.di.split('-').reverse().join('/')}${a.df ? ' a ' + a.df.split('-').reverse().join('/') : ''}).`);
  if (d.data_final && d.data_final < d.data_inicial) throw new ErroHttp(422, 'Data final anterior à inicial.');
  if (d.recebe_beneficio && !a.concede_beneficio) throw new ErroHttp(422, 'Esta ação programática não concede benefícios.');
  if (a.max_inscricoes && d.situacao === 'ATIVO') {
    const n = (await c.query(`select count(*)::int n from esus.inscricao where acao_id = $1 and situacao = 'ATIVO' and id <> coalesce($2, 0)`, [a.id, atualId ?? null])).rows[0].n;
    if (n >= a.max_inscricoes) throw new ErroHttp(409, `Limite de ${a.max_inscricoes} inscrições ativas atingido para a ação.`);
  }
  const dup = (await c.query(`select 1 from esus.inscricao where acao_id = $1 and paciente_id = $2 and situacao = 'ATIVO' and id <> coalesce($3, 0)`, [a.id, d.paciente_id, atualId ?? null])).rowCount;
  if (dup && d.situacao === 'ATIVO') throw new ErroHttp(409, 'O cidadão já possui inscrição ativa nesta ação.');
}

/** Concessão de benefício respeitando a periodicidade do subsídio (TR 1.2.36.3, 1.2.36.9.1). */
export async function validarBeneficio(c: pg.PoolClient, d: Record<string, any>) {
  const i = (await c.query(`select situacao, recebe_beneficio from esus.inscricao where id = $1`, [d.inscricao_id])).rows[0];
  if (!i || i.situacao !== 'ATIVO') throw new ErroHttp(422, 'Benefício só pode ser concedido a inscrição ativa.');
  if (!i.recebe_beneficio) throw new ErroHttp(422, 'A inscrição não está marcada para receber benefícios.');
  if (d.acao_procedimento_id) {
    const p = (await c.query(`select periodicidade_dias, descricao from esus.acao_procedimento where id = $1`, [d.acao_procedimento_id])).rows[0];
    const ultimo = (await c.query(`select max(data)::text d from esus.inscricao_beneficio where inscricao_id = $1 and acao_procedimento_id = $2`, [d.inscricao_id, d.acao_procedimento_id])).rows[0].d;
    if (ultimo && p && d.data < somaDias(ultimo, p.periodicidade_dias)) throw new ErroHttp(422, `Periodicidade de ${p.periodicidade_dias} dias: próxima concessão a partir de ${somaDias(ultimo, p.periodicidade_dias).split('-').reverse().join('/')}.`);
    if (p) {
      d.proxima_concessao = somaDias(d.data, p.periodicidade_dias);
      if (!d.descricao) d.descricao = p.descricao;
    }
  }
}

// ---------------------------------------------------------------------------
// HIPERDIA (TR 1.2.13.1.37)
// ---------------------------------------------------------------------------
/** Cadastros HIPERDIA gerados dos atendimentos/sinais vitais de hipertensos e diabéticos, sem redigitação. */
export async function gerarCadastrosHiperdia(c: pg.PoolClient, de: string, ate: string) {
  const r = await c.query(
    `insert into esus.hiperdia (paciente_id, unidade_id, profissional_id, data, tipo, pa_sistolica, pa_diastolica, glicemia, peso, altura, cintura, fatores, origem)
     select distinct on (p.id) p.id, coalesce(a.unidade_id, p.unidade_referencia_id), coalesce(s.profissional_id, a.profissional_id), s.data_hora::date,
            case when 'hipertensao' = any(p.condicoes_saude) and 'diabetes' = any(p.condicoes_saude) then 'HAS_DM2' when 'diabetes' = any(p.condicoes_saude) then 'DM2' else 'HAS' end,
            s.pa_sistolica, s.pa_diastolica, s.glicemia, s.peso, s.altura::int, s.cintura::int,
            array_remove(array[case when 'fumante' = any(p.condicoes_saude) then 'TABAGISMO' end, case when 'avc' = any(p.condicoes_saude) then 'AVC' end,
                                case when 'infarto' = any(p.condicoes_saude) then 'INFARTO' end, case when 'rins' = any(p.condicoes_saude) then 'DOENCA_RENAL' end,
                                case when s.imc >= 25 then 'SOBREPESO' end], null),
            'sinais_vitais:' || s.id
       from cad.pessoa p join amb.sinais_vitais s on s.paciente_id = p.id left join amb.atendimento a on a.id = s.atendimento_id
      where p.condicoes_saude && array['hipertensao','diabetes']::text[] and s.data_hora::date between $1 and $2
        and coalesce(a.unidade_id, p.unidade_referencia_id) is not null
        and not exists (select 1 from esus.hiperdia h where h.paciente_id = p.id and h.data = s.data_hora::date)
      order by p.id, s.data_hora desc`,
    [de, ate],
  );
  return { gerados: r.rowCount ?? 0 };
}

export const LAYOUT_HIPERDIA: CampoLayout[] = [
  ['TP_REG', 2, 'N', '10 = cadastro/acompanhamento'],
  ['CNES', 7, 'N', 'CNES da unidade'],
  ['DT_CONSULTA', 8, 'N', 'Data (AAAAMMDD)'],
  ['CNS_PAC', 15, 'A', 'CNS'],
  ['CPF_PAC', 11, 'A', 'CPF'],
  ['NOME_PAC', 70, 'A', 'Nome'],
  ['DT_NASC', 8, 'N', 'Nascimento'],
  ['SEXO', 1, 'A', 'Sexo'],
  ['RACA_COR', 2, 'N', 'Raça/cor'],
  ['NOME_MAE', 70, 'A', 'Nome da mãe'],
  ['MUN_RES', 7, 'N', 'Município (IBGE)'],
  ['HAS', 1, 'A', 'S/N hipertensão'],
  ['DM', 1, 'N', '0 = não, 1 = tipo 1, 2 = tipo 2'],
  ['PA_SIST', 3, 'N', 'PA sistólica'],
  ['PA_DIAST', 3, 'N', 'PA diastólica'],
  ['GLICEMIA', 3, 'N', 'Glicemia'],
  ['GLICEMIA_JEJUM', 1, 'A', 'S/N'],
  ['PESO', 5, 'N', 'Peso em gramas/10 (kg x 10)'],
  ['ALTURA', 3, 'N', 'Altura (cm)'],
  ['CINTURA', 3, 'N', 'Cintura (cm)'],
  ['ANTECEDENTES', 1, 'A', 'S/N'],
  ['TABAGISMO', 1, 'A', 'S/N'],
  ['SEDENTARISMO', 1, 'A', 'S/N'],
  ['SOBREPESO', 1, 'A', 'S/N'],
  ['INFARTO', 1, 'A', 'S/N'],
  ['CORONARIOPATIA', 1, 'A', 'S/N'],
  ['AVC', 1, 'A', 'S/N'],
  ['PE_DIABETICO', 1, 'A', 'S/N'],
  ['AMPUTACAO', 1, 'A', 'S/N'],
  ['DOENCA_RENAL', 1, 'A', 'S/N'],
  ['HIDROCLOROTIAZIDA', 1, 'A', 'S/N'],
  ['PROPRANOLOL', 1, 'A', 'S/N'],
  ['CAPTOPRIL', 1, 'A', 'S/N'],
  ['LOSARTANA', 1, 'A', 'S/N'],
  ['GLIBENCLAMIDA', 1, 'A', 'S/N'],
  ['METFORMINA', 1, 'A', 'S/N'],
  ['INSULINA', 1, 'A', 'S/N'],
  ['OUTROS_MED', 1, 'A', 'S/N'],
  ['NAO_MEDICAMENTOSO', 1, 'A', 'S/N'],
  ['CNS_PROF', 15, 'A', 'CNS do profissional'],
];

export async function gerarArquivoHiperdia(c: pg.PoolClient, de: string, ate: string, unidadeId: number | null, parcial: boolean) {
  const regs = (
    await c.query(
      `select h.*, h.data::text dt, u.cnes, p.cns, p.cpf, p.nome, p.data_nascimento::text nasc, p.sexo, p.raca_cor, p.nome_mae, m.codigo_ibge mun,
              (select x.cns from cad.pessoa x join cad.profissional pf on pf.pessoa_id = x.id where pf.id = h.profissional_id) cns_prof
         from esus.hiperdia h join cad.pessoa p on p.id = h.paciente_id join cad.unidade u on u.id = h.unidade_id left join cad.municipio m on m.id = p.municipio_id
        where h.data between $1 and $2 and ($3::bigint is null or h.unidade_id = $3) and (not $4 or h.exportado_em is null or h.atualizado_em > h.exportado_em)
        order by u.cnes, h.data`,
      [de, ate, unidadeId, parcial],
    )
  ).rows;
  if (!regs.length) throw new ErroHttp(422, 'Não há cadastros HIPERDIA no período para exportar.');
  const sn = (lista: string[] | null, k: string) => ((lista ?? []).includes(k) ? 'S' : 'N');
  const linhas = regs.map((h) =>
    montarLinha(LAYOUT_HIPERDIA, {
      TP_REG: 10,
      CNES: h.cnes,
      DT_CONSULTA: aaaammdd(h.dt),
      CNS_PAC: digitos(h.cns),
      CPF_PAC: digitos(h.cpf),
      NOME_PAC: h.nome,
      DT_NASC: aaaammdd(h.nasc),
      SEXO: h.sexo,
      RACA_COR: h.raca_cor ?? '99',
      NOME_MAE: h.nome_mae ?? '',
      MUN_RES: h.mun ?? '',
      HAS: String(h.tipo).startsWith('HAS') ? 'S' : 'N',
      DM: String(h.tipo).includes('DM1') ? 1 : String(h.tipo).includes('DM2') ? 2 : 0,
      PA_SIST: h.pa_sistolica,
      PA_DIAST: h.pa_diastolica,
      GLICEMIA: h.glicemia,
      GLICEMIA_JEJUM: h.glicemia_jejum ? 'S' : 'N',
      PESO: h.peso ? Math.round(Number(h.peso) * 10) : null,
      ALTURA: h.altura,
      CINTURA: h.cintura,
      ...Object.fromEntries(['ANTECEDENTES', 'TABAGISMO', 'SEDENTARISMO', 'SOBREPESO', 'INFARTO', 'CORONARIOPATIA', 'AVC', 'PE_DIABETICO', 'AMPUTACAO', 'DOENCA_RENAL'].map((k) => [k, sn(h.fatores, k)])),
      ...Object.fromEntries(['HIDROCLOROTIAZIDA', 'PROPRANOLOL', 'CAPTOPRIL', 'LOSARTANA', 'GLIBENCLAMIDA', 'METFORMINA', 'INSULINA'].map((k) => [k, sn(h.medicamentos, k)])),
      OUTROS_MED: sn(h.medicamentos, 'OUTROS'),
      NAO_MEDICAMENTOSO: h.nao_medicamentoso ? 'S' : 'N',
      CNS_PROF: digitos(h.cns_prof),
    }),
  );
  return { conteudo: Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1'), registros: linhas.length, ids: regs.map((r) => r.id as number) };
}

// ---------------------------------------------------------------------------
// Indicadores: exame solicitado automaticamente pela guia de solicitação (TR 1.2.36.12)
// ---------------------------------------------------------------------------
const PUBLICO_SQL: Record<string, string> = {
  DIABETICOS: `'diabetes' = any(p.condicoes_saude)`,
  HIPERTENSOS: `'hipertensao' = any(p.condicoes_saude)`,
  GESTANTES: `('gestante' = any(p.condicoes_saude) or exists (select 1 from amb.gestacao g where g.paciente_id = p.id and g.situacao = 'EM_ACOMPANHAMENTO'))`,
  MULHERES_25_64: `p.sexo = 'F' and extract(year from age(p.data_nascimento)) between 25 and 64`,
  MULHERES_50_69: `p.sexo = 'F' and extract(year from age(p.data_nascimento)) between 50 and 69`,
  TODOS: 'true',
};

/**
 * Situação de cada cidadão do público no critério: REALIZADO (exame realizado/avaliado ou produção),
 * SOLICITADO (assim que a guia de solicitação de exame é gerada, automaticamente) ou PENDENTE.
 */
export async function situacaoIndicador(c: pg.Pool | pg.PoolClient, indicadorId: number, unidadeId: number | null) {
  const ind = (await c.query(`select * from esus.indicador where id = $1`, [indicadorId])).rows[0];
  if (!ind) throw new ErroHttp(404, 'Critério não encontrado.');
  const codigos = String(ind.procedimentos).split(/[,;\s]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean);
  const gestacao = !!(await c.query(`select to_regclass('amb.gestacao') t`)).rows[0].t;
  const publico = !gestacao && ind.publico === 'GESTANTES' ? `'gestante' = any(p.condicoes_saude)` : PUBLICO_SQL[ind.publico];
  const linhas = (
    await c.query(
      `with base as (
         select p.id, p.nome, p.cns, p.data_nascimento::text nasc, u.nome unidade,
                (select max(s.data)::text from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id join cad.procedimento pr on pr.id = i.procedimento_id
                  where s.paciente_id = p.id and pr.codigo = any($1) and s.situacao <> 'CANCELADO' and s.data >= current_date - ($2 || ' months')::interval) solicitado_em,
                (select max(coalesce(i.resultado_liberado_em::date, s.data))::text from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id join cad.procedimento pr on pr.id = i.procedimento_id
                  where s.paciente_id = p.id and pr.codigo = any($1) and i.situacao in ('REALIZADO','AVALIADO') and s.data >= current_date - ($2 || ' months')::interval) realizado_exame,
                (select max(fp.data)::text from fat.producao fp join cad.procedimento pr on pr.id = fp.procedimento_id
                  where fp.paciente_id = p.id and pr.codigo = any($1) and fp.data >= current_date - ($2 || ' months')::interval) realizado_producao
           from cad.pessoa p left join cad.unidade u on u.id = p.unidade_referencia_id
          where p.situacao = 'ATIVO' and ${publico} and ($3::bigint is null or p.unidade_referencia_id = $3) and p.id not in (select pessoa_id from seg.operador))
       select *, coalesce(realizado_exame, realizado_producao) realizado_em,
              case when coalesce(realizado_exame, realizado_producao) is not null then 'REALIZADO' when solicitado_em is not null then 'SOLICITADO' else 'PENDENTE' end situacao
         from base order by situacao desc, nome`,
      [codigos, String(ind.periodo_meses ?? 12), unidadeId],
    )
  ).rows;
  const total = linhas.length;
  const cont = (s: string) => linhas.filter((l) => l.situacao === s).length;
  return { indicador: ind, total, realizados: cont('REALIZADO'), solicitados: cont('SOLICITADO'), pendentes: cont('PENDENTE'), linhas };
}

// ---------------------------------------------------------------------------
// RNDS: Registro de Atendimento Clínico (TR 1.2.36.10)
// ---------------------------------------------------------------------------
/** Documento FHIR R4 (Bundle do modelo RAC) de um atendimento finalizado. */
export async function montarRac(c: pg.PoolClient, atendimentoId: number) {
  const a = (
    await c.query(
      `select a.id, a.entrada_em, a.fim_em, a.carater, p.cns, p.cpf, u.cnes, cd.codigo cid, ci.codigo ciap, (select x.cns from cad.pessoa x where x.id = pf.pessoa_id) cns_prof, cb.codigo cbo,
              (select json_agg(pr.codigo) from fat.producao fp join cad.procedimento pr on pr.id = fp.procedimento_id where fp.referencia = 'atendimento:' || a.id) procedimentos
         from amb.atendimento a join cad.pessoa p on p.id = a.paciente_id join cad.unidade u on u.id = a.unidade_id left join cad.cid cd on cd.id = a.cid_id left join cad.ciap ci on ci.id = a.ciap_id
         left join cad.profissional pf on pf.id = a.profissional_id left join cad.vinculo v on v.profissional_id = a.profissional_id and v.unidade_id = a.unidade_id and v.ativo left join cad.cbo cb on cb.id = v.cbo_id
        where a.id = $1`,
      [atendimentoId],
    )
  ).rows[0];
  if (!a) throw new ErroHttp(404, 'Atendimento não encontrado.');
  const ns = 'http://www.saude.gov.br/fhir/r4';
  return {
    resourceType: 'Bundle',
    meta: { lastUpdated: new Date().toISOString() },
    identifier: { system: `${ns}/NamingSystem/BRRegistroAtendimentoClinico`, value: `UBRISUS-RAC-${a.id}` },
    type: 'document',
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:composition-${a.id}`,
        resource: {
          resourceType: 'Composition',
          meta: { profile: [`${ns}/StructureDefinition/BRRegistroAtendimentoClinico-1.0`] },
          status: 'final',
          type: { coding: [{ system: `${ns}/CodeSystem/BRTipoDocumento`, code: 'RAC' }] },
          subject: { identifier: { system: `${ns}/NamingSystem/${a.cns ? 'cns' : 'cpf'}`, value: a.cns ?? a.cpf } },
          date: new Date(a.fim_em ?? a.entrada_em).toISOString(),
          author: [{ identifier: { system: `${ns}/NamingSystem/cnes`, value: a.cnes } }],
          title: 'Registro de Atendimento Clínico',
          section: [{ entry: [{ reference: `urn:uuid:encounter-${a.id}` }] }],
        },
      },
      {
        fullUrl: `urn:uuid:encounter-${a.id}`,
        resource: {
          resourceType: 'Encounter',
          status: 'finished',
          class: { system: `${ns}/CodeSystem/BRModalidadeAssistencial`, code: '01' },
          priority: { coding: [{ system: `${ns}/CodeSystem/BRCaraterAtendimento`, code: a.carater ?? '01' }] },
          period: { start: new Date(a.entrada_em).toISOString(), end: new Date(a.fim_em ?? a.entrada_em).toISOString() },
          participant: a.cns_prof ? [{ individual: { identifier: { system: `${ns}/NamingSystem/cns`, value: a.cns_prof } }, type: [{ coding: [{ system: `${ns}/CodeSystem/BRCBO`, code: a.cbo }] }] }] : [],
          diagnosis: [
            ...(a.cid ? [{ condition: { display: a.cid }, use: { coding: [{ system: `${ns}/CodeSystem/BRCID10`, code: a.cid }] } }] : []),
            ...(a.ciap ? [{ condition: { display: a.ciap }, use: { coding: [{ system: `${ns}/CodeSystem/BRCIAP2`, code: a.ciap }] } }] : []),
          ],
          serviceProvider: { identifier: { system: `${ns}/NamingSystem/cnes`, value: a.cnes } },
        },
      },
      ...((a.procedimentos ?? []) as string[]).map((p, i) => ({
        fullUrl: `urn:uuid:procedure-${a.id}-${i}`,
        resource: { resourceType: 'Procedure', status: 'completed', code: { coding: [{ system: `${ns}/CodeSystem/BRTabelaSUS`, code: p }] }, encounter: { reference: `urn:uuid:encounter-${a.id}` } },
      })),
    ],
  };
}

export async function enfileirarRac(c: pg.PoolClient, de: string, ate: string) {
  const ats = (
    await c.query(
      `select a.id, a.paciente_id from amb.atendimento a join cad.pessoa p on p.id = a.paciente_id
        where a.situacao = 'FINALIZADO' and a.entrada_em::date between $1 and $2 and (p.cns is not null or p.cpf is not null)
          and not exists (select 1 from esus.rnds_envio r where r.tipo = 'RAC' and r.referencia = 'atendimento:' || a.id)`,
      [de, ate],
    )
  ).rows;
  for (const a of ats) {
    await c.query(`insert into esus.rnds_envio (tipo, referencia, paciente_id, payload, situacao, tentativas) values ('RAC', $1, $2, $3, 'PENDENTE', 0)`, [`atendimento:${a.id}`, a.paciente_id, JSON.stringify(await montarRac(c, a.id))]);
  }
  return { enfileirados: ats.length };
}

interface ConfigRnds {
  ativo: boolean;
  urlAutenticacao: string;
  urlServicos: string;
  certificadoId: number;
  cpfResponsavel: string;
}

function requisitar(url: string, opcoes: https.RequestOptions & { corpo?: string }): Promise<{ status: number; corpo: string; cabecalhos: Record<string, unknown> }> {
  const { corpo, ...opts } = opcoes;
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(url), { ...opts, timeout: 20_000 }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (d: Buffer) => partes.push(d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8'), cabecalhos: res.headers as Record<string, unknown> }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado na comunicação com a RNDS.')));
    if (corpo) req.write(corpo);
    req.end();
  });
}

/** Envia os registros pendentes à RNDS (autenticação mútua com o certificado do estabelecimento). */
export async function enviarPendentesRnds(c: pg.PoolClient, limite = 50) {
  const cfg = (await consultarUm(`select valor from sis.parametro where chave = 'integracao.rnds'`))?.valor as ConfigRnds | undefined;
  if (!cfg?.ativo) throw new ErroHttp(503, 'Integração com a RNDS não ativada (Parâmetros > integracao.rnds). Os registros permanecem na fila de envio.');
  const cert = (await c.query(`select conteudo_cifrado from seg.certificado where id = $1 and ativo`, [cfg.certificadoId])).rows[0];
  if (!cert) throw new ErroHttp(503, 'Certificado digital da integração RNDS não encontrado.');
  const pacote = JSON.parse(decifrar(cert.conteudo_cifrado).toString('utf8')) as { pfx: string; senha: string };
  const tls = { pfx: Buffer.from(pacote.pfx, 'base64'), passphrase: pacote.senha };
  const auth = await requisitar(cfg.urlAutenticacao, { method: 'GET', ...tls });
  if (auth.status !== 200) throw new ErroHttp(502, `Falha na autenticação RNDS (HTTP ${auth.status}).`);
  const token = JSON.parse(auth.corpo).access_token;
  const pend = (await c.query(`select id, payload from esus.rnds_envio where situacao in ('PENDENTE','ERRO') and tentativas < 5 order by id limit $1`, [limite])).rows;
  let enviados = 0;
  for (const p of pend) {
    const r = await requisitar(`${cfg.urlServicos.replace(/\/$/, '')}/api/fhir/r4/Bundle`, {
      method: 'POST',
      ...tls,
      headers: { 'Content-Type': 'application/json', 'X-Authorization-Server': `Bearer ${token}`, Authorization: cfg.cpfResponsavel },
      corpo: JSON.stringify(p.payload),
    }).catch((e) => ({ status: 0, corpo: (e as Error).message, cabecalhos: {} as Record<string, unknown> }));
    const ok = r.status === 201 || r.status === 200;
    await c.query(`update esus.rnds_envio set situacao = $2, protocolo = $3, resposta = $4, tentativas = tentativas + 1, enviado_em = case when $5 then now() end where id = $1`, [
      p.id,
      ok ? 'ENVIADO' : 'ERRO',
      ok ? String(r.cabecalhos['location'] ?? '').slice(0, 120) || null : null,
      r.corpo.slice(0, 4000),
      ok,
    ]);
    if (ok) enviados++;
  }
  return { enviados, tentados: pend.length };
}
