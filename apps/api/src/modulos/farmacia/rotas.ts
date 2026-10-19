import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { enfileirarMensagem } from '../../servicos/mensageria.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario } from '../../seguranca/usuario.js';
import { idadeTexto } from '../../compartilhado/validacao.js';
import { parametro } from '../cadastros/alertas.js';
import {
  acertarSaldo,
  alternativas,
  aprovarEntrada,
  aprovarTransferencia,
  cancelarTransferencia,
  confirmarEntrada,
  criarTransferencia,
  dispensar,
  estornarDispensacao,
  inutilizar,
  lotesDisponiveis,
  posicaoEstoque,
  receberEntradaIntegracao,
  receberTransferencia,
} from './servico.js';
import './relatorios.js';

registrarPermissao('acerto_estoque', 'Acerto de saldo de estoque', 'FAR', ['executar']);
registrarPermissao('integracao_estoque', 'Integração com o sistema administrativo (entradas)', 'FAR', ['executar']);

const fmtData = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const num = z.coerce.number();

// Movimentações só pelas rotinas de estoque: o cadastro genérico não altera saldos.
registrarGanchos('estoque_lote', {
  antesSalvar(d, { atual }) {
    if (!atual) throw new ErroHttp(422, 'Lotes são criados pelas entradas e transferências de estoque.');
    for (const k of Object.keys(d)) if (!['bloqueado', 'motivo_bloqueio', 'custo_unitario'].includes(k)) delete d[k];
    if (d.bloqueado && !d.motivo_bloqueio && !atual.motivo_bloqueio) throw new ErroHttp(422, 'Informe o motivo do bloqueio do lote.', { motivo_bloqueio: 'Obrigatório.' });
  },
});
registrarGanchos('movimento_estoque', {
  antesSalvar() {
    throw new ErroHttp(422, 'Movimentações são geradas automaticamente pelas rotinas de estoque.');
  },
});
registrarGanchos('dispensacao', {
  antesSalvar(_d, { atual }) {
    if (!atual) throw new ErroHttp(422, 'Utilize a tela de dispensação para registrar a entrega de medicamentos.');
    throw new ErroHttp(422, 'Para corrigir uma dispensação, estorne-a e registre novamente (TR 1.2.25.28).');
  },
});
registrarGanchos('entrada', {
  antesSalvar(d, { atual, usuario }) {
    if (atual && !['DIGITACAO', 'RECEBIDA_INTEGRACAO'].includes(atual.situacao)) throw new ErroHttp(422, 'Entrada já confirmada não pode ser alterada.');
    const un = d.unidade_id ?? atual?.unidade_id;
    if (usuario && !usuario.administrador && usuario.unidades.length && !usuario.unidades.includes(Number(un))) throw new ErroHttp(403, 'Operador sem acesso à unidade da entrada (TR 1.2.27.21).');
    if (!atual) d.situacao = 'DIGITACAO';
    else delete d.situacao;
  },
});
registrarGanchos('entrada_item', {
  async antesSalvar(d, { cliente, atual }) {
    const e = (await cliente.query(`select situacao from far.entrada where id = $1`, [d.entrada_id ?? atual?.entrada_id])).rows[0];
    if (e && !['DIGITACAO', 'RECEBIDA_INTEGRACAO'].includes(e.situacao)) throw new ErroHttp(422, 'Entrada já confirmada não pode ser alterada.');
  },
});
registrarGanchos('inutilizacao', {
  antesSalvar(_d, { atual }) {
    if (atual) throw new ErroHttp(422, 'Inutilização registrada não pode ser alterada; registre um acerto de estoque se necessário.');
  },
  async depoisSalvar(r, { cliente, usuario }) {
    await inutilizar(cliente, r as any, usuario);
  },
});
registrarGanchos('requisicao_estoque', {
  antesSalvar(d, { atual }) {
    if (atual && !['DIGITACAO'].includes(atual.situacao) && d.situacao === undefined) throw new ErroHttp(422, 'Requisição já enviada não pode ser alterada.');
    if (!atual) d.situacao = 'DIGITACAO';
  },
});
registrarGanchos('requisicao_estoque_item', {
  async antesSalvar(d, { cliente, atual }) {
    const r = (await cliente.query(`select situacao from far.requisicao where id = $1`, [d.requisicao_id ?? atual?.requisicao_id])).rows[0];
    if (r && r.situacao !== 'DIGITACAO') throw new ErroHttp(422, 'Requisição já enviada não pode ser alterada (TR 1.2.27.2).');
  },
});
registrarGanchos('transferencia', {
  antesSalvar(_d, { atual }) {
    if (!atual) throw new ErroHttp(422, 'Utilize a tela de transferências para enviar produtos.');
  },
});
registrarGanchos('processo_judicial', {
  async depoisSalvar(r, { cliente, usuario, atual }) {
    const desc = !atual ? 'Processo cadastrado.' : atual.situacao !== r.situacao ? `Situação alterada de ${atual.situacao} para ${r.situacao}.` : 'Dados do processo alterados.';
    await cliente.query(`insert into far.processo_judicial_tramite (processo_id, data_hora, descricao, operador_id) values ($1, now(), $2, $3)`, [r.id, desc, usuario?.id ?? null]);
  },
});
registrarGanchos('negativa_medicamento', {
  // Alerta de negativas anteriores do mesmo paciente (TR 1.2.27.28.5).
  async antesSalvar(d, { cliente, atual }) {
    if (atual || d.confirmar_existentes) return void delete d.confirmar_existentes;
    const n = (await cliente.query(`select count(*)::int n from far.negativa_medicamento where paciente_id = $1`, [d.paciente_id])).rows[0].n;
    if (n) throw new ErroHttp(409, `O paciente já possui ${n} declaração(ões) de indisponibilidade registrada(s).`, { exigeConfirmacao: true });
  },
});

