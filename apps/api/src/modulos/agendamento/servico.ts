// Regras de agendamento: geração de horários, disponibilidade, marcação, cancelamento,
// transferência, faltas, notificações e lista de espera.
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { consultar, consultarUm } from '../../db/pool.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { enfileirarMensagem } from '../../servicos/mensageria.js';
import { idadeDetalhada } from '../../compartilhado/validacao.js';
import { parametro } from '../cadastros/alertas.js';

const DIA = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const paraData = (s: string) => new Date(s + 'T12:00:00Z');
const minutos = (h: string) => {
  const [a, b] = h.split(':').map(Number);
  return a * 60 + b;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Datas bloqueadas por feriado para a unidade (TR 1.2.7.7). */
async function feriados(c: pg.PoolClient, unidadeId: number, de: string, ate: string) {
  const r = await c.query(`select data::text d from cad.feriado where data between $1 and $2 and (unidade_id is null or unidade_id = $3)`, [de, ate, unidadeId]);
  return new Set(r.rows.map((x) => x.d));
}

/** Verifica se a soma das agendas do profissional ultrapassa a carga horária do vínculo (TR 1.2.12.8). */
export async function validarCargaHoraria(c: pg.PoolClient, agenda: any) {
  if (!agenda.profissional_id || !(await parametro<boolean>('agenda.validar_carga_horaria', true))) return;
  const vinc = await c.query(
    `select coalesce(sum(carga_horaria), 0)::int ch from cad.vinculo where profissional_id = $1 and unidade_id = $2 and ativo`,
    [agenda.profissional_id, agenda.unidade_id],
  );
  const limite = vinc.rows[0].ch;
  if (!limite) return;
  const outras = await c.query(
    `select hora_inicio::text hi, hora_fim::text hf, dias_semana, intervalo_semanas from age.agenda
      where profissional_id = $1 and unidade_id = $2 and ativo and id <> coalesce($3, 0)
        and (vigencia_fim is null or vigencia_fim >= $4::date) and vigencia_inicio <= coalesce($5::date, '2999-12-31')`,
    [agenda.profissional_id, agenda.unidade_id, agenda.id ?? null, agenda.vigencia_inicio, agenda.vigencia_fim ?? null],
  );
  const horasSemana = (a: any) => ((minutos(a.hf) - minutos(a.hi)) / 60) * (a.dias_semana?.length ?? 0) / (a.intervalo_semanas || 1);
  const total = outras.rows.reduce((s, a) => s + horasSemana(a), 0) + horasSemana({ hi: agenda.hora_inicio, hf: agenda.hora_fim, dias_semana: agenda.dias_semana, intervalo_semanas: agenda.intervalo_semanas });
  if (total > limite + 0.01) {
    throw new ErroHttp(422, `As agendas do profissional somam ${total.toFixed(1)} h semanais, acima da carga horária do vínculo (${limite} h).`);
  }
}

/** Gera os horários da agenda dentro da vigência, até o horizonte configurado. */
export async function gerarHorarios(c: pg.PoolClient, agendaId: number, horizonteDias?: number) {
  const a = (await c.query(`select *, hora_inicio::text hi, hora_fim::text hf, vigencia_inicio::text vi, vigencia_fim::text vf from age.agenda where id = $1`, [agendaId])).rows[0];
  if (!a || !a.ativo) return 0;
  const horizonte = horizonteDias ?? (await parametro<number>('agenda.horizonte_geracao_dias', 120));
  const hoje = iso(new Date());
  const inicio = a.vi > hoje ? a.vi : hoje;
  const limite = iso(new Date(Date.now() + horizonte * DIA));
  const fim = a.vf && a.vf < limite ? a.vf : limite;
  if (inicio > fim) return 0;
  const bloqueadas = await feriados(c, a.unidade_id, inicio, fim);
  const bloqueios = (
    await c.query(
      `select data_inicio::text di, data_fim::text df from age.bloqueio_agenda
        where (agenda_id = $1 or (agenda_id is null and profissional_id = $2)) and data_fim >= $3 and data_inicio <= $4`,
      [a.id, a.profissional_id, inicio, fim],
    )
  ).rows;
  const existentes = new Set(
    (await c.query(`select distinct data::text d from age.horario where agenda_id = $1 and data between $2 and $3`, [a.id, inicio, fim])).rows.map((r) => r.d),
  );
  const total = a.vagas + (a.vagas_urgencia ?? 0) + (a.vagas_regulacao ?? 0);
  const passo = a.por_ordem_chegada ? 0 : Math.max(1, Math.floor((minutos(a.hf) - minutos(a.hi)) / total));
  const semanaBase = Math.floor(paraData(a.vi).getTime() / (7 * DIA));
  let criados = 0;
  for (let t = paraData(inicio).getTime(); t <= paraData(fim).getTime(); t += DIA) {
    const d = new Date(t);
    const data = iso(d);
    if (existentes.has(data)) continue;
    if (!a.dias_semana?.includes(String(d.getUTCDay()))) continue;
    if ((Math.floor(t / (7 * DIA)) - semanaBase) % (a.intervalo_semanas || 1) !== 0) continue;
    const feriado = bloqueadas.has(data);
    const bloqueio = bloqueios.some((b) => data >= b.di && data <= b.df);
    for (let i = 0; i < total; i++) {
      const tipo = i < a.vagas ? 'ELETIVA' : i < a.vagas + (a.vagas_urgencia ?? 0) ? 'URGENCIA' : 'REGULACAO';
      await c.query(
        `insert into age.horario (agenda_id, data, hora, ordem, tipo_vaga, situacao, motivo_bloqueio) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict do nothing`,
        [a.id, data, hhmm(minutos(a.hi) + i * passo), i + 1, tipo, feriado || bloqueio || a.bloqueada ? 'BLOQUEADO' : 'LIVRE', feriado ? 'Feriado' : bloqueio ? 'Bloqueio de agenda' : null],
      );
      criados++;
    }
  }
  return criados;
}

export function novaSenha(prefixo = 'A') {
  const alf = '0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alf[randomInt(10)];
  return `${prefixo}${s}`;
}

const NOMES_EVENTO: Record<string, string> = {
  AGENDAMENTO: 'Agendamento confirmado',
  LISTA_ESPERA: 'Agendamento realizado a partir da lista de espera',
  TRANSFERENCIA: 'Agendamento transferido',
  CANCELAMENTO: 'Agendamento cancelado',
  LEMBRETE: 'Lembrete de agendamento',
};

/** Envia notificações conforme os critérios configurados e as preferências do paciente (TR 1.2.2). */
export async function notificarEvento(c: pg.PoolClient, agendamentoId: number, evento: string, extra: { motivo?: string } = {}) {
  const ag = (
    await c.query(
      `select a.*, a.data::text data_txt, to_char(a.hora, 'HH24:MI') hora_txt, p.nome paciente, p.celular, p.email,
              p.notificar_sms, p.notificar_email, p.notificar_app, u.nome unidade, ag.tipo tipo_agenda, ag.convenio_id convenio_agenda,
              e.nome especialidade, pr.nome profissional,
              (select array_agg(pc.codigo) from age.agendamento_procedimento ap join cad.procedimento pc on pc.id = ap.procedimento_id where ap.agendamento_id = a.id) procedimentos
         from age.agendamento a join cad.pessoa p on p.id = a.paciente_id join age.agenda ag on ag.id = a.agenda_id
         left join cad.unidade u on u.id = a.unidade_id left join cad.especialidade e on e.id = a.especialidade_id
         left join cad.profissional pr on pr.id = a.profissional_id where a.id = $1`,
      [agendamentoId],
    )
  ).rows[0];
  if (!ag) return 0;
  const criterios = (await c.query(`select * from age.criterio_notificacao where ativo and $1 = any(eventos)`, [evento])).rows;
  let enviados = 0;
  for (const cr of criterios) {
    if (cr.tipo_agenda !== 'TODAS' && cr.tipo_agenda !== (ag.tipo_agenda === 'EXAME' ? 'EXAME' : 'CONSULTA')) continue;
    if (cr.convenio_id && cr.convenio_id !== (ag.convenio_id ?? ag.convenio_agenda)) continue;
    if (cr.unidade_id && cr.unidade_id !== ag.unidade_id) continue;
    if (cr.especialidade_id && cr.especialidade_id !== ag.especialidade_id) continue;
    const procs: string[] = ag.procedimentos ?? [];
    if (cr.grupo_procedimento && !procs.some((p) => p.startsWith(cr.grupo_procedimento))) continue;
    if (cr.subgrupo_procedimento && !procs.some((p) => p.startsWith(cr.subgrupo_procedimento))) continue;
    if (cr.procedimento_id) {
      const ok = (await c.query(`select 1 from age.agendamento_procedimento where agendamento_id = $1 and procedimento_id = $2`, [ag.id, cr.procedimento_id])).rowCount;
      if (!ok) continue;
    }
    const texto = String(cr.texto)
      .replaceAll('{paciente}', ag.paciente.split(' ')[0])
      .replaceAll('{evento}', NOMES_EVENTO[evento] ?? evento)
      .replaceAll('{tipo}', ag.tipo === 'EXAME' ? 'exame' : 'consulta')
      .replaceAll('{data}', ag.data_txt.split('-').reverse().join('/'))
      .replaceAll('{hora}', ag.hora_txt ?? '')
      .replaceAll('{local}', ag.unidade ?? '')
      .replaceAll('{profissional}', ag.profissional ?? '')
      .replaceAll('{especialidade}', ag.especialidade ?? '')
      .replaceAll('{senha}', ag.senha ?? '')
      .replaceAll('{motivo}', extra.motivo ?? '');
    const meios = cr.meio === 'TODOS' ? ['SMS', 'EMAIL', 'PUSH'] : [cr.meio];
    for (const m of meios) {
      if (m === 'SMS' && ag.notificar_sms && ag.celular) {
        await enfileirarMensagem({ pacienteId: ag.paciente_id, meio: 'sms', destinatario: ag.celular, texto, evento: evento.toLowerCase(), referencia: `agendamento:${ag.id}` }, c);
        enviados++;
      }
      if (m === 'EMAIL' && ag.notificar_email && ag.email) {
        await enfileirarMensagem({ pacienteId: ag.paciente_id, meio: 'email', destinatario: ag.email, assunto: cr.assunto, texto, evento: evento.toLowerCase(), referencia: `agendamento:${ag.id}` }, c);
        enviados++;
      }
      if (m === 'PUSH' && ag.notificar_app) {
        await enfileirarMensagem({ pacienteId: ag.paciente_id, meio: 'push', destinatario: `paciente:${ag.paciente_id}`, assunto: NOMES_EVENTO[evento], texto, evento: evento.toLowerCase(), referencia: `agendamento:${ag.id}` }, c);
        enviados++;
      }
    }
  }
  return enviados;
}

export interface PedidoAgendamento {
  horarioId?: number;
  agendaId?: number;
  data?: string;
  hora?: string;
  encaixe?: boolean;
  pacienteId: number;
  tipo?: string;
  origem?: string;
  urgente?: boolean;
  procedimentos?: { procedimentoId: number; quantidade?: number; estrutura?: string; solicitacaoItemId?: number }[];
  requisicaoId?: number;
  unidadeSolicitanteId?: number;
  profissionalSolicitanteId?: number;
  listaEsperaId?: number;
  observacao?: string;
  confirmarAvisos?: boolean;
  agendamentoOrigemId?: number;
  situacaoInicial?: string;
}

/** Validações do paciente para a agenda: sexo, idade, faltas e duplicidade (TR 1.2.12.10, 1.2.12.11, 1.2.12.14). */
async function validarPaciente(c: pg.PoolClient, agenda: any, pacienteId: number, pedido: PedidoAgendamento, data: string) {
  const p = (await c.query(`select id, nome, sexo, data_nascimento::text dn, situacao, cadastro_atualizado_em::text atualizado from cad.pessoa where id = $1`, [pacienteId])).rows[0];
  if (!p) throw new ErroHttp(404, 'Paciente não encontrado.');
  if (p.situacao === 'FALECIDO') throw new ErroHttp(422, 'Paciente registrado como falecido.');
  const avisos: string[] = [];
  const validade = await parametro<number>('paciente.validade_cadastro_dias', 365);
  if (validade && p.atualizado && (Date.now() - new Date(p.atualizado).getTime()) / DIA > validade && (await parametro<boolean>('paciente.bloquear_cadastro_vencido', true))) {
    throw new ErroHttp(422, 'Cadastro do paciente vencido: atualize os dados cadastrais antes de agendar.', { cadastroVencido: true });
  }
  if (agenda.especialidade_id) {
    const e = (await c.query(`select * from cad.especialidade where id = $1`, [agenda.especialidade_id])).rows[0];
    const idade = idadeDetalhada(p.dn, new Date(data + 'T12:00:00')).anos;
    if (e.sexo_permitido && e.sexo_permitido !== 'A' && p.sexo !== e.sexo_permitido)
      throw new ErroHttp(422, `${e.nome}: atendimento somente para o sexo ${e.sexo_permitido === 'F' ? 'feminino' : 'masculino'}.`);
    if (e.idade_minima != null && idade < e.idade_minima) throw new ErroHttp(422, `${e.nome}: idade mínima de ${e.idade_minima} anos.`);
    if (e.idade_maxima != null && idade > e.idade_maxima) throw new ErroHttp(422, `${e.nome}: idade máxima de ${e.idade_maxima} anos.`);

    // Falta não justificada em consulta especializada impede reagendamento por período (TR 1.2.12.10).
    if (e.atencao === 'ESPECIALIZADA') {
      const dias = await parametro<number>('agenda.dias_bloqueio_falta', 30);
      const falta = (
        await c.query(
          `select data::text from age.agendamento where paciente_id = $1 and especialidade_id = $2 and situacao = 'FALTA' and not falta_justificada
            and data >= current_date - $3::int order by data desc limit 1`,
          [pacienteId, e.id, dias],
        )
      ).rows[0];
      if (falta) throw new ErroHttp(422, `Paciente faltou sem justificativa em ${falta.data.split('-').reverse().join('/')}: novo agendamento em ${e.nome} bloqueado por ${dias} dias.`, { faltaNaoJustificada: true });
    }
    const pendente = (
      await c.query(
        `select data::text from age.agendamento where paciente_id = $1 and especialidade_id = $2 and situacao in ('AGENDADO','CONFIRMADO','SOLICITADO') and data >= current_date limit 1`,
        [pacienteId, e.id],
      )
    ).rows[0];
    if (pendente) avisos.push(`O paciente já possui consulta de ${e.nome} marcada para ${pendente.data.split('-').reverse().join('/')}.`);
  }
  // Restrições de sexo e idade da tabela SIGTAP para procedimentos (TR 1.2.10.15).
  for (const pr of pedido.procedimentos ?? []) {
    const proc = (await c.query(`select * from cad.procedimento where id = $1`, [pr.procedimentoId])).rows[0];
    if (!proc) continue;
    if (['M', 'F'].includes(proc.sexo) && proc.sexo !== p.sexo) throw new ErroHttp(422, `${proc.nome}: permitido somente para o sexo ${proc.sexo === 'F' ? 'feminino' : 'masculino'}.`);
    const meses = Math.floor((new Date(data).getTime() - new Date(p.dn).getTime()) / (30.44 * DIA));
    if (proc.idade_minima_meses != null && proc.idade_minima_meses < 9999 && meses < proc.idade_minima_meses) throw new ErroHttp(422, `${proc.nome}: idade abaixo da permitida.`);
    if (proc.idade_maxima_meses != null && proc.idade_maxima_meses < 9999 && meses > proc.idade_maxima_meses) throw new ErroHttp(422, `${proc.nome}: idade acima da permitida.`);
  }
  if (avisos.length && !pedido.confirmarAvisos) throw new ErroHttp(409, avisos.join(' '), { avisos, exigeConfirmacao: true });
  return p;
}

/** Controle de cotas dos procedimentos na data (TR 1.2.10.11, 1.2.12.12). */
export async function cotasProcedimentos(c: pg.PoolClient | pg.Pool, agendaId: number, data: string) {
  return (
    await c.query(
      `select ap.procedimento_id, pr.codigo, pr.nome, ap.cota_diaria, ap.cota_mensal, ap.estrutura,
              (select coalesce(sum(x.quantidade), 0)::int from age.agendamento_procedimento x join age.agendamento a on a.id = x.agendamento_id
                where a.agenda_id = ap.agenda_id and x.procedimento_id = ap.procedimento_id and a.data = $2
                  and a.situacao not in ('CANCELADO','TRANSFERIDO')) usadas_dia,
              (select coalesce(sum(x.quantidade), 0)::int from age.agendamento_procedimento x join age.agendamento a on a.id = x.agendamento_id
                where a.agenda_id = ap.agenda_id and x.procedimento_id = ap.procedimento_id and date_trunc('month', a.data) = date_trunc('month', $2::date)
                  and a.situacao not in ('CANCELADO','TRANSFERIDO')) usadas_mes
         from age.agenda_procedimento ap join cad.procedimento pr on pr.id = ap.procedimento_id where ap.agenda_id = $1 order by pr.nome`,
      [agendaId, data],
    )
  ).rows.map((r) => ({
    ...r,
    disponivel_dia: r.cota_diaria == null ? null : r.cota_diaria - r.usadas_dia,
    disponivel_mes: r.cota_mensal == null ? null : r.cota_mensal - r.usadas_mes,
  }));
}

export async function agendar(c: pg.PoolClient, pedido: PedidoAgendamento, u: Usuario) {
  let horario: any = null;
  let agenda: any;
  let data: string;
  let hora: string | null;
  if (pedido.horarioId) {
    horario = (await c.query(`select *, data::text dt, to_char(hora,'HH24:MI') hr from age.horario where id = $1 for update`, [pedido.horarioId])).rows[0];
    if (!horario) throw new ErroHttp(404, 'Horário não encontrado.');
    if (horario.situacao !== 'LIVRE') throw new ErroHttp(409, horario.situacao === 'OCUPADO' ? 'Horário já ocupado por outro paciente.' : 'Horário bloqueado.');
    agenda = (await c.query(`select * from age.agenda where id = $1`, [horario.agenda_id])).rows[0];
    data = horario.dt;
    hora = horario.hr;
  } else {
    // Encaixe entre horários já agendados (TR 1.2.10.14).
    if (!pedido.agendaId || !pedido.data) throw new ErroHttp(400, 'Informe o horário ou a agenda e a data do encaixe.');
    agenda = (await c.query(`select * from age.agenda where id = $1`, [pedido.agendaId])).rows[0];
    if (!agenda) throw new ErroHttp(404, 'Agenda não encontrada.');
    data = pedido.data;
    hora = pedido.hora ?? null;
    pedido.encaixe = true;
    const ordem = (await c.query(`select coalesce(max(ordem), 0) + 1 o from age.horario where agenda_id = $1 and data = $2`, [agenda.id, data])).rows[0].o;
    horario = (
      await c.query(`insert into age.horario (agenda_id, data, hora, ordem, tipo_vaga, situacao) values ($1,$2,$3,$4,'ENCAIXE','LIVRE') returning id`, [
        agenda.id,
        data,
        hora ?? '00:00',
        ordem,
      ])
    ).rows[0];
  }
  if (data < iso(new Date())) throw new ErroHttp(422, 'Não é possível agendar em data passada.');
  await validarPaciente(c, agenda, pedido.pacienteId, pedido, data);

  for (const pr of pedido.procedimentos ?? []) {
    const cota = (await cotasProcedimentos(c, agenda.id, data)).find((x) => x.procedimento_id === pr.procedimentoId);
    if (cota && ((cota.disponivel_dia != null && cota.disponivel_dia < (pr.quantidade ?? 1)) || (cota.disponivel_mes != null && cota.disponivel_mes < (pr.quantidade ?? 1)))) {
      throw new ErroHttp(409, `Sem cota disponível para ${cota.nome} na data selecionada.`);
    }
  }

  let senha = novaSenha(agenda.tipo === 'EXAME' ? 'E' : 'C');
  while ((await c.query(`select 1 from age.agendamento where senha = $1`, [senha])).rowCount) senha = novaSenha();
  const ag = (
    await c.query(
      `insert into age.agendamento (senha, data, hora, paciente_id, agenda_id, horario_id, unidade_id, profissional_id, especialidade_id, convenio_id,
                                    unidade_solicitante_id, profissional_solicitante_id, tipo, origem, urgente, encaixe, situacao, requisicao_id,
                                    lista_espera_id, agendamento_origem_id, operador_id, observacao)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *`,
      [
        senha,
        data,
        hora,
        pedido.pacienteId,
        agenda.id,
        horario.id,
        agenda.unidade_id,
        agenda.profissional_id,
        agenda.especialidade_id,
        agenda.convenio_id,
        pedido.unidadeSolicitanteId ?? u.unidadeAtual,
        pedido.profissionalSolicitanteId ?? null,
        pedido.tipo ?? (agenda.tipo === 'EXAME' ? 'EXAME' : agenda.tipo === 'TELECONSULTA' ? 'TELECONSULTA' : 'CONSULTA'),
        pedido.origem ?? 'BALCAO',
        !!pedido.urgente,
        !!pedido.encaixe,
        pedido.situacaoInicial ?? 'AGENDADO',
        pedido.requisicaoId ?? null,
        pedido.listaEsperaId ?? null,
        pedido.agendamentoOrigemId ?? null,
        u.id,
        pedido.observacao ?? null,
      ],
    )
  ).rows[0];
  await c.query(`update age.horario set situacao = 'OCUPADO' where id = $1`, [horario.id]);
  for (const pr of pedido.procedimentos ?? []) {
    await c.query(
      `insert into age.agendamento_procedimento (agendamento_id, procedimento_id, quantidade, estrutura, solicitacao_item_id) values ($1,$2,$3,$4,$5)`,
      [ag.id, pr.procedimentoId, pr.quantidade ?? 1, pr.estrutura ?? null, pr.solicitacaoItemId ?? null],
    );
    if (pr.solicitacaoItemId) await c.query(`update amb.solicitacao_exame_item set situacao = 'AGENDADO' where id = $1`, [pr.solicitacaoItemId]);
  }
  if (pedido.requisicaoId) await c.query(`update amb.solicitacao_exame set situacao = 'AGENDADO' where id = $1`, [pedido.requisicaoId]);
  if (pedido.listaEsperaId) {
    await c.query(`update age.lista_espera set situacao = 'AGENDADO', agendamento_id = $2 where id = $1`, [pedido.listaEsperaId, ag.id]);
  }
  await notificarEvento(c, ag.id, pedido.listaEsperaId ? 'LISTA_ESPERA' : pedido.agendamentoOrigemId ? 'TRANSFERENCIA' : 'AGENDAMENTO');
  return ag;
}

export async function incluirListaEspera(
  c: pg.PoolClient,
  d: { pacienteId: number; especialidadeId?: number | null; procedimentoId?: number | null; unidadeSolicitanteId?: number | null; profissionalSolicitanteId?: number | null; origem: string; justificativa?: string; regulada?: boolean; prioridade?: string; encaminhamentoId?: number; solicitacaoItemId?: number },
) {
  const ordem = { VERMELHO: 1, AMARELO: 2, AZUL: 3 }[d.prioridade ?? 'AZUL'] ?? 3;
  const r = await c.query(
    `insert into age.lista_espera (paciente_id, especialidade_id, procedimento_id, unidade_solicitante_id, profissional_solicitante_id, origem, justificativa,
                                   regulada, prioridade, prioridade_ordem, situacao, incluido_em, encaminhamento_id, solicitacao_item_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'AGUARDANDO',now(),$11,$12) returning id`,
    [
      d.pacienteId,
      d.especialidadeId ?? null,
      d.procedimentoId ?? null,
      d.unidadeSolicitanteId ?? null,
      d.profissionalSolicitanteId ?? null,
      d.origem,
      d.justificativa ?? null,
      !!d.regulada,
      d.prioridade ?? 'AZUL',
      ordem,
      d.encaminhamentoId ?? null,
      d.solicitacaoItemId ?? null,
    ],
  );
  return r.rows[0].id as number;
}

/** Cancela, libera o horário, estorna a cota e inclui na lista de espera (TR 1.2.8.4.1). */
export async function cancelar(c: pg.PoolClient, id: number, motivo: string, incluirEspera = true, situacao = 'CANCELADO') {
  const ag = (await c.query(`select * from age.agendamento where id = $1 for update`, [id])).rows[0];
  if (!ag) throw new ErroHttp(404, 'Agendamento não encontrado.');
  if (!['AGENDADO', 'CONFIRMADO', 'SOLICITADO'].includes(ag.situacao)) throw new ErroHttp(409, 'Somente agendamentos pendentes podem ser cancelados.');
  await c.query(`update age.agendamento set situacao = $2, motivo = $3 where id = $1`, [id, situacao, motivo]);
  if (ag.horario_id) await c.query(`update age.horario set situacao = 'LIVRE' where id = $1 and situacao = 'OCUPADO'`, [ag.horario_id]);
  let listaId: number | null = null;
  if (incluirEspera && situacao === 'CANCELADO') {
    const proc = (await c.query(`select procedimento_id from age.agendamento_procedimento where agendamento_id = $1 limit 1`, [id])).rows[0];
    listaId = await incluirListaEspera(c, {
      pacienteId: ag.paciente_id,
      especialidadeId: ag.especialidade_id,
      procedimentoId: proc?.procedimento_id,
      unidadeSolicitanteId: ag.unidade_solicitante_id,
      profissionalSolicitanteId: ag.profissional_solicitante_id,
      origem: 'CANCELAMENTO',
      justificativa: `Cancelamento do agendamento ${ag.senha}: ${motivo}`,
    });
  }
  if (situacao === 'CANCELADO') await notificarEvento(c, id, 'CANCELAMENTO', { motivo });
  return { ok: true, listaEsperaId: listaId };
}

export async function transferir(c: pg.PoolClient, id: number, destino: { horarioId?: number; agendaId?: number; data?: string }, motivo: string, u: Usuario) {
  const ag = (await c.query(`select * from age.agendamento where id = $1 for update`, [id])).rows[0];
  if (!ag) throw new ErroHttp(404, 'Agendamento não encontrado.');
  const procs = (await c.query(`select procedimento_id, quantidade, estrutura, solicitacao_item_id from age.agendamento_procedimento where agendamento_id = $1`, [id])).rows;
  await cancelar(c, id, motivo, false, 'TRANSFERIDO');
  return agendar(
    c,
    {
      horarioId: destino.horarioId,
      agendaId: destino.agendaId,
      data: destino.data,
      pacienteId: ag.paciente_id,
      tipo: ag.tipo,
      origem: ag.origem,
      urgente: ag.urgente,
      unidadeSolicitanteId: ag.unidade_solicitante_id,
      profissionalSolicitanteId: ag.profissional_solicitante_id,
      requisicaoId: ag.requisicao_id,
      procedimentos: procs.map((p) => ({ procedimentoId: p.procedimento_id, quantidade: p.quantidade, estrutura: p.estrutura, solicitacaoItemId: p.solicitacao_item_id })),
      observacao: `Transferido do agendamento ${ag.senha}. ${motivo}`,
      agendamentoOrigemId: ag.id,
      confirmarAvisos: true,
    },
    u,
  );
}

/** Próximo horário livre de outra agenda da mesma especialidade (transferência em lote, TR 1.2.12.43.1). */
export async function proximoHorarioLivre(c: pg.PoolClient, filtro: { profissionalId?: number; especialidadeId?: number; unidadeId?: number; aPartirDe: string; tipoVaga?: string }) {
  return (
    await c.query(
      `select h.id, h.data::text, to_char(h.hora,'HH24:MI') hora, h.agenda_id from age.horario h join age.agenda a on a.id = h.agenda_id
        where h.situacao = 'LIVRE' and h.data >= $1 and a.ativo
          and ($2::bigint is null or a.profissional_id = $2) and ($3::bigint is null or a.especialidade_id = $3) and ($4::bigint is null or a.unidade_id = $4)
          and h.tipo_vaga = coalesce($5, 'ELETIVA')
        order by h.data, h.hora limit 1`,
      [filtro.aPartirDe, filtro.profissionalId ?? null, filtro.especialidadeId ?? null, filtro.unidadeId ?? null, filtro.tipoVaga ?? null],
    )
  ).rows[0] as { id: number; data: string; hora: string; agenda_id: number } | undefined;
}

/** Disponibilidade por dia para o calendário colorido (TR 1.2.10.8, 1.2.12.40). */
export async function calendario(filtro: { agendaId?: number; profissionalId?: number; especialidadeId?: number; unidadeId?: number; tipo?: string; mes: string; tipoVaga?: string }) {
  const inicio = `${filtro.mes}-01`;
  return consultar(
    `select h.data::text as data,
            count(*) filter (where h.situacao <> 'BLOQUEADO' and h.tipo_vaga = coalesce($6, h.tipo_vaga))::int as total,
            count(*) filter (where h.situacao = 'LIVRE' and h.tipo_vaga = coalesce($6, 'ELETIVA'))::int as livres,
            count(*) filter (where h.situacao = 'LIVRE' and h.tipo_vaga = 'URGENCIA')::int as livres_urgencia,
            count(*) filter (where h.situacao = 'OCUPADO')::int as ocupados,
            bool_or(a.especial) as especial, max(a.descricao_especial) as campanha,
            bool_and(h.situacao = 'BLOQUEADO') as bloqueado,
            max(h.motivo_bloqueio) as motivo_bloqueio
       from age.horario h join age.agenda a on a.id = h.agenda_id
      where h.data >= $1::date and h.data < ($1::date + interval '1 month') and a.ativo
        and ($2::bigint is null or a.id = $2) and ($3::bigint is null or a.profissional_id = $3)
        and ($4::bigint is null or a.especialidade_id = $4) and ($5::bigint is null or a.unidade_id = $5)
        and ($7::text is null or a.tipo = $7)
      group by h.data order by h.data`,
    [inicio, filtro.agendaId ?? null, filtro.profissionalId ?? null, filtro.especialidadeId ?? null, filtro.unidadeId ?? null, filtro.tipoVaga ?? null, filtro.tipo ?? null],
  );
}

export async function primeiraData(filtro: { agendaId?: number; profissionalId?: number; especialidadeId?: number; unidadeId?: number; tipoVaga?: string }) {
  return consultarUm<{ data: string }>(
    `select min(h.data)::text as data from age.horario h join age.agenda a on a.id = h.agenda_id
      where h.situacao = 'LIVRE' and h.data >= current_date and a.ativo and h.tipo_vaga = coalesce($5, 'ELETIVA')
        and ($1::bigint is null or a.id = $1) and ($2::bigint is null or a.profissional_id = $2)
        and ($3::bigint is null or a.especialidade_id = $3) and ($4::bigint is null or a.unidade_id = $4)`,
    [filtro.agendaId ?? null, filtro.profissionalId ?? null, filtro.especialidadeId ?? null, filtro.unidadeId ?? null, filtro.tipoVaga ?? null],
  );
}

/** Bloqueio de período: retira vagas e trata os pacientes já agendados (TR 1.2.12.16.1). */
export async function processarBloqueio(c: pg.PoolClient, bloqueioId: number, u: Usuario | undefined) {
  const b = (await c.query(`select *, data_inicio::text di, data_fim::text df from age.bloqueio_agenda where id = $1`, [bloqueioId])).rows[0];
  if (!b) return;
  const agendas = (
    await c.query(
      `select id from age.agenda where ($1::bigint is not null and id = $1) or ($1::bigint is null and profissional_id = $2 and ($3::bigint is null or unidade_id = $3))`,
      [b.agenda_id, b.profissional_id, b.unidade_id],
    )
  ).rows.map((r) => r.id);
  if (!agendas.length) return;
  const ags = (
    await c.query(
      `select id from age.agendamento where agenda_id = any($1) and data between $2 and $3 and situacao in ('AGENDADO','CONFIRMADO','SOLICITADO') order by data, hora`,
      [agendas, b.di, b.df],
    )
  ).rows;
  await c.query(`update age.horario set situacao = 'BLOQUEADO', motivo_bloqueio = $4 where agenda_id = any($1) and data between $2 and $3 and situacao = 'LIVRE'`, [
    agendas,
    b.di,
    b.df,
    `Bloqueio: ${b.tipo}`,
  ]);
  const resultado = { listaEspera: 0, transferidos: 0, encaixes: 0 };
  const usuario = u ?? ({ id: null, unidadeAtual: null } as any);
  for (const { id } of ags) {
    const ag = (await c.query(`select * from age.agendamento where id = $1`, [id])).rows[0];
    let destino: { horarioId?: number; agendaId?: number; data?: string } | null = null;
    const depois = iso(new Date(paraData(b.df).getTime() + DIA));
    if (b.acao === 'TRANSFERIR_DATA') {
      const h = await proximoHorarioLivre(c, { profissionalId: ag.profissional_id, especialidadeId: ag.especialidade_id, aPartirDe: depois });
      if (h) destino = { horarioId: h.id };
    } else if (b.acao === 'TRANSFERIR_PROFISSIONAL') {
      const h = await proximoHorarioLivre(c, { profissionalId: b.profissional_destino_id ?? undefined, especialidadeId: ag.especialidade_id, aPartirDe: ag.data });
      if (h) destino = { horarioId: h.id };
    } else if (b.acao === 'TRANSFERIR_UNIDADE') {
      const h = await proximoHorarioLivre(c, { unidadeId: b.unidade_destino_id ?? undefined, especialidadeId: ag.especialidade_id, aPartirDe: ag.data });
      if (h) destino = { horarioId: h.id };
    } else if (b.acao === 'ENCAIXE') {
      destino = { agendaId: ag.agenda_id, data: depois };
    }
    if (destino) {
      await transferir(c, id, destino, `Bloqueio de agenda (${b.tipo})`, usuario);
      if (b.acao === 'ENCAIXE') resultado.encaixes++;
      else resultado.transferidos++;
    } else {
      await c.query(`update age.horario set situacao = 'BLOQUEADO' where id = $1`, [ag.horario_id]);
      await cancelar(c, id, `Bloqueio de agenda (${b.tipo})`, true);
      await c.query(`update age.lista_espera set origem = 'FERIADO' where id = (select max(id) from age.lista_espera where paciente_id = $1)`, [ag.paciente_id]);
      resultado.listaEspera++;
    }
  }
  await c.query(`update age.bloqueio_agenda set processado_em = now(), resultado = $2 where id = $1`, [
    bloqueioId,
    `${ags.length} agendamento(s): ${resultado.transferidos} transferido(s), ${resultado.encaixes} encaixe(s), ${resultado.listaEspera} na lista de espera.`,
  ]);
  return resultado;
}

/** Feriado cadastrado: bloqueia as agendas e envia os agendados para a lista de espera (TR 1.2.7.6). */
export async function aplicarFeriado(c: pg.PoolClient, feriado: any) {
  const agendados = (
    await c.query(
      `select a.id from age.agendamento a where a.data = $1 and a.situacao in ('AGENDADO','CONFIRMADO','SOLICITADO')
          and ($2::bigint is null or a.unidade_id = $2)`,
      [feriado.data, feriado.unidade_id],
    )
  ).rows;
  await c.query(
    `update age.horario h set situacao = 'BLOQUEADO', motivo_bloqueio = 'Feriado: ' || $3 from age.agenda a
      where a.id = h.agenda_id and h.data = $1 and h.situacao = 'LIVRE' and ($2::bigint is null or a.unidade_id = $2)`,
    [feriado.data, feriado.unidade_id, feriado.descricao],
  );
  for (const { id } of agendados) {
    const ag = (await c.query(`select horario_id from age.agendamento where id = $1`, [id])).rows[0];
    await cancelar(c, id, `Feriado: ${feriado.descricao}`, true);
    await c.query(`update age.horario set situacao = 'BLOQUEADO' where id = $1`, [ag.horario_id]);
  }
  return agendados.length;
}
