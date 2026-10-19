// Regras do autoatendimento do cidadão: agendamento pela internet, listas de consultas, fila
// de espera, vacinas, medicamentos, exames e histórico de atendimentos (TR 1.2.41.7 a 1.2.41.13).
import type pg from 'pg';
import { consultar, consultarUm } from '../../db/pool.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { enfileirarMensagem } from '../../servicos/mensageria.js';
import { parametro } from '../cadastros/alertas.js';
import { agendar } from '../agendamento/servico.js';

export interface Antecedencia {
  quantidade: number;
  unidade: 'HORAS' | 'DIAS';
}
export const emHoras = (a: Antecedencia | null | undefined) => (!a ? 0 : a.unidade === 'DIAS' ? a.quantidade * 24 : a.quantidade);

/** Funcionalidades do aplicativo liberadas pela Secretaria (configuração do aplicativo). */
export const FUNCIONALIDADES = ['agendamento', 'fila', 'vacinas', 'medicamentos', 'exames', 'historico', 'unidades', 'mensagens', 'teleatendimento', 'dependentes', 'manifestacoes'] as const;
export async function funcionalidades(): Promise<Record<string, boolean>> {
  const p = await parametro<Record<string, boolean>>('portal.funcionalidades', {});
  return Object.fromEntries(FUNCIONALIDADES.map((f) => [f, p[f] !== false]));
}
export async function exigirFuncionalidade(f: (typeof FUNCIONALIDADES)[number]) {
  if (!(await funcionalidades())[f]) throw new ErroHttp(403, 'Funcionalidade não disponível no aplicativo.');
}

/** Usuário técnico das operações feitas pelo próprio cidadão (sem operador vinculado). */
export function usuarioAplicativo(unidadeId: number | null): Usuario {
  return { id: null, nome: 'Aplicativo do cidadão', login: 'aplicativo', unidadeAtual: unidadeId, unidades: [], permissoes: new Set() } as unknown as Usuario;
}

/** Antecedências efetivas: a maior entre a da agenda e a parametrizada para o aplicativo (TR 1.2.41.7.3, 1.2.41.7.10). */
export async function antecedencias(agenda: { antecedencia_agendar_horas?: number | null; antecedencia_cancelar_horas?: number | null }) {
  const ag = await parametro<Antecedencia>('portal.antecedencia_agendamento', { quantidade: 24, unidade: 'HORAS' });
  const ca = await parametro<Antecedencia>('portal.antecedencia_cancelamento', { quantidade: 24, unidade: 'HORAS' });
  return {
    agendarHoras: Math.max(agenda.antecedencia_agendar_horas ?? 0, emHoras(ag)),
    cancelarHoras: Math.max(agenda.antecedencia_cancelar_horas ?? 0, emHoras(ca)),
  };
}

/** Modo do agendamento: direto ou confirmado por operador da unidade (TR 1.2.41.7.2). */
export async function modoAgendamento(agenda: { web_modo?: string | null }) {
  const global = await parametro<string>('portal.agendamento_modo', 'AGENDA');
  return global === 'AGENDA' ? (agenda.web_modo ?? 'DIRETO') : global;
}

const COLUNAS_AGENDAMENTO = `a.id, a.senha, a.data::text data, to_char(a.hora,'HH24:MI') hora, a.situacao, a.tipo, a.origem, a.motivo, a.encaixe,
  a.criado_em, a.atualizado_em, a.paciente_id, p.nome paciente, u.nome unidade, u.telefone unidade_telefone,
  concat_ws(', ', concat_ws(' ', lg.tipo_abreviatura, lg.nome), u.numero, b.nome) unidade_endereco, u.latitude unidade_latitude, u.longitude unidade_longitude,
  ag.local, ag.tipo tipo_agenda, ag.antecedencia_cancelar_horas, pr.nome profissional, e.nome especialidade,
  (select string_agg(pc.nome, '; ') from age.agendamento_procedimento ap join cad.procedimento pc on pc.id = ap.procedimento_id where ap.agendamento_id = a.id) procedimentos,
  (select string_agg(pc.nome || ': ' || pc.preparo, E'\\n') from age.agendamento_procedimento ap join cad.procedimento pc on pc.id = ap.procedimento_id where ap.agendamento_id = a.id and pc.preparo is not null) preparo`;
const JUNCOES_AGENDAMENTO = `from age.agendamento a join cad.pessoa p on p.id = a.paciente_id join age.agenda ag on ag.id = a.agenda_id
  left join cad.unidade u on u.id = a.unidade_id left join cad.logradouro lg on lg.id = u.logradouro_id left join cad.bairro b on b.id = u.bairro_id
  left join cad.profissional pr on pr.id = a.profissional_id left join cad.especialidade e on e.id = a.especialidade_id`;

