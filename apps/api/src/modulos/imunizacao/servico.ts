// Regras de imunização: carteira de vacinação com situação por cores, aplicação com validação do quadro
// de cobertura, incompatibilidades, gestantes, frascos multidose, diluentes, aprazamento e estoque.
import type pg from 'pg';
import { consultar, consultarUm, pool } from '../../db/pool.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { baixarFefo, movimentar } from '../farmacia/servico.js';

type C = pg.PoolClient;
const DIA = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const diasEntre = (a: string | Date, b: string | Date) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DIA);
const txt = (d: any) => (d instanceof Date ? iso(d) : String(d).slice(0, 10));

export type SituacaoDose = 'APLICADA' | 'RESGATADA' | 'APRAZADA' | 'INDICADA' | 'NO_PRAZO' | 'ATRASADA' | 'FUTURA' | 'SEM_EFEITO';
/** Cores da carteira (TR 1.2.39.1.16): azul aplicada/resgatada, verde no prazo, vermelho fora do prazo, cinza sem efeito. */
export const COR_SITUACAO: Record<SituacaoDose, string> = {
  APLICADA: 'AZUL',
  RESGATADA: 'AZUL',
  APRAZADA: 'VERDE',
  INDICADA: 'VERDE',
  NO_PRAZO: 'VERDE',
  ATRASADA: 'VERMELHO',
  FUTURA: 'CINZA',
  SEM_EFEITO: 'CINZA',
};

async function paciente(c: C | pg.Pool, id: number) {
  const p = (
    await c.query(
      `select p.id, p.nome, p.sexo, p.data_nascimento::text nascimento,
              exists (select 1 from amb.gestacao g where g.paciente_id = p.id and g.situacao = 'EM_ACOMPANHAMENTO') gestante
         from cad.pessoa p where p.id = $1`,
      [id],
    )
  ).rows[0];
  if (!p) throw new ErroHttp(404, 'Paciente não encontrado.');
  return p as { id: number; nome: string; sexo: string; nascimento: string; gestante: boolean };
}

