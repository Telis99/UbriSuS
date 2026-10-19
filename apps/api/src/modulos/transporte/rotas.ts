// Rotas do transporte sanitário: agendamento simplificado, gestão das viagens, fechamento com
// prestação de contas e documentos impressos (comprovante, relação de passageiros, ordem de tráfego).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { idadeTexto } from '../../compartilhado/validacao.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { contextoDe, ErroHttp, exigirPermissao } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import {
  abrangenciaDaRota,
  agendarTransporte,
  cancelarViagem,
  confirmarViagem,
  criarViagemAvulsa,
  disponibilidadeRota,
  fecharViagem,
  fmtData,
  hhmm,
  incluirAcompanhante,
  incluirPassageiro,
  lancarDespesa,
  ocupacaoViagens,
  prestacaoContas,
  registrarPresenca,
} from './servico.js';
import './relatorios.js';

const ROTULO_TIPO: Record<string, string> = { IDA_VOLTA: 'Ida e volta', IDA: 'Somente ida', VOLTA: 'Somente volta' };
const moeda = (v: unknown) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const pdf = (reply: any, r: { nome: string; conteudo: Buffer }) => reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
const idParam = (req: any) => Number(req.params.id);

const tipoViagem = z.enum(['IDA', 'VOLTA', 'IDA_VOLTA']);
const nulo = <T extends z.ZodTypeAny>(t: T) => t.nullish();
const acompanhanteSchema = z.object({
  indefinido: z.boolean().optional(),
  pessoaId: nulo(z.number()),
  nome: nulo(z.string().max(120)),
  documento: nulo(z.string().max(20)),
  parentesco: nulo(z.string().max(40)),
  tipoViagem: tipoViagem.optional(),
  ocupaVaga: z.boolean().optional(),
  poltrona: nulo(z.number().int().positive()),
});
const hora = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const passageiroSchema = z.object({
  pacienteId: z.number(),
  ocupaVaga: z.boolean().optional(),
  municipioDestinoId: nulo(z.number()),
  localDestinoId: nulo(z.number()),
  motivoId: nulo(z.number()),
  localEmbarqueId: nulo(z.number()),
  horaSaida: nulo(hora),
  horarioCompromisso: nulo(hora),
  poltrona: nulo(z.number().int().positive()),
  tipoViagem: tipoViagem.optional(),
  necessidade: z.enum(['NENHUMA', 'MACA', 'CADEIRA_RODAS']).optional(),
  observacao: nulo(z.string().max(250)),
  tfdLaudoId: nulo(z.number()),
  acompanhantes: z.array(acompanhanteSchema).max(10).optional(),
});
const despesaSchema = z.object({
  despesaId: z.number(),
  data,
  descricao: nulo(z.string().max(200)),
  quantidade: z.number().positive(),
  valorUnitario: z.number().min(0),
  documento: nulo(z.string().max(40)),
});

async function viagemAberta(c: any, viagemId: number) {
  const v = (await c.query(`select situacao from tra.viagem where id = $1`, [viagemId])).rows[0];
  if (!v) throw new ErroHttp(404, 'Viagem não encontrada.');
  if (['CONCLUIDA', 'CANCELADA'].includes(v.situacao)) throw new ErroHttp(422, 'Viagem encerrada: não pode ser alterada.');
}

// ---------------------------------------------------------------------------
// Regras nos cadastros genéricos
// ---------------------------------------------------------------------------
registrarGanchos('rota', {
  // Abrangência usada no bloqueio por feriados (TR 1.2.40.27, 1.2.40.28).
  async antesSalvar(d, { cliente, atual }) {
    if (!d.abrangencia && !atual?.abrangencia) d.abrangencia = await abrangenciaDaRota(cliente, d.municipio_destino_id ?? atual?.municipio_destino_id);
  },
});
registrarGanchos('agenda_transporte', {
  async antesSalvar(d, { cliente, atual }) {
    const veiculoId = d.veiculo_id ?? atual?.veiculo_id;
    const vagas = d.vagas ?? atual?.vagas;
    const v = (await cliente.query(`select passageiros, placa from tra.veiculo where id = $1`, [veiculoId])).rows[0];
    if (v && vagas > v.passageiros) throw new ErroHttp(422, `O veículo ${v.placa} comporta ${v.passageiros} passageiros.`, { vagas: 'Acima da capacidade do veículo.' });
    const ini = d.data_inicial ?? atual?.data_inicial;
    const fim = d.data_final === undefined ? atual?.data_final : d.data_final;
    if (fim && ini && String(fim) < String(ini)) throw new ErroHttp(422, 'A data final deve ser posterior à data inicial.', { data_final: 'Inválida.' });
  },
});
registrarGanchos('viagem', {
  async antesSalvar(d, { atual }) {
    if (!atual) throw new ErroHttp(422, 'Utilize o agendamento de transporte ou a inclusão de viagem sem agendamento prévio.');
    if (['CONCLUIDA', 'CANCELADA'].includes(atual.situacao)) throw new ErroHttp(422, 'Viagem encerrada não pode ser alterada.');
    for (const k of ['data_saida', 'sem_agendamento', 'km_final', 'data_chegada', 'hora_chegada']) delete d[k];
  },
  antesExcluir() {
    throw new ErroHttp(422, 'Viagens não são excluídas: utilize o cancelamento.');
  },
});
registrarGanchos('viagem_passageiro', {
  async antesSalvar(d, { cliente, atual }) {
    if (!atual) throw new ErroHttp(422, 'Utilize o agendamento de transporte para incluir passageiros.');
    await viagemAberta(cliente, atual.viagem_id);
    delete d.viagem_id;
    delete d.paciente_id;
    if (d.local_destino_id) d.local_destino = (await cliente.query(`select nome from tra.local_destino where id = $1`, [d.local_destino_id])).rows[0]?.nome ?? null;
  },
  antesExcluir() {
    throw new ErroHttp(422, 'Utilize o cancelamento do agendamento.');
  },
});
registrarGanchos('viagem_acompanhante', {
  // Identificação dos acompanhantes reservados (TR 1.2.40.15, 1.2.40.20).
  async antesSalvar(d, { cliente, atual }) {
    if (!atual) throw new ErroHttp(422, 'Inclua acompanhantes pelo agendamento ou pela gestão da viagem.');
    const vp = (await cliente.query(`select viagem_id from tra.viagem_passageiro where id = $1`, [atual.passageiro_id])).rows[0];
    await viagemAberta(cliente, vp.viagem_id);
    const pessoa = d.pessoa_id ?? atual.pessoa_id;
    if (pessoa && !d.nome && !atual.nome) d.nome = (await cliente.query(`select nome from cad.pessoa where id = $1`, [pessoa])).rows[0]?.nome ?? null;
    d.indefinido = !(pessoa || d.nome || atual.nome);
  },
});
registrarGanchos('viagem_despesa', {
  async antesSalvar(d, { cliente, atual }) {
    await viagemAberta(cliente, d.viagem_id ?? atual?.viagem_id);
    d.valor_total = Math.round(Number(d.quantidade ?? atual?.quantidade ?? 1) * Number(d.valor_unitario ?? atual?.valor_unitario ?? 0) * 100) / 100;
  },
  async antesExcluir(r, { cliente }) {
    await viagemAberta(cliente, r.viagem_id);
  },
});
registrarGanchos('viagem_adiantamento', {
  async antesSalvar(d, { cliente, atual, usuario }) {
    await viagemAberta(cliente, d.viagem_id ?? atual?.viagem_id);
    if (!atual) d.operador_id = usuario?.id ?? null;
  },
  async antesExcluir(r, { cliente }) {
    await viagemAberta(cliente, r.viagem_id);
  },
});

