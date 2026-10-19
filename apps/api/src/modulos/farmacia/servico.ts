// Motor de estoque da farmácia e almoxarifado: lotes com validade (FEFO), entradas, dispensação
// com bloqueios clínicos e de receita, transferências com reserva, acertos e inutilizações.
import type pg from 'pg';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { alergiasConflitantes } from '../atendimento/servico.js';
import { parametro } from '../cadastros/alertas.js';

type C = pg.PoolClient;
const hoje = () => new Date().toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);

export interface Movimento {
  unidadeId: number;
  produtoId: number;
  loteId: number;
  tipo: string;
  /** Quantidade com sinal: positiva entra, negativa sai. */
  quantidade: number;
  pacienteId?: number | null;
  documento?: string | null;
  operadorId?: number | null;
  observacao?: string | null;
  /** Movimenta também a reserva do lote (saída de item reservado). */
  liberarReserva?: number;
}

/** Atualiza o saldo do lote e grava o movimento com o saldo resultante (rastreabilidade, TR 1.2.25.17). */
export async function movimentar(c: C, m: Movimento) {
  const lote = (
    await c.query(
      `update far.estoque_lote set quantidade = quantidade + $2, reservado = greatest(reservado - $3, 0)
        where id = $1 returning quantidade, custo_unitario, unidade_id, produto_id`,
      [m.loteId, m.quantidade, m.liberarReserva ?? 0],
    )
  ).rows[0];
  if (!lote) throw new ErroHttp(404, 'Lote não encontrado.');
  if (n(lote.quantidade) < 0) throw new ErroHttp(409, 'Saldo insuficiente no lote para a movimentação.');
  await c.query(
    `insert into far.movimento_estoque (data_hora, unidade_id, produto_id, lote_id, tipo, quantidade, saldo_apos, custo_unitario, paciente_id, documento, operador_id, observacao)
     values (now(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [m.unidadeId, m.produtoId, m.loteId, m.tipo, m.quantidade, lote.quantidade, lote.custo_unitario, m.pacienteId ?? null, m.documento ?? null, m.operadorId ?? null, m.observacao ?? null],
  );
  return n(lote.quantidade);
}

/** Localiza ou cria o lote na unidade (mesmo produto, lote e fabricante). */
export async function loteNaUnidade(c: C, d: { unidadeId: number; produtoId: number; lote: string; validade: string; fabricanteId?: number | null; custo?: number | null; dosesFrasco?: number | null }) {
  const existente = (
    await c.query(`select id from far.estoque_lote where unidade_id = $1 and produto_id = $2 and lote = $3 and coalesce(fabricante_id, 0) = coalesce($4::bigint, 0)`, [
      d.unidadeId,
      d.produtoId,
      d.lote,
      d.fabricanteId ?? null,
    ])
  ).rows[0];
  if (existente) {
    if (d.custo != null) await c.query(`update far.estoque_lote set custo_unitario = $2 where id = $1`, [existente.id, d.custo]);
    return existente.id as number;
  }
  return (
    await c.query(
      `insert into far.estoque_lote (unidade_id, produto_id, lote, validade, fabricante_id, quantidade, reservado, custo_unitario, doses_frasco, bloqueado)
       values ($1,$2,$3,$4,$5,0,0,$6,$7,false) returning id`,
      [d.unidadeId, d.produtoId, d.lote, d.validade, d.fabricanteId ?? null, d.custo ?? null, d.dosesFrasco ?? null],
    )
  ).rows[0].id as number;
}

/** Lotes utilizáveis em ordem de menor validade (FEFO), ignorando vencidos e bloqueados (TR 1.2.25.18, 1.2.25.19). */
export async function lotesDisponiveis(c: C | pg.Pool, unidadeId: number, produtoId: number) {
  return (
    await c.query(
      `select l.id, l.lote, l.validade::text validade, l.quantidade, l.reservado, (l.quantidade - l.reservado) disponivel, l.custo_unitario, f.nome fabricante
         from far.estoque_lote l left join far.fabricante f on f.id = l.fabricante_id
        where l.unidade_id = $1 and l.produto_id = $2 and not l.bloqueado and l.validade >= current_date and l.quantidade - l.reservado > 0
        order by l.validade, l.id`,
      [unidadeId, produtoId],
    )
  ).rows.map((l) => ({ ...l, quantidade: n(l.quantidade), reservado: n(l.reservado), disponivel: n(l.disponivel) }));
}

/** Alternativas quando falta o produto: similares/genéricos com saldo e outras unidades com estoque (TR 1.2.25.20, 1.2.25.21). */
export async function alternativas(c: C | pg.Pool, unidadeId: number, produtoId: number) {
  const similares = (
    await c.query(
      `select p.id, p.nome || coalesce(' ' || p.concentracao, '') nome, sum(l.quantidade - l.reservado) saldo
         from far.produto_similar s join far.produto p on p.id = s.similar_id
         join far.estoque_lote l on l.produto_id = p.id and l.unidade_id = $1 and not l.bloqueado and l.validade >= current_date
        where s.produto_id = $2 group by p.id having sum(l.quantidade - l.reservado) > 0`,
      [unidadeId, produtoId],
    )
  ).rows;
  const outrasUnidades = (
    await c.query(
      `select u.id, u.nome, sum(l.quantidade - l.reservado) saldo from far.estoque_lote l join cad.unidade u on u.id = l.unidade_id
        where l.produto_id = $2 and l.unidade_id <> $1 and not l.bloqueado and l.validade >= current_date
        group by u.id having sum(l.quantidade - l.reservado) > 0 order by 3 desc limit 10`,
      [unidadeId, produtoId],
    )
  ).rows;
  return { similares, outrasUnidades };
}

/** Baixa a quantidade distribuindo entre os lotes por menor validade; um lote específico pode ser indicado. */
export async function baixarFefo(c: C, d: { unidadeId: number; produtoId: number; quantidade: number; loteId?: number | null; tipo: string; pacienteId?: number | null; documento?: string; operadorId?: number | null }) {
  const lotes = await lotesDisponiveis(c, d.unidadeId, d.produtoId);
  const ordem = d.loteId ? [...lotes.filter((l) => l.id === d.loteId), ...lotes.filter((l) => l.id !== d.loteId)] : lotes;
  const total = ordem.reduce((s, l) => s + l.disponivel, 0);
  if (total < d.quantidade) {
    const prod = (await c.query(`select nome from far.produto where id = $1`, [d.produtoId])).rows[0];
    throw new ErroHttp(409, `Estoque insuficiente de ${prod?.nome ?? 'produto'}: disponível ${total}, solicitado ${d.quantidade}.`, {
      estoqueInsuficiente: true,
      produtoId: d.produtoId,
      disponivel: total,
      ...(await alternativas(c, d.unidadeId, d.produtoId)),
    });
  }
  let resta = d.quantidade;
  const usados: { loteId: number; quantidade: number; custo: number | null }[] = [];
  for (const l of ordem) {
    if (resta <= 0) break;
    const q = Math.min(resta, l.disponivel);
    await movimentar(c, { unidadeId: d.unidadeId, produtoId: d.produtoId, loteId: l.id, tipo: d.tipo, quantidade: -q, pacienteId: d.pacienteId, documento: d.documento, operadorId: d.operadorId });
    usados.push({ loteId: l.id, quantidade: q, custo: l.custo_unitario == null ? null : n(l.custo_unitario) });
    resta -= q;
  }
  return usados;
}

function exigirAcessoUnidade(u: Usuario, unidadeId: number) {
  if (!u.administrador && u.unidades.length && !u.unidades.includes(unidadeId)) throw new ErroHttp(403, 'Operador sem acesso a esta unidade (TR 1.2.27.21).');
}

// ---------------------------------------------------------------------------
// Entradas (TR 1.2.22, 1.2.27.21 a 1.2.27.26)
// ---------------------------------------------------------------------------
export async function confirmarEntrada(c: C, entradaId: number, u: Usuario, opcoes: { ignorarDiferencaValor?: boolean } = {}) {
  const e = (await c.query(`select * from far.entrada where id = $1 for update`, [entradaId])).rows[0];
  if (!e) throw new ErroHttp(404, 'Entrada não encontrada.');
  if (!['DIGITACAO', 'RECEBIDA_INTEGRACAO'].includes(e.situacao)) throw new ErroHttp(409, 'Entrada já confirmada ou cancelada.');
  exigirAcessoUnidade(u, e.unidade_id);
  const itens = (await c.query(`select i.*, i.validade::text val, p.tipo tipo_produto from far.entrada_item i join far.produto p on p.id = i.produto_id where entrada_id = $1`, [entradaId])).rows;
  if (!itens.length) throw new ErroHttp(422, 'Informe os itens da entrada.');

  if (e.fornecedor_id && e.nota_numero) {
    const dup = (
      await c.query(
        `select id from far.entrada where id <> $1 and fornecedor_id = $2 and nota_numero = $3 and coalesce(nota_serie, '') = coalesce($4, '')
            and coalesce(lote_entrada, '') = coalesce($5, '') and situacao <> 'CANCELADA'`,
        [entradaId, e.fornecedor_id, e.nota_numero, e.nota_serie, e.lote_entrada],
      )
    ).rows[0];
    if (dup) throw new ErroHttp(409, 'Já existe entrada registrada com o mesmo fornecedor, número, série e lote da nota (TR 1.2.27.22).');
  }
  for (const i of itens) {
    const anterior = (
      await c.query(
        `select l.validade::text val, l.fabricante_id, l.doses_frasco from far.estoque_lote l where l.produto_id = $1 and l.lote = $2 order by l.id limit 1`,
        [i.produto_id, i.lote],
      )
    ).rows[0];
    if (!anterior) continue;
    if (anterior.fabricante_id && i.fabricante_id && Number(anterior.fabricante_id) !== Number(i.fabricante_id))
      throw new ErroHttp(422, `Lote ${i.lote}: fabricante diferente do já registrado para este produto e lote (TR 1.2.27.25).`);
    if (anterior.val !== i.val) throw new ErroHttp(422, `Lote ${i.lote}: data de validade diferente da já registrada (${anterior.val.split('-').reverse().join('/')}) (TR 1.2.27.23).`);
    if (i.tipo_produto === 'IMUNOBIOLOGICO' && anterior.doses_frasco && i.doses_frasco && Number(anterior.doses_frasco) !== Number(i.doses_frasco))
      throw new ErroHttp(422, `Lote ${i.lote}: doses por frasco diferente da já registrada (TR 1.2.27.24).`);
  }
  const totalItens = itens.reduce((s, i) => s + n(i.quantidade) * n(i.valor_unitario), 0);
  if (e.valor_nota != null && Math.abs(totalItens - n(e.valor_nota)) > 0.01 && !opcoes.ignorarDiferencaValor) {
    throw new ErroHttp(409, `O valor dos itens (R$ ${totalItens.toFixed(2)}) não confere com o valor da nota (R$ ${n(e.valor_nota).toFixed(2)}) (TR 1.2.22.8).`, { exigeConfirmacao: true });
  }
  const un = (await c.query(`select usa_aprovacao_entrada from cad.unidade where id = $1`, [e.unidade_id])).rows[0];
  if (un?.usa_aprovacao_entrada) {
    await c.query(`update far.entrada set situacao = 'AGUARDANDO_APROVACAO' where id = $1`, [entradaId]);
    return { situacao: 'AGUARDANDO_APROVACAO' };
  }
  await efetivarEntrada(c, e, itens, u);
  return { situacao: 'CONFIRMADA' };
}

async function efetivarEntrada(c: C, e: any, itens: any[], u: Usuario) {
  for (const i of itens) {
    const loteId = await loteNaUnidade(c, { unidadeId: e.unidade_id, produtoId: i.produto_id, lote: i.lote, validade: i.val, fabricanteId: i.fabricante_id, custo: i.valor_unitario, dosesFrasco: i.doses_frasco });
    await movimentar(c, { unidadeId: e.unidade_id, produtoId: i.produto_id, loteId, tipo: 'ENTRADA', quantidade: n(i.quantidade), documento: `NF ${e.nota_numero ?? e.id}`, operadorId: u.id });
  }
  await c.query(`update far.entrada set situacao = 'CONFIRMADA' where id = $1`, [e.id]);
}

/** Aprovação da entrada por outro operador (TR 1.2.27.26) e aceite das entradas vindas da integração (TR 1.2.22.9.1). */
export async function aprovarEntrada(c: C, entradaId: number, u: Usuario) {
  const e = (await c.query(`select * from far.entrada where id = $1 for update`, [entradaId])).rows[0];
  if (!e || !['AGUARDANDO_APROVACAO', 'RECEBIDA_INTEGRACAO'].includes(e.situacao)) throw new ErroHttp(409, 'Entrada não está aguardando aprovação.');
  const itens = (await c.query(`select i.*, i.validade::text val from far.entrada_item i where entrada_id = $1`, [entradaId])).rows;
  await efetivarEntrada(c, e, itens, u);
  await c.query(`update far.entrada set aprovado_por = $2 where id = $1`, [entradaId, u.id]);
}

/** Entradas vindas do sistema administrativo identificadas pelo código CATMAT (TR 1.2.22.9, 1.2.22.9.2). */
export async function receberEntradaIntegracao(
  c: C,
  d: { unidadeId: number; fornecedorCnpj?: string; notaNumero: string; notaSerie?: string; empenho?: string; dataEntrada?: string; valorNota?: number; itens: { catmat: string; lote: string; validade: string; quantidade: number; valorUnitario?: number }[] },
) {
  const forn = d.fornecedorCnpj ? (await c.query(`select id from far.fornecedor where cnpj = $1`, [d.fornecedorCnpj.replace(/\D/g, '')])).rows[0] : null;
  const e = (
    await c.query(
      `insert into far.entrada (unidade_id, tipo, fornecedor_id, nota_numero, nota_serie, data_entrada, empenho, valor_nota, situacao)
       values ($1,'INTEGRACAO',$2,$3,$4,$5,$6,$7,'RECEBIDA_INTEGRACAO') returning id`,
      [d.unidadeId, forn?.id ?? null, d.notaNumero, d.notaSerie ?? null, d.dataEntrada ?? hoje(), d.empenho ?? null, d.valorNota ?? null],
    )
  ).rows[0];
  const naoEncontrados: string[] = [];
  for (const i of d.itens) {
    const p = (await c.query(`select p.id from far.produto p join far.catmat m on m.id = p.catmat_id where m.codigo = $1 limit 1`, [i.catmat])).rows[0];
    if (!p) {
      naoEncontrados.push(i.catmat);
      continue;
    }
    await c.query(`insert into far.entrada_item (entrada_id, produto_id, lote, validade, quantidade, valor_unitario) values ($1,$2,$3,$4,$5,$6)`, [
      e.id,
      p.id,
      i.lote,
      i.validade,
      i.quantidade,
      i.valorUnitario ?? null,
    ]);
  }
  return { entradaId: e.id, naoEncontrados };
}

// ---------------------------------------------------------------------------
// Dispensação (TR 1.2.25)
// ---------------------------------------------------------------------------
export interface PedidoDispensacao {
  unidadeId: number;
  pacienteId: number;
  prescricaoId?: number | null;
  processoJudicialId?: number | null;
  numeroReceita?: string | null;
  prescritor?: string | null;
  tipoReceita?: string | null;
  dataReceita?: string | null;
  retiradoPor?: string | null;
  itens: { produtoId: number; quantidade: number; loteId?: number | null; diasConsumo?: number | null; prescricaoItemId?: number | null }[];
  confirmarAvisos?: boolean;
}

const RECEITAS_ESPECIAIS = ['BRANCA_C', 'AZUL_B', 'AMARELA_A'];

export async function dispensar(c: C, p: PedidoDispensacao, u: Usuario) {
  exigirAcessoUnidade(u, p.unidadeId);
  if (!p.itens.length) throw new ErroHttp(422, 'Informe os itens a dispensar.');
  const pac = (await c.query(`select situacao from cad.pessoa where id = $1`, [p.pacienteId])).rows[0];
  if (!pac) throw new ErroHttp(404, 'Paciente não encontrado.');
  if (pac.situacao === 'FALECIDO') throw new ErroHttp(422, 'Paciente registrado como falecido.');

  // Alergia ao princípio ativo bloqueia a dispensação (TR 1.2.25.9).
  const alergias = await alergiasConflitantes(c, p.pacienteId, p.itens.map((i) => i.produtoId));
  if (alergias.length) throw new ErroHttp(422, `Dispensação bloqueada: paciente com restrição alérgica a ${alergias.map((a) => `${a.substancia} (${a.produto})`).join('; ')}.`, { alergias });

  let receita: any = null;
  if (p.prescricaoId) {
    receita = (await c.query(`select r.*, r.validade::text val, pr.nome prescritor_nome from amb.prescricao r left join cad.profissional pr on pr.id = r.profissional_id where r.id = $1 for update`, [p.prescricaoId])).rows[0];
    if (!receita) throw new ErroHttp(404, 'Receita não encontrada.');
    if (receita.situacao === 'CANCELADA') throw new ErroHttp(422, 'Receita cancelada.');
    if (receita.val && receita.val < hoje()) {
      await c.query(`update amb.prescricao set situacao = 'VENCIDA' where id = $1`, [receita.id]);
      throw new ErroHttp(422, `Receita vencida em ${receita.val.split('-').reverse().join('/')} (TR 1.2.25.15).`);
    }
  }
  const tipoReceita = receita?.tipo_receita ?? p.tipoReceita ?? 'BASICA';
  const numeroReceita = p.numeroReceita ?? receita?.numero_notificacao ?? receita?.numero ?? null;
  const prescritor = p.prescritor ?? receita?.prescritor_nome ?? receita?.prescritor_externo ?? null;

  // Receita digitada (externa): validade por tipo/medicamento (TR 1.2.25.24, 1.2.25.25).
  if (!receita && p.dataReceita) {
    for (const i of p.itens) {
      const pr = (await c.query(`select nome, validade_receita_dias, tipo_receita from far.produto where id = $1`, [i.produtoId])).rows[0];
      const dias = pr?.validade_receita_dias ?? { BASICA: 180, BRANCA_C: 30, AZUL_B: 30, AMARELA_A: 30, ANTIMICROBIANO: 10 }[pr?.tipo_receita as string] ?? 180;
      const vence = new Date(new Date(p.dataReceita + 'T12:00:00').getTime() + dias * 86_400_000).toISOString().slice(0, 10);
      if (vence < hoje()) throw new ErroHttp(422, `Receita vencida para ${pr.nome} (validade de ${dias} dias) (TR 1.2.25.15).`);
    }
  }

  const avisos: string[] = [];
  const produtos = new Map<number, any>();
  for (const i of p.itens) {
    const pr = (await c.query(`select * from far.produto where id = $1`, [i.produtoId])).rows[0];
    if (!pr) throw new ErroHttp(404, 'Produto não encontrado.');
    produtos.set(i.produtoId, pr);
    // Controlados exigem número da receita e prescritor (TR 1.2.25.10).
    if ((pr.controlado || pr.lista_344 || RECEITAS_ESPECIAIS.includes(pr.tipo_receita)) && (!numeroReceita || !prescritor))
      throw new ErroHttp(422, `${pr.nome}: medicamento controlado — informe o número da receita e o profissional que receitou.`);
    // Tipo de receita compatível com o medicamento (TR 1.2.25.26).
    const tipoProduto = pr.tipo_receita ?? 'BASICA';
    if (RECEITAS_ESPECIAIS.includes(tipoReceita) && tipoProduto === 'BASICA')
      throw new ErroHttp(422, `${pr.nome}: medicamento de receita simples não pode ser dispensado em receita do tipo ${tipoReceita}.`);
    if (RECEITAS_ESPECIAIS.includes(tipoProduto) && tipoProduto !== tipoReceita)
      throw new ErroHttp(422, `${pr.nome}: exige receita do tipo ${tipoProduto}.`);
    if (pr.nao_fracionavel && Math.round(i.quantidade) !== i.quantidade) throw new ErroHttp(422, `${pr.nome}: produto não fracionável.`);
    if (pr.acesso_restrito && !u.administrador && Array.isArray(pr.perfis_autorizados) && pr.perfis_autorizados.length) {
      const perfis = (await c.query(`select perfil_id from seg.operador_perfil where operador_id = $1`, [u.id])).rows.map((r) => Number(r.perfil_id));
      if (!pr.perfis_autorizados.some((x: number) => perfis.includes(Number(x)))) throw new ErroHttp(403, `${pr.nome}: produto de acesso restrito.`);
    }
    // Paciente ainda possui o medicamento da última retirada (TR 1.2.25.12).
    const ultima = (
      await c.query(
        `select di.termino_previsto::text fim from far.dispensacao_item di join far.dispensacao d on d.id = di.dispensacao_id
          where d.paciente_id = $1 and di.produto_id = $2 and d.situacao = 'EFETIVADA' and di.termino_previsto > current_date order by di.termino_previsto desc limit 1`,
        [p.pacienteId, i.produtoId],
      )
    ).rows[0];
    if (ultima) avisos.push(`${pr.nome}: o paciente ainda deve possuir medicamento suficiente até ${ultima.fim.split('-').reverse().join('/')}.`);
    // Saldo da receita em dispensações parciais (TR 1.2.25.27).
    if (i.prescricaoItemId) {
      const it = (await c.query(`select quantidade, quantidade_dispensada from amb.prescricao_item where id = $1`, [i.prescricaoItemId])).rows[0];
      if (it?.quantidade != null && n(it.quantidade_dispensada) + i.quantidade > n(it.quantidade))
        throw new ErroHttp(422, `${pr.nome}: quantidade acima do saldo da receita (prescrito ${n(it.quantidade)}, já dispensado ${n(it.quantidade_dispensada)}).`);
    }
  }
  if (avisos.length && !p.confirmarAvisos) throw new ErroHttp(409, avisos.join(' '), { avisos, exigeConfirmacao: true });

  const d = (
    await c.query(
      `insert into far.dispensacao (unidade_id, paciente_id, prescricao_id, processo_judicial_id, data_hora, numero_receita, prescritor, tipo_receita, retirado_por, operador_id, situacao)
       values ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9,'EFETIVADA') returning *`,
      [p.unidadeId, p.pacienteId, p.prescricaoId ?? null, p.processoJudicialId ?? null, numeroReceita, prescritor, tipoReceita, p.retiradoPor ?? null, u.id],
    )
  ).rows[0];
  for (const i of p.itens) {
    const usados = await baixarFefo(c, { unidadeId: p.unidadeId, produtoId: i.produtoId, quantidade: i.quantidade, loteId: i.loteId, tipo: 'DISPENSACAO', pacienteId: p.pacienteId, documento: `DISP ${d.id}`, operadorId: u.id });
    const termino = i.diasConsumo ? new Date(Date.now() + i.diasConsumo * 86_400_000).toISOString().slice(0, 10) : null;
    for (const us of usados) {
      await c.query(
        `insert into far.dispensacao_item (dispensacao_id, produto_id, lote_id, prescricao_item_id, quantidade, dias_consumo, termino_previsto, custo_unitario) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [d.id, i.produtoId, us.loteId, i.prescricaoItemId ?? null, us.quantidade, i.diasConsumo ?? null, termino, us.custo],
      );
    }
    if (i.prescricaoItemId) await c.query(`update amb.prescricao_item set quantidade_dispensada = coalesce(quantidade_dispensada, 0) + $2 where id = $1`, [i.prescricaoItemId, i.quantidade]);
    if (p.processoJudicialId)
      await c.query(`update far.processo_judicial_item set quantidade_entregue = coalesce(quantidade_entregue, 0) + $3, ultima_entrega = current_date where processo_id = $1 and produto_id = $2`, [
        p.processoJudicialId,
        i.produtoId,
        i.quantidade,
      ]);
    // Atende demanda reprimida aberta do paciente para o produto.
    await c.query(
      `update far.demanda_reprimida set quantidade_atendida = least(quantidade, quantidade_atendida + $3),
              situacao = case when quantidade_atendida + $3 >= quantidade then 'ATENDIDA' else 'PARCIAL' end
        where paciente_id = $1 and produto_id = $2 and situacao in ('ABERTA','PARCIAL')`,
      [p.pacienteId, i.produtoId, i.quantidade],
    );
  }
  if (p.prescricaoId) {
    const pend = (await c.query(`select count(*)::int n from amb.prescricao_item where prescricao_id = $1 and quantidade is not null and coalesce(quantidade_dispensada, 0) < quantidade`, [p.prescricaoId])).rows[0].n;
    await c.query(`update amb.prescricao set situacao = $2 where id = $1`, [p.prescricaoId, pend ? 'PARCIAL' : 'DISPENSADA']);
  }
  if (p.processoJudicialId) {
    await c.query(`insert into far.processo_judicial_tramite (processo_id, data_hora, descricao, operador_id) values ($1, now(), $2, $3)`, [p.processoJudicialId, `Dispensação nº ${d.id} realizada.`, u.id]);
    // Processo cumprido automaticamente após a última entrega (TR 1.2.27.48).
    const falta = (await c.query(`select count(*)::int n from far.processo_judicial_item where processo_id = $1 and coalesce(quantidade_entregue, 0) < quantidade`, [p.processoJudicialId])).rows[0].n;
    if (!falta) {
      await c.query(`update far.processo_judicial set situacao = 'CUMPRIDO' where id = $1`, [p.processoJudicialId]);
      await c.query(`insert into far.processo_judicial_tramite (processo_id, data_hora, descricao, operador_id) values ($1, now(), 'Processo cumprido: todos os itens entregues.', $2)`, [p.processoJudicialId, u.id]);
    }
  }
  return d;
}

