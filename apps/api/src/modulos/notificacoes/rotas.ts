// Gerenciador de notificações aos pacientes: consulta centralizada, envio avulso, envio em bloco
// agendado e retorno do gateway (TR 1.2.2.10, 1.2.2.11, 1.1.2.1.58, 1.1.2.1.60, 1.1.2.1.67).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { contextoDe, ErroHttp, exigirPermissao } from '../../seguranca/usuario.js';
import { alcance, esquemaCriterios, gerarMensagens, selecionarDestinatarios } from './servico.js';
import './relatorios.js';

registrarPermissao('mensagem_paciente', 'Notificações aos pacientes (gerenciador, avulsas e em bloco)', 'AGE', ['consultar', 'incluir', 'excluir']);

const meios = z.array(z.enum(['sms', 'email', 'push'])).min(1);
const quando = z
  .string()
  .nullish()
  .transform((x) => (x ? new Date(x) : null))
  .refine((d) => !d || d.getTime() > Date.now() - 60_000, 'O agendamento deve ser para uma data/hora futura.');

// Situação apresentada: mensagens do aplicativo lidas pelo cidadão contam como recebidas (TR 1.2.2.11.1).
const SITUACAO = `case when m.situacao = 'enviada' and m.meio = 'push' and exists (select 1 from portal.mensagem_lida l where l.mensagem_id = m.id) then 'recebida' else m.situacao end`;