/** Carteira de vacinação do paciente conforme o quadro de cobertura (TR 1.2.39.1.16 a 1.2.39.1.18). */
export async function carteira(pacienteId: number) {
  const p = await paciente(pool, pacienteId);
  const idade = diasEntre(p.nascimento, new Date());
  const quadro = await consultar(
    `select q.*, i.nome imunobiologico, i.sigla, i.ordem_carteira, d.sigla dose, d.nome dose_nome, d.ordem dose_ordem
       from imu.quadro_cobertura q join imu.imunobiologico i on i.id = q.imunobiologico_id join imu.dose d on d.id = q.dose_id
      where i.ativo and i.exibir_carteira and q.estrategia = 'ROTINA' and (q.sexo is null or q.sexo = 'A' or q.sexo = $1)
      order by i.ordem_carteira, i.nome, d.ordem`,
    [p.sexo],
  );
  const registros = await consultar(
    `select v.id, v.imunobiologico_id, v.dose_id, v.tipo, v.data::text data, v.data_aprazada::text data_aprazada, v.inadvertida, v.estrategia,
            coalesce(l.lote, v.lote_texto) lote, u.nome unidade, u.cnes, coalesce(pr.nome, v.profissional_texto) profissional, i.sigla, i.nome imunobiologico, d.sigla dose
       from imu.vacinacao v join imu.imunobiologico i on i.id = v.imunobiologico_id left join imu.dose d on d.id = v.dose_id
       left join far.estoque_lote l on l.id = v.lote_id left join cad.unidade u on u.id = v.unidade_id left join cad.profissional pr on pr.id = v.profissional_id
      where v.paciente_id = $1 order by v.data`,
    [pacienteId],
  );
  // Equivalências: aplicações que contam como outra vacina/dose (TR 1.2.39.1.7).
  const equivalencias = await consultar(`select imunobiologico_id, dose_id, equivale_id, equivale_dose_id from imu.imunobiologico_equivalencia`);
  const aplicadas = registros.filter((r) => r.tipo === 'APLICACAO' || r.tipo === 'RESGATE');
  const cumpre = (imuno: number, dose: number) =>
    aplicadas.find((a) => Number(a.imunobiologico_id) === imuno && Number(a.dose_id) === dose) ??
    aplicadas.find((a) =>
      equivalencias.some(
        (e) => Number(e.imunobiologico_id) === Number(a.imunobiologico_id) && (!e.dose_id || Number(e.dose_id) === Number(a.dose_id)) && Number(e.equivale_id) === imuno && (!e.equivale_dose_id || Number(e.equivale_dose_id) === dose),
      ),
    );
  const hoje = iso(new Date());
  const itens = quadro
    .filter((q) => q.faixa_carteira !== 'GESTANTE' || p.sexo === 'F')
    .map((q) => {
      const feito = cumpre(Number(q.imunobiologico_id), Number(q.dose_id));
      const aprazado = registros.find((r) => r.tipo === 'APRAZAMENTO' && Number(r.imunobiologico_id) === Number(q.imunobiologico_id) && Number(r.dose_id) === Number(q.dose_id));
      const indicado = registros.find((r) => r.tipo === 'INDICACAO' && Number(r.imunobiologico_id) === Number(q.imunobiologico_id) && Number(r.dose_id) === Number(q.dose_id));
      let situacao: SituacaoDose;
      if (feito) situacao = feito.tipo === 'RESGATE' ? 'RESGATADA' : 'APLICADA';
      else if (aprazado) situacao = aprazado.data < hoje ? 'ATRASADA' : 'APRAZADA';
      else if (indicado) situacao = 'INDICADA';
      else if (idade < Number(q.idade_minima_dias)) situacao = 'FUTURA';
      else if (q.idade_maxima_dias != null && idade > Number(q.idade_maxima_dias)) situacao = q.faixa_carteira === 'CRIANCA' ? 'SEM_EFEITO' : 'ATRASADA';
      else situacao = 'NO_PRAZO';
      const previsto = new Date(new Date(p.nascimento + 'T12:00:00').getTime() + Number(q.idade_minima_dias) * DIA);
      return {
        quadroId: q.id,
        imunobiologicoId: Number(q.imunobiologico_id),
        imunobiologico: q.imunobiologico,
        sigla: q.sigla,
        doseId: Number(q.dose_id),
        dose: q.dose,
        faixa: q.faixa_carteira ?? 'CRIANCA',
        idadeMinimaDias: Number(q.idade_minima_dias),
        idadeMaximaDias: q.idade_maxima_dias == null ? null : Number(q.idade_maxima_dias),
        previstoPara: iso(previsto),
        gestante: q.gestante,
        situacao,
        cor: COR_SITUACAO[situacao],
        registro: feito ?? aprazado ?? indicado ?? null,
      };
    });
  // Vencidas no sentido de atraso: dose em idade de aplicação sem registro há mais de 30 dias do previsto.
  for (const i of itens) if (i.situacao === 'NO_PRAZO' && diasEntre(i.previstoPara, hoje) > 30) (i.situacao = 'ATRASADA'), (i.cor = 'VERMELHO');
  const foraDoQuadro = aplicadas.filter((a) => !itens.some((i) => i.registro?.id === a.id));
  return { paciente: { ...p, idadeDias: idade }, itens, outrasAplicacoes: foraDoQuadro, registros };
}