/** Estorno da dispensação: devolve os itens aos mesmos lotes (TR 1.2.25.28). */
export async function estornarDispensacao(c: C, id: number, motivo: string, u: Usuario) {
  const d = (await c.query(`select * from far.dispensacao where id = $1 for update`, [id])).rows[0];
  if (!d) throw new ErroHttp(404, 'Dispensação não encontrada.');
  if (d.situacao === 'ESTORNADA') throw new ErroHttp(409, 'Dispensação já estornada.');
  const itens = (await c.query(`select * from far.dispensacao_item where dispensacao_id = $1`, [id])).rows;
  for (const i of itens) {
    await movimentar(c, { unidadeId: d.unidade_id, produtoId: i.produto_id, loteId: i.lote_id, tipo: 'ESTORNO_DISPENSACAO', quantidade: n(i.quantidade), pacienteId: d.paciente_id, documento: `DISP ${id}`, operadorId: u.id, observacao: motivo });
    if (i.prescricao_item_id) await c.query(`update amb.prescricao_item set quantidade_dispensada = greatest(coalesce(quantidade_dispensada, 0) - $2, 0) where id = $1`, [i.prescricao_item_id, i.quantidade]);
    if (d.processo_judicial_id)
      await c.query(`update far.processo_judicial_item set quantidade_entregue = greatest(coalesce(quantidade_entregue, 0) - $3, 0) where processo_id = $1 and produto_id = $2`, [d.processo_judicial_id, i.produto_id, i.quantidade]);
  }
  if (d.prescricao_id) await c.query(`update amb.prescricao set situacao = 'PARCIAL' where id = $1 and situacao = 'DISPENSADA'`, [d.prescricao_id]);
  await c.query(`update far.dispensacao set situacao = 'ESTORNADA', motivo_estorno = $2 where id = $1`, [id, motivo]);
}

