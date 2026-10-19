// Regras do prontuário odontológico: classificação dos dentes (FDI), resolução automática dos
// procedimentos SIGTAP por tipo de dente, validação SIGTAP antes do registro, lançamento da
// produção (BPA), estado atual do odontograma e índices CPO-D / ceo-d (TR 1.2.34.26 a 1.2.34.30).
import type pg from 'pg';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { lancarProducao, validarProcedimento } from '../faturamento/producao.js';

type C = pg.PoolClient;

// ---------------------------------------------------------------------------
// Dentes (notação FDI)
// ---------------------------------------------------------------------------
export const DENTES_PERMANENTES = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const DENTES_DECIDUOS = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
export const FACES = ['M', 'D', 'O', 'V', 'L'];

export const ehDenteValido = (d: number) => DENTES_PERMANENTES.includes(d) || DENTES_DECIDUOS.includes(d);
export const ehDeciduo = (d: number) => Math.floor(d / 10) >= 5;
/** Quadrante equivalente da dentição permanente (1 a 4). */
export const quadranteDe = (d: number) => ((Math.floor(d / 10) - 1) % 4) + 1;
export const arcadaDe = (d: number) => ([1, 2].includes(quadranteDe(d)) ? 'SUPERIOR' : 'INFERIOR');
export function sextanteDe(d: number) {
  const q = quadranteDe(d);
  const pos = d % 10;
  const anterior = pos <= 3;
  if (q === 1) return anterior ? 2 : 1;
  if (q === 2) return anterior ? 2 : 3;
  if (q === 3) return anterior ? 5 : 4;
  return anterior ? 5 : 6;
}
/** Número de raízes do dente permanente (classificação usada pelo SIGTAP na endodontia). */
export function raizesDe(d: number) {
  if (ehDeciduo(d)) return 1;
  const pos = d % 10;
  const superior = arcadaDe(d) === 'SUPERIOR';
  if (pos <= 3) return 1;
  if (pos === 4) return superior ? 2 : 1;
  if (pos === 5) return 1;
  return superior ? 3 : 2;
}

/** O item SIGTAP se aplica a este dente? (escolha automática do código conforme o elemento). */
export function itemAplica(aplicaA: string | null | undefined, dente: number | null) {
  if (!aplicaA || aplicaA === 'TODOS' || dente == null) return true;
  const dec = ehDeciduo(dente);
  const pos = dente % 10;
  switch (aplicaA) {
    case 'DECIDUO':
      return dec;
    case 'PERMANENTE':
      return !dec;
    case 'PERMANENTE_ANTERIOR':
      return !dec && pos <= 3;
    case 'PERMANENTE_POSTERIOR':
      return !dec && pos >= 4;
    case 'UNIRRADICULAR':
      return !dec && raizesDe(dente) === 1;
    case 'BIRRADICULAR':
      return !dec && raizesDe(dente) === 2;
    case 'MULTIRRADICULAR':
      return !dec && raizesDe(dente) >= 3;
  }
  return true;
}