export async function rotasFarmacia(app: FastifyInstance) {
  // Estoque em tempo real com nível do saldo (TR 1.2.27.27, 1.2.25.16).
  app.get('/api/farmacia/estoque', async (req) => {
    const u = exigirPermissao(req, 'estoque_lote:consultar');
    const q = req.query as any;
    const unidadeId = q.unidadeId ? Number(q.unidadeId) : q.todas === 'true' ? null : u.unidadeAtual;
    if (unidadeId && !u.administrador && u.unidades.length && !u.unidades.includes(unidadeId)) throw new ErroHttp(403, 'Operador sem acesso ao estoque desta unidade (TR 1.2.25.16.1).');
    const linhas = await posicaoEstoque(pool, { unidadeId, produtoId: q.produtoId ? Number(q.produtoId) : null, busca: q.busca, somenteAbaixoMinimo: q.abaixoMinimo === 'true' });
    return u.administrador || !u.unidades.length ? linhas : linhas.filter((l) => u.unidades.includes(Number(l.unidade_id)));
  });

  // Visão geral do produto em todas as unidades com lotes e validades (TR 1.2.20.1.27).
  app.get('/api/farmacia/produtos/:id/lotes', async (req) => {
    exigirPermissao(req, 'estoque_lote:consultar');
    const q = req.query as any;
    return consultar(
      `select l.id, l.unidade_id, u.nome unidade, l.lote, l.validade::text validade, f.nome fabricante, l.quantidade, l.reservado, l.bloqueado, l.motivo_bloqueio,
              (l.validade < current_date) vencido, l.custo_unitario
         from far.estoque_lote l join cad.unidade u on u.id = l.unidade_id left join far.fabricante f on f.id = l.fabricante_id
        where l.produto_id = $1 and ($2::bigint is null or l.unidade_id = $2) and (l.quantidade > 0 or $3)
        order by u.nome, l.validade`,
      [Number((req.params as any).id), q.unidadeId ? Number(q.unidadeId) : null, q.zerados === 'true'],
    );
  });

  // Lotes para saída em ordem FEFO e alternativas quando não há saldo (TR 1.2.25.18 a 1.2.25.21).
  app.get('/api/farmacia/produtos/:id/disponivel', async (req) => {
    const u = exigirUsuario(req);
    const unidadeId = Number((req.query as any).unidadeId ?? u.unidadeAtual);
    const produtoId = Number((req.params as any).id);
    const lotes = await lotesDisponiveis(pool, unidadeId, produtoId);
    const vencidos = await consultar(`select lote, validade::text validade, quantidade from far.estoque_lote where unidade_id = $1 and produto_id = $2 and validade < current_date and quantidade > 0`, [unidadeId, produtoId]);
    const produto = await consultarUm(`select id, nome || coalesce(' ' || concentracao, '') nome, tipo_receita, controlado, lista_344, nao_fracionavel, antimicrobiano from far.produto where id = $1`, [produtoId]);
    const saldo = lotes.reduce((s, l) => s + l.disponivel, 0);
    return { produto, lotes, saldo, vencidos, ...(saldo <= 0 ? await alternativas(pool, unidadeId, produtoId) : { similares: [], outrasUnidades: [] }) };
  });

  // Leitura de código de barras (TR 1.2.22.2, 1.2.25.11, 1.2.27.16).
  app.get('/api/farmacia/produto-por-codigo', async (req) => {
    exigirUsuario(req);
    const codigo = String((req.query as any).codigo ?? '').trim();
    if (!codigo) throw new ErroHttp(400, 'Informe o código.');
    const p = await consultarUm(
      `select id, nome || coalesce(' ' || concentracao, '') nome from far.produto
        where ativo and (',' || replace(coalesce(codigos_barras, ''), ' ', '') || ',' like '%,' || $1 || ',%' or id::text = $1) limit 1`,
      [codigo],
    );
    if (!p) throw new ErroHttp(404, 'Produto não encontrado para o código lido.');
    return p;
  });

  // ---------------------------------------------------------------------------
  // Entradas
  // ---------------------------------------------------------------------------
  app.post('/api/farmacia/entradas/:id/confirmar', async (req) => {
    const u = exigirPermissao(req, 'entrada:incluir');
    const b = z.object({ ignorarDiferencaValor: z.boolean().optional() }).parse(req.body ?? {});
    return transacao(contextoDe(req, 'entrada:confirmar'), (c) => confirmarEntrada(c, Number((req.params as any).id), u, b));
  });
  app.post('/api/farmacia/entradas/:id/aprovar', async (req) => {
    const u = exigirPermissao(req, 'entrada:alterar');
    await transacao(contextoDe(req, 'entrada:aprovar'), (c) => aprovarEntrada(c, Number((req.params as any).id), u));
    return { ok: true };
  });
  app.post('/api/farmacia/entradas/:id/rejeitar', async (req) => {
    exigirPermissao(req, 'entrada:alterar');
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    await transacao(contextoDe(req, 'entrada:rejeitar'), (c) =>
      c.query(`update far.entrada set situacao = 'CANCELADA', observacao = concat_ws(' | ', observacao, $2::text) where id = $1 and situacao in ('AGUARDANDO_APROVACAO','RECEBIDA_INTEGRACAO','DIGITACAO')`, [
        (req.params as any).id,
        `Rejeitada: ${motivo}`,
      ]),
    );
    return { ok: true };
  });
  // Web service para o sistema administrativo enviar notas recebidas (TR 1.2.22.9).
  app.post('/api/integracao/farmacia/entradas', async (req, reply) => {
    exigirPermissao(req, 'integracao_estoque:executar');
    const b = z
      .object({
        unidadeId: z.number(),
        fornecedorCnpj: z.string().optional(),
        notaNumero: z.string(),
        notaSerie: z.string().optional(),
        empenho: z.string().optional(),
        dataEntrada: z.string().optional(),
        valorNota: z.number().optional(),
        itens: z.array(z.object({ catmat: z.string(), lote: z.string(), validade: z.string(), quantidade: z.number(), valorUnitario: z.number().optional() })).min(1),
      })
      .parse(req.body);
    return reply.status(201).send(await transacao(contextoDe(req, 'integracao:entrada'), (c) => receberEntradaIntegracao(c, b)));
  });

  // ---------------------------------------------------------------------------
  // Dispensação
  // ---------------------------------------------------------------------------
  // Receitas abertas, histórico, demandas e processos do paciente na farmácia (TR 1.2.25.7, 1.2.25.14).
  app.get('/api/farmacia/paciente/:id', async (req) => {
    exigirPermissao(req, 'dispensacao:consultar');
    const id = Number((req.params as any).id);
    const [receitas, historico, demandas, processos] = await Promise.all([
      consultar(
        `select r.id, r.numero, r.data::text data, r.validade::text validade, r.tipo_receita, r.situacao, r.numero_notificacao, coalesce(p.nome, r.prescritor_externo) prescritor,
                (r.validade < current_date) vencida,
                (select json_agg(json_build_object('id', i.id, 'produto_id', i.produto_id, 'descricao', i.descricao, 'quantidade', i.quantidade, 'dispensada', coalesce(i.quantidade_dispensada, 0),
                                                   'posologia', i.posologia, 'duracao_dias', i.duracao_dias, 'uso_continuo', i.uso_continuo) order by i.id)
                   from amb.prescricao_item i where i.prescricao_id = r.id) itens
           from amb.prescricao r left join cad.profissional p on p.id = r.profissional_id
          where r.paciente_id = $1 and r.situacao in ('ABERTA','PARCIAL') and not r.uso_interno order by r.data desc limit 30`,
        [id],
      ),
      consultar(
        `select d.id, d.data_hora, u.nome unidade, pr.nome || coalesce(' ' || pr.concentracao, '') produto, di.quantidade, d.prescritor, d.tipo_receita, di.termino_previsto::text termino,
                l.lote, d.situacao, o.nome atendente
           from far.dispensacao d join far.dispensacao_item di on di.dispensacao_id = d.id join far.produto pr on pr.id = di.produto_id
           join cad.unidade u on u.id = d.unidade_id left join far.estoque_lote l on l.id = di.lote_id left join seg.operador o on o.id = d.operador_id
          where d.paciente_id = $1 order by d.data_hora desc limit 100`,
        [id],
      ),
      consultar(
        `select dr.id, dr.data::text data, pr.nome produto, dr.quantidade, dr.quantidade_atendida, dr.situacao from far.demanda_reprimida dr join far.produto pr on pr.id = dr.produto_id
          where dr.paciente_id = $1 and dr.situacao in ('ABERTA','PARCIAL') order by dr.data`,
        [id],
      ),
      consultar(
        `select pj.id, pj.numero, pj.situacao, (select json_agg(json_build_object('produto_id', i.produto_id, 'produto', pr.nome, 'quantidade', i.quantidade, 'entregue', i.quantidade_entregue,
                                                                                'por_retirada', i.quantidade_por_retirada, 'frequencia', i.frequencia_dias, 'ultima', i.ultima_entrega))
                                                    from far.processo_judicial_item i join far.produto pr on pr.id = i.produto_id where i.processo_id = pj.id) itens
           from far.processo_judicial pj where pj.paciente_id = $1 and pj.situacao in ('ABERTO','EM_ANDAMENTO','UNICO')`,
        [id],
      ),
    ]);
    return { receitas, historico, demandas, processos };
  });

  app.post('/api/farmacia/dispensacoes', async (req, reply) => {
    const u = exigirPermissao(req, 'dispensacao:incluir');
    const b = z
      .object({
        unidadeId: z.number().optional(),
        pacienteId: z.number(),
        prescricaoId: z.number().nullish(),
        processoJudicialId: z.number().nullish(),
        numeroReceita: z.string().nullish(),
        prescritor: z.string().nullish(),
        tipoReceita: z.string().nullish(),
        dataReceita: z.string().nullish(),
        retiradoPor: z.string().nullish(),
        itens: z.array(z.object({ produtoId: z.number(), quantidade: z.number().positive(), loteId: z.number().nullish(), diasConsumo: z.number().nullish(), prescricaoItemId: z.number().nullish() })).min(1),
        confirmarAvisos: z.boolean().optional(),
        demandaReprimida: z.array(z.object({ produtoId: z.number(), quantidade: z.number().positive(), dataNecessaria: z.string().optional() })).optional(),
      })
      .parse(req.body);
    const unidadeId = b.unidadeId ?? u.unidadeAtual;
    if (!unidadeId) throw new ErroHttp(422, 'Selecione a unidade de trabalho.');
    const d = await transacao(contextoDe(req, 'dispensacao'), async (c) => {
      const r = await dispensar(c, { ...b, unidadeId }, u);
      // Demanda reprimida no momento da dispensação, se parametrizado (TR 1.2.28.7).
      if (b.demandaReprimida?.length && (await parametro<boolean>('farmacia.demanda_na_dispensacao', true)))
        for (const dr of b.demandaReprimida)
          await c.query(`insert into far.demanda_reprimida (data, unidade_id, paciente_id, produto_id, quantidade, quantidade_atendida, data_necessaria, situacao) values (current_date,$1,$2,$3,$4,0,$5,'ABERTA')`, [
            unidadeId,
            b.pacienteId,
            dr.produtoId,
            dr.quantidade,
            dr.dataNecessaria ?? null,
          ]);
      return r;
    });
    return reply.status(201).send(d);
  });

  app.post('/api/farmacia/dispensacoes/:id/estornar', async (req) => {
    const u = exigirPermissao(req, 'dispensacao:excluir');
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    await transacao(contextoDe(req, 'dispensacao:estorno'), (c) => estornarDispensacao(c, Number((req.params as any).id), motivo, u));
    return { ok: true };
  });

  // Comprovante de entrega com espaço para assinatura, em A4 ou impressora térmica (TR 1.2.25.22, 1.2.25.23, 1.2.25.29).
  app.get('/api/farmacia/dispensacoes/:id/comprovante', async (req, reply) => {
    const u = exigirPermissao(req, 'dispensacao:consultar');
    const id = Number((req.params as any).id);
    const termica = (req.query as any).termica === 'true' || (await parametro<{ termica?: boolean }>('farmacia.comprovante', {})).termica === true;
    const d = await consultarUm(
      `select d.*, p.nome paciente, p.cns, p.data_nascimento::text nasc, u.nome unidade, o.nome atendente, pj.numero processo
         from far.dispensacao d join cad.pessoa p on p.id = d.paciente_id join cad.unidade u on u.id = d.unidade_id
         left join seg.operador o on o.id = d.operador_id left join far.processo_judicial pj on pj.id = d.processo_judicial_id where d.id = $1`,
      [id],
    );
    if (!d) throw new ErroHttp(404, 'Dispensação não encontrada.');
    const itens = await consultar(
      `select pr.nome || coalesce(' ' || pr.concentracao, '') produto, di.quantidade, l.lote, l.validade::text validade, di.termino_previsto::text termino
         from far.dispensacao_item di join far.produto pr on pr.id = di.produto_id left join far.estoque_lote l on l.id = di.lote_id where di.dispensacao_id = $1 order by di.id`,
      [id],
    );
    const saldoProcesso = d.processo_judicial_id
      ? await consultar(`select pr.nome produto, i.quantidade - coalesce(i.quantidade_entregue, 0) saldo from far.processo_judicial_item i join far.produto pr on pr.id = i.produto_id where i.processo_id = $1`, [
          d.processo_judicial_id,
        ])
      : [];
    const fs = termica ? 8 : 10;
    const corpo: any[] = [
      { image: await codigoBarras(`D${String(id).padStart(9, '0')}`), width: termica ? 150 : 200, margin: [0, 0, 0, 4] },
      { text: `Dispensação nº ${id} — ${new Date(d.data_hora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${d.situacao === 'ESTORNADA' ? ' — ESTORNADA' : ''}`, bold: true, fontSize: fs },
      { text: `Unidade: ${d.unidade}`, fontSize: fs },
      { text: `Paciente: ${d.paciente} · CNS ${d.cns ?? '-'} · ${idadeTexto(d.nasc)}`, fontSize: fs },
      { text: `Receita: ${d.numero_receita ?? '-'} (${d.tipo_receita ?? '-'}) · Prescritor: ${d.prescritor ?? '-'}`, fontSize: fs },
      ...(d.processo ? [{ text: `Processo judicial: ${d.processo}`, fontSize: fs }] : []),
      {
        margin: [0, 6, 0, 6],
        table: {
          widths: termica ? ['*', 30] : ['*', 50, 70, 60, 70],
          body: [
            termica
              ? [{ text: 'Produto / lote', bold: true, fontSize: fs }, { text: 'Qtd', bold: true, fontSize: fs }]
              : ['Produto', 'Qtd.', 'Lote', 'Validade', 'Término previsto'].map((t) => ({ text: t, bold: true, fontSize: fs })),
            ...itens.map((i) =>
              termica
                ? [{ text: `${i.produto}\nLote ${i.lote ?? '-'} val. ${fmtData(i.validade)}`, fontSize: fs }, { text: String(Number(i.quantidade)), fontSize: fs }]
                : [i.produto, String(Number(i.quantidade)), i.lote ?? '-', fmtData(i.validade), fmtData(i.termino)].map((t) => ({ text: t, fontSize: fs })),
            ),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      ...(saldoProcesso.length ? [{ text: 'Saldo a retirar no processo: ' + saldoProcesso.map((s) => `${s.produto}: ${Number(s.saldo)}`).join('; '), fontSize: fs }] : []),
      { text: `Retirado por: ${d.retirado_por ?? d.paciente}`, fontSize: fs, margin: [0, 6, 0, 0] },
      { text: '\n\n_____________________________________________\nAssinatura do paciente ou responsável', alignment: 'center', fontSize: fs },
      { text: `Atendente: ${d.atendente ?? '-'}`, fontSize: fs - 1, margin: [0, 6, 0, 0] },
    ];
    const r = await emitirDocumento(
      { relatorio: 'farmacia:comprovante', titulo: 'Comprovante de entrega de medicamentos', filtros: { dispensacao: id, termica } },
      corpo,
      termica ? { tamanho: { width: 226, height: 160 + itens.length * 30 + saldoProcesso.length * 10 + 260 }, margens: [10, 10, 10, 10], semCabecalho: true } : {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
  });

  // ---------------------------------------------------------------------------
  // Acertos e bloqueios de lote
  // ---------------------------------------------------------------------------
  app.get('/api/farmacia/acerto', async (req) => {
    const u = exigirPermissao(req, 'acerto_estoque:executar');
    const q = req.query as any;
    return consultar(
      `select l.id, pr.nome || coalesce(' ' || pr.concentracao, '') produto, l.lote, l.validade::text validade, l.quantidade, l.reservado, l.bloqueado, f.nome fabricante
         from far.estoque_lote l join far.produto pr on pr.id = l.produto_id left join far.fabricante f on f.id = l.fabricante_id
        where l.unidade_id = $1 and ($2::bigint is null or l.produto_id = $2) and (l.quantidade <> 0 or $2 is not null) order by 2, l.validade`,
      [Number(q.unidadeId ?? u.unidadeAtual), q.produtoId ? Number(q.produtoId) : null],
    );
  });
  app.post('/api/farmacia/acerto', async (req) => {
    const u = exigirPermissao(req, 'acerto_estoque:executar');
    const b = z.object({ itens: z.array(z.object({ loteId: z.number(), novoSaldo: z.number().min(0) })).min(1), motivo: z.string().min(3) }).parse(req.body);
    return transacao(contextoDe(req, 'acerto-estoque'), async (c) => {
      const r = [];
      for (const i of b.itens) r.push({ loteId: i.loteId, ...(await acertarSaldo(c, i.loteId, i.novoSaldo, b.motivo, u)) });
      return r;
    });
  });
  // Bloqueio/desbloqueio de lote, ex.: interdição pela ANVISA (TR 1.2.27.19, 1.2.27.20).
  app.post('/api/farmacia/lotes/:id/bloqueio', async (req) => {
    exigirPermissao(req, 'estoque_lote:alterar');
    const b = z.object({ bloquear: z.boolean(), motivo: z.string().optional() }).parse(req.body);
    if (b.bloquear && !b.motivo) throw new ErroHttp(422, 'Informe o motivo do bloqueio.');
    await transacao(contextoDe(req, 'lote:bloqueio'), (c) => c.query(`update far.estoque_lote set bloqueado = $2, motivo_bloqueio = $3 where id = $1`, [(req.params as any).id, b.bloquear, b.bloquear ? b.motivo : null]));
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Requisições e transferências
  // ---------------------------------------------------------------------------
  app.post('/api/farmacia/requisicoes/:id/:acao', async (req) => {
    exigirPermissao(req, 'requisicao_estoque:alterar');
    const acao = (req.params as any).acao as string;
    const destinos: Record<string, [string[], string]> = {
      enviar: [['DIGITACAO'], 'ENVIADA'],
      separar: [['ENVIADA'], 'EM_SEPARACAO'],
      cancelar: [['DIGITACAO', 'ENVIADA', 'EM_SEPARACAO'], 'CANCELADA'],
      receber: [['ATENDIDA', 'ATENDIDA_PARCIAL'], 'RECEBIDA'],
    };
    const d = destinos[acao];
    if (!d) throw new ErroHttp(404, 'Ação inexistente.');
    const r = await transacao(contextoDe(req, `requisicao:${acao}`), async (c) => {
      if (acao === 'enviar') {
        const n = (await c.query(`select count(*)::int n from far.requisicao_item where requisicao_id = $1`, [(req.params as any).id])).rows[0].n;
        if (!n) throw new ErroHttp(422, 'Inclua os itens antes de enviar a requisição.');
      }
      return c.query(`update far.requisicao set situacao = $2 where id = $1 and situacao = any($3) returning id`, [(req.params as any).id, d[1], d[0]]);
    });
    if (!r.rowCount) throw new ErroHttp(409, 'A requisição não está em uma situação que permita esta ação.');
    return { ok: true };
  });

  // Requisições pendentes para a unidade requisitada, com saldo do requisitante para decisão (TR 1.2.27.5, 1.2.27.17).
  app.get('/api/farmacia/requisicoes/pendentes', async (req) => {
    const u = exigirPermissao(req, 'transferencia:consultar');
    const unidadeId = Number((req.query as any).unidadeId ?? u.unidadeAtual);
    return consultar(
      `select r.id, r.data::text data, r.situacao, r.unidade_requisitante_id, ur.nome unidade_requisitante, r.observacao,
              (select json_agg(json_build_object('id', i.id, 'produto_id', i.produto_id, 'produto', pr.nome || coalesce(' ' || pr.concentracao, ''), 'quantidade', i.quantidade,
                       'atendida', coalesce(i.quantidade_atendida, 0),
                       'saldo_requisitante', (select coalesce(sum(l.quantidade), 0) from far.estoque_lote l where l.unidade_id = r.unidade_requisitante_id and l.produto_id = i.produto_id and l.validade >= current_date),
                       'saldo_disponivel', (select coalesce(sum(l.quantidade - l.reservado), 0) from far.estoque_lote l where l.unidade_id = r.unidade_requisitada_id and l.produto_id = i.produto_id and not l.bloqueado and l.validade >= current_date),
                       'consumo_30d', (select coalesce(-sum(m.quantidade), 0) from far.movimento_estoque m where m.unidade_id = r.unidade_requisitante_id and m.produto_id = i.produto_id and m.tipo = 'DISPENSACAO' and m.data_hora > now() - interval '30 days'),
                       'ultimo_envio', (select max(t.data)::date::text from far.transferencia t join far.transferencia_item ti on ti.transferencia_id = t.id where t.unidade_destino_id = r.unidade_requisitante_id and ti.produto_id = i.produto_id and t.situacao <> 'CANCELADA')
                     ) order by pr.nome) from far.requisicao_item i join far.produto pr on pr.id = i.produto_id where i.requisicao_id = r.id) itens
         from far.requisicao r join cad.unidade ur on ur.id = r.unidade_requisitante_id
        where r.unidade_requisitada_id = $1 and r.situacao in ('ENVIADA','EM_SEPARACAO','ATENDIDA_PARCIAL') order by r.data`,
      [unidadeId],
    );
  });

  app.post('/api/farmacia/transferencias', async (req, reply) => {
    const u = exigirPermissao(req, 'transferencia:incluir');
    const b = z
      .object({
        unidadeOrigemId: z.number().optional(),
        unidadeDestinoId: z.number(),
        itens: z.array(z.object({ produtoId: z.number(), quantidade: z.number().positive(), loteId: z.number().nullish(), requisicaoItemId: z.number().nullish() })).min(1),
        requisicoes: z.array(z.number()).optional(),
        observacao: z.string().optional(),
      })
      .parse(req.body);
    const origem = b.unidadeOrigemId ?? u.unidadeAtual;
    if (!origem) throw new ErroHttp(422, 'Selecione a unidade de origem.');
    return reply.status(201).send(await transacao(contextoDe(req, 'transferencia'), (c) => criarTransferencia(c, { ...b, unidadeOrigemId: origem }, u)));
  });
  app.post('/api/farmacia/transferencias/:id/aprovar', async (req) => {
    const u = exigirPermissao(req, 'transferencia:alterar');
    await transacao(contextoDe(req, 'transferencia:aprovar'), (c) => aprovarTransferencia(c, Number((req.params as any).id), u));
    return { ok: true };
  });
  app.post('/api/farmacia/transferencias/:id/receber', async (req) => {
    const u = exigirPermissao(req, 'transferencia:alterar');
    const b = z.object({ recebidos: z.record(num).optional() }).parse(req.body ?? {});
    const t = await consultarUm(`select unidade_destino_id from far.transferencia where id = $1`, [(req.params as any).id]);
    if (t && !u.administrador && u.unidades.length && !u.unidades.includes(Number(t.unidade_destino_id))) throw new ErroHttp(403, 'Somente a unidade de destino pode receber a transferência.');
    const rec = b.recebidos ? Object.fromEntries(Object.entries(b.recebidos).map(([k, v]) => [Number(k), v])) : null;
    await transacao(contextoDe(req, 'transferencia:receber'), (c) => receberTransferencia(c, Number((req.params as any).id), rec, u));
    return { ok: true };
  });
  app.post('/api/farmacia/transferencias/:id/cancelar', async (req) => {
    const u = exigirPermissao(req, 'transferencia:alterar');
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    await transacao(contextoDe(req, 'transferencia:cancelar'), (c) => cancelarTransferencia(c, Number((req.params as any).id), motivo, u));
    return { ok: true };
  });
  app.get('/api/farmacia/transferencias', async (req) => {
    const u = exigirPermissao(req, 'transferencia:consultar');
    const q = req.query as any;
    const unidadeId = Number(q.unidadeId ?? u.unidadeAtual);
    return consultar(
      `select t.id, t.data, t.situacao, t.unidade_origem_id, uo.nome origem, t.unidade_destino_id, ud.nome destino, t.observacao,
              (select json_agg(json_build_object('id', i.id, 'produto', pr.nome || coalesce(' ' || pr.concentracao, ''), 'lote', l.lote, 'validade', l.validade, 'quantidade', i.quantidade, 'recebida', i.quantidade_recebida) order by pr.nome)
                 from far.transferencia_item i join far.produto pr on pr.id = i.produto_id join far.estoque_lote l on l.id = i.lote_origem_id where i.transferencia_id = t.id) itens
         from far.transferencia t join cad.unidade uo on uo.id = t.unidade_origem_id join cad.unidade ud on ud.id = t.unidade_destino_id
        where (t.unidade_origem_id = $1 or t.unidade_destino_id = $1) and ($2::text is null or t.situacao = $2) order by t.id desc limit 200`,
      [unidadeId, q.situacao || null],
    );
  });

  // Guia de separação / requisição impressa (TR 1.2.27.3, 1.2.27.6, 1.2.27.8).
  app.get('/api/farmacia/guia/:tipo/:id', async (req, reply) => {
    const u = exigirPermissao(req, 'transferencia:consultar');
    const { tipo, id } = req.params as any;
    let titulo: string;
    let cab: string[];
    let linhas: string[][];
    let info: string;
    if (tipo === 'transferencia') {
      const t = await consultarUm(`select t.*, uo.nome origem, ud.nome destino from far.transferencia t join cad.unidade uo on uo.id = t.unidade_origem_id join cad.unidade ud on ud.id = t.unidade_destino_id where t.id = $1`, [id]);
      if (!t) throw new ErroHttp(404, 'Transferência não encontrada.');
      titulo = `Guia de separação - transferência nº ${id}`;
      info = `Origem: ${t.origem} · Destino: ${t.destino} · Situação: ${t.situacao}`;
      cab = ['Produto', 'Apresentação', 'Fabricante', 'Lote', 'Validade', 'Qtd.', 'Recebida'];
      linhas = (
        await consultar(
          `select pr.nome || coalesce(' ' || pr.concentracao, '') produto, ap.nome apresentacao, f.nome fabricante, l.lote, l.validade::text validade, i.quantidade, i.quantidade_recebida
             from far.transferencia_item i join far.produto pr on pr.id = i.produto_id join far.estoque_lote l on l.id = i.lote_origem_id
             left join far.apresentacao ap on ap.id = pr.apresentacao_id left join far.fabricante f on f.id = l.fabricante_id where i.transferencia_id = $1 order by 1`,
          [id],
        )
      ).map((r) => [r.produto, r.apresentacao ?? '', r.fabricante ?? '', r.lote, fmtData(r.validade), String(Number(r.quantidade)), r.quantidade_recebida == null ? '' : String(Number(r.quantidade_recebida))]);
    } else {
      const r = await consultarUm(`select r.*, ur.nome requisitante, ud.nome requisitada from far.requisicao r join cad.unidade ur on ur.id = r.unidade_requisitante_id join cad.unidade ud on ud.id = r.unidade_requisitada_id where r.id = $1`, [id]);
      if (!r) throw new ErroHttp(404, 'Requisição não encontrada.');
      const analitica = (req.query as any).analitica === 'true';
      titulo = `Requisição de produtos nº ${id}${analitica ? ' (analítica)' : ''}`;
      info = `Requisitante: ${r.requisitante} · Requisitada: ${r.requisitada} · Data: ${fmtData(r.data)} · Situação: ${r.situacao}`;
      cab = analitica ? ['Produto', 'Qtd. solicitada', 'Lotes disponíveis na unidade requisitada'] : ['Produto', 'Qtd. solicitada', 'Qtd. atendida'];
      linhas = (
        await consultar(
          `select pr.nome || coalesce(' ' || pr.concentracao, '') produto, i.quantidade, i.quantidade_atendida,
                  (select string_agg(l.lote || ' (' || to_char(l.validade, 'DD/MM/YYYY') || '): ' || (l.quantidade - l.reservado)::text, '; ' order by l.validade)
                     from far.estoque_lote l where l.unidade_id = $2 and l.produto_id = i.produto_id and l.quantidade - l.reservado > 0 and not l.bloqueado and l.validade >= current_date) lotes
             from far.requisicao_item i join far.produto pr on pr.id = i.produto_id where i.requisicao_id = $1 order by 1`,
          [id, r.unidade_requisitada_id],
        )
      ).map((x) => (analitica ? [x.produto, String(Number(x.quantidade)), x.lotes ?? 'sem saldo'] : [x.produto, String(Number(x.quantidade)), String(Number(x.quantidade_atendida ?? 0))]));
    }
    const doc = await emitirDocumento(
      { relatorio: `farmacia:guia-${tipo}`, titulo, filtros: { id } },
      [
        { text: info, margin: [0, 0, 0, 8] },
        { table: { headerRows: 1, widths: cab.map((_, i) => (i === 0 ? '*' : 'auto')), body: [cab.map((t) => ({ text: t, style: 'th' })), ...linhas] }, layout: 'lightHorizontalLines' },
        { text: '\n\nSeparado por: ______________________________    Conferido por: ______________________________', fontSize: 9 },
      ] as any,
      { orientacao: 'landscape' },
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // ---------------------------------------------------------------------------
  // Demanda reprimida: avisos ao paciente (TR 1.2.28.3, 1.2.28.4)
  // ---------------------------------------------------------------------------
  app.post('/api/farmacia/demandas/:id/avisar', async (req) => {
    const u = exigirPermissao(req, 'demanda_reprimida:alterar');
    const b = z.object({ meio: z.enum(['SMS', 'EMAIL', 'PUSH', 'SISTEMA']).default('SMS'), texto: z.string().optional() }).parse(req.body ?? {});
    const d = await consultarUm(
      `select dr.*, p.nome paciente, p.celular, p.email, pr.nome produto, un.nome unidade from far.demanda_reprimida dr join cad.pessoa p on p.id = dr.paciente_id
         join far.produto pr on pr.id = dr.produto_id join cad.unidade un on un.id = dr.unidade_id where dr.id = $1`,
      [(req.params as any).id],
    );
    if (!d) throw new ErroHttp(404, 'Demanda não encontrada.');
    const texto = b.texto ?? `${d.paciente.split(' ')[0]}, o medicamento ${d.produto} já está disponível para retirada na ${d.unidade}.`;
    await transacao(contextoDe(req, 'demanda:aviso'), async (c) => {
      const meio = ({ SMS: 'sms', EMAIL: 'email', PUSH: 'push', SISTEMA: 'push' } as const)[b.meio];
      const destino = meio === 'email' ? d.email : meio === 'sms' ? d.celular : String(d.paciente_id);
      if (!destino) throw new ErroHttp(422, `Paciente sem ${meio === 'email' ? 'e-mail' : 'celular'} cadastrado.`);
      await enfileirarMensagem({ pacienteId: d.paciente_id, meio, destinatario: destino, assunto: 'Medicamento disponível', texto, evento: 'demanda_reprimida', operadorId: u.id, referencia: `demanda:${d.id}` }, c);
      await c.query(`insert into cad.pessoa_contato (pessoa_id, data_hora, setor, meio, assunto, descricao) values ($1, now(), 'FARMÁCIA', $2, 'Demanda reprimida', $3)`, [
        d.paciente_id,
        meio === 'push' ? 'APP' : b.meio,
        texto,
      ]);
    });
    return { ok: true };
  });
}