// ---------------------------------------------------------------------------
// Acertos e inutilizações (TR 1.2.24)
// ---------------------------------------------------------------------------
export async function acertarSaldo(c: C, loteId: number, novoSaldo: number, motivo: string, u: Usuario) {
  const l = (await c.query(`select * from far.estoque_lote where id = $1 for update`, [loteId])).rows[0];
  if (!l) throw new ErroHttp(404, 'Lote não encontrado.');
  exigirAcessoUnidade(u, l.unidade_id);
  const dif = novoSaldo - n(l.quantidade);
  if (dif === 0) return { diferenca: 0 };
  if (novoSaldo < n(l.reservado)) throw new ErroHttp(422, `O novo saldo não pode ser menor que a quantidade reservada (${n(l.reservado)}).`);
  await movimentar(c, { unidadeId: l.unidade_id, produtoId: l.produto_id, loteId, tipo: dif > 0 ? 'ACERTO_ENTRADA' : 'ACERTO_SAIDA', quantidade: dif, operadorId: u.id, observacao: motivo, documento: 'ACERTO' });
  return { diferenca: dif };
}

export async function inutilizar(c: C, r: { id: number; unidade_id: number; produto_id: number; lote_id: number; quantidade: number }, u: Usuario | undefined) {
  const l = (await c.query(`select custo_unitario, unidade_id, produto_id, quantidade, reservado from far.estoque_lote where id = $1 for update`, [r.lote_id])).rows[0];
  if (!l || Number(l.unidade_id) !== Number(r.unidade_id) || Number(l.produto_id) !== Number(r.produto_id)) throw new ErroHttp(422, 'O lote não pertence ao produto/unidade informados.');
  if (n(l.quantidade) - n(l.reservado) < n(r.quantidade)) throw new ErroHttp(409, 'Quantidade maior que o saldo disponível do lote.');
  await movimentar(c, { unidadeId: r.unidade_id, produtoId: r.produto_id, loteId: r.lote_id, tipo: 'INUTILIZACAO', quantidade: -n(r.quantidade), operadorId: u?.id, documento: `INUT ${r.id}` });
  await c.query(`update far.inutilizacao set valor_total = $2 where id = $1`, [r.id, n(l.custo_unitario) * n(r.quantidade)]);
}