/** Dados completos da viagem para a gestão, documentos e fechamento. */
async function carregarViagem(id: number) {
  const v = await consultarUm(
    `select v.*, v.data_saida::text data_saida, v.hora_saida::text hora_saida, v.data_chegada::text data_chegada, v.hora_chegada::text hora_chegada,
            r.nome rota, m.nome municipio, m.uf_sigla uf, ld.nome local_destino, mv.nome motivo, le.nome local_embarque, le.endereco embarque_endereco,
            ve.placa, ve.modelo, mv2.nome marca, tv.nome tipo_veiculo, ve.passageiros capacidade, ve.macas, ve.cadeiras_rodas, ve.km_atual,
            co.nome condutor, co.cnh_numero, co.cnh_categoria, co.cnh_validade::text cnh_validade, co.telefone condutor_telefone,
            oc.nome confirmada_por_nome, ofe.nome fechada_por_nome
       from tra.viagem v left join tra.rota r on r.id = v.rota_id left join cad.municipio m on m.id = v.municipio_destino_id
       left join tra.local_destino ld on ld.id = v.local_destino_id left join tra.motivo_viagem mv on mv.id = v.motivo_id
       left join tra.local_embarque le on le.id = v.local_embarque_id left join tra.veiculo ve on ve.id = v.veiculo_id
       left join tra.marca_veiculo mv2 on mv2.id = ve.marca_id left join tra.tipo_veiculo tv on tv.id = ve.tipo_id
       left join tra.condutor co on co.id = v.condutor_id left join seg.operador oc on oc.id = v.confirmada_por left join seg.operador ofe on ofe.id = v.fechada_por
      where v.id = $1`,
    [id],
  );
  if (!v) throw new ErroHttp(404, 'Viagem não encontrada.');
  const passageiros = await consultar(
    `select vp.*, vp.hora_saida::text hora_saida, vp.horario_compromisso::text horario_compromisso, p.nome paciente, p.cns, p.cpf, p.data_nascimento::text nascimento,
            coalesce(p.celular, p.telefone) telefone, m.nome municipio_destino, mv.nome motivo, le.nome local_embarque, l.numero tfd_numero,
            coalesce((select json_agg(json_build_object('id', a.id, 'indefinido', a.indefinido, 'nome', a.nome, 'documento', a.documento, 'parentesco', a.parentesco,
                              'tipo_viagem', a.tipo_viagem, 'ocupa_vaga', a.ocupa_vaga, 'poltrona', a.poltrona, 'pessoa_id', a.pessoa_id) order by a.id)
                        from tra.viagem_acompanhante a where a.passageiro_id = vp.id), '[]') acompanhantes
       from tra.viagem_passageiro vp join cad.pessoa p on p.id = vp.paciente_id left join cad.municipio m on m.id = vp.municipio_destino_id
       left join tra.motivo_viagem mv on mv.id = vp.motivo_id left join tra.local_embarque le on le.id = vp.local_embarque_id
       left join tfd.laudo l on l.id = vp.tfd_laudo_id
      where vp.viagem_id = $1 order by vp.situacao = 'CANCELADO', vp.poltrona nulls last, p.nome`,
    [id],
  );
  const paradas = v.rota_id
    ? await consultar(`select rp.ordem, m.nome municipio, m.uf_sigla uf, ld.nome local from tra.rota_parada rp join cad.municipio m on m.id = rp.municipio_id left join tra.local_destino ld on ld.id = rp.local_destino_id where rp.rota_id = $1 order by rp.ordem`, [v.rota_id])
    : [];
  const adiantamentos = await consultar(`select a.*, a.data::text data, c.nome condutor from tra.viagem_adiantamento a left join tra.condutor c on c.id = a.condutor_id where a.viagem_id = $1 order by a.data, a.id`, [id]);
  const despesas = await consultar(
    `select d.*, d.data::text data, t.nome despesa, g.nome grupo, t.combustivel, t.unidade_medida from tra.viagem_despesa d join tra.despesa t on t.id = d.despesa_id join tra.grupo_despesa g on g.id = t.grupo_id where d.viagem_id = $1 order by d.data, d.id`,
    [id],
  );
  const ocup = (await ocupacaoViagens(pool, [id])).get(id) ?? { ida: 0, volta: 0, ocupadas: 0, pacientes: 0, indefinidos: 0 };
  return { viagem: v, passageiros, paradas, adiantamentos, despesas, ocupacao: { ...ocup, vagas: Number(v.vagas ?? 0), livres: Math.max(0, Number(v.vagas ?? 0) - ocup.ocupadas) }, contas: await prestacaoContas(pool, id) };
}

