// Seleção de destinatários e geração de mensagens individuais ou em bloco (TR 1.1.2.1.58, 1.1.2.1.60, 1.2.2.9, 1.2.2.10).
import { z } from 'zod';
import type { Cliente } from '../../db/pool.js';
import { enfileirarMensagem } from '../../servicos/mensageria.js';
import { ErroHttp } from '../../seguranca/usuario.js';

export const esquemaCriterios = z.object({
  pacienteIds: z.array(z.number()).max(5000).optional(),
  unidadeReferenciaId: z.number().nullish(),
  bairroId: z.number().nullish(),
  microarea: z.string().nullish(),
  sexo: z.enum(['M', 'F']).nullish(),
  idadeMinima: z.number().int().min(0).nullish(),
  idadeMaxima: z.number().int().max(150).nullish(),
  condicoes: z.array(z.string()).optional(),
  // Pacientes com agendamento no período (aviso de remanejamento, falta de profissional, lembrete coletivo).
  agendaDe: z.string().nullish(),
  agendaAte: z.string().nullish(),
  agendaUnidadeId: z.number().nullish(),
  agendaProfissionalId: z.number().nullish(),
  agendaEspecialidadeId: z.number().nullish(),
});
export type Criterios = z.infer<typeof esquemaCriterios>;

export interface Destinatario {
  id: number;
  nome: string;
  celular: string | null;
  email: string | null;
  notificar_sms: boolean;
  notificar_email: boolean;
  notificar_app: boolean;
  unidade: string | null;
  data_agendamento: string | null;
  hora: string | null;
  profissional: string | null;
}

/** Pacientes ativos que atendem a todos os critérios informados. */
export async function selecionarDestinatarios(c: Cliente, cr: Criterios, limite = 20000): Promise<Destinatario[]> {
  const temAgenda = !!(cr.agendaDe || cr.agendaAte || cr.agendaUnidadeId || cr.agendaProfissionalId || cr.agendaEspecialidadeId);
  const v: unknown[] = [];
  const p = (x: unknown) => (v.push(x), `$${v.length}`);
  const onde: string[] = [`p.situacao = 'ATIVO'`, `p.data_obito is null`];
  if (cr.pacienteIds?.length) onde.push(`p.id = any(${p(cr.pacienteIds)}::bigint[])`);
  if (cr.unidadeReferenciaId) onde.push(`p.unidade_referencia_id = ${p(cr.unidadeReferenciaId)}`);
  if (cr.bairroId) onde.push(`p.bairro_id = ${p(cr.bairroId)}`);
  if (cr.microarea) onde.push(`p.microarea = ${p(cr.microarea)}`);
  if (cr.sexo) onde.push(`p.sexo = ${p(cr.sexo)}`);
  if (cr.idadeMinima != null) onde.push(`p.data_nascimento <= current_date - make_interval(years => ${p(cr.idadeMinima)}::int)`);
  if (cr.idadeMaxima != null) onde.push(`p.data_nascimento > current_date - make_interval(years => ${p(cr.idadeMaxima)}::int + 1)`);
  if (cr.condicoes?.length) onde.push(`p.condicoes_saude && ${p(cr.condicoes)}::varchar[]`);
  let agenda = 'null::text data_agendamento, null::text hora, null::text profissional';
  let juncao = '';
  if (temAgenda) {
    const f: string[] = [`a.paciente_id = p.id`, `a.situacao = 'AGENDADO'`];
    f.push(`a.data >= ${p(cr.agendaDe ?? new Date().toISOString().slice(0, 10))}::date`);
    if (cr.agendaAte) f.push(`a.data <= ${p(cr.agendaAte)}::date`);
    if (cr.agendaUnidadeId) f.push(`a.unidade_id = ${p(cr.agendaUnidadeId)}`);
    if (cr.agendaProfissionalId) f.push(`a.profissional_id = ${p(cr.agendaProfissionalId)}`);
    if (cr.agendaEspecialidadeId) f.push(`a.especialidade_id = ${p(cr.agendaEspecialidadeId)}`);
    juncao = `join lateral (select a.data, a.hora, a.profissional_id from age.agendamento a where ${f.join(' and ')} order by a.data, a.hora limit 1) ag on true
              left join cad.profissional pr on pr.id = ag.profissional_id`;
    agenda = `to_char(ag.data, 'DD/MM/YYYY') data_agendamento, to_char(ag.hora, 'HH24:MI') hora, pr.nome profissional`;
  }
  const r = await c.query(
    `select p.id, coalesce(p.nome_social, p.nome) nome, p.celular, p.email, coalesce(p.notificar_sms, true) notificar_sms,
            coalesce(p.notificar_email, true) notificar_email, coalesce(p.notificar_app, true) notificar_app, u.nome unidade,
            ${agenda}
       from cad.pessoa p left join cad.unidade u on u.id = p.unidade_referencia_id ${juncao}
      where ${onde.join(' and ')} order by p.nome limit ${Number(limite)}`,
    v,
  );
  return r.rows;
}