/** Listas de consultas do cidadão e dependentes (TR 1.2.41.7.11 a 1.2.41.7.14, 1.2.41.7.17). */
export async function listasAgendamentos(pessoas: number[]) {
  const agendadas = await consultar(
    `select ${COLUNAS_AGENDAMENTO}, h.situacao situacao_horario, h.motivo_bloqueio,
            (a.data + coalesce(a.hora, '00:00'::time)) at time zone 'America/Sao_Paulo' inicio
       ${JUNCOES_AGENDAMENTO} left join age.horario h on h.id = a.horario_id
      where a.paciente_id = any($1) and a.situacao in ('AGENDADO','SOLICITADO','CONFIRMADO','PRESENTE') and a.data >= current_date
      order by a.data, a.hora`,
    [pessoas],
  );
  // Responsável pelo cancelamento: o cidadão (registro do aplicativo) ou o operador da unidade (auditoria).
  const canceladas = await consultar(
    `select ${COLUNAS_AGENDAMENTO},
            coalesce(ev.data_hora, a.atualizado_em) cancelado_em,
            coalesce(ev.responsavel, (select coalesce(o.nome, 'Operador') from aud.log_dados l left join seg.operador o on o.id = l.operador_id
                                        where l.tabela = 'age.agendamento' and l.registro_id = a.id and l.depois->>'situacao' = a.situacao
                                        order by l.id desc limit 1), 'Unidade de saúde') responsavel_cancelamento
       ${JUNCOES_AGENDAMENTO}
       left join lateral (select e2.data_hora, e2.responsavel from portal.evento_agendamento e2
                           where e2.agendamento_id = a.id and e2.evento in ('CANCELAMENTO','TRANSFERENCIA','RECUSA') order by e2.id desc limit 1) ev on true
      where a.paciente_id = any($1) and a.situacao in ('CANCELADO','TRANSFERIDO')
      order by a.data desc, a.hora desc limit 100`,
    [pessoas],
  );
  const efetuadas = await consultar(
    `select ${COLUNAS_AGENDAMENTO} ${JUNCOES_AGENDAMENTO}
      where a.paciente_id = any($1) and (a.situacao = 'ATENDIDO' or (a.data < current_date and a.situacao in ('PRESENTE','CONFIRMADO')))
      order by a.data desc, a.hora desc limit 100`,
    [pessoas],
  );
  const espera = await listaEspera(pessoas, 'AGUARDANDO');
  // Bloqueadas: inclusões bloqueadas na lista de espera e consultas cujo horário foi bloqueado pela unidade.
  const bloqueadas = [
    ...(await listaEspera(pessoas, 'BLOQUEADO')).map((l) => ({ ...l, origem_bloqueio: 'LISTA_ESPERA', motivo_bloqueio: l.motivo })),
    ...agendadas.filter((a) => a.situacao_horario === 'BLOQUEADO').map((a) => ({ ...a, origem_bloqueio: 'AGENDA', motivo_bloqueio: a.motivo_bloqueio ?? 'Agenda bloqueada pela unidade' })),
  ];
  return { agendadas, espera, bloqueadas, canceladas, efetuadas };
}

/** Lista de espera com a posição do paciente na fila da especialidade/exame (TR 1.2.41.7.13). */
export async function listaEspera(pessoas: number[], situacao: string) {
  return consultar(
    `select l.id, l.paciente_id, p.nome paciente, l.incluido_em, l.situacao, l.prioridade, l.origem, l.motivo, l.justificativa, l.regulada,
            e.nome especialidade, pc.nome procedimento, us.nome unidade_solicitante,
            (select count(*)::int + 1 from age.lista_espera x
              where x.situacao = 'AGUARDANDO' and coalesce(x.especialidade_id, 0) = coalesce(l.especialidade_id, 0) and coalesce(x.procedimento_id, 0) = coalesce(l.procedimento_id, 0)
                and (x.prioridade_ordem, x.incluido_em, x.id) < (l.prioridade_ordem, l.incluido_em, l.id)) posicao,
            (select count(*)::int from age.lista_espera x
              where x.situacao = 'AGUARDANDO' and coalesce(x.especialidade_id, 0) = coalesce(l.especialidade_id, 0) and coalesce(x.procedimento_id, 0) = coalesce(l.procedimento_id, 0)) total_fila
       from age.lista_espera l join cad.pessoa p on p.id = l.paciente_id left join cad.especialidade e on e.id = l.especialidade_id
       left join cad.procedimento pc on pc.id = l.procedimento_id left join cad.unidade us on us.id = l.unidade_solicitante_id
      where l.paciente_id = any($1) and l.situacao = $2 order by l.incluido_em`,
    [pessoas, situacao],
  );
}