export default async function rotasNotificacoesPacientes(app: FastifyInstance) {
  app.get('/api/mensagens-pacientes', async (req) => {
    exigirPermissao(req, 'mensagem_paciente:consultar');
    const q = req.query as Record<string, string | undefined>;
    return consultar(
      `select m.id, m.paciente_id, p.nome paciente, m.meio, m.destinatario, m.assunto, m.texto, m.evento, ${SITUACAO} situacao,
              m.gerada_em, m.agendada_para, m.processada_em, m.erro, m.referencia, o.nome operador,
              (select json_agg(json_build_object('texto', r.texto, 'recebida_em', r.recebida_em) order by r.id) from sis.mensagem_resposta r where r.mensagem_id = m.id) respostas
         from sis.mensagem m left join cad.pessoa p on p.id = m.paciente_id left join seg.operador o on o.id = m.operador_id
        where ($1::text is null or ${SITUACAO} = $1) and ($2::text is null or m.meio = $2) and ($3::text is null or m.evento = $3)
          and ($4::date is null or m.gerada_em >= $4) and ($5::date is null or m.gerada_em < $5::date + 1)
          and ($6::bigint is null or m.paciente_id = $6) and ($7::text is null or m.referencia = $7)
          and ($8::text is null or m.destinatario ilike '%' || $8 || '%' or p.nome ilike '%' || $8 || '%' or m.texto ilike '%' || $8 || '%')
          and ($9::boolean is not true or exists (select 1 from sis.mensagem_resposta r where r.mensagem_id = m.id))
        order by m.id desc limit 500`,
      [q.situacao || null, q.meio || null, q.evento || null, q.de || null, q.ate || null, q.pacienteId || null, q.referencia || null, q.busca || null, q.comResposta === 'true'],
    );
  });

  app.get('/api/mensagens-pacientes/modelos', async (req) => {
    exigirPermissao(req, 'mensagem_paciente:incluir');
    return consultar(`select id, nome, assunto, texto from sis.modelo_mensagem where ativo order by nome`);
  });

  app.get('/api/mensagens-pacientes/resumo', async (req) => {
    exigirPermissao(req, 'mensagem_paciente:consultar');
    return consultar(`select ${SITUACAO} situacao, count(*)::int total from sis.mensagem m where m.gerada_em > now() - interval '30 days' group by 1`);
  });

  app.post('/api/mensagens-pacientes/:id/reenviar', async (req) => {
    exigirPermissao(req, 'mensagem_paciente:incluir');
    const r = await pool.query(`update sis.mensagem set situacao = 'aguardando', erro = null where id = $1 and situacao in ('falha', 'cancelada') returning id`, [(req.params as any).id]);
    if (!r.rowCount) throw new ErroHttp(422, 'Somente mensagens com falha ou canceladas podem ser reenviadas.');
    return { ok: true };
  });

  app.post('/api/mensagens-pacientes/:id/cancelar', async (req) => {
    exigirPermissao(req, 'mensagem_paciente:excluir');
    const r = await pool.query(`update sis.mensagem set situacao = 'cancelada' where id = $1 and situacao in ('agendada', 'aguardando') returning id`, [(req.params as any).id]);
    if (!r.rowCount) throw new ErroHttp(422, 'A mensagem já foi processada.');
    return { ok: true };
  });

  // Notificação avulsa a um paciente, com assunto e texto editáveis (TR 1.2.2.10).
  app.post('/api/mensagens-pacientes/avulsa', async (req) => {
    const u = exigirPermissao(req, 'mensagem_paciente:incluir');
    const b = z.object({ pacienteId: z.number(), meios, assunto: z.string().max(150).nullish(), texto: z.string().min(1).max(4000), agendadaPara: quando }).parse(req.body);
    return transacao(contextoDe(req, 'mensagem_paciente:avulsa'), async (c) => {
      const ds = await selecionarDestinatarios(c, { pacienteIds: [b.pacienteId] });
      if (!ds.length) throw new ErroHttp(404, 'Paciente não encontrado ou inativo.');
      const d = ds[0];
      const bloqueios: string[] = [];
      if (b.meios.includes('sms') && !d.celular) bloqueios.push('o paciente não possui celular no cadastro');
      if (b.meios.includes('sms') && d.celular && !d.notificar_sms) bloqueios.push('o paciente desabilitou o recebimento por SMS');
      if (b.meios.includes('email') && !d.email) bloqueios.push('o paciente não possui e-mail no cadastro');
      if (b.meios.includes('email') && d.email && !d.notificar_email) bloqueios.push('o paciente desabilitou o recebimento por e-mail');
      if (b.meios.includes('push') && !d.notificar_app) bloqueios.push('o paciente desabilitou as notificações do aplicativo');
      if (bloqueios.length) throw new ErroHttp(422, `Não é possível enviar: ${bloqueios.join('; ')}.`);
      const n = await gerarMensagens(c, ds, { meios: b.meios, assunto: b.assunto, texto: b.texto, agendadaPara: b.agendadaPara, evento: 'avulsa', operadorId: u.id });
      return { mensagens: n };
    });
  });

  // Prévia do envio em bloco: quantidade e amostra de destinatários por meio.
  app.post('/api/mensagens-pacientes/destinatarios', async (req) => {
    exigirPermissao(req, 'mensagem_paciente:consultar');
    const b = z.object({ criterios: esquemaCriterios, meios }).parse(req.body);
    const ds = await selecionarDestinatarios(pool, b.criterios);
    return { total: ds.length, alcance: alcance(ds, b.meios), amostra: ds.slice(0, 50) };
  });

  // Envio em bloco imediato ou agendado para os pacientes selecionados pelos critérios (TR 1.1.2.1.58, 1.1.2.1.60, 1.1.2.1.67).
  app.post('/api/mensagens-pacientes/campanhas', async (req) => {
    const u = exigirPermissao(req, 'mensagem_paciente:incluir');
    const b = z
      .object({ titulo: z.string().min(3).max(120), meios, assunto: z.string().max(150).nullish(), texto: z.string().min(1).max(4000), criterios: esquemaCriterios, agendadaPara: quando })
      .parse(req.body);
    return transacao(contextoDe(req, 'mensagem_paciente:campanha'), async (c) => {
      const ds = await selecionarDestinatarios(c, b.criterios);
      if (!ds.length) throw new ErroHttp(422, 'Nenhum paciente atende aos critérios informados.');
      const camp = (
        await c.query(
          `insert into sis.campanha_notificacao (titulo, meios, assunto, texto, criterios, agendada_para, situacao, destinatarios, operador_id, criado_por)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) returning id`,
          [b.titulo, b.meios, b.assunto ?? null, b.texto, JSON.stringify(b.criterios), b.agendadaPara, b.agendadaPara ? 'AGENDADA' : 'ENVIADA', ds.length, u.id],
        )
      ).rows[0];
      const n = await gerarMensagens(c, ds, {
        meios: b.meios,
        assunto: b.assunto,
        texto: b.texto,
        agendadaPara: b.agendadaPara,
        evento: 'campanha',
        referencia: `campanha:${camp.id}`,
        operadorId: u.id,
      });
      await c.query(`update sis.campanha_notificacao set mensagens = $2 where id = $1`, [camp.id, n]);
      return { id: camp.id, destinatarios: ds.length, mensagens: n };
    });
  });

  app.get('/api/mensagens-pacientes/campanhas', async (req) => {
    exigirPermissao(req, 'mensagem_paciente:consultar');
    return consultar(
      `select k.id, k.titulo, k.meios, k.assunto, k.texto, k.criterios, k.agendada_para, k.situacao, k.destinatarios, k.mensagens, k.criado_em, o.nome operador,
              (select json_object_agg(s, n) from (select ${SITUACAO} s, count(*)::int n from sis.mensagem m where m.referencia = 'campanha:' || k.id group by 1) x) por_situacao
         from sis.campanha_notificacao k left join seg.operador o on o.id = k.operador_id order by k.id desc limit 200`,
    );
  });

  app.post('/api/mensagens-pacientes/campanhas/:id/cancelar', async (req) => {
    exigirPermissao(req, 'mensagem_paciente:excluir');
    const id = Number((req.params as any).id);
    return transacao(contextoDe(req, 'mensagem_paciente:cancelar-campanha'), async (c) => {
      const k = (await c.query(`select * from sis.campanha_notificacao where id = $1 for update`, [id])).rows[0];
      if (!k) throw new ErroHttp(404, 'Envio não encontrado.');
      const r = await c.query(`update sis.mensagem set situacao = 'cancelada' where referencia = $1 and situacao in ('agendada', 'aguardando')`, [`campanha:${id}`]);
      if (!r.rowCount) throw new ErroHttp(422, 'Não há mensagens pendentes de envio neste lote.');
      await c.query(`update sis.campanha_notificacao set situacao = 'CANCELADA' where id = $1`, [id]);
      return { canceladas: r.rowCount };
    });
  });

  // Retorno do gateway de SMS/e-mail: confirmação de entrega, falha e respostas do paciente (TR 1.2.2.11.1, 1.2.2.11.10, 1.2.2.11.11).
  app.post('/api/integracao/mensageria/retorno', { config: { publica: true } }, async (req) => {
    const token = req.headers['x-token'] ?? String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!config.sms.token || token !== config.sms.token) throw new ErroHttp(401, 'Credencial do gateway inválida.');
    const b = z.object({ id: z.coerce.number(), evento: z.enum(['ENTREGUE', 'FALHA', 'RESPOSTA']), texto: z.string().max(2000).optional(), erro: z.string().max(500).optional() }).parse(req.body);
    const m = await consultarUm(`select id from sis.mensagem where id = $1`, [b.id]);
    if (!m) throw new ErroHttp(404, 'Mensagem não encontrada.');
    if (b.evento === 'ENTREGUE') await pool.query(`update sis.mensagem set situacao = 'recebida' where id = $1`, [b.id]);
    else if (b.evento === 'FALHA') await pool.query(`update sis.mensagem set situacao = 'falha', erro = $2 where id = $1`, [b.id, b.erro ?? 'Falha informada pelo gateway']);
    else await pool.query(`insert into sis.mensagem_resposta (mensagem_id, texto) values ($1, $2)`, [b.id, b.texto ?? '']);
    return { ok: true };
  });
}
