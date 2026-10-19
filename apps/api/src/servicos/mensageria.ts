// Envio de e-mail, SMS e notificações push, com fila e gerenciador de mensagens (TR 1.2.2).
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { consultar, pool, type Cliente } from '../db/pool.js';

let transporte: nodemailer.Transporter | null = null;
function obterTransporte() {
  if (!config.smtp.host) return null;
  transporte ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.porta,
    secure: config.smtp.porta === 465,
    auth: config.smtp.usuario ? { user: config.smtp.usuario, pass: config.smtp.senha } : undefined,
  });
  return transporte;
}

/** E-mail de serviço para operadores (senhas temporárias, relatórios). */
export async function enviarEmail(para: string, assunto: string, texto: string, anexos?: { nome: string; conteudo: Buffer }[]) {
  const t = obterTransporte();
  if (!t) {
    console.info(`[e-mail não enviado: SMTP não configurado] para=${para} assunto=${assunto}\n${texto}`);
    return { enviado: false };
  }
  await t.sendMail({
    from: config.smtp.remetente,
    to: para,
    subject: assunto,
    text: texto,
    attachments: anexos?.map((a) => ({ filename: a.nome, content: a.conteudo })),
  });
  return { enviado: true };
}

async function enviarSms(numero: string, texto: string, id?: number) {
  if (config.sms.provedor === 'log' || !config.sms.url) {
    console.info(`[SMS simulado] ${numero}: ${texto}`);
    return;
  }
  // Provedor HTTP genérico (gateway contratado pela Secretaria), compatível com qualquer operadora.
  const r = await fetch(config.sms.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.sms.token}` },
    // O identificador volta no retorno do gateway (entrega, falha e respostas: /api/integracao/mensageria/retorno).
    body: JSON.stringify({ numero: '55' + numero, mensagem: texto, id }),
  });
  if (!r.ok) throw new Error(`Gateway SMS respondeu ${r.status}`);
}

export interface NovaMensagem {
  pacienteId?: number | null;
  meio: 'email' | 'sms' | 'push';
  destinatario: string;
  assunto?: string;
  texto: string;
  evento?: string;
  agendadaPara?: Date | null;
  operadorId?: number | null;
  referencia?: string;
}

export async function enfileirarMensagem(m: NovaMensagem, cliente: Cliente = pool) {
  const r = await cliente.query(
    `insert into sis.mensagem (paciente_id, meio, destinatario, assunto, texto, evento, situacao, agendada_para, operador_id, referencia)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [
      m.pacienteId ?? null,
      m.meio,
      m.destinatario,
      m.assunto ?? null,
      m.texto,
      m.evento ?? 'avulsa',
      m.agendadaPara ? 'agendada' : 'aguardando',
      m.agendadaPara ?? null,
      m.operadorId ?? null,
      m.referencia ?? null,
    ],
  );
  return r.rows[0].id as number;
}

/** Processa a fila: mensagens aguardando ou agendadas cujo horário chegou. */
export async function processarFila(limite = 50) {
  const pendentes = await consultar(
    `update sis.mensagem set situacao = 'enviando'
      where id in (select id from sis.mensagem
                    where situacao = 'aguardando' or (situacao = 'agendada' and agendada_para <= now())
                    order by id limit $1 for update skip locked)
      returning *`,
    [limite],
  );
  for (const m of pendentes) {
    try {
      if (m.meio === 'email') await enviarEmail(m.destinatario, m.assunto ?? config.nomeSecretaria, m.texto);
      else if (m.meio === 'sms') await enviarSms(m.destinatario, m.texto, Number(m.id));
      else {
        // Push: entregue pela caixa de mensagens do aplicativo do cidadão (consulta a sis.mensagem).
      }
      await pool.query(`update sis.mensagem set situacao = 'enviada', processada_em = now() where id = $1`, [m.id]);
    } catch (e) {
      await pool.query(`update sis.mensagem set situacao = 'falha', processada_em = now(), erro = $2 where id = $1`, [
        m.id,
        (e as Error).message,
      ]);
    }
  }
  return pendentes.length;
}

export function iniciarProcessamentoFila() {
  const t = setInterval(() => processarFila().catch((e) => console.error('fila de mensagens:', e)), 15_000);
  t.unref();
}