/** Fila de espera pública por especialidade ou exame, com identificação anonimizada (TR 1.2.41.7.18). */
export async function filaPublica(filtro: { especialidadeId?: number | null; procedimentoId?: number | null }, pessoas: number[], somenteMeus: boolean) {
  const resumo = await consultar(
    `select 'E' tipo, e.id, e.nome, count(*)::int aguardando, min(l.incluido_em) mais_antigo from age.lista_espera l join cad.especialidade e on e.id = l.especialidade_id
      where l.situacao = 'AGUARDANDO' and l.procedimento_id is null group by e.id, e.nome
     union all
     select 'P', pc.id, pc.nome, count(*)::int, min(l.incluido_em) from age.lista_espera l join cad.procedimento pc on pc.id = l.procedimento_id
      where l.situacao = 'AGUARDANDO' group by pc.id, pc.nome
     order by 3`,
  );
  if (!filtro.especialidadeId && !filtro.procedimentoId) return { resumo, fila: [] };
  const fila = await consultar(
    `select row_number() over (order by l.prioridade_ordem, l.incluido_em, l.id)::int posicao, l.id, l.incluido_em, l.prioridade,
            regexp_replace(p.nome, '(\\S)\\S*\\s*', '\\1.', 'g') iniciais,
            case when p.cns is null then null else '*** **** ' || right(p.cns, 4) end cns_mascarado,
            l.paciente_id = any($3) meu, case when l.paciente_id = any($3) then p.nome end nome
       from age.lista_espera l join cad.pessoa p on p.id = l.paciente_id
      where l.situacao = 'AGUARDANDO' and (($1::bigint is not null and l.especialidade_id = $1 and l.procedimento_id is null) or ($2::bigint is not null and l.procedimento_id = $2))
      order by posicao`,
    [filtro.especialidadeId ?? null, filtro.procedimentoId ?? null, pessoas],
  );
  return { resumo, fila: somenteMeus ? fila.filter((f) => f.meu) : fila };
}

/** Especialidades, profissionais e horários liberados para marcação pelo aplicativo (TR 1.2.41.7.1, 1.2.41.7.6 a 1.2.41.7.8). */
export async function ofertas(f: { especialidadeId?: number | null; profissionalId?: number | null; unidadeId?: number | null; tipo?: string | null }) {
  const antecedenciaGlobal = emHoras(await parametro<Antecedencia>('portal.antecedencia_agendamento', { quantidade: 24, unidade: 'HORAS' }));
  const agendas = await consultar(
    `select a.id, a.nome, a.tipo, a.web_modo, a.antecedencia_agendar_horas, a.antecedencia_cancelar_horas, a.unidade_id, u.nome unidade,
            a.profissional_id, pr.nome profissional, a.especialidade_id, e.nome especialidade, e.tipo tipo_especialidade, a.local,
            (select count(*)::int from age.horario h where h.agenda_id = a.id and h.situacao = 'LIVRE' and h.tipo_vaga = 'ELETIVA'
               and (h.data + h.hora) at time zone 'America/Sao_Paulo' >= now() + make_interval(hours => greatest(coalesce(a.antecedencia_agendar_horas, 0), $5::int))) vagas,
            (select min(h.data)::text from age.horario h where h.agenda_id = a.id and h.situacao = 'LIVRE' and h.tipo_vaga = 'ELETIVA'
               and (h.data + h.hora) at time zone 'America/Sao_Paulo' >= now() + make_interval(hours => greatest(coalesce(a.antecedencia_agendar_horas, 0), $5::int))) primeira_data
       from age.agenda a join cad.unidade u on u.id = a.unidade_id left join cad.profissional pr on pr.id = a.profissional_id
       left join cad.especialidade e on e.id = a.especialidade_id
      where a.ativo and a.disponivel_web and (a.vigencia_fim is null or a.vigencia_fim >= current_date)
        and coalesce(e.regulada, false) = false and a.tipo in ('CONSULTA','TELECONSULTA','EXAME')
        and ($1::bigint is null or a.especialidade_id = $1) and ($2::bigint is null or a.profissional_id = $2)
        and ($3::bigint is null or a.unidade_id = $3) and ($4::text is null or a.tipo = $4)
      order by e.nome, pr.nome`,
    [f.especialidadeId ?? null, f.profissionalId ?? null, f.unidadeId ?? null, f.tipo ?? null, antecedenciaGlobal],
  );
  const especialidades = [...new Map(agendas.filter((a) => a.especialidade_id).map((a) => [a.especialidade_id, { id: a.especialidade_id, nome: a.especialidade, tipo: a.tipo_especialidade }])).values()];
  const profissionais = [...new Map(agendas.filter((a) => a.profissional_id).map((a) => [a.profissional_id, { id: a.profissional_id, nome: a.profissional, especialidadeId: a.especialidade_id }])).values()];
  return { agendas, especialidades, profissionais };
}