/** Substitui as variáveis do modelo pelos dados do destinatário. */
export function personalizar(texto: string, d: Partial<Destinatario>) {
  const vars: Record<string, string> = {
    nome: d.nome ?? '',
    primeiro_nome: (d.nome ?? '').split(' ')[0],
    unidade: d.unidade ?? '',
    data_agendamento: d.data_agendamento ?? '',
    hora: d.hora ?? '',
    profissional: d.profissional ?? '',
    hoje: new Date().toLocaleDateString('pt-BR'),
  };
  return texto.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Quantos destinatários serão alcançados por meio, respeitando as preferências do cadastro (TR 1.2.2.9). */
export function alcance(ds: Destinatario[], meios: string[]) {
  const n = { sms: 0, email: 0, push: 0, semContato: 0 };
  for (const d of ds) {
    let algum = false;
    if (meios.includes('sms') && d.celular && d.notificar_sms) (n.sms++, (algum = true));
    if (meios.includes('email') && d.email && d.notificar_email) (n.email++, (algum = true));
    if (meios.includes('push') && d.notificar_app) (n.push++, (algum = true));
    if (!algum) n.semContato++;
  }
  return n;
}

export interface Envio {
  meios: string[];
  assunto?: string | null;
  texto: string;
  agendadaPara?: Date | null;
  evento: string;
  referencia?: string;
  operadorId: number;
}

/**
 * Enfileira uma mensagem por meio para cada destinatário. O SMS vai somente para o celular do
 * cadastro e o e-mail para o endereço do cadastro (TR 1.2.2.10); quem desabilitou o meio não recebe (TR 1.2.2.9).
 */
export async function gerarMensagens(c: Cliente, ds: Destinatario[], e: Envio) {
  let total = 0;
  for (const d of ds) {
    const texto = personalizar(e.texto, d);
    const assunto = e.assunto ? personalizar(e.assunto, d) : undefined;
    const base = { pacienteId: d.id, texto, assunto, evento: e.evento, agendadaPara: e.agendadaPara ?? null, operadorId: e.operadorId, referencia: e.referencia };
    if (e.meios.includes('sms') && d.celular && d.notificar_sms) {
      if (texto.length > 640) throw new ErroHttp(422, 'O texto do SMS excede 640 caracteres (4 mensagens).');
      await enfileirarMensagem({ ...base, meio: 'sms', destinatario: d.celular.replace(/\D/g, '') }, c);
      total++;
    }
    if (e.meios.includes('email') && d.email && d.notificar_email) {
      await enfileirarMensagem({ ...base, meio: 'email', destinatario: d.email }, c);
      total++;
    }
    if (e.meios.includes('push') && d.notificar_app) {
      await enfileirarMensagem({ ...base, meio: 'push', destinatario: `paciente:${d.id}` }, c);
      total++;
    }
  }
  return total;
}