export default async function rotasTransporte(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Agendamento: município de destino → rotas → dias e horários → vagas (TR 1.2.40.12)
  // -------------------------------------------------------------------------
  app.get('/api/transporte/municipios-destino', async (req) => {
    exigirPermissao(req, 'viagem:consultar');
    return consultar(
      `select m.id, m.nome, m.uf_sigla uf, count(distinct r.id)::int rotas
         from tra.rota r join (select id rota_id, municipio_destino_id municipio_id from tra.rota union select rota_id, municipio_id from tra.rota_parada) x on x.rota_id = r.id
         join cad.municipio m on m.id = x.municipio_id
        where r.ativo and exists (select 1 from tra.agenda a where a.rota_id = r.id and a.ativo and (a.data_final is null or a.data_final >= current_date))
        group by m.id, m.nome, m.uf_sigla order by m.nome`,
    );
  });

  app.get('/api/transporte/rotas', async (req) => {
    exigirPermissao(req, 'viagem:consultar');
    const q = req.query as any;
    const rotas = await consultar(
      `select r.id, r.nome, r.abrangencia, r.valor_viagem, r.distancia_km, m.nome destino, m.uf_sigla uf, ld.nome local_destino, r.local_destino_id, mv.nome motivo, r.motivo_id,
              ve.placa || ' ' || coalesce(ve.modelo, '') veiculo,
              (select json_agg(json_build_object('ordem', rp.ordem, 'municipio', mm.nome, 'municipioId', mm.id) order by rp.ordem) from tra.rota_parada rp join cad.municipio mm on mm.id = rp.municipio_id where rp.rota_id = r.id) paradas,
              (select json_agg(json_build_object('id', a.id, 'hora', to_char(a.hora_saida, 'HH24:MI'), 'dias', a.dias_semana, 'vagas', a.vagas) order by a.hora_saida) from tra.agenda a where a.rota_id = r.id and a.ativo and (a.data_final is null or a.data_final >= current_date)) agendas
         from tra.rota r join cad.municipio m on m.id = r.municipio_destino_id left join tra.local_destino ld on ld.id = r.local_destino_id
         left join tra.motivo_viagem mv on mv.id = r.motivo_id left join tra.veiculo ve on ve.id = r.veiculo_id
        where r.ativo and ($1::bigint is null or r.municipio_destino_id = $1 or exists (select 1 from tra.rota_parada rp where rp.rota_id = r.id and rp.municipio_id = $1))
        order by r.nome`,
      [q.municipioId ? Number(q.municipioId) : null],
    );
    // Próximo dia com vaga de cada rota (TR 1.2.40.12).
    const c = await pool.connect();
    try {
      for (const r of rotas) r.proximo = (await disponibilidadeRota(c, r.id, undefined, 60)).find((d) => d.proximo) ?? null;
    } finally {
      c.release();
    }
    return rotas;
  });

  app.get('/api/transporte/rotas/:id/disponibilidade', async (req) => {
    exigirPermissao(req, 'viagem:consultar');
    const q = req.query as any;
    const c = await pool.connect();
    try {
      return await disponibilidadeRota(c, idParam(req), q.de, Math.min(Number(q.dias ?? 45), 180));
    } finally {
      c.release();
    }
  });

  // Poltronas ocupadas da viagem (para escolha do lugar no agendamento, TR 1.2.40.18.6).
  app.get('/api/transporte/agendas/:id/poltronas', async (req) => {
    exigirPermissao(req, 'viagem:consultar');
    const dataQ = String((req.query as any).data ?? '');
    const a = await consultarUm(`select a.vagas, v.id viagem_id, v.vagas vagas_viagem from tra.agenda a left join tra.viagem v on v.agenda_id = a.id and v.data_saida = $2::date where a.id = $1`, [idParam(req), dataQ]);
    if (!a) throw new ErroHttp(404, 'Agenda não encontrada.');
    const ocupadas = a.viagem_id
      ? (
          await consultar(
            `select vp.poltrona from tra.viagem_passageiro vp where vp.viagem_id = $1 and vp.situacao <> 'CANCELADO' and vp.poltrona is not null
             union select ac.poltrona from tra.viagem_acompanhante ac join tra.viagem_passageiro vp on vp.id = ac.passageiro_id where vp.viagem_id = $1 and vp.situacao <> 'CANCELADO' and ac.poltrona is not null`,
            [a.viagem_id],
          )
        ).map((x) => Number(x.poltrona))
      : [];
    return { vagas: Number(a.vagas_viagem ?? a.vagas), ocupadas };
  });

  app.post('/api/transporte/agendamentos', async (req, reply) => {
    const u = exigirPermissao(req, 'viagem:incluir');
    const b = passageiroSchema.extend({ agendaId: z.number(), data }).parse(req.body);
    const r = await transacao(contextoDe(req, 'transporte:agendamento'), (c) => agendarTransporte(c, b, u));
    return reply.status(201).send(r);
  });

  // Agendamentos do paciente e processos de TFD liberados para transporte (TR 1.2.35.17).
  app.get('/api/transporte/paciente/:id', async (req) => {
    exigirPermissao(req, 'viagem:consultar');
    const id = idParam(req);
    const viagens = await consultar(
      `select vp.id, vp.protocolo, vp.situacao, vp.poltrona, vp.tipo_viagem, vp.ocupa_vaga, vp.local_destino, v.id viagem_id, v.data_saida::text data_saida, to_char(v.hora_saida, 'HH24:MI') hora_saida,
              v.situacao situacao_viagem, r.nome rota, m.nome municipio, vp.observacao_ausencia,
              (select count(*)::int from tra.viagem_acompanhante a where a.passageiro_id = vp.id) acompanhantes,
              (select count(*)::int from tra.viagem_acompanhante a where a.passageiro_id = vp.id and a.indefinido) indefinidos
         from tra.viagem_passageiro vp join tra.viagem v on v.id = vp.viagem_id left join tra.rota r on r.id = v.rota_id left join cad.municipio m on m.id = vp.municipio_destino_id
        where vp.paciente_id = $1 order by v.data_saida desc, v.hora_saida desc limit 50`,
      [id],
    );
    const tfd = await consultar(
      `select l.id, l.numero, l.data_abertura::text data_abertura, ld.nome local_tratamento, l.local_tratamento_id, ld.municipio_id, m.nome municipio, l.agendamento_data_hora, pr.nome procedimento
         from tfd.laudo l left join tra.local_destino ld on ld.id = l.local_tratamento_id left join cad.municipio m on m.id = ld.municipio_id left join cad.procedimento pr on pr.id = l.procedimento_id
        where l.paciente_id = $1 and l.situacao_tratamento = 'AUTORIZADO' order by l.id desc`,
      [id],
    ).catch(() => []);
    return { viagens, tfd };
  });

  app.post('/api/transporte/passageiros/:id/cancelar', async (req) => {
    exigirPermissao(req, 'viagem:incluir');
    const { motivo } = z.object({ motivo: z.string().min(3).max(200) }).parse(req.body);
    await transacao(contextoDe(req, 'transporte:cancelar-agendamento'), async (c) => {
      const vp = (await c.query(`select viagem_id, situacao from tra.viagem_passageiro where id = $1`, [idParam(req)])).rows[0];
      if (!vp) throw new ErroHttp(404, 'Agendamento não encontrado.');
      await viagemAberta(c, vp.viagem_id);
      if (vp.situacao === 'CANCELADO') throw new ErroHttp(422, 'Agendamento já cancelado.');
      await c.query(`update tra.viagem_passageiro set situacao = 'CANCELADO', observacao = concat_ws(' | ', observacao, $2::text) where id = $1`, [idParam(req), `Cancelado: ${motivo}`]);
    });
    return { ok: true };
  });

  app.post('/api/transporte/passageiros/:id/acompanhantes', async (req, reply) => {
    exigirPermissao(req, 'viagem:incluir');
    const b = acompanhanteSchema.parse(req.body);
    await transacao(contextoDe(req, 'transporte:acompanhante'), (c) => incluirAcompanhante(c, idParam(req), b));
    return reply.status(201).send({ ok: true });
  });

  // Identificação de acompanhante reservado (TR 1.2.40.15, 1.2.40.20).
  app.patch('/api/transporte/acompanhantes/:id', async (req) => {
    exigirPermissao(req, 'viagem:incluir');
    const b = z.object({ pessoaId: nulo(z.number()), nome: nulo(z.string().max(120)), documento: nulo(z.string().max(20)), parentesco: nulo(z.string().max(40)), tipoViagem: tipoViagem.optional(), ocupaVaga: z.boolean().optional(), poltrona: nulo(z.number().int().positive()) }).parse(req.body);
    await transacao(contextoDe(req, 'transporte:acompanhante'), async (c) => {
      const a = (await c.query(`select a.*, vp.viagem_id from tra.viagem_acompanhante a join tra.viagem_passageiro vp on vp.id = a.passageiro_id where a.id = $1`, [idParam(req)])).rows[0];
      if (!a) throw new ErroHttp(404, 'Acompanhante não encontrado.');
      await viagemAberta(c, a.viagem_id);
      let nome = b.nome?.trim().toUpperCase() || a.nome;
      if (b.pessoaId && !b.nome) nome = (await c.query(`select nome from cad.pessoa where id = $1`, [b.pessoaId])).rows[0]?.nome ?? nome;
      await c.query(
        `update tra.viagem_acompanhante set pessoa_id = coalesce($2::bigint, pessoa_id), nome = $3::varchar, documento = coalesce($4, documento), parentesco = coalesce($5, parentesco),
                tipo_viagem = coalesce($6, tipo_viagem), ocupa_vaga = coalesce($7, ocupa_vaga), poltrona = coalesce($8, poltrona), indefinido = ($3::varchar is null and coalesce($2::bigint, pessoa_id) is null) where id = $1`,
        [idParam(req), b.pessoaId ?? null, nome ?? null, b.documento ?? null, b.parentesco ?? null, b.tipoViagem ?? null, b.ocupaVaga ?? null, b.poltrona ?? null],
      );
    });
    return { ok: true };
  });

  app.delete('/api/transporte/acompanhantes/:id', async (req) => {
    exigirPermissao(req, 'viagem:incluir');
    await transacao(contextoDe(req, 'transporte:acompanhante'), async (c) => {
      const a = (await c.query(`select vp.viagem_id from tra.viagem_acompanhante a join tra.viagem_passageiro vp on vp.id = a.passageiro_id where a.id = $1`, [idParam(req)])).rows[0];
      if (!a) throw new ErroHttp(404, 'Acompanhante não encontrado.');
      await viagemAberta(c, a.viagem_id);
      await c.query(`delete from tra.viagem_acompanhante where id = $1`, [idParam(req)]);
    });
    return { ok: true };
  });

  // Comprovante de agendamento em impressora padrão (A4) ou térmica conforme parâmetro (TR 1.2.40.26).
  app.get('/api/transporte/passageiros/:id/comprovante', async (req, reply) => {
    const u = exigirPermissao(req, 'viagem:consultar');
    const q = req.query as any;
    const param = await parametro<{ termica?: boolean }>('transporte.comprovante', { termica: false });
    const termica = q.termica === 'true' ? true : q.termica === 'false' ? false : param.termica === true;
    const vp = await consultarUm(
      `select vp.*, to_char(coalesce(vp.hora_saida, v.hora_saida), 'HH24:MI') hora, to_char(vp.horario_compromisso, 'HH24:MI') compromisso, v.data_saida::text data_saida,
              p.nome paciente, p.cns, p.data_nascimento::text nasc, r.nome rota, m.nome municipio, le.nome embarque, le.endereco embarque_endereco, mv.nome motivo,
              ve.placa, ve.modelo, o.nome operador
         from tra.viagem_passageiro vp join tra.viagem v on v.id = vp.viagem_id join cad.pessoa p on p.id = vp.paciente_id left join tra.rota r on r.id = v.rota_id
         left join cad.municipio m on m.id = vp.municipio_destino_id left join tra.local_embarque le on le.id = vp.local_embarque_id left join tra.motivo_viagem mv on mv.id = vp.motivo_id
         left join tra.veiculo ve on ve.id = v.veiculo_id left join seg.operador o on o.id = vp.agendado_por
        where vp.id = $1`,
      [idParam(req)],
    );
    if (!vp) throw new ErroHttp(404, 'Agendamento não encontrado.');
    const acomp = await consultar(`select indefinido, nome, documento, tipo_viagem, ocupa_vaga, poltrona from tra.viagem_acompanhante where passageiro_id = $1 order by id`, [vp.id]);
    const fs = termica ? 8 : 10;
    const linha = (rot: string, val: unknown) => ({ text: [{ text: `${rot}: `, bold: true }, String(val ?? '-')], fontSize: fs, margin: [0, 1, 0, 1] });
    const corpo: any[] = [
      ...(termica ? [{ text: 'COMPROVANTE DE AGENDAMENTO DE TRANSPORTE', bold: true, alignment: 'center', fontSize: 9, margin: [0, 0, 0, 4] }] : []),
      { image: await codigoBarras(vp.protocolo ?? `TR${vp.id}`), width: termica ? 150 : 200, margin: [0, 0, 0, 6] },
      linha('Protocolo', vp.protocolo),
      linha('Paciente', `${vp.paciente}${vp.nasc ? ` (${idadeTexto(vp.nasc)})` : ''}`),
      linha('CNS', vp.cns),
      linha('Data e horário de saída', `${fmtData(vp.data_saida)} às ${vp.hora}`),
      linha('Local de embarque', [vp.embarque, vp.embarque_endereco].filter(Boolean).join(' - ')),
      linha('Rota', vp.rota ?? 'Viagem extra'),
      linha('Destino', [vp.municipio, vp.local_destino].filter(Boolean).join(' - ')),
      ...(vp.compromisso ? [linha('Horário do atendimento', vp.compromisso)] : []),
      linha('Motivo', vp.motivo),
      linha('Tipo da viagem', ROTULO_TIPO[vp.tipo_viagem] ?? vp.tipo_viagem),
      linha('Poltrona', vp.poltrona ?? (vp.ocupa_vaga ? 'a definir no embarque' : 'não ocupa vaga')),
      linha('Veículo', [vp.placa, vp.modelo].filter(Boolean).join(' ')),
      ...(acomp.length
        ? [
            { text: 'Acompanhantes', bold: true, fontSize: fs, margin: [0, 4, 0, 1] },
            ...acomp.map((a) => ({
              text: `• ${a.indefinido ? 'VAGA RESERVADA (a identificar antes da viagem)' : `${a.nome}${a.documento ? ` - doc. ${a.documento}` : ''}`} · ${ROTULO_TIPO[a.tipo_viagem]}${a.poltrona ? ` · poltrona ${a.poltrona}` : ''}${a.ocupa_vaga ? '' : ' · não ocupa vaga'}`,
              fontSize: fs,
            })),
          ]
        : []),
      { text: 'Compareça ao local de embarque com 15 minutos de antecedência, com documento com foto, cartão SUS e a guia/comprovante do atendimento. Em caso de desistência, avise a central de transporte.', fontSize: fs - 1, italics: true, margin: [0, 8, 0, 0] },
      { text: `Agendado por ${vp.operador ?? '-'}`, fontSize: fs - 2, margin: [0, 4, 0, 0] },
    ];
    const r = await emitirDocumento(
      { relatorio: 'transporte:comprovante', titulo: 'Comprovante de agendamento de transporte', filtros: { passageiro: vp.id, termica } },
      corpo,
      termica ? { tamanho: { width: 226, height: 420 + acomp.length * 24 }, margens: [10, 10, 10, 10], semCabecalho: true, semRodape: true } : {},
      u,
    );
    return pdf(reply, r);
  });

  // -------------------------------------------------------------------------
  // Gestão das viagens
  // -------------------------------------------------------------------------
  app.get('/api/transporte/viagens', async (req) => {
    exigirPermissao(req, 'viagem:consultar');
    const q = req.query as any;
    const linhas = await consultar(
      `select v.id, v.data_saida::text data_saida, to_char(v.hora_saida, 'HH24:MI') hora_saida, v.situacao, v.sem_agendamento, v.vagas, r.nome rota, m.nome municipio,
              ve.placa || ' ' || coalesce(ve.modelo, '') veiculo, co.nome condutor, v.km_inicial, v.km_final
         from tra.viagem v left join tra.rota r on r.id = v.rota_id left join cad.municipio m on m.id = v.municipio_destino_id
         left join tra.veiculo ve on ve.id = v.veiculo_id left join tra.condutor co on co.id = v.condutor_id
        where v.data_saida between $1 and $2 and ($3::text is null or v.situacao = $3) and ($4::bigint is null or v.rota_id = $4)
        order by v.data_saida, v.hora_saida limit 500`,
      [q.de ?? new Date().toISOString().slice(0, 10), q.ate ?? q.de ?? new Date().toISOString().slice(0, 10), q.situacao || null, q.rotaId ? Number(q.rotaId) : null],
    );
    const ocup = await ocupacaoViagens(pool, linhas.map((l) => Number(l.id)));
    return linhas.map((l) => ({ ...l, ocupadas: ocup.get(Number(l.id))?.ocupadas ?? 0, pacientes: ocup.get(Number(l.id))?.pacientes ?? 0, indefinidos: ocup.get(Number(l.id))?.indefinidos ?? 0 }));
  });

  app.get('/api/transporte/viagens/:id', async (req) => {
    exigirPermissao(req, 'viagem:consultar');
    return carregarViagem(idParam(req));
  });

  // Viagem sem agendamento prévio (TR 1.2.40.17).
  app.post('/api/transporte/viagens', async (req, reply) => {
    const u = exigirPermissao(req, 'viagem:incluir');
    const b = z
      .object({
        dataSaida: data,
        horaSaida: hora,
        rotaId: nulo(z.number()),
        motivoId: z.number(),
        municipioDestinoId: z.number(),
        localDestinoId: nulo(z.number()),
        veiculoId: z.number(),
        condutorId: z.number(),
        localEmbarqueId: nulo(z.number()),
        valorViagem: nulo(z.number().min(0)),
        observacao: nulo(z.string().max(500)),
        confirmar: z.boolean().optional(),
        passageiros: z.array(passageiroSchema).max(80).optional(),
      })
      .parse(req.body);
    return reply.status(201).send(await transacao(contextoDe(req, 'transporte:viagem-avulsa'), (c) => criarViagemAvulsa(c, b, u)));
  });

  app.patch('/api/transporte/viagens/:id', async (req) => {
    exigirPermissao(req, 'viagem:alterar');
    const b = z
      .object({ veiculoId: nulo(z.number()), condutorId: nulo(z.number()), horaSaida: nulo(hora), kmInicial: nulo(z.number().int().min(0)), valorViagem: nulo(z.number().min(0)), localEmbarqueId: nulo(z.number()), observacao: nulo(z.string().max(500)) })
      .parse(req.body);
    await transacao(contextoDe(req, 'transporte:viagem'), async (c) => {
      await viagemAberta(c, idParam(req));
      if (b.veiculoId) {
        const v = (await c.query(`select passageiros from tra.veiculo where id = $1`, [b.veiculoId])).rows[0];
        const oc = (await ocupacaoViagens(c, [idParam(req)])).get(idParam(req))?.ocupadas ?? 0;
        if (v && v.passageiros < oc) throw new ErroHttp(422, `O veículo comporta ${v.passageiros} passageiros e a viagem já possui ${oc} vagas ocupadas.`);
      }
      await c.query(
        `update tra.viagem set veiculo_id = coalesce($2, veiculo_id), condutor_id = coalesce($3, condutor_id), hora_saida = coalesce($4::time, hora_saida), km_inicial = coalesce($5, km_inicial),
                valor_viagem = coalesce($6, valor_viagem), local_embarque_id = coalesce($7, local_embarque_id), observacao = coalesce($8, observacao) where id = $1`,
        [idParam(req), b.veiculoId ?? null, b.condutorId ?? null, b.horaSaida ?? null, b.kmInicial ?? null, b.valorViagem ?? null, b.localEmbarqueId ?? null, b.observacao ?? null],
      );
    });
    return { ok: true };
  });

  app.post('/api/transporte/viagens/:id/confirmar', async (req) => {
    const u = exigirPermissao(req, 'viagem:alterar');
    const b = z.object({ observacao: nulo(z.string().max(250)) }).parse(req.body ?? {});
    await transacao(contextoDe(req, 'transporte:confirmar'), (c) => confirmarViagem(c, idParam(req), b.observacao, u));
    return { ok: true };
  });

  app.post('/api/transporte/viagens/:id/cancelar', async (req) => {
    exigirPermissao(req, 'viagem:alterar');
    const { motivo } = z.object({ motivo: z.string().min(3).max(200) }).parse(req.body);
    await transacao(contextoDe(req, 'transporte:cancelar'), (c) => cancelarViagem(c, idParam(req), motivo));
    return { ok: true };
  });

  // Inclusão de paciente sem agendamento prévio, somente em viagem confirmada (TR 1.2.40.17, 1.2.40.19).
  app.post('/api/transporte/viagens/:id/passageiros', async (req, reply) => {
    const u = exigirPermissao(req, 'viagem:incluir');
    const b = passageiroSchema.parse(req.body);
    return reply.status(201).send(await transacao(contextoDe(req, 'transporte:inclusao-passageiro'), (c) => incluirPassageiro(c, idParam(req), b, u)));
  });

  app.post('/api/transporte/viagens/:id/presenca', async (req) => {
    exigirPermissao(req, 'viagem:alterar');
    const b = z.object({ itens: z.array(z.object({ passageiroId: z.number(), presente: z.boolean(), observacao: nulo(z.string().max(250)) })).min(1) }).parse(req.body);
    await transacao(contextoDe(req, 'transporte:presenca'), (c) => registrarPresenca(c, idParam(req), b.itens));
    return { ok: true };
  });

  // Adiantamento de viagem (TR 1.2.40.21).
  app.post('/api/transporte/viagens/:id/adiantamentos', async (req, reply) => {
    const u = exigirPermissao(req, 'viagem:alterar');
    const b = z.object({ data, valor: z.number().positive(), condutorId: nulo(z.number()), finalidade: nulo(z.string().max(200)) }).parse(req.body);
    const r = await transacao(contextoDe(req, 'transporte:adiantamento'), async (c) => {
      await viagemAberta(c, idParam(req));
      const condutor = b.condutorId ?? (await c.query(`select condutor_id from tra.viagem where id = $1`, [idParam(req)])).rows[0]?.condutor_id ?? null;
      return (
        await c.query(`insert into tra.viagem_adiantamento (viagem_id, data, condutor_id, valor, finalidade, operador_id) values ($1,$2,$3,$4,$5,$6) returning id`, [
          idParam(req),
          b.data,
          condutor,
          b.valor,
          b.finalidade ?? null,
          u.id,
        ])
      ).rows[0];
    });
    return reply.status(201).send(r);
  });

  app.post('/api/transporte/viagens/:id/despesas', async (req, reply) => {
    exigirPermissao(req, 'viagem:alterar');
    const b = despesaSchema.parse(req.body);
    await transacao(contextoDe(req, 'transporte:despesa'), async (c) => {
      await viagemAberta(c, idParam(req));
      await lancarDespesa(c, idParam(req), b);
    });
    return reply.status(201).send(await prestacaoContas(pool, idParam(req)));
  });

  app.delete('/api/transporte/despesas/:id', async (req) => {
    exigirPermissao(req, 'viagem:alterar');
    await transacao(contextoDe(req, 'transporte:despesa'), async (c) => {
      const d = (await c.query(`select viagem_id from tra.viagem_despesa where id = $1`, [idParam(req)])).rows[0];
      if (!d) throw new ErroHttp(404, 'Despesa não encontrada.');
      await viagemAberta(c, d.viagem_id);
      await c.query(`delete from tra.viagem_despesa where id = $1`, [idParam(req)]);
    });
    return { ok: true };
  });

  // Prestação de contas: valor adiantado, despesas e saldo (TR 1.2.40.22).
  app.get('/api/transporte/viagens/:id/prestacao-contas', async (req) => {
    exigirPermissao(req, 'viagem:consultar');
    return prestacaoContas(pool, idParam(req));
  });

  app.post('/api/transporte/viagens/:id/fechar', async (req) => {
    const u = exigirPermissao(req, 'viagem:alterar');
    const b = z.object({ dataChegada: data, horaChegada: hora, kmInicial: nulo(z.number().int().min(0)), kmFinal: z.number().int().min(0), despesas: z.array(despesaSchema).optional() }).parse(req.body);
    return transacao(contextoDe(req, 'transporte:fechamento'), (c) => fecharViagem(c, idParam(req), b, u));
  });

  // -------------------------------------------------------------------------
  // Documentos impressos
  // -------------------------------------------------------------------------
  const cabecalhoViagem = (v: any) => [
    {
      table: {
        widths: ['*', '*', '*'],
        body: [
          [`Viagem nº ${v.id}${v.sem_agendamento ? ' (sem agendamento prévio)' : ''}`, `Saída: ${fmtData(v.data_saida)} às ${hhmm(v.hora_saida)}`, `Situação: ${v.situacao}`],
          [`Rota: ${v.rota ?? 'Viagem extra'}`, `Destino: ${[v.municipio, v.uf].filter(Boolean).join('/')}${v.local_destino ? ` - ${v.local_destino}` : ''}`, `Motivo: ${v.motivo ?? '-'}`],
          [`Veículo: ${[v.placa, v.marca, v.modelo].filter(Boolean).join(' ')}`, `Condutor: ${v.condutor ?? '-'} (CNH ${v.cnh_numero ?? '-'} ${v.cnh_categoria ?? ''})`, `Embarque: ${v.local_embarque ?? '-'}`],
        ].map((l) => l.map((t) => ({ text: t, fontSize: 8 }))),
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 8],
    },
  ];

  // Relação de passageiros (TR 1.2.40.24).
  app.get('/api/transporte/viagens/:id/relacao-passageiros', async (req, reply) => {
    const u = exigirPermissao(req, 'viagem:consultar');
    const d = await carregarViagem(idParam(req));
    const linhas: any[][] = [];
    for (const p of d.passageiros.filter((x: any) => x.situacao !== 'CANCELADO')) {
      linhas.push([p.poltrona ?? '-', p.paciente, p.cns ?? p.cpf ?? '-', p.telefone ?? '', [p.municipio_destino, p.local_destino].filter(Boolean).join(' - '), hhmm(p.horario_compromisso), ROTULO_TIPO[p.tipo_viagem], p.ocupa_vaga ? 'Sim' : 'Não', '']);
      for (const a of p.acompanhantes as any[])
        linhas.push([a.poltrona ?? '-', `  ↳ Acomp.: ${a.indefinido ? 'A DEFINIR' : a.nome}`, a.documento ?? '', a.parentesco ?? '', '', '', ROTULO_TIPO[a.tipo_viagem], a.ocupa_vaga ? 'Sim' : 'Não', '']);
    }
    const cab = ['Polt.', 'Passageiro', 'CNS / documento', 'Telefone', 'Destino', 'Atend.', 'Viagem', 'Ocupa vaga', 'Assinatura'];
    const r = await emitirDocumento(
      { relatorio: 'transporte:relacao-passageiros', titulo: 'Relação de passageiros', filtros: { viagem: d.viagem.id } },
      [
        ...cabecalhoViagem(d.viagem),
        { table: { headerRows: 1, widths: [24, '*', 80, 60, 110, 32, 50, 34, 90], body: [cab.map((t) => ({ text: t, style: 'th' })), ...linhas.map((l) => l.map((t) => ({ text: String(t ?? ''), style: 'td' })))] }, layout: 'lightHorizontalLines' },
        { text: `\nOcupação: ${d.ocupacao.ocupadas} de ${d.ocupacao.vagas} vagas (ida ${d.ocupacao.ida}, volta ${d.ocupacao.volta}) · Pacientes: ${d.ocupacao.pacientes}`, fontSize: 8 },
        { text: '\n\n_______________________________________\nCondutor', alignment: 'center', fontSize: 8 },
      ] as any,
      { orientacao: 'landscape' },
      u,
    );
    return pdf(reply, r);
  });

  // Ordem de tráfego (TR 1.2.40.25).
  app.get('/api/transporte/viagens/:id/ordem-trafego', async (req, reply) => {
    const u = exigirPermissao(req, 'viagem:consultar');
    const d = await carregarViagem(idParam(req));
    const v = d.viagem;
    const ativos = d.passageiros.filter((x: any) => x.situacao !== 'CANCELADO');
    const r = await emitirDocumento(
      { relatorio: 'transporte:ordem-trafego', titulo: `Ordem de tráfego nº ${v.id}`, filtros: { viagem: v.id } },
      [
        { text: 'Autorizamos o condutor abaixo identificado a conduzir o veículo oficial no itinerário descrito, para o transporte de pacientes do Sistema Único de Saúde.', margin: [0, 0, 0, 8] },
        {
          table: {
            widths: [130, '*'],
            body: [
              ['Veículo', `${[v.tipo_veiculo, v.marca, v.modelo].filter(Boolean).join(' ')} · placa ${v.placa ?? '-'}`],
              ['Capacidade', `${v.capacidade ?? '-'} passageiros · ${v.macas ?? 0} maca(s) · ${v.cadeiras_rodas ?? 0} cadeira(s) de rodas`],
              ['Condutor', `${v.condutor ?? '-'} · CNH nº ${v.cnh_numero ?? '-'} categoria ${v.cnh_categoria ?? '-'} · validade ${fmtData(v.cnh_validade)}`],
              ['Saída', `${fmtData(v.data_saida)} às ${hhmm(v.hora_saida)} · ${[v.local_embarque, v.embarque_endereco].filter(Boolean).join(' - ') || '-'}`],
              ['Destino final', `${[v.municipio, v.uf].filter(Boolean).join('/')}${v.local_destino ? ` - ${v.local_destino}` : ''}`],
              ['Itinerário (paradas)', d.paradas.length ? d.paradas.map((p: any) => `${p.ordem}. ${p.municipio}${p.local ? ` (${p.local})` : ''}`).join('  →  ') : 'Direto ao destino'],
              ['Motivo', v.motivo ?? '-'],
              ['Passageiros', `${ativos.length} paciente(s) e ${ativos.reduce((s: number, p: any) => s + p.acompanhantes.length, 0)} acompanhante(s) · ${d.ocupacao.ocupadas} vaga(s) ocupada(s)`],
              ['Km de saída', v.km_inicial ?? `______________ (hodômetro atual: ${v.km_atual ?? '-'})`],
              ['Km de chegada', v.km_final ?? '______________'],
              ['Chegada', v.data_chegada ? `${fmtData(v.data_chegada)} às ${hhmm(v.hora_chegada)}` : '____/____/________  às  ____:____'],
              ['Adiantamento', moeda(d.contas.adiantado)],
            ].map(([a, b]) => [{ text: a, bold: true }, String(b)]),
          },
          layout: 'lightHorizontalLines',
        },
        { text: '\nOcorrências: ______________________________________________________________________________________________\n\n', fontSize: 9 },
        {
          columns: [
            { text: '_______________________________\nResponsável pelo setor de transporte', alignment: 'center', fontSize: 8 },
            { text: '_______________________________\nCondutor', alignment: 'center', fontSize: 8 },
          ],
          margin: [0, 30, 0, 0],
        },
      ] as any,
      {},
      u,
    );
    return pdf(reply, r);
  });

  // Requisição de adiantamento (TR 1.2.40.23).
  app.get('/api/transporte/adiantamentos/:id/requisicao', async (req, reply) => {
    const u = exigirPermissao(req, 'viagem:consultar');
    const a = await consultarUm(
      `select a.*, a.data::text data, c.nome beneficiario, c.cpf, c.cnh_numero, o.nome operador from tra.viagem_adiantamento a left join tra.condutor c on c.id = a.condutor_id
         left join seg.operador o on o.id = a.operador_id where a.id = $1`,
      [idParam(req)],
    );
    if (!a) throw new ErroHttp(404, 'Adiantamento não encontrado.');
    const d = await carregarViagem(Number(a.viagem_id));
    const r = await emitirDocumento(
      { relatorio: 'transporte:requisicao-adiantamento', titulo: `Requisição de adiantamento de viagem nº ${a.id}`, filtros: { adiantamento: a.id } },
      [
        ...cabecalhoViagem(d.viagem),
        {
          table: {
            widths: [130, '*'],
            body: [
              ['Beneficiário', `${a.beneficiario ?? '-'}${a.cpf ? ` · CPF ${a.cpf}` : ''}${a.cnh_numero ? ` · CNH ${a.cnh_numero}` : ''}`],
              ['Data', fmtData(a.data)],
              ['Valor solicitado', moeda(a.valor)],
              ['Finalidade', a.finalidade ?? 'Despesas de viagem (alimentação, combustível, pedágio, estacionamento)'],
              ['Passageiros previstos', `${d.ocupacao.pacientes} paciente(s) · ${d.ocupacao.ocupadas} vaga(s) ocupada(s)`],
            ].map(([x, y]) => [{ text: x, bold: true }, String(y)]),
          },
          layout: 'lightHorizontalLines',
        },
        { text: '\nO beneficiário compromete-se a prestar contas das despesas realizadas, com os respectivos comprovantes, no fechamento da viagem, devolvendo o saldo não utilizado.', fontSize: 9 },
        {
          columns: [
            { text: '_______________________________\nBeneficiário', alignment: 'center', fontSize: 8 },
            { text: '_______________________________\nAutorização (ordenador de despesa)', alignment: 'center', fontSize: 8 },
          ],
          margin: [0, 40, 0, 0],
        },
        { text: `\nLançado por ${a.operador ?? '-'}`, fontSize: 7 },
      ] as any,
      {},
      u,
    );
    return pdf(reply, r);
  });
}