export async function horariosLivres(agendaId: number, de: string, ate: string) {
  const agenda = await consultarUm(`select * from age.agenda where id = $1 and ativo and disponivel_web`, [agendaId]);
  if (!agenda) throw new ErroHttp(404, 'Agenda não disponível no aplicativo.');
  const { agendarHoras } = await antecedencias(agenda);
  return consultar(
    `select h.id, h.data::text data, to_char(h.hora,'HH24:MI') hora from age.horario h
      where h.agenda_id = $1 and h.situacao = 'LIVRE' and h.tipo_vaga = 'ELETIVA' and h.data between $2 and $3
        and (h.data + h.hora) at time zone 'America/Sao_Paulo' >= now() + make_interval(hours => $4::int)
      order by h.data, h.hora`,
    [agendaId, de, ate, agendarHoras],
  );
}

/** Aviso ao cidadão pelo aplicativo e, conforme parametrização e preferências, por SMS e e-mail (TR 1.2.41.7.4). */
export async function avisarCidadao(c: pg.PoolClient, pessoaId: number, assunto: string, texto: string, referencia: string, evento = 'aplicativo', eventoAgenda?: string) {
  const p = (await c.query(`select celular, email, notificar_sms, notificar_email, notificar_app from cad.pessoa where id = $1`, [pessoaId])).rows[0];
  if (!p) return;
  const meios = await parametro<{ app: boolean; sms: boolean; email: boolean }>('portal.aviso_meios', { app: true, sms: true, email: true });
  // Quando há critério de notificação ativo para o evento, o aviso por SMS/e-mail já é enviado pelo agendamento.
  const criterios = eventoAgenda ? (await c.query(`select meio from age.criterio_notificacao where ativo and $1 = any(eventos)`, [eventoAgenda])).rows.map((r) => r.meio as string) : [];
  const cobre = (m: string) => criterios.includes(m) || criterios.includes('TODOS');
  if (meios.app !== false && !cobre('PUSH')) await enfileirarMensagem({ pacienteId: pessoaId, meio: 'push', destinatario: `paciente:${pessoaId}`, assunto, texto, evento, referencia }, c);
  if (meios.sms !== false && !cobre('SMS') && p.notificar_sms && p.celular) await enfileirarMensagem({ pacienteId: pessoaId, meio: 'sms', destinatario: p.celular, texto, evento, referencia }, c);
  if (meios.email !== false && !cobre('EMAIL') && p.notificar_email && p.email) await enfileirarMensagem({ pacienteId: pessoaId, meio: 'email', destinatario: p.email, assunto, texto, evento, referencia }, c);
}

export async function registrarEvento(c: pg.PoolClient, d: { agendamentoId: number; contaId?: number | null; pessoaId?: number | null; evento: string; motivo?: string | null; responsavel: string }) {
  await c.query(
    `insert into portal.evento_agendamento (agendamento_id, conta_id, pessoa_id, evento, data_hora, motivo, responsavel) values ($1,$2,$3,$4,now(),$5,$6)`,
    [d.agendamentoId, d.contaId ?? null, d.pessoaId ?? null, d.evento, d.motivo?.slice(0, 250) ?? null, d.responsavel.slice(0, 120)],
  );
}

/**
 * Vaga liberada por cancelamento ou transferência é oferecida automaticamente ao primeiro paciente
 * da lista de espera da mesma especialidade (TR 1.2.41.7.9, 1.2.41.7.16).
 */