// ---------------------------------------------------------------------------
// Requisições e transferências (TR 1.2.27.1 a 1.2.27.18)
// ---------------------------------------------------------------------------
export interface PedidoTransferencia {
  unidadeOrigemId: number;
  unidadeDestinoId: number;
  itens: { produtoId: number; quantidade: number; loteId?: number | null; requisicaoItemId?: number | null }[];
  requisicoes?: number[];
  observacao?: string;
}

/** Cria a transferência reservando o estoque nos lotes de origem (bloqueio até o aceite, TR 1.2.27.12). */
export async function criarTransferencia(c: C, p: PedidoTransferencia, u: Usuario) {
  exigirAcessoUnidade(u, p.unidadeOrigemId);
  if (p.unidadeOrigemId === p.unidadeDestinoId) throw new ErroHttp(422, 'Origem e destino devem ser diferentes.');
  const t = (
    await c.query(
      `insert into far.transferencia (unidade_origem_id, unidade_destino_id, data, requisicoes, situacao, observacao) values ($1,$2,now(),$3,'AGUARDANDO_APROVACAO',$4) returning *`,
      [p.unidadeOrigemId, p.unidadeDestinoId, JSON.stringify(p.requisicoes ?? []), p.observacao ?? null],
    )
  ).rows[0];
  for (const i of p.itens) {
    if (i.quantidade <= 0) continue;
    const lotes = await lotesDisponiveis(c, p.unidadeOrigemId, i.produtoId);
    const ordem = i.loteId ? lotes.filter((l) => l.id === i.loteId) : lotes;
    if (i.loteId && !ordem.length) throw new ErroHttp(422, 'Lote indisponível, vencido ou bloqueado (TR 1.2.27.18).');
    const total = ordem.reduce((s, l) => s + l.disponivel, 0);
    if (total < i.quantidade) {
      const pr = (await c.query(`select nome from far.produto where id = $1`, [i.produtoId])).rows[0];
      throw new ErroHttp(409, `Estoque insuficiente de ${pr?.nome}: disponível ${total}.`, { estoqueInsuficiente: true, ...(await alternativas(c, p.unidadeOrigemId, i.produtoId)) });
    }
    let resta = i.quantidade;
    for (const l of ordem) {
      if (resta <= 0) break;
      const q = Math.min(resta, l.disponivel);
      await c.query(`update far.estoque_lote set reservado = reservado + $2 where id = $1`, [l.id, q]);
      await c.query(`insert into far.transferencia_item (transferencia_id, produto_id, lote_origem_id, quantidade, requisicao_item_id) values ($1,$2,$3,$4,$5)`, [
        t.id,
        i.produtoId,
        l.id,
        q,
        i.requisicaoItemId ?? null,
      ]);
      resta -= q;
    }
    if (i.requisicaoItemId) await c.query(`update far.requisicao_item set quantidade_atendida = coalesce(quantidade_atendida, 0) + $2 where id = $1`, [i.requisicaoItemId, i.quantidade]);
  }
  for (const r of p.requisicoes ?? []) {
    const pend = (await c.query(`select count(*)::int n from far.requisicao_item where requisicao_id = $1 and coalesce(quantidade_atendida, 0) < quantidade`, [r])).rows[0].n;
    await c.query(`update far.requisicao set situacao = $2 where id = $1`, [r, pend ? 'ATENDIDA_PARCIAL' : 'ATENDIDA']);
  }
  const origem = (await c.query(`select usa_aprovacao_transferencia from cad.unidade where id = $1`, [p.unidadeOrigemId])).rows[0];
  if (!origem?.usa_aprovacao_transferencia) await aprovarTransferencia(c, t.id, u);
  return (await c.query(`select * from far.transferencia where id = $1`, [t.id])).rows[0];
}