export async function atrasadas(pacienteId: number) {
  return (await carteira(pacienteId)).itens.filter((i) => i.situacao === 'ATRASADA');
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------
export interface PedidoVacinacao {
  pacienteId: number;
  imunobiologicoId: number;
  doseId?: number | null;
  tipo: 'APLICACAO' | 'RESGATE' | 'APRAZAMENTO' | 'INDICACAO';
  data?: string;
  unidadeId?: number | null;
  loteId?: number | null;
  loteTexto?: string | null;
  profissionalTexto?: string | null;
  estrategia?: string;
  campanhaId?: number | null;
  grupoId?: number | null;
  viaAplicacao?: string | null;
  localAplicacao?: string | null;
  diluenteLoteId?: number | null;
  novoFrasco?: boolean;
  observacao?: string | null;
  confirmarAvisos?: boolean;
}

/** Validações clínicas da aplicação (TR 1.2.39.1.20 a 1.2.39.1.25, 1.2.39.1.34). Retorna avisos que tornam a aplicação inadvertida. */
async function validarAplicacao(c: C, p: Awaited<ReturnType<typeof paciente>>, v: PedidoVacinacao, data: string) {
  const idade = diasEntre(p.nascimento, data);
  const estrategia = v.estrategia ?? 'ROTINA';
  const linhas = (await c.query(`select * from imu.quadro_cobertura where imunobiologico_id = $1 and ($2::bigint is null or dose_id = $2)`, [v.imunobiologicoId, v.doseId ?? null])).rows;
  if (!linhas.length) throw new ErroHttp(422, 'Imunobiológico/dose fora do quadro de cobertura: aplicação não permitida (TR 1.2.39.1.20).');
  if (estrategia === 'CAMPANHA' && (!v.campanhaId || !v.grupoId)) throw new ErroHttp(422, 'Informe a campanha e o grupo de vacinação para aplicações de campanha (TR 1.2.39.1.34).');
  const avisos: string[] = [];
  const ok = linhas.filter((q) => (!q.estrategia || q.estrategia === estrategia || estrategia !== 'ROTINA') && idade >= Number(q.idade_minima_dias) && (q.idade_maxima_dias == null || idade <= Number(q.idade_maxima_dias)));
  if (!ok.length) avisos.push('Imunobiológico não recomendado para a faixa etária do paciente.');
  const sexoOk = linhas.some((q) => !q.sexo || q.sexo === 'A' || q.sexo === p.sexo);
  if (!sexoOk) avisos.push('Imunobiológico não recomendado para o sexo do paciente.');
  // Gestantes: mulheres de 10 a 49 anos são questionadas (TR 1.2.39.1.21, 1.2.39.1.25).
  const anos = idade / 365.25;
  if (p.sexo === 'F' && anos >= 10 && anos < 50 && p.gestante && linhas.every((q) => q.gestante === 'NAO_RECOMENDADO')) avisos.push('Imunobiológico não recomendado para gestantes.');
  // Incompatibilidades por intervalo mínimo (TR 1.2.39.1.23).
  const incomp = (
    await c.query(
      `select i.nome, v.data::text data, x.intervalo_dias from imu.imunobiologico_incompatibilidade x
         join imu.vacinacao v on v.imunobiologico_id = case when x.imunobiologico_id = $2 then x.incompativel_id else x.imunobiologico_id end
         join imu.imunobiologico i on i.id = v.imunobiologico_id
        where (x.imunobiologico_id = $2 or x.incompativel_id = $2) and v.paciente_id = $1 and v.tipo = 'APLICACAO' and abs($3::date - v.data) < x.intervalo_dias`,
      [p.id, v.imunobiologicoId, data],
    )
  ).rows;
  for (const i of incomp) avisos.push(`Incompatível com ${i.nome} aplicada em ${i.data.split('-').reverse().join('/')} (intervalo mínimo de ${i.intervalo_dias} dias).`);
  // Dose já aplicada.
  if (v.doseId) {
    const dup = (await c.query(`select data::text from imu.vacinacao where paciente_id = $1 and imunobiologico_id = $2 and dose_id = $3 and tipo in ('APLICACAO','RESGATE') limit 1`, [p.id, v.imunobiologicoId, v.doseId])).rows[0];
    if (dup) avisos.push(`Esta dose já foi registrada em ${dup.data.split('-').reverse().join('/')}.`);
  }
  return avisos;
}

/** Usa o frasco aberto do lote ou abre um novo, baixando o estoque (TR 1.2.39.1.30 a 1.2.39.1.33). */
async function consumirDose(c: C, d: { unidadeId: number; loteId: number; novoFrasco?: boolean; pacienteId: number; operadorId: number; doses?: number; tipo?: string }) {
  const lote = (await c.query(`select l.*, coalesce(l.doses_frasco, p.doses_frasco, 1) dpf from far.estoque_lote l join far.produto p on p.id = l.produto_id where l.id = $1`, [d.loteId])).rows[0];
  if (!lote || Number(lote.unidade_id) !== d.unidadeId) throw new ErroHttp(422, 'Lote não disponível nesta unidade.');
  if (lote.bloqueado) throw new ErroHttp(422, `Lote ${lote.lote} bloqueado: ${lote.motivo_bloqueio ?? ''}`);
  if (txt(lote.validade) < iso(new Date())) throw new ErroHttp(422, `Lote ${lote.lote} vencido.`);
  const dosesPorFrasco = Number(lote.dpf);
  const necessarias = d.doses ?? 1;
  if (dosesPorFrasco <= 1) {
    await baixarFefo(c, { unidadeId: d.unidadeId, produtoId: lote.produto_id, quantidade: necessarias, loteId: d.loteId, tipo: d.tipo ?? 'VACINACAO', pacienteId: d.pacienteId, documento: 'VACINA', operadorId: d.operadorId });
    return null;
  }
  let frasco = d.novoFrasco
    ? null
    : (await c.query(`select * from imu.frasco_aberto where unidade_id = $1 and lote_id = $2 and situacao = 'ABERTO' and doses_usadas < doses_total order by aberto_em limit 1 for update`, [d.unidadeId, d.loteId])).rows[0];
  if (!frasco) {
    await movimentar(c, { unidadeId: d.unidadeId, produtoId: lote.produto_id, loteId: d.loteId, tipo: d.tipo ?? 'VACINACAO', quantidade: -1, pacienteId: d.pacienteId, documento: 'ABERTURA DE FRASCO', operadorId: d.operadorId });
    frasco = (await c.query(`insert into imu.frasco_aberto (unidade_id, lote_id, aberto_em, doses_total, doses_usadas, situacao) values ($1,$2,now(),$3,0,'ABERTO') returning *`, [d.unidadeId, d.loteId, dosesPorFrasco])).rows[0];
  }
  const usadas = Number(frasco.doses_usadas) + necessarias;
  await c.query(`update imu.frasco_aberto set doses_usadas = $2, situacao = case when $2 >= doses_total then 'ENCERRADO' else 'ABERTO' end where id = $1`, [frasco.id, usadas]);
  return frasco.id as number;
}

export async function registrarVacinacao(c: C, v: PedidoVacinacao, u: Usuario) {
  const p = await paciente(c, v.pacienteId);
  const data = v.data ?? iso(new Date());
  const imuno = (await c.query(`select * from imu.imunobiologico where id = $1`, [v.imunobiologicoId])).rows[0];
  if (!imuno) throw new ErroHttp(404, 'Imunobiológico não encontrado.');
  const unidadeId = v.unidadeId ?? u.unidadeAtual;
  let inadvertida = false;
  let motivo: string | null = null;
  let frascoId: number | null = null;

  if (v.tipo === 'APLICACAO') {
    if (!unidadeId) throw new ErroHttp(422, 'Selecione a unidade de trabalho.');
    if (data > iso(new Date())) throw new ErroHttp(422, 'Data de aplicação futura.');
    const avisos = await validarAplicacao(c, p, v, data);
    if (avisos.length && !v.confirmarAvisos) throw new ErroHttp(409, avisos.join(' '), { avisos, exigeConfirmacao: true });
    if (avisos.length) {
      inadvertida = true;
      motivo = avisos.join(' ');
    }
    if (imuno.produto_id) {
      if (!v.loteId) throw new ErroHttp(422, 'Informe o lote do imunobiológico.');
      frascoId = await consumirDose(c, { unidadeId, loteId: v.loteId, novoFrasco: v.novoFrasco, pacienteId: p.id, operadorId: u.id, doses: imuno.tipo === 'SORO' ? Number(imuno.doses_tratamento ?? 1) : 1 });
    }
    // Diluente obrigatório quando o imunobiológico exige (TR 1.2.39.1.28, 1.2.39.1.29).
    if (imuno.exige_diluente) {
      if (!v.diluenteLoteId) throw new ErroHttp(422, 'Informe o lote do diluente.');
      const permitido = (await c.query(`select 1 from imu.imunobiologico_diluente d join far.estoque_lote l on l.produto_id = d.produto_id where d.imunobiologico_id = $1 and l.id = $2`, [imuno.id, v.diluenteLoteId])).rowCount;
      if (!permitido) throw new ErroHttp(422, 'Diluente não associado a este imunobiológico.');
      if (!frascoId || (await c.query(`select doses_usadas from imu.frasco_aberto where id = $1`, [frascoId])).rows[0]?.doses_usadas === 1)
        await consumirDose(c, { unidadeId, loteId: v.diluenteLoteId, pacienteId: p.id, operadorId: u.id, tipo: 'VACINACAO' });
    }
  }
  if (v.tipo === 'RESGATE' && !v.loteTexto && !v.loteId) throw new ErroHttp(422, 'Informe o lote da vacina resgatada.');

  const lote = v.loteId ? (await c.query(`select fabricante_id from far.estoque_lote where id = $1`, [v.loteId])).rows[0] : null;
  const r = (
    await c.query(
      `insert into imu.vacinacao (paciente_id, imunobiologico_id, dose_id, tipo, data, unidade_id, profissional_id, profissional_texto, lote_id, lote_texto, fabricante_id,
                                  estrategia, campanha_id, grupo_id, gestante, inadvertida, motivo_inadvertida, via, local_aplicacao, frasco_id, diluente_lote_id, observacao)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *`,
      [
        p.id,
        imuno.id,
        v.doseId ?? null,
        v.tipo,
        data,
        v.tipo === 'APLICACAO' ? unidadeId : (v.unidadeId ?? null),
        v.tipo === 'APLICACAO' ? u.profissionalId : null,
        v.profissionalTexto ?? null,
        v.loteId ?? null,
        v.loteTexto ?? null,
        lote?.fabricante_id ?? null,
        v.estrategia ?? 'ROTINA',
        v.campanhaId ?? null,
        v.grupoId ?? null,
        p.gestante,
        inadvertida,
        motivo,
        v.viaAplicacao ?? imuno.via ?? null,
        v.localAplicacao ?? null,
        frascoId,
        v.diluenteLoteId ?? null,
        v.observacao ?? null,
      ],
    )
  ).rows[0];

  if (v.tipo === 'APLICACAO' || v.tipo === 'RESGATE') {
    // A aplicação cumpre aprazamentos e indicações da mesma dose (TR 1.2.39.1.42).
    await c.query(`delete from imu.vacinacao where paciente_id = $1 and imunobiologico_id = $2 and coalesce(dose_id, 0) = coalesce($3::bigint, 0) and tipo in ('APRAZAMENTO','INDICACAO')`, [p.id, imuno.id, v.doseId ?? null]);
    // Aprazamento automático da próxima dose (TR 1.2.39.1.26).
    const q = v.doseId ? (await c.query(`select proxima_dose_id, intervalo_proxima_dias from imu.quadro_cobertura where imunobiologico_id = $1 and dose_id = $2 and proxima_dose_id is not null limit 1`, [imuno.id, v.doseId])).rows[0] : null;
    if (q?.proxima_dose_id && q.intervalo_proxima_dias) {
      const prox = iso(new Date(new Date(data + 'T12:00:00').getTime() + Number(q.intervalo_proxima_dias) * DIA));
      const ja = (await c.query(`select 1 from imu.vacinacao where paciente_id = $1 and imunobiologico_id = $2 and dose_id = $3`, [p.id, imuno.id, q.proxima_dose_id])).rowCount;
      if (!ja) {
        await c.query(`insert into imu.vacinacao (paciente_id, imunobiologico_id, dose_id, tipo, data, unidade_id, estrategia) values ($1,$2,$3,'APRAZAMENTO',$4,$5,'ROTINA')`, [p.id, imuno.id, q.proxima_dose_id, prox, unidadeId]);
        await c.query(`update imu.vacinacao set data_aprazada = $2 where id = $1`, [r.id, prox]);
        r.data_aprazada = prox;
      }
    }
  }
  return { ...r, inadvertida, avisos: motivo };
}

/** Exclusão de registro; a dose aplicada volta ao frasco ou ao estoque (TR 1.2.39.1.36, 1.2.39.1.37). */
export async function excluirVacinacao(c: C, id: number, u: Usuario) {
  const v = (await c.query(`select v.*, i.produto_id, i.tipo tipo_imuno, i.doses_tratamento from imu.vacinacao v join imu.imunobiologico i on i.id = v.imunobiologico_id where v.id = $1 for update`, [id])).rows[0];
  if (!v) throw new ErroHttp(404, 'Registro não encontrado.');
  if (v.tipo === 'APLICACAO' && v.lote_id) {
    const doses = v.tipo_imuno === 'SORO' ? Number(v.doses_tratamento ?? 1) : 1;
    if (v.frasco_id) await c.query(`update imu.frasco_aberto set doses_usadas = greatest(doses_usadas - $2, 0), situacao = 'ABERTO' where id = $1`, [v.frasco_id, doses]);
    else await movimentar(c, { unidadeId: v.unidade_id, produtoId: v.produto_id, loteId: v.lote_id, tipo: 'ESTORNO_VACINACAO', quantidade: doses, pacienteId: v.paciente_id, documento: `VACINA ${id}`, operadorId: u.id });
  }
  await c.query(`delete from imu.eapv where vacinacao_id = $1`, [id]);
  await c.query(`delete from imu.vacinacao where id = $1`, [id]);
}

/** Inutiliza as doses restantes do frasco aberto (fim do prazo de uso após abertura). */
export async function encerrarFrasco(c: C, frascoId: number) {
  await c.query(`update imu.frasco_aberto set situacao = 'INUTILIZADO' where id = $1 and situacao = 'ABERTO'`, [frascoId]);
}

/** Lotes da unidade para o imunobiológico (e diluentes) com frascos abertos e doses restantes (TR 1.2.39.1.33). */
export async function lotesAplicacao(unidadeId: number, imunobiologicoId: number) {
  const imuno = await consultarUm(`select produto_id, exige_diluente from imu.imunobiologico where id = $1`, [imunobiologicoId]);
  if (!imuno?.produto_id) return { lotes: [], diluentes: [] };
  const lotes = await consultar(
    `select l.id, l.lote, l.validade::text validade, l.quantidade, coalesce(l.doses_frasco, p.doses_frasco, 1) doses_frasco, f.nome fabricante,
            (select json_build_object('id', fa.id, 'doses_total', fa.doses_total, 'doses_usadas', fa.doses_usadas, 'aberto_em', fa.aberto_em)
               from imu.frasco_aberto fa where fa.lote_id = l.id and fa.unidade_id = l.unidade_id and fa.situacao = 'ABERTO' and fa.doses_usadas < fa.doses_total order by fa.aberto_em limit 1) frasco
       from far.estoque_lote l join far.produto p on p.id = l.produto_id left join far.fabricante f on f.id = l.fabricante_id
      where l.unidade_id = $1 and l.produto_id = $2 and not l.bloqueado and l.validade >= current_date
        and (l.quantidade - l.reservado > 0 or exists (select 1 from imu.frasco_aberto fa where fa.lote_id = l.id and fa.situacao = 'ABERTO' and fa.doses_usadas < fa.doses_total))
      order by l.validade`,
    [unidadeId, imuno.produto_id],
  );
  const diluentes = imuno.exige_diluente
    ? await consultar(
        `select l.id, p.nome || ' - ' || l.lote rotulo, l.validade::text validade, l.quantidade from imu.imunobiologico_diluente d join far.estoque_lote l on l.produto_id = d.produto_id
           join far.produto p on p.id = l.produto_id where d.imunobiologico_id = $1 and l.unidade_id = $2 and l.quantidade > 0 and l.validade >= current_date and not l.bloqueado order by l.validade`,
        [imunobiologicoId, unidadeId],
      )
    : [];
  return { lotes, diluentes };
}