export async function reaproveitarVaga(c: pg.PoolClient, horarioId: number | null) {
  if (!horarioId || !(await parametro<boolean>('portal.vaga_para_lista_espera', true))) return null;
  const h = (await c.query(`select h.*, a.especialidade_id from age.horario h join age.agenda a on a.id = h.agenda_id where h.id = $1`, [horarioId])).rows[0];
  if (!h || h.situacao !== 'LIVRE' || !h.especialidade_id) return null;
  const candidatos = (
    await c.query(
      `select id, paciente_id from age.lista_espera where situacao = 'AGUARDANDO' and especialidade_id = $1 and procedimento_id is null and not regulada
        order by prioridade_ordem, incluido_em, id limit 3`,
      [h.especialidade_id],
    )
  ).rows;
  for (const l of candidatos) {
    await c.query('savepoint vaga');
    try {
      const ag = await agendar(c, { horarioId, pacienteId: l.paciente_id, origem: 'LISTA_ESPERA', listaEsperaId: l.id, confirmarAvisos: true }, usuarioAplicativo(null));
      await c.query('release savepoint vaga');
      await avisarCidadao(c, l.paciente_id, 'Consulta agendada', `Surgiu uma vaga e sua consulta foi agendada para ${String(ag.data).slice(0, 10).split('-').reverse().join('/')} às ${String(ag.hora ?? '').slice(0, 5)}. Protocolo ${ag.senha}.`, `agendamento:${ag.id}`, 'lista_espera', 'LISTA_ESPERA');
      return ag.id as number;
    } catch {
      await c.query('rollback to savepoint vaga');
    }
  }
  return null;
}

/** Verifica a antecedência mínima para cancelar/transferir (TR 1.2.41.7.10, 1.2.41.7.16). */
export async function validarAntecedenciaCancelamento(ag: any) {
  const agenda = await consultarUm(`select antecedencia_cancelar_horas from age.agenda where id = $1`, [ag.agenda_id]);
  const { cancelarHoras } = await antecedencias(agenda ?? {});
  const inicio = new Date(`${String(ag.data_txt)}T${ag.hora_txt ?? '00:00'}:00-03:00`).getTime();
  if (inicio - Date.now() < cancelarHoras * 3_600_000) {
    throw new ErroHttp(422, `O cancelamento ou transferência pelo aplicativo é permitido até ${cancelarHoras >= 48 && cancelarHoras % 24 === 0 ? `${cancelarHoras / 24} dias` : `${cancelarHoras} horas`} antes da consulta. Procure a unidade de saúde.`);
  }
}

/** Histórico de vacinação, próximas doses, aprazamentos e campanhas em aberto (TR 1.2.41.8). */
export async function campanhasAbertas(pessoaId: number) {
  return consultar(
    `select c.id, c.nome, c.estrategia, c.inicio::text inicio, c.fim::text fim,
            coalesce(json_agg(json_build_object('grupo', g.nome, 'imunobiologico', i.nome, 'dose', d.nome,
                     'indicada', (current_date - p.data_nascimento) between coalesce(g.idade_minima_dias, 0) and coalesce(g.idade_maxima_dias, 999999)))
                     filter (where g.id is not null), '[]') grupos
       from imu.campanha c cross join cad.pessoa p left join imu.campanha_grupo g on g.campanha_id = c.id
       left join imu.imunobiologico i on i.id = g.imunobiologico_id left join imu.dose d on d.id = g.dose_id
      where p.id = $1 and c.ativo and c.inicio <= current_date and (c.fim is null or c.fim >= current_date)
      group by c.id order by c.inicio`,
    [pessoaId],
  );
}

/** Medicamentos em uso e histórico com posologia, início e término (TR 1.2.41.9.1, 1.2.41.9.2). */
export async function medicamentos(pessoaId: number) {
  const itens = await consultar(
    `select i.id, coalesce(pd.nome || coalesce(' ' || pd.concentracao, ''), i.descricao) medicamento, i.quantidade, i.posologia, i.dose, i.via,
            i.intervalo_horas, i.duracao_dias, i.uso_continuo, i.quantidade_dispensada, p.data::text inicio,
            case when i.uso_continuo then null when i.duracao_dias is not null then (p.data + i.duracao_dias)::text end termino,
            coalesce(pr.nome, p.prescritor_externo) prescritor, u.nome unidade, p.numero receita, p.situacao situacao_receita, p.orientacoes,
            (i.uso_continuo or p.data + coalesce(i.duracao_dias, 30) >= current_date) and p.situacao <> 'CANCELADA' em_uso,
            (select max(di.termino_previsto)::text from far.dispensacao_item di join far.dispensacao d on d.id = di.dispensacao_id
              where di.prescricao_item_id = i.id and d.situacao is distinct from 'ESTORNADA') termino_dispensado
       from amb.prescricao_item i join amb.prescricao p on p.id = i.prescricao_id left join far.produto pd on pd.id = i.produto_id
       left join cad.profissional pr on pr.id = p.profissional_id left join cad.unidade u on u.id = p.unidade_id
      where p.paciente_id = $1 and not coalesce(p.uso_interno, false) order by p.data desc, i.id`,
    [pessoaId],
  );
  const dispensacoes = await consultar(
    `select d.data_hora, u.nome unidade, pd.nome medicamento, di.quantidade, di.dias_consumo, di.termino_previsto::text termino
       from far.dispensacao d join far.dispensacao_item di on di.dispensacao_id = d.id join far.produto pd on pd.id = di.produto_id
       left join cad.unidade u on u.id = d.unidade_id
      where d.paciente_id = $1 and d.situacao is distinct from 'ESTORNADA' order by d.data_hora desc limit 100`,
    [pessoaId],
  );
  return { emUso: itens.filter((i) => i.em_uso), historico: itens, dispensacoes };
}