/** Aprovação: libera a transferência para recebimento; sem aceite no destino, o recebimento é automático (TR 1.2.27.9, 1.2.27.13). */
export async function aprovarTransferencia(c: C, id: number, u: Usuario) {
  const t = (await c.query(`select * from far.transferencia where id = $1 for update`, [id])).rows[0];
  if (!t || t.situacao !== 'AGUARDANDO_APROVACAO') throw new ErroHttp(409, 'Transferência não está aguardando aprovação.');
  await c.query(`update far.transferencia set situacao = 'EM_TRANSITO', aprovado_por = $2 where id = $1`, [id, u.id]);
  const destino = (await c.query(`select usa_aceite_transferencia from cad.unidade where id = $1`, [t.unidade_destino_id])).rows[0];
  if (!destino?.usa_aceite_transferencia) await receberTransferencia(c, id, null, u);
}

/** Recebimento total ou parcial (TR 1.2.27.10): baixa a origem pela quantidade enviada e dá entrada no destino pela recebida. */
export async function receberTransferencia(c: C, id: number, recebidos: Record<number, number> | null, u: Usuario) {
  const t = (await c.query(`select * from far.transferencia where id = $1 for update`, [id])).rows[0];
  if (!t || t.situacao !== 'EM_TRANSITO') throw new ErroHttp(409, 'Transferência não está em trânsito.');
  const itens = (await c.query(`select i.*, l.lote, l.validade::text val, l.fabricante_id, l.custo_unitario, l.doses_frasco from far.transferencia_item i join far.estoque_lote l on l.id = i.lote_origem_id where i.transferencia_id = $1`, [id])).rows;
  let divergencia = false;
  for (const i of itens) {
    const enviada = n(i.quantidade);
    const recebida = recebidos?.[i.id] ?? enviada;
    if (recebida > enviada || recebida < 0) throw new ErroHttp(422, 'Quantidade recebida inválida.');
    if (recebida !== enviada) divergencia = true;
    await movimentar(c, { unidadeId: t.unidade_origem_id, produtoId: i.produto_id, loteId: i.lote_origem_id, tipo: 'TRANSFERENCIA_SAIDA', quantidade: -enviada, liberarReserva: enviada, documento: `TRANSF ${id}`, operadorId: u.id });
    if (recebida > 0) {
      const destino = await loteNaUnidade(c, { unidadeId: t.unidade_destino_id, produtoId: i.produto_id, lote: i.lote, validade: i.val, fabricanteId: i.fabricante_id, custo: i.custo_unitario, dosesFrasco: i.doses_frasco });
      await movimentar(c, { unidadeId: t.unidade_destino_id, produtoId: i.produto_id, loteId: destino, tipo: 'TRANSFERENCIA_ENTRADA', quantidade: recebida, documento: `TRANSF ${id}`, operadorId: u.id });
    }
    await c.query(`update far.transferencia_item set quantidade_recebida = $2 where id = $1`, [i.id, recebida]);
  }
  await c.query(`update far.transferencia set situacao = $2, recebido_por = $3, recebido_em = now() where id = $1`, [id, divergencia ? 'RECEBIDA_PARCIAL' : 'RECEBIDA', u.id]);
  const reqs: number[] = t.requisicoes ?? [];
  for (const r of reqs) await c.query(`update far.requisicao set situacao = 'RECEBIDA' where id = $1 and situacao = 'ATENDIDA'`, [r]);
}