/** Dentes contidos na região marcada (arcada, quadrante, sextante ou boca) para a dentição informada. */
export function dentesDaRegiao(r: { marcacao: string; arcada?: string | null; quadrante?: number | null; sextante?: number | null }, denticao: string) {
  const base = denticao === 'DECIDUA' ? DENTES_DECIDUOS : denticao === 'MISTA' ? [...DENTES_PERMANENTES, ...DENTES_DECIDUOS] : DENTES_PERMANENTES;
  return base.filter((d) => {
    if (r.marcacao === 'BOCA') return true;
    if (r.marcacao === 'ARCADA') return arcadaDe(d) === r.arcada;
    if (r.marcacao === 'QUADRANTE') return quadranteDe(d) === r.quadrante;
    if (r.marcacao === 'SEXTANTE') return sextanteDe(d) === r.sextante;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Procedimentos odontológicos -> SIGTAP
// ---------------------------------------------------------------------------
export interface ItemSigtap {
  procedimentoId: number;
  codigo: string;
  nome: string;
  quantidade: number;
}

/**
 * Procedimentos SIGTAP gerados por um procedimento odontológico pré-cadastrado no dente/região
 * (ex.: tratamento de canal gera acesso à polpa, curativo e a obturação conforme o número de raízes) (TR 1.2.34.29).
 */
export async function itensSigtap(c: C | pg.Pool, procOdontoId: number, alvo: { dente?: number | null; elementos: number }): Promise<ItemSigtap[]> {
  const itens = (
    await c.query(
      `select i.procedimento_id, i.aplica_a, coalesce(i.quantidade, 1) quantidade, coalesce(i.por_elemento, true) por_elemento, p.codigo, p.nome
         from odo.procedimento_item i join cad.procedimento p on p.id = i.procedimento_id where i.procedimento_odonto_id = $1 order by i.id`,
      [procOdontoId],
    )
  ).rows;
  return itens
    .filter((i) => itemAplica(i.aplica_a, alvo.dente ?? null))
    .map((i) => ({ procedimentoId: Number(i.procedimento_id), codigo: i.codigo, nome: i.nome, quantidade: i.quantidade * (i.por_elemento ? Math.max(alvo.elementos, 1) : 1) }));
}

/** Valida os itens SIGTAP para o paciente e o profissional (sexo, idade, CBO, procedimento ativo) (TR 1.2.34.30). */
export async function validarItens(c: C | pg.Pool, itens: ItemSigtap[], pacienteId: number, profissionalId: number | null, unidadeId: number | null) {
  const paciente = (await c.query(`select sexo, data_nascimento::text data_nascimento from cad.pessoa where id = $1`, [pacienteId])).rows[0] ?? null;
  const cbo = profissionalId
    ? ((
        await c.query(
          `select cb.codigo from cad.vinculo v join cad.cbo cb on cb.id = v.cbo_id where v.profissional_id = $1 and v.ativo order by (v.unidade_id = $2) desc limit 1`,
          [profissionalId, unidadeId],
        )
      ).rows[0]?.codigo ?? null)
    : null;
  const criticas: string[] = [];
  for (const i of itens) {
    const proc = (await c.query(`select * from cad.procedimento where id = $1`, [i.procedimentoId])).rows[0];
    if (!proc) continue;
    const v = await validarProcedimento(c, proc, paciente, cbo, new Date());
    for (const cr of v.criticas) criticas.push(`${i.codigo} - ${i.nome}: ${cr}`);
    if (proc.quantidade_maxima && i.quantidade > proc.quantidade_maxima) criticas.push(`${i.codigo} - ${i.nome}: quantidade ${i.quantidade} acima da máxima permitida (${proc.quantidade_maxima}).`);
  }
  return criticas;
}

/** Lança a produção (BPA) dos procedimentos executados, vinculada ao atendimento (TR 1.2.34.30). */
export async function lancarItens(c: C, itens: ItemSigtap[], at: { id: number; unidade_id: number; paciente_id: number; carater?: string | null; cid_codigo?: string | null }, profissionalId: number | null) {
  const ids: number[] = [];
  for (const i of itens) {
    const r = await lancarProducao(c, {
      data: new Date(),
      unidadeId: at.unidade_id,
      profissionalId,
      pacienteId: at.paciente_id,
      procedimentoId: i.procedimentoId,
      quantidade: i.quantidade,
      cidCodigo: at.cid_codigo ?? null,
      carater: at.carater ?? undefined,
      origem: 'ODONTOLOGIA',
      referencia: `atendimento:${at.id}`,
    });
    if (r) ids.push(r.id);
  }
  return ids;
}

/** Estorna a produção ainda não exportada no BPA (cancelamento de procedimento executado). */
export async function estornarProducao(c: C, ids: number[]) {
  if (!ids.length) return;
  const exportada = (await c.query(`select count(*)::int n from fat.producao where id = any($1) and situacao = 'EXPORTADO'`, [ids])).rows[0].n;
  if (exportada) throw new ErroHttp(422, 'O procedimento já foi exportado no BPA e não pode ser cancelado.');
  await c.query(`delete from fat.producao where id = any($1)`, [ids]);
}

// ---------------------------------------------------------------------------
// Estado do odontograma e índices
// ---------------------------------------------------------------------------
export interface EstadoDente {
  dente: number;
  situacao: { id: number; codigo: string; nome: string; cor: string; simbolo: string | null; componente: string } | null;
  faces: Record<string, { id: number; codigo: string; nome: string; cor: string; simbolo: string | null; componente: string }>;
  planejados: string[];
}

/** Marcações vigentes do paciente (registradas, planejadas e executadas), com a situação efetiva. */
export async function marcacoesPaciente(c: C | pg.Pool, pacienteId: number) {
  return (
    await c.query(
      `select m.id, m.data::text data, m.marcacao, m.dente, m.faces, m.arcada, m.quadrante, m.sextante, m.status, m.observacao, m.plano_id, m.etapa_id,
              m.atendimento_id, m.executado_atendimento_id, m.executado_em, m.motivo_cancelamento, m.producao,
              m.situacao_id, s.codigo situacao_codigo, s.nome situacao_nome, s.cor situacao_cor, s.simbolo situacao_simbolo, s.componente_cpo situacao_cpo, s.abrangencia,
              m.procedimento_odonto_id, po.nome procedimento, po.cor procedimento_cor,
              rs.id resultante_id, rs.codigo resultante_codigo, rs.nome resultante_nome, rs.cor resultante_cor, rs.simbolo resultante_simbolo, rs.componente_cpo resultante_cpo, rs.abrangencia resultante_abrangencia,
              pr.nome profissional, pe.nome profissional_execucao, u.nome unidade, e.descricao etapa
         from odo.marcacao m left join odo.situacao s on s.id = m.situacao_id left join odo.procedimento po on po.id = m.procedimento_odonto_id
         left join odo.situacao rs on rs.id = po.situacao_resultante_id left join cad.profissional pr on pr.id = m.profissional_id
         left join cad.profissional pe on pe.id = m.executado_profissional_id left join cad.unidade u on u.id = m.unidade_id
         left join odo.plano_etapa e on e.id = m.etapa_id
        where m.paciente_id = $1 order by coalesce(m.executado_em::date, m.data), m.id`,
      [pacienteId],
    )
  ).rows;
}

/** Calcula o estado atual de cada dente a partir da evolução (situações e procedimentos executados). */
export function estadoOdontograma(marcacoes: any[]): Record<number, EstadoDente> {
  const estado: Record<number, EstadoDente> = {};
  const de = (d: number) => (estado[d] ??= { dente: d, situacao: null, faces: {}, planejados: [] });
  for (const m of marcacoes) {
    if (m.dente == null || m.status === 'CANCELADO') continue;
    const e = de(m.dente);
    if (m.status === 'PLANEJADO') {
      if (m.procedimento) e.planejados.push(m.procedimento);
      continue;
    }
    // Situação efetiva: informada diretamente ou resultante do procedimento executado.
    const s = m.situacao_id
      ? { id: m.situacao_id, codigo: m.situacao_codigo, nome: m.situacao_nome, cor: m.situacao_cor, simbolo: m.situacao_simbolo, componente: m.situacao_cpo, abr: m.abrangencia }
      : m.resultante_id && m.status === 'EXECUTADO'
        ? { id: m.resultante_id, codigo: m.resultante_codigo, nome: m.resultante_nome, cor: m.resultante_cor, simbolo: m.resultante_simbolo, componente: m.resultante_cpo, abr: m.resultante_abrangencia }
        : null;
    if (!s) continue;
    const { abr, ...sit } = s;
    const faces: string[] = m.faces ?? [];
    if (abr === 'FACE' && faces.length) {
      for (const f of faces) e.faces[f] = sit;
      // Face tratada/registrada indica dente presente: remove situações de dente "hígido".
      if (e.situacao?.componente === 'H') e.situacao = null;
    } else {
      e.situacao = sit;
      e.faces = {};
    }
  }
  return estado;
}

/** Componente do índice para o dente (prioridade: cariado > perdido/extração indicada > obturado > hígido). */
function componenteDente(e: EstadoDente) {
  const comps = [e.situacao?.componente, ...Object.values(e.faces).map((f) => f.componente)].filter(Boolean) as string[];
  if (comps.includes('C')) return 'C';
  if (comps.includes('P')) return 'P';
  if (comps.includes('EI')) return 'EI';
  if (comps.includes('O')) return 'O';
  return comps.length ? 'H' : null;
}

/** Índices CPO-D (dentes permanentes) e ceo-d (dentes decíduos) a partir do estado atual. */
export function indicesCpo(estado: Record<number, EstadoDente>) {
  const cpo = { C: 0, P: 0, O: 0, total: 0, examinados: 0 };
  const ceo = { c: 0, e: 0, o: 0, total: 0, examinados: 0 };
  for (const e of Object.values(estado)) {
    const comp = componenteDente(e);
    if (!comp) continue;
    if (ehDeciduo(e.dente)) {
      ceo.examinados++;
      if (comp === 'C') ceo.c++;
      else if (comp === 'EI') ceo.e++;
      else if (comp === 'O') ceo.o++;
    } else {
      cpo.examinados++;
      if (comp === 'C') cpo.C++;
      else if (comp === 'P' || comp === 'EI') cpo.P++;
      else if (comp === 'O') cpo.O++;
    }
  }
  cpo.total = cpo.C + cpo.P + cpo.O;
  ceo.total = ceo.c + ceo.e + ceo.o;
  return { cpod: cpo, ceod: ceo };
}

// ---------------------------------------------------------------------------
// Registro de marcações
// ---------------------------------------------------------------------------
export interface NovaMarcacao {
  pacienteId: number;
  atendimentoId?: number | null;
  planoId?: number | null;
  etapaId?: number | null;
  marcacao: string;
  dentes?: number[];
  faces?: string[];
  arcada?: string | null;
  quadrante?: number | null;
  sextante?: number | null;
  denticao?: string;
  situacaoId?: number | null;
  procedimentoOdontoId?: number | null;
  status: 'EXISTENTE' | 'PLANEJADO' | 'EXECUTADO';
  observacao?: string | null;
}

async function atendimentoAberto(c: C, id: number) {
  const at = (
    await c.query(`select a.*, ci.codigo cid_codigo from amb.atendimento a left join cad.cid ci on ci.id = a.cid_id where a.id = $1`, [id])
  ).rows[0];
  if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
  if (['FINALIZADO', 'CANCELADO', 'NAO_ATENDIDO', 'EVADIDO'].includes(at.situacao)) throw new ErroHttp(409, 'O atendimento já foi encerrado.');
  return at;
}

/**
 * Registra no odontograma situações, procedimentos planejados ou executados por dente, face ou região
 * (arcada, quadrante, sextante, boca), validando as regras SIGTAP e lançando a produção (TR 1.2.34.26 a 1.2.34.30).
 */
export async function registrarMarcacoes(c: C, b: NovaMarcacao, u: Usuario) {
  if (!b.situacaoId && !b.procedimentoOdontoId) throw new ErroHttp(422, 'Informe a situação ou o procedimento.');
  const regiao = ['ARCADA', 'QUADRANTE', 'SEXTANTE', 'BOCA'].includes(b.marcacao);
  const dentes = [...new Set(b.dentes ?? [])];
  if (!regiao) {
    if (!dentes.length) throw new ErroHttp(422, 'Selecione ao menos um dente no odontograma.');
    const invalidos = dentes.filter((d) => !ehDenteValido(d));
    if (invalidos.length) throw new ErroHttp(422, `Dente(s) inválido(s): ${invalidos.join(', ')}.`);
  } else {
    if (b.marcacao === 'ARCADA' && !['SUPERIOR', 'INFERIOR'].includes(b.arcada ?? '')) throw new ErroHttp(422, 'Selecione a arcada.');
    if (b.marcacao === 'QUADRANTE' && ![1, 2, 3, 4].includes(b.quadrante ?? 0)) throw new ErroHttp(422, 'Selecione o quadrante.');
    if (b.marcacao === 'SEXTANTE' && ![1, 2, 3, 4, 5, 6].includes(b.sextante ?? 0)) throw new ErroHttp(422, 'Selecione o sextante.');
  }
  const sit = b.situacaoId ? (await c.query(`select * from odo.situacao where id = $1 and ativo`, [b.situacaoId])).rows[0] : null;
  if (b.situacaoId && !sit) throw new ErroHttp(422, 'Situação dentária inexistente ou inativa.');
  if (sit && regiao) throw new ErroHttp(422, 'Situações dentárias são registradas por dente ou face.');
  if (sit?.abrangencia === 'FACE' && b.marcacao === 'FACE' && !b.faces?.length) throw new ErroHttp(422, 'Selecione as faces do dente.');
  const proc = b.procedimentoOdontoId ? (await c.query(`select * from odo.procedimento where id = $1 and ativo`, [b.procedimentoOdontoId])).rows[0] : null;
  if (b.procedimentoOdontoId && !proc) throw new ErroHttp(422, 'Procedimento odontológico inexistente ou inativo.');
  if (proc) {
    if (proc.marcacao === 'FACE' && b.marcacao === 'FACE' && !b.faces?.length) throw new ErroHttp(422, `Selecione as faces para "${proc.nome}".`);
    if (proc.marcacao === 'SEXTANTE' && !['SEXTANTE', 'ARCADA', 'BOCA'].includes(b.marcacao))
      throw new ErroHttp(422, `"${proc.nome}" é registrado por sextante: marque o sextante, a arcada ou a boca.`);
    if (['BOCA'].includes(proc.marcacao) && b.marcacao !== 'BOCA') throw new ErroHttp(422, `"${proc.nome}" é registrado para a boca toda.`);
    for (const d of dentes) {
      if (proc.denticao === 'PERMANENTE' && ehDeciduo(d)) throw new ErroHttp(422, `"${proc.nome}" não se aplica ao dente decíduo ${d}.`);
      if (proc.denticao === 'DECIDUA' && !ehDeciduo(d)) throw new ErroHttp(422, `"${proc.nome}" aplica-se somente a dentes decíduos (dente ${d}).`);
    }
  }
  if (b.status === 'EXECUTADO' && !proc) throw new ErroHttp(422, 'Somente procedimentos podem ser registrados como executados.');
  if (b.status === 'EXISTENTE' && !sit) throw new ErroHttp(422, 'Informe a situação dentária a registrar.');
  if (b.status === 'EXECUTADO' && !b.atendimentoId) throw new ErroHttp(422, 'A execução de procedimentos deve ser registrada durante um atendimento.');
  const at = b.atendimentoId ? await atendimentoAberto(c, b.atendimentoId) : null;
  if (at && at.paciente_id !== b.pacienteId) throw new ErroHttp(422, 'O atendimento informado é de outro paciente.');
  const profissionalId = u.profissionalId ?? at?.profissional_id ?? null;
  const unidadeId = at?.unidade_id ?? u.unidadeAtual ?? null;
  if (b.planoId) {
    const pl = (await c.query(`select * from odo.plano_tratamento where id = $1`, [b.planoId])).rows[0];
    if (!pl || pl.paciente_id !== b.pacienteId) throw new ErroHttp(422, 'Plano de tratamento inválido para o paciente.');
    if (pl.situacao !== 'EM_ANDAMENTO') throw new ErroHttp(409, 'O plano de tratamento não está em andamento.');
  }

  // Elementos de cada registro: um por dente (ou um para a região).
  const alvos: { dente: number | null; elementos: number }[] = regiao
    ? [
        {
          dente: null,
          elementos:
            proc?.marcacao === 'SEXTANTE'
              ? b.marcacao === 'BOCA'
                ? 6
                : b.marcacao === 'ARCADA'
                  ? 3
                  : 1
              : ['DENTE', 'FACE'].includes(proc?.marcacao)
                ? dentesDaRegiao(b, b.denticao ?? 'PERMANENTE').length
                : 1,
        },
      ]
    : dentes.map((d) => ({ dente: d, elementos: 1 }));

  // Validação SIGTAP antes de gravar, evitando críticas na produção BPA (TR 1.2.34.30).
  const itensPorAlvo = proc ? await Promise.all(alvos.map((a) => itensSigtap(c, proc.id, a))) : alvos.map(() => []);
  if (proc) {
    const todos = itensPorAlvo.flat();
    if (!todos.length) throw new ErroHttp(422, `"${proc.nome}" não possui procedimento SIGTAP aplicável a este elemento. Verifique o cadastro do procedimento odontológico.`);
    const criticas = await validarItens(c, todos, b.pacienteId, profissionalId, unidadeId);
    if (criticas.length) throw new ErroHttp(422, `Regras do SIGTAP não atendidas: ${[...new Set(criticas)].join(' ')}`, { criticas });
  }

  const criados = [];
  for (let i = 0; i < alvos.length; i++) {
    const a = alvos[i];
    const producao = b.status === 'EXECUTADO' && at ? await lancarItens(c, itensPorAlvo[i], at, profissionalId) : [];
    const r = (
      await c.query(
        `insert into odo.marcacao (paciente_id, atendimento_id, plano_id, etapa_id, data, profissional_id, unidade_id, marcacao, dente, faces, arcada, quadrante, sextante,
                                   situacao_id, procedimento_odonto_id, status, executado_em, executado_atendimento_id, executado_profissional_id, producao, observacao)
         values ($1,$2,$3,$4,current_date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
        [
          b.pacienteId,
          b.atendimentoId ?? null,
          b.planoId ?? null,
          b.etapaId ?? null,
          profissionalId,
          unidadeId,
          b.marcacao,
          a.dente,
          b.faces?.length && !regiao ? b.faces : null,
          b.marcacao === 'ARCADA' ? b.arcada : null,
          b.marcacao === 'QUADRANTE' ? b.quadrante : null,
          b.marcacao === 'SEXTANTE' ? b.sextante : null,
          sit?.id ?? null,
          proc?.id ?? null,
          b.status,
          b.status === 'EXECUTADO' ? new Date() : null,
          b.status === 'EXECUTADO' ? (at?.id ?? null) : null,
          b.status === 'EXECUTADO' ? profissionalId : null,
          JSON.stringify(producao),
          b.observacao ?? null,
        ],
      )
    ).rows[0];
    criados.push({ ...r, sigtap: itensPorAlvo[i] });
  }
  if (b.etapaId) await atualizarEtapa(c, b.etapaId);
  return criados;
}

/** Executa um procedimento planejado no atendimento atual, com validação SIGTAP e produção. */
export async function executarMarcacao(c: C, id: number, atendimentoId: number, u: Usuario) {
  const m = (await c.query(`select * from odo.marcacao where id = $1 for update`, [id])).rows[0];
  if (!m) throw new ErroHttp(404, 'Marcação não encontrada.');
  if (m.status !== 'PLANEJADO') throw new ErroHttp(409, 'Somente procedimentos planejados podem ser executados.');
  const at = await atendimentoAberto(c, atendimentoId);
  if (at.paciente_id !== m.paciente_id) throw new ErroHttp(422, 'O atendimento informado é de outro paciente.');
  const profissionalId = u.profissionalId ?? at.profissional_id ?? null;
  const proc = (await c.query(`select * from odo.procedimento where id = $1`, [m.procedimento_odonto_id])).rows[0];
  const elementos = m.dente
    ? 1
    : proc.marcacao === 'SEXTANTE'
      ? m.marcacao === 'BOCA'
        ? 6
        : m.marcacao === 'ARCADA'
          ? 3
          : 1
      : ['DENTE', 'FACE'].includes(proc.marcacao)
        ? dentesDaRegiao(m, 'PERMANENTE').length
        : 1;
  const itens = await itensSigtap(c, proc.id, { dente: m.dente, elementos });
  const criticas = await validarItens(c, itens, m.paciente_id, profissionalId, at.unidade_id);
  if (criticas.length) throw new ErroHttp(422, `Regras do SIGTAP não atendidas: ${[...new Set(criticas)].join(' ')}`, { criticas });
  const producao = await lancarItens(c, itens, at, profissionalId);
  await c.query(
    `update odo.marcacao set status = 'EXECUTADO', executado_em = now(), executado_atendimento_id = $2, executado_profissional_id = $3, producao = $4 where id = $1`,
    [id, at.id, profissionalId, JSON.stringify(producao)],
  );
  if (m.etapa_id) await atualizarEtapa(c, m.etapa_id);
  return { ok: true, sigtap: itens };
}

export async function cancelarMarcacao(c: C, id: number, motivo: string) {
  const m = (await c.query(`select * from odo.marcacao where id = $1 for update`, [id])).rows[0];
  if (!m) throw new ErroHttp(404, 'Marcação não encontrada.');
  if (m.status === 'CANCELADO') throw new ErroHttp(409, 'Marcação já cancelada.');
  if (m.status === 'EXECUTADO') {
    const at = (await c.query(`select situacao from amb.atendimento where id = $1`, [m.executado_atendimento_id])).rows[0];
    if (at?.situacao === 'FINALIZADO') throw new ErroHttp(409, 'Procedimento de atendimento já finalizado: registre a correção em novo atendimento.');
    await estornarProducao(c, (m.producao as number[] | null) ?? []);
  }
  await c.query(`update odo.marcacao set status = 'CANCELADO', motivo_cancelamento = $2, producao = '[]' where id = $1`, [id, motivo]);
  if (m.etapa_id) await atualizarEtapa(c, m.etapa_id);
  return { ok: true };
}

/** Etapa concluída quando todos os procedimentos vinculados foram executados. */
export async function atualizarEtapa(c: C, etapaId: number) {
  const r = (
    await c.query(
      `select count(*) filter (where status = 'PLANEJADO')::int pendentes, count(*) filter (where status = 'EXECUTADO')::int executados from odo.marcacao where etapa_id = $1`,
      [etapaId],
    )
  ).rows[0];
  if (r.executados > 0 && r.pendentes === 0) await c.query(`update odo.plano_etapa set situacao = 'CONCLUIDA', concluida_em = coalesce(concluida_em, current_date) where id = $1`, [etapaId]);
  else await c.query(`update odo.plano_etapa set situacao = 'PENDENTE', concluida_em = null where id = $1 and $2::int > 0`, [etapaId, r.pendentes]);
}