/** Medicamentos parametrizados para exibição no aplicativo e disponibilidade por farmácia (TR 1.2.41.9.3). */
export async function medicamentosDisponiveis(busca: string | null) {
  const mostrarQuantidade = await parametro<boolean>('portal.exibir_quantidade_estoque', false);
  const linhas = await consultar(
    `select pd.id, pd.nome, pd.concentracao, pd.unidade_fornecimento, u.id unidade_id, u.nome unidade, u.telefone,
            coalesce(sum(l.quantidade - coalesce(l.reservado, 0)) filter (where l.validade >= current_date and not coalesce(l.bloqueado, false)), 0)::numeric saldo
       from far.produto pd left join far.estoque_lote l on l.produto_id = pd.id left join cad.unidade u on u.id = l.unidade_id
      where pd.ativo and pd.disponivel_app and pd.tipo = 'MEDICAMENTO' and ($1::text is null or pd.nome ilike '%' || $1 || '%')
      group by pd.id, u.id order by pd.nome, u.nome`,
    [busca || null],
  );
  const mapa = new Map<number, any>();
  for (const l of linhas) {
    const m = mapa.get(l.id) ?? { id: l.id, nome: [l.nome, l.concentracao].filter(Boolean).join(' '), unidadeFornecimento: l.unidade_fornecimento, farmacias: [] as any[] };
    if (l.unidade_id && Number(l.saldo) > 0) m.farmacias.push({ unidadeId: l.unidade_id, unidade: l.unidade, telefone: l.telefone, quantidade: mostrarQuantidade ? Number(l.saldo) : undefined });
    mapa.set(l.id, m);
  }
  return [...mapa.values()].map((m) => ({ ...m, disponivel: m.farmacias.length > 0 }));
}

/** Pedidos de exames, agendados, realizados e resultados (TR 1.2.41.10). */
export async function exames(pessoas: number[]) {
  const itens = await consultar(
    `select it.id, s.id solicitacao_id, s.numero, s.data::text data, s.situacao situacao_pedido, s.paciente_id, p.nome paciente,
            pc.codigo, pc.nome exame, pc.preparo, it.material, it.situacao, it.resultado_liberado_em, it.resultado_arquivo_id is not null tem_laudo,
            it.resultado_texto is not null tem_resultado, pr.nome profissional, u.nome unidade, pres.nome prestador,
            (select json_build_object('id', a.id, 'data', a.data::text, 'hora', to_char(a.hora,'HH24:MI'), 'unidade', ua.nome, 'senha', a.senha, 'situacao', a.situacao)
               from age.agendamento_procedimento ap join age.agendamento a on a.id = ap.agendamento_id left join cad.unidade ua on ua.id = a.unidade_id
              where ap.solicitacao_item_id = it.id and a.situacao not in ('CANCELADO','TRANSFERIDO') order by a.data desc limit 1) agendamento
       from amb.solicitacao_exame_item it join amb.solicitacao_exame s on s.id = it.solicitacao_id join cad.pessoa p on p.id = s.paciente_id
       join cad.procedimento pc on pc.id = it.procedimento_id left join cad.profissional pr on pr.id = s.profissional_id
       left join cad.unidade u on u.id = s.unidade_id left join cad.unidade pres on pres.id = it.prestador_id
      where s.paciente_id = any($1) and not coalesce(s.uso_interno, false) and s.situacao <> 'CANCELADO'
      order by s.data desc, it.id`,
    [pessoas],
  );
  // Exames agendados diretamente na agenda de exames (sem requisição vinculada).
  const agendamentosExame = await consultar(
    `select ${COLUNAS_AGENDAMENTO} ${JUNCOES_AGENDAMENTO}
      where a.paciente_id = any($1) and (a.tipo = 'EXAME' or ag.tipo = 'EXAME') and a.situacao in ('AGENDADO','SOLICITADO','CONFIRMADO') and a.data >= current_date
      order by a.data, a.hora`,
    [pessoas],
  );
  const pedidos = [...new Map(itens.map((i) => [i.solicitacao_id, { id: i.solicitacao_id, numero: i.numero, data: i.data, situacao: i.situacao_pedido, paciente: i.paciente, profissional: i.profissional, unidade: i.unidade, itens: itens.filter((x) => x.solicitacao_id === i.solicitacao_id) }])).values()];
  return {
    pedidos,
    agendados: [...itens.filter((i) => i.situacao === 'AGENDADO' || i.agendamento?.situacao === 'AGENDADO'), ...agendamentosExame.map((a) => ({ ...a, exame: a.procedimentos ?? a.especialidade ?? 'Exame', agendamento: a }))],
    realizados: itens.filter((i) => ['COLETADO', 'REALIZADO', 'AVALIADO'].includes(i.situacao) || i.resultado_liberado_em),
  };
}