export async function cancelarTransferencia(c: C, id: number, motivo: string, u: Usuario) {
  const t = (await c.query(`select * from far.transferencia where id = $1 for update`, [id])).rows[0];
  if (!t || !['AGUARDANDO_APROVACAO', 'EM_TRANSITO'].includes(t.situacao)) throw new ErroHttp(409, 'Transferência não pode ser cancelada.');
  const itens = (await c.query(`select * from far.transferencia_item where transferencia_id = $1`, [id])).rows;
  for (const i of itens) {
    await c.query(`update far.estoque_lote set reservado = greatest(reservado - $2, 0) where id = $1`, [i.lote_origem_id, i.quantidade]);
    if (i.requisicao_item_id) await c.query(`update far.requisicao_item set quantidade_atendida = greatest(coalesce(quantidade_atendida, 0) - $2, 0) where id = $1`, [i.requisicao_item_id, i.quantidade]);
  }
  await c.query(`update far.transferencia set situacao = 'CANCELADA', observacao = concat_ws(' | ', observacao, $2::text) where id = $1`, [id, `Cancelada por ${u.nome}: ${motivo}`]);
}

// ---------------------------------------------------------------------------
// Consultas de estoque
// ---------------------------------------------------------------------------
/** Posição do estoque por produto com nível em relação ao mínimo (TR 1.2.27.27, 1.2.25.16). */
export async function posicaoEstoque(c: pg.Pool | C, f: { unidadeId?: number | null; produtoId?: number | null; busca?: string | null; somenteAbaixoMinimo?: boolean }) {
  return (
    await c.query(
      `select l.unidade_id, u.nome unidade, p.id produto_id, p.nome || coalesce(' ' || p.concentracao, '') produto, ap.nome apresentacao, p.tarja, p.lista_344,
              sum(l.quantidade)::numeric quantidade,
              sum(l.quantidade) filter (where l.validade < current_date)::numeric vencido,
              sum(l.quantidade) filter (where l.bloqueado and l.validade >= current_date)::numeric bloqueado,
              sum(l.reservado)::numeric reservado,
              sum(l.quantidade - l.reservado) filter (where not l.bloqueado and l.validade >= current_date)::numeric saldo,
              coalesce(pu.estoque_minimo, p.estoque_minimo) estoque_minimo, pu.estoque_ideal,
              min(l.validade) filter (where l.quantidade > 0 and l.validade >= current_date)::text proxima_validade,
              sum(l.quantidade * coalesce(l.custo_unitario, p.preco_custo, 0))::numeric valor
         from far.estoque_lote l join far.produto p on p.id = l.produto_id join cad.unidade u on u.id = l.unidade_id
         left join far.apresentacao ap on ap.id = p.apresentacao_id
         left join far.produto_unidade pu on pu.produto_id = p.id and pu.unidade_id = l.unidade_id
        where ($1::bigint is null or l.unidade_id = $1) and ($2::bigint is null or l.produto_id = $2)
          and ($3::text is null or cad.fn_normalizar(p.nome || ' ' || coalesce(p.principio_ativo, '') || ' ' || coalesce(p.codigos_barras, '')) like '%' || cad.fn_normalizar($3) || '%')
        group by l.unidade_id, u.nome, p.id, ap.nome, pu.estoque_minimo, pu.estoque_ideal
       having sum(l.quantidade) > 0 or $4
        order by u.nome, 4`,
      [f.unidadeId ?? null, f.produtoId ?? null, f.busca || null, !!f.somenteAbaixoMinimo],
    )
  ).rows
    .map((r) => {
      const saldo = n(r.saldo);
      const minimo = r.estoque_minimo == null ? null : n(r.estoque_minimo);
      return {
        ...r,
        quantidade: n(r.quantidade),
        vencido: n(r.vencido),
        bloqueado: n(r.bloqueado),
        reservado: n(r.reservado),
        saldo,
        valor: n(r.valor),
        estoque_minimo: minimo,
        nivel: minimo == null ? (saldo > 0 ? 'OK' : 'ZERADO') : saldo <= 0 ? 'ZERADO' : saldo < minimo ? 'ABAIXO_MINIMO' : saldo < minimo * 1.5 ? 'ATENCAO' : 'OK',
      };
    })
    .filter((r) => !f.somenteAbaixoMinimo || r.nivel === 'ZERADO' || r.nivel === 'ABAIXO_MINIMO');
}

/** Valida parâmetro opcional para habilitar o registro de demanda reprimida na dispensação (TR 1.2.28.7). */
export const permiteDemandaNaDispensacao = () => parametro<boolean>('farmacia.demanda_na_dispensacao', true);