const CLASSIFICACAO = `case when a.tipo_unidade = 'ODONTOLOGIA' or e.tipo = 'ODONTOLOGICA' or cb.codigo like '2232%' then 'ODONTOLOGICO'
  when e.tipo = 'ENFERMAGEM' or cb.codigo like '2235%' or cb.codigo like '3222%' then 'ENFERMAGEM' else 'MEDICO' end`;

/** Histórico de atendimentos médicos, odontológicos e de enfermagem (TR 1.2.41.11, 1.2.41.12, 1.2.41.13). */
export async function historicoAtendimentos(pessoaId: number) {
  return consultar(
    `select a.id, coalesce(a.fim_em, a.inicio_em, a.entrada_em) data_hora, u.nome unidade, pr.nome profissional, coalesce(e.nome, cb.nome) especialidade,
            ${CLASSIFICACAO} classe, ci.codigo cid_codigo, ci.nome cid
       from amb.atendimento a left join cad.unidade u on u.id = a.unidade_id left join cad.profissional pr on pr.id = a.profissional_id
       left join cad.especialidade e on e.id = a.especialidade_id
       left join lateral (select v.cbo_id from cad.vinculo v where v.profissional_id = a.profissional_id order by (v.unidade_id = a.unidade_id) desc, v.ativo desc limit 1) vv on true
       left join cad.cbo cb on cb.id = vv.cbo_id left join cad.cid ci on ci.id = a.cid_id
      where a.paciente_id = $1 and a.situacao = 'FINALIZADO' order by 2 desc limit 200`,
    [pessoaId],
  );
}

const registroProfissional = (alias: string, vinculo: string) =>
  `nullif(concat_ws(' ', coalesce(${vinculo}.conselho, ${alias}.conselho), coalesce(${vinculo}.registro_conselho, ${alias}.registro_conselho) || coalesce('/' || coalesce(${vinculo}.uf_conselho, ${alias}.uf_conselho), '')), '')`;

export async function detalheAtendimento(pessoaId: number, id: number) {
  const exibirEvolucao = await parametro<boolean>('portal.exibir_evolucao_clinica', false);
  const a = await consultarUm(
    `select a.id, a.paciente_id, coalesce(a.fim_em, a.inicio_em, a.entrada_em) data_hora, a.tipo_unidade, u.nome unidade, pr.nome profissional,
            coalesce(e.nome, cb.nome) especialidade, ${registroProfissional('pr', 'v')} registro_profissional, ${CLASSIFICACAO} classe,
            ci.codigo cid_codigo, ci.nome cid, a.cids_secundarios, a.odontograma, a.desfecho, a.retorno_dias,
            coalesce((select numero from cad.pessoa_prontuario pp where pp.pessoa_id = a.paciente_id and pp.unidade_id = a.unidade_id), pe.prontuario, a.paciente_id::text) prontuario,
            case when $3 then a.subjetivo end subjetivo, case when $3 then a.avaliacao end avaliacao, case when $3 then a.plano end plano,
            a.triagem_em, pt.nome triagem_profissional, ${registroProfissional('pt', 'vt')} triagem_registro, cbt.nome triagem_especialidade
       from amb.atendimento a join cad.pessoa pe on pe.id = a.paciente_id left join cad.unidade u on u.id = a.unidade_id
       left join cad.profissional pr on pr.id = a.profissional_id left join cad.especialidade e on e.id = a.especialidade_id
       left join lateral (select v.* from cad.vinculo v where v.profissional_id = a.profissional_id order by (v.unidade_id = a.unidade_id) desc, v.ativo desc limit 1) v on true
       left join cad.cbo cb on cb.id = v.cbo_id left join cad.cid ci on ci.id = a.cid_id
       left join cad.profissional pt on pt.id = a.profissional_triagem_id
       left join lateral (select v2.* from cad.vinculo v2 where v2.profissional_id = a.profissional_triagem_id order by (v2.unidade_id = a.unidade_id) desc, v2.ativo desc limit 1) vt on true
       left join cad.cbo cbt on cbt.id = vt.cbo_id
      where a.id = $1 and a.paciente_id = $2 and a.situacao = 'FINALIZADO'`,
    [id, pessoaId, exibirEvolucao],
  );
  if (!a) throw new ErroHttp(404, 'Atendimento não encontrado.');
  const triagem = await consultarUm(
    `select sv.data_hora, sv.altura, sv.cintura, sv.abdomen, sv.quadril, sv.perimetro_cefalico, sv.peso, sv.imc, sv.pa_sistolica, sv.pa_diastolica,
            sv.temperatura, sv.frequencia_cardiaca, sv.frequencia_respiratoria, sv.saturacao, sv.glicemia, sv.glicemia_momento,
            pr.nome profissional, ${registroProfissional('pr', 'v')} registro_profissional, cb.nome especialidade
       from amb.sinais_vitais sv left join cad.profissional pr on pr.id = sv.profissional_id
       left join lateral (select v.* from cad.vinculo v where v.profissional_id = sv.profissional_id order by v.ativo desc limit 1) v on true
       left join cad.cbo cb on cb.id = v.cbo_id
      where sv.atendimento_id = $1 order by sv.data_hora limit 1`,
    [id],
  );
  const procedimentos = await consultar(
    `select fp.data::text data, pc.codigo, pc.nome, fp.quantidade from fat.producao fp join cad.procedimento pc on pc.id = fp.procedimento_id
      where fp.referencia = $1 and fp.paciente_id = $2 order by pc.nome`,
    [`atendimento:${id}`, pessoaId],
  );
  const examesSolicitados = await consultar(
    `select s.numero, s.data::text data, pc.codigo, pc.nome, it.situacao from amb.solicitacao_exame s join amb.solicitacao_exame_item it on it.solicitacao_id = s.id
       join cad.procedimento pc on pc.id = it.procedimento_id where s.atendimento_id = $1 and not coalesce(s.uso_interno, false) order by pc.nome`,
    [id],
  );
  const encaminhamentos = await consultar(
    `select en.data::text data, e.nome especialidade, en.situacao, en.urgencia from amb.encaminhamento en left join cad.especialidade e on e.id = en.especialidade_id
      where en.atendimento_id = $1`,
    [id],
  );
  const prescricoes = await consultar(
    `select p.numero, p.data::text data, p.orientacoes, coalesce(pd.nome || coalesce(' ' || pd.concentracao, ''), i.descricao) medicamento, i.quantidade, i.posologia, i.uso_continuo, i.duracao_dias
       from amb.prescricao p join amb.prescricao_item i on i.prescricao_id = p.id left join far.produto pd on pd.id = i.produto_id
      where p.atendimento_id = $1 and not coalesce(p.uso_interno, false) and p.situacao <> 'CANCELADA' order by p.id, i.id`,
    [id],
  );
  return { ...a, triagem: triagem ?? null, procedimentos, examesSolicitados, encaminhamentos, prescricoes };
}

/** Unidades de saúde com endereço, contato, localização e especialidades ofertadas. */
export async function unidades() {
  return consultar(
    `select u.id, u.nome, u.tipo_unidade, u.telefone, u.email, u.cnes, u.latitude, u.longitude, u.turno_atendimento, u.cep,
            concat_ws(' ', lg.tipo_abreviatura, lg.nome) logradouro, u.numero, b.nome bairro, m.nome municipio,
            (select string_agg(distinct e.nome, ', ') from age.agenda a join cad.especialidade e on e.id = a.especialidade_id where a.unidade_id = u.id and a.ativo) especialidades
       from cad.unidade u left join cad.logradouro lg on lg.id = u.logradouro_id left join cad.bairro b on b.id = u.bairro_id
       left join cad.municipio m on m.id = u.municipio_id
      where u.ativo and coalesce(u.tipo_unidade, '') not in ('ADMINISTRATIVA', 'TRANSPORTE', 'VIGILANCIA') order by u.nome`,
  );
}
