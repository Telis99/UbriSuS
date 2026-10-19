// Regras do transporte sanitário: disponibilidade das agendas por rota, bloqueio por feriado,
// cálculo de vagas por trecho, agendamento, viagens sem agendamento, confirmação e fechamento.
import type pg from 'pg';
import { config } from '../../config.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';

const DIA = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const paraData = (s: string) => new Date(s + 'T12:00:00Z');
export const fmtData = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
export const hhmm = (h?: string | null) => (h ? String(h).slice(0, 5) : '');

/** Data e hora atuais no fuso do município. */
export function agoraLocal() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

export type TipoViagem = 'IDA' | 'VOLTA' | 'IDA_VOLTA';

export interface AcompanhanteEntrada {
  indefinido?: boolean;
  pessoaId?: number | null;
  nome?: string | null;
  documento?: string | null;
  parentesco?: string | null;
  tipoViagem?: TipoViagem;
  ocupaVaga?: boolean;
  poltrona?: number | null;
}

export interface PassageiroEntrada {
  pacienteId: number;
  ocupaVaga?: boolean;
  municipioDestinoId?: number | null;
  localDestinoId?: number | null;
  motivoId?: number | null;
  localEmbarqueId?: number | null;
  horaSaida?: string | null;
  horarioCompromisso?: string | null;
  poltrona?: number | null;
  tipoViagem?: TipoViagem;
  necessidade?: 'NENHUMA' | 'MACA' | 'CADEIRA_RODAS';
  observacao?: string | null;
  tfdLaudoId?: number | null;
  acompanhantes?: AcompanhanteEntrada[];
}

// ---------------------------------------------------------------------------
// Feriados (TR 1.2.40.27, 1.2.40.28)
// ---------------------------------------------------------------------------

/** Abrangência da rota: dentro do município ou para fora dele (usada no bloqueio por feriado). */
export async function abrangenciaDaRota(c: pg.PoolClient, municipioDestinoId: number | null | undefined) {
  if (!municipioDestinoId) return 'FORA';
  const m = (await c.query(`select codigo_ibge from cad.municipio where id = $1`, [municipioDestinoId])).rows[0];
  return m?.codigo_ibge === config.codigoIbgeMunicipio ? 'MUNICIPIO' : 'FORA';
}

/** Feriados do período que afetam rotas com a abrangência informada (TODAS, rotas do município ou para fora). */
export async function feriadosQueAfetam(c: pg.PoolClient, abrangencia: string, de: string, ate: string) {
  const r = await c.query(
    `select data::text data, descricao from cad.feriado
      where data between $1 and $2 and unidade_id is null
        and (rotas_afetadas = 'TODAS' or rotas_afetadas = $3)`,
    [de, ate, abrangencia === 'MUNICIPIO' ? 'MUNICIPIO' : 'FORA'],
  );
  return new Map<string, string>(r.rows.map((x) => [x.data, x.descricao]));
}

// ---------------------------------------------------------------------------
// Vagas (TR 1.2.40.13, 1.2.40.16)
// ---------------------------------------------------------------------------

/**
 * Ocupação da viagem por trecho: pacientes e acompanhantes que ocupam vaga, considerando se viajam
 * somente na ida, somente na volta ou na ida e volta. Quem não ocupa vaga não é computado.
 */
export async function ocupacaoViagens(c: pg.PoolClient | pg.Pool, viagens: number[]) {
  const mapa = new Map<number, { ida: number; volta: number; ocupadas: number; pacientes: number; indefinidos: number }>();
  if (!viagens.length) return mapa;
  const r = await c.query(
    `select viagem_id, sum(case when tipo_viagem in ('IDA','IDA_VOLTA') and ocupa then 1 else 0 end)::int ida,
            sum(case when tipo_viagem in ('VOLTA','IDA_VOLTA') and ocupa then 1 else 0 end)::int volta,
            sum(case when paciente then 1 else 0 end)::int pacientes, sum(case when indefinido then 1 else 0 end)::int indefinidos
       from (select vp.viagem_id, vp.tipo_viagem, vp.ocupa_vaga ocupa, true paciente, false indefinido
               from tra.viagem_passageiro vp where vp.viagem_id = any($1) and vp.situacao <> 'CANCELADO'
             union all
             select vp.viagem_id, a.tipo_viagem, a.ocupa_vaga, false, a.indefinido
               from tra.viagem_acompanhante a join tra.viagem_passageiro vp on vp.id = a.passageiro_id
              where vp.viagem_id = any($1) and vp.situacao <> 'CANCELADO') x
      group by viagem_id`,
    [viagens],
  );
  for (const l of r.rows) mapa.set(Number(l.viagem_id), { ida: l.ida, volta: l.volta, ocupadas: Math.max(l.ida, l.volta), pacientes: l.pacientes, indefinidos: l.indefinidos });
  return mapa;
}

/** Vagas necessárias por trecho para um paciente e seus acompanhantes. */
function vagasNecessarias(p: PassageiroEntrada) {
  let ida = 0;
  let volta = 0;
  const somar = (tipo: TipoViagem = 'IDA_VOLTA', ocupa = true) => {
    if (!ocupa) return;
    if (tipo !== 'VOLTA') ida++;
    if (tipo !== 'IDA') volta++;
  };
  somar(p.tipoViagem, p.ocupaVaga !== false);
  for (const a of p.acompanhantes ?? []) somar(a.tipoViagem, a.ocupaVaga !== false);
  return { ida, volta };
}

async function validarVagas(c: pg.PoolClient, viagem: any, p: PassageiroEntrada) {
  const cap = Number(viagem.vagas ?? 0);
  const atual = (await ocupacaoViagens(c, [viagem.id])).get(Number(viagem.id)) ?? { ida: 0, volta: 0 };
  const nec = vagasNecessarias(p);
  if (atual.ida + nec.ida > cap || atual.volta + nec.volta > cap) {
    const livres = Math.max(0, cap - Math.max(atual.ida, atual.volta));
    throw new ErroHttp(422, `Vagas insuficientes na viagem: ${livres} vaga(s) livre(s) para ${Math.max(nec.ida, nec.volta)} solicitada(s).`);
  }
}

async function validarPoltronas(c: pg.PoolClient, viagemId: number, poltronas: number[], cap: number) {
  const pedidas = poltronas.filter((x) => x != null);
  if (new Set(pedidas).size !== pedidas.length) throw new ErroHttp(422, 'A mesma poltrona foi informada mais de uma vez.');
  for (const n of pedidas) if (cap && n > cap) throw new ErroHttp(422, `Poltrona ${n} inexistente: o veículo possui ${cap} lugares.`);
  if (!pedidas.length) return;
  const r = await c.query(
    `select poltrona from tra.viagem_passageiro where viagem_id = $1 and situacao <> 'CANCELADO' and poltrona = any($2)
     union select a.poltrona from tra.viagem_acompanhante a join tra.viagem_passageiro vp on vp.id = a.passageiro_id
      where vp.viagem_id = $1 and vp.situacao <> 'CANCELADO' and a.poltrona = any($2)`,
    [viagemId, pedidas],
  );
  if (r.rows.length) throw new ErroHttp(422, `Poltrona(s) já ocupada(s): ${r.rows.map((x) => x.poltrona).join(', ')}.`);
}

// ---------------------------------------------------------------------------
// Disponibilidade (TR 1.2.40.12)
// ---------------------------------------------------------------------------

export interface DiaDisponivel {
  agendaId: number;
  data: string;
  diaSemana: number;
  horaSaida: string;
  vagas: number;
  ocupadas: number;
  livres: number;
  viagemId: number | null;
  situacaoViagem: string | null;
  feriado: string | null;
  disponivel: boolean;
  motivo: string | null;
  veiculo: string | null;
  proximo?: boolean;
}

/** Dias e horários das agendas da rota, com vagas livres, bloqueios por feriado e o próximo dia com vaga. */
export async function disponibilidadeRota(c: pg.PoolClient, rotaId: number, de?: string, dias = 45): Promise<DiaDisponivel[]> {
  const rota = (await c.query(`select * from tra.rota where id = $1`, [rotaId])).rows[0];
  if (!rota) throw new ErroHttp(404, 'Rota não encontrada.');
  const agora = agoraLocal();
  const inicio = de && de > agora.data ? de : agora.data;
  const fim = iso(new Date(paraData(inicio).getTime() + dias * DIA));
  const agendas = (
    await c.query(
      `select a.*, a.hora_saida::text hs, a.data_inicial::text di, a.data_final::text df, v.placa || ' ' || coalesce(v.modelo, '') veiculo
         from tra.agenda a join tra.veiculo v on v.id = a.veiculo_id
        where a.rota_id = $1 and a.ativo and a.data_inicial <= $3 and (a.data_final is null or a.data_final >= $2) order by a.hora_saida`,
      [rotaId, inicio, fim],
    )
  ).rows;
  const feriados = await feriadosQueAfetam(c, rota.abrangencia ?? (await abrangenciaDaRota(c, rota.municipio_destino_id)), inicio, fim);
  const viagens = (
    await c.query(`select id, agenda_id, data_saida::text data, situacao, vagas from tra.viagem where agenda_id = any($1) and data_saida between $2 and $3`, [agendas.map((a) => a.id), inicio, fim])
  ).rows;
  const ocup = await ocupacaoViagens(c, viagens.map((v) => Number(v.id)));
  const saida: DiaDisponivel[] = [];
  for (let t = paraData(inicio).getTime(); t <= paraData(fim).getTime(); t += DIA) {
    const d = new Date(t);
    const data = iso(d);
    for (const a of agendas) {
      if (data < a.di || (a.df && data > a.df)) continue;
      if (!(a.dias_semana ?? []).includes(String(d.getUTCDay()))) continue;
      const v = viagens.find((x) => Number(x.agenda_id) === Number(a.id) && x.data === data);
      const vagas = Number(v?.vagas ?? a.vagas);
      const ocupadas = v ? (ocup.get(Number(v.id))?.ocupadas ?? 0) : 0;
      const feriado = feriados.get(data) ?? null;
      const hora = hhmm(a.hs);
      let motivo: string | null = null;
      if (feriado) motivo = `Feriado: ${feriado}`;
      else if (v && ['CONCLUIDA', 'CANCELADA'].includes(v.situacao)) motivo = v.situacao === 'CANCELADA' ? 'Viagem cancelada' : 'Viagem concluída';
      else if (data === agora.data && hora <= agora.hora) motivo = 'Horário já passou';
      else if (a.antecedencia_minima_horas && new Date(`${data}T${hora}:00-03:00`).getTime() - Date.now() < a.antecedencia_minima_horas * 3_600_000)
        motivo = `Antecedência mínima de ${a.antecedencia_minima_horas} h`;
      else if (vagas - ocupadas <= 0) motivo = 'Sem vagas';
      saida.push({
        agendaId: Number(a.id),
        data,
        diaSemana: d.getUTCDay(),
        horaSaida: hora,
        vagas,
        ocupadas,
        livres: Math.max(0, vagas - ocupadas),
        viagemId: v ? Number(v.id) : null,
        situacaoViagem: v?.situacao ?? null,
        feriado,
        disponivel: !motivo,
        motivo,
        veiculo: a.veiculo,
      });
    }
  }
  const prox = saida.find((s) => s.disponivel);
  if (prox) prox.proximo = true;
  return saida;
}

// ---------------------------------------------------------------------------
// Agendamento e inclusão de passageiros
// ---------------------------------------------------------------------------

/** Obtém (ou cria) a viagem da agenda na data, travada para atualização. */
async function viagemDaAgenda(c: pg.PoolClient, agendaId: number, data: string) {
  const a = (await c.query(`select a.*, r.municipio_destino_id, r.local_destino_id, r.motivo_id, r.valor_viagem, r.condutor_id rota_condutor, r.local_embarque_id rota_embarque from tra.agenda a join tra.rota r on r.id = a.rota_id where a.id = $1`, [agendaId])).rows[0];
  if (!a || !a.ativo) throw new ErroHttp(404, 'Agenda de transporte não encontrada ou inativa.');
  await c.query(
    `insert into tra.viagem (agenda_id, rota_id, data_saida, hora_saida, veiculo_id, condutor_id, municipio_destino_id, local_destino_id, motivo_id, local_embarque_id, vagas, valor_viagem, situacao)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ABERTA') on conflict (agenda_id, data_saida) do nothing`,
    [agendaId, a.rota_id, data, a.hora_saida, a.veiculo_id, a.condutor_id ?? a.rota_condutor, a.municipio_destino_id, a.local_destino_id, a.motivo_id, a.local_embarque_id ?? a.rota_embarque, a.vagas, a.valor_viagem],
  );
  return (await c.query(`select * from tra.viagem where agenda_id = $1 and data_saida = $2 for update`, [agendaId, data])).rows[0];
}

async function inserirPassageiro(c: pg.PoolClient, viagem: any, p: PassageiroEntrada, u: Usuario | undefined, semAgendamento: boolean) {
  const pac = (await c.query(`select id, nome, situacao from cad.pessoa where id = $1`, [p.pacienteId])).rows[0];
  if (!pac) throw new ErroHttp(404, 'Paciente não encontrado.');
  if (pac.situacao === 'OBITO') throw new ErroHttp(422, 'Paciente com óbito registrado.');
  const dup = (await c.query(`select 1 from tra.viagem_passageiro where viagem_id = $1 and paciente_id = $2 and situacao <> 'CANCELADO'`, [viagem.id, p.pacienteId])).rowCount;
  if (dup) throw new ErroHttp(422, `${pac.nome} já está incluído(a) nesta viagem.`);
  for (const a of p.acompanhantes ?? []) {
    if (!a.indefinido && !a.pessoaId && !a.nome?.trim()) throw new ErroHttp(422, 'Informe o acompanhante ou marque a vaga como reservada (acompanhante a definir).');
  }
  if (p.tfdLaudoId) {
    const l = (await c.query(`select paciente_id, situacao_tratamento, numero from tfd.laudo where id = $1`, [p.tfdLaudoId])).rows[0];
    if (!l) throw new ErroHttp(404, 'Processo de TFD não encontrado.');
    if (Number(l.paciente_id) !== Number(p.pacienteId)) throw new ErroHttp(422, 'O processo de TFD informado é de outro paciente.');
    if (l.situacao_tratamento !== 'AUTORIZADO') throw new ErroHttp(422, `O tratamento do laudo ${l.numero} não está autorizado; o transporte é liberado após a autorização (TR 1.2.35.17).`);
  }
  await validarVagas(c, viagem, p);
  await validarPoltronas(c, viagem.id, [p.poltrona, ...(p.acompanhantes ?? []).map((a) => a.poltrona)].filter((x): x is number => x != null), Number(viagem.vagas ?? 0));
  const localId = p.localDestinoId ?? viagem.local_destino_id ?? null;
  const local = localId ? (await c.query(`select nome, municipio_id from tra.local_destino where id = $1`, [localId])).rows[0] : null;
  const r = await c.query(
    `insert into tra.viagem_passageiro (viagem_id, paciente_id, municipio_destino_id, local_destino_id, local_destino, motivo_id, local_embarque_id, hora_saida, horario_compromisso,
        poltrona, tipo_viagem, ocupa_vaga, necessidade, sem_agendamento, tfd_laudo_id, situacao, observacao, agendado_por)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [
      viagem.id,
      p.pacienteId,
      p.municipioDestinoId ?? local?.municipio_id ?? viagem.municipio_destino_id,
      localId,
      local?.nome ?? null,
      p.motivoId ?? viagem.motivo_id,
      p.localEmbarqueId ?? viagem.local_embarque_id,
      p.horaSaida ?? viagem.hora_saida,
      p.horarioCompromisso ?? null,
      p.poltrona ?? null,
      p.tipoViagem ?? 'IDA_VOLTA',
      p.ocupaVaga !== false,
      p.necessidade ?? 'NENHUMA',
      semAgendamento,
      p.tfdLaudoId ?? null,
      viagem.situacao === 'CONFIRMADA' ? 'CONFIRMADO' : 'AGENDADO',
      p.observacao ?? null,
      u?.id ?? null,
    ],
  );
  const id = Number(r.rows[0].id);
  const protocolo = `TR${String(viagem.data_saida).slice(2, 4)}${String(id).padStart(6, '0')}`;
  await c.query(`update tra.viagem_passageiro set protocolo = $2 where id = $1`, [id, protocolo]);
  for (const a of p.acompanhantes ?? []) await inserirAcompanhante(c, id, a);
  if (p.tfdLaudoId)
    await c.query(`insert into tfd.laudo_tramite (laudo_id, data_hora, acao, descricao, situacao, operador_id) values ($1, now(), 'Transporte agendado', $2, null, $3)`, [
      p.tfdLaudoId,
      `Viagem de ${fmtData(viagem.data_saida)} às ${hhmm(viagem.hora_saida)} - protocolo ${protocolo}.`,
      u?.id ?? null,
    ]);
  return { id, protocolo, viagemId: Number(viagem.id) };
}

async function inserirAcompanhante(c: pg.PoolClient, passageiroId: number, a: AcompanhanteEntrada) {
  let nome = a.nome?.trim().toUpperCase() || null;
  if (a.pessoaId && !nome) nome = (await c.query(`select nome from cad.pessoa where id = $1`, [a.pessoaId])).rows[0]?.nome ?? null;
  const indefinido = !!a.indefinido && !a.pessoaId && !nome;
  await c.query(
    `insert into tra.viagem_acompanhante (passageiro_id, indefinido, pessoa_id, nome, documento, parentesco, tipo_viagem, ocupa_vaga, poltrona) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [passageiroId, indefinido, a.pessoaId ?? null, indefinido ? null : nome, a.documento ?? null, a.parentesco ?? null, a.tipoViagem ?? 'IDA_VOLTA', a.ocupaVaga !== false, a.poltrona ?? null],
  );
}

/** Agendamento na agenda da rota: bloqueia feriados, controla as vagas e gera o protocolo (TR 1.2.40.12 a 1.2.40.18, 1.2.40.28). */
export async function agendarTransporte(c: pg.PoolClient, b: PassageiroEntrada & { agendaId: number; data: string }, u?: Usuario) {
  const disp = await disponibilidadeDia(c, b.agendaId, b.data);
  if (disp.feriado) throw new ErroHttp(422, `Rota bloqueada para agendamento em ${fmtData(b.data)}: feriado "${disp.feriado}" (TR 1.2.40.28).`);
  if (!disp.diaValido) throw new ErroHttp(422, 'A agenda da rota não possui saída nesta data.');
  const agora = agoraLocal();
  if (b.data < agora.data || (b.data === agora.data && disp.hora <= agora.hora)) throw new ErroHttp(422, 'Não é possível agendar para data/horário já passados.');
  const viagem = await viagemDaAgenda(c, b.agendaId, b.data);
  if (!['ABERTA', 'CONFIRMADA'].includes(viagem.situacao)) throw new ErroHttp(422, `Viagem ${viagem.situacao === 'CANCELADA' ? 'cancelada' : 'já concluída'}: não aceita novos agendamentos.`);
  return inserirPassageiro(c, viagem, b, u, false);
}

async function disponibilidadeDia(c: pg.PoolClient, agendaId: number, data: string) {
  const a = (await c.query(`select a.*, a.hora_saida::text hs, r.abrangencia, r.municipio_destino_id from tra.agenda a join tra.rota r on r.id = a.rota_id where a.id = $1`, [agendaId])).rows[0];
  if (!a) throw new ErroHttp(404, 'Agenda de transporte não encontrada.');
  const dia = paraData(data);
  const diaValido = (a.dias_semana ?? []).includes(String(dia.getUTCDay())) && data >= a.data_inicial && (!a.data_final || data <= a.data_final);
  const feriado = (await feriadosQueAfetam(c, a.abrangencia ?? (await abrangenciaDaRota(c, a.municipio_destino_id)), data, data)).get(data) ?? null;
  return { diaValido, feriado, hora: hhmm(a.hs) };
}

/** Viagem sem agendamento prévio: motivo, destino final, veículo, condutor, pacientes com destino e acompanhantes (TR 1.2.40.17). */
export async function criarViagemAvulsa(
  c: pg.PoolClient,
  b: {
    dataSaida: string;
    horaSaida: string;
    rotaId?: number | null;
    motivoId: number;
    municipioDestinoId: number;
    localDestinoId?: number | null;
    veiculoId: number;
    condutorId: number;
    localEmbarqueId?: number | null;
    valorViagem?: number | null;
    observacao?: string | null;
    confirmar?: boolean;
    passageiros?: PassageiroEntrada[];
  },
  u?: Usuario,
) {
  const v = (await c.query(`select passageiros, situacao from tra.veiculo where id = $1`, [b.veiculoId])).rows[0];
  if (!v) throw new ErroHttp(404, 'Veículo não encontrado.');
  if (v.situacao !== 'ATIVO') throw new ErroHttp(422, 'Veículo em manutenção ou baixado.');
  await validarCondutor(c, b.condutorId, b.dataSaida);
  const rota = b.rotaId ? (await c.query(`select valor_viagem from tra.rota where id = $1`, [b.rotaId])).rows[0] : null;
  const r = await c.query(
    `insert into tra.viagem (rota_id, data_saida, hora_saida, veiculo_id, condutor_id, municipio_destino_id, local_destino_id, motivo_id, local_embarque_id, vagas, valor_viagem, sem_agendamento, situacao, observacao)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,'ABERTA',$12) returning *`,
    [b.rotaId ?? null, b.dataSaida, b.horaSaida, b.veiculoId, b.condutorId, b.municipioDestinoId, b.localDestinoId ?? null, b.motivoId, b.localEmbarqueId ?? null, v.passageiros, b.valorViagem ?? rota?.valor_viagem ?? null, b.observacao ?? null],
  );
  let viagem = r.rows[0];
  if (b.confirmar || b.passageiros?.length) viagem = await confirmarViagem(c, Number(viagem.id), 'Viagem sem agendamento prévio confirmada na inclusão.', u);
  const incluidos = [];
  for (const p of b.passageiros ?? []) incluidos.push(await inserirPassageiro(c, viagem, p, u, true));
  return { id: Number(viagem.id), passageiros: incluidos };
}

async function validarCondutor(c: pg.PoolClient, condutorId: number | null | undefined, data: string) {
  if (!condutorId) return;
  const d = (await c.query(`select nome, cnh_validade::text validade, ativo from tra.condutor where id = $1`, [condutorId])).rows[0];
  if (!d) throw new ErroHttp(404, 'Condutor não encontrado.');
  if (!d.ativo) throw new ErroHttp(422, `Condutor ${d.nome} inativo.`);
  if (d.validade && d.validade < data) throw new ErroHttp(422, `A CNH do condutor ${d.nome} venceu em ${fmtData(d.validade)}.`);
}

/** Inclusão de paciente sem agendamento prévio: somente após a confirmação da viagem (TR 1.2.40.19). */
export async function incluirPassageiro(c: pg.PoolClient, viagemId: number, p: PassageiroEntrada, u?: Usuario) {
  const viagem = (await c.query(`select * from tra.viagem where id = $1 for update`, [viagemId])).rows[0];
  if (!viagem) throw new ErroHttp(404, 'Viagem não encontrada.');
  if (['CONCLUIDA', 'CANCELADA'].includes(viagem.situacao)) throw new ErroHttp(422, 'Viagem encerrada: não aceita novos passageiros.');
  if (viagem.situacao !== 'CONFIRMADA') throw new ErroHttp(422, 'Confirme a viagem antes de incluir pacientes sem agendamento prévio (TR 1.2.40.19).');
  return inserirPassageiro(c, viagem, p, u, true);
}

export async function incluirAcompanhante(c: pg.PoolClient, passageiroId: number, a: AcompanhanteEntrada) {
  const vp = (await c.query(`select vp.*, v.vagas, v.situacao sv, v.id vid from tra.viagem_passageiro vp join tra.viagem v on v.id = vp.viagem_id where vp.id = $1 for update of v`, [passageiroId])).rows[0];
  if (!vp) throw new ErroHttp(404, 'Passageiro não encontrado.');
  if (['CONCLUIDA', 'CANCELADA'].includes(vp.sv)) throw new ErroHttp(422, 'Viagem encerrada.');
  if (!a.indefinido && !a.pessoaId && !a.nome?.trim()) throw new ErroHttp(422, 'Informe o acompanhante ou marque a vaga como reservada.');
  const nec: PassageiroEntrada = { pacienteId: vp.paciente_id, ocupaVaga: false, acompanhantes: [a] };
  await validarVagas(c, { id: vp.vid, vagas: vp.vagas }, nec);
  if (a.poltrona) await validarPoltronas(c, vp.vid, [a.poltrona], Number(vp.vagas ?? 0));
  await inserirAcompanhante(c, passageiroId, a);
}

// ---------------------------------------------------------------------------
// Confirmação, cancelamento, presença e fechamento
// ---------------------------------------------------------------------------

/** Confirmação da viagem (mesmo sem lotação do veículo ou por qualquer outro motivo) (TR 1.2.40.19). */
export async function confirmarViagem(c: pg.PoolClient, id: number, observacao: string | null | undefined, u?: Usuario) {
  const v = (await c.query(`select * from tra.viagem where id = $1 for update`, [id])).rows[0];
  if (!v) throw new ErroHttp(404, 'Viagem não encontrada.');
  if (v.situacao !== 'ABERTA') throw new ErroHttp(422, 'Somente viagens abertas podem ser confirmadas.');
  if (!v.condutor_id) throw new ErroHttp(422, 'Informe o condutor da viagem antes de confirmá-la.');
  await validarCondutor(c, v.condutor_id, String(v.data_saida));
  await c.query(`update tra.viagem_passageiro set situacao = 'CONFIRMADO' where viagem_id = $1 and situacao = 'AGENDADO'`, [id]);
  return (
    await c.query(
      `update tra.viagem set situacao = 'CONFIRMADA', confirmada_em = now(), confirmada_por = $2, observacao = concat_ws(' | ', observacao, $3::text) where id = $1 returning *`,
      [id, u?.id ?? null, observacao || null],
    )
  ).rows[0];
}

export async function cancelarViagem(c: pg.PoolClient, id: number, motivo: string) {
  const v = (await c.query(`select situacao from tra.viagem where id = $1 for update`, [id])).rows[0];
  if (!v) throw new ErroHttp(404, 'Viagem não encontrada.');
  if (['CONCLUIDA', 'CANCELADA'].includes(v.situacao)) throw new ErroHttp(422, 'Viagem já encerrada.');
  await c.query(`update tra.viagem_passageiro set situacao = 'CANCELADO', observacao = concat_ws(' | ', observacao, $2::text) where viagem_id = $1 and situacao <> 'CANCELADO'`, [id, `Viagem cancelada: ${motivo}`]);
  await c.query(`update tra.viagem set situacao = 'CANCELADA', motivo_cancelamento = $2 where id = $1`, [id, motivo]);
}

/** Registro de presença e ausência dos pacientes (base do relatório de absenteísmo, TR 1.2.40.29.2). */
export async function registrarPresenca(c: pg.PoolClient, viagemId: number, itens: { passageiroId: number; presente: boolean; observacao?: string | null }[]) {
  const v = (await c.query(`select situacao from tra.viagem where id = $1 for update`, [viagemId])).rows[0];
  if (!v) throw new ErroHttp(404, 'Viagem não encontrada.');
  if (v.situacao === 'CANCELADA') throw new ErroHttp(422, 'Viagem cancelada.');
  for (const i of itens) {
    if (!i.presente && !i.observacao?.trim()) throw new ErroHttp(422, 'Informe a observação sobre a ausência do paciente.');
    await c.query(`update tra.viagem_passageiro set situacao = $3, observacao_ausencia = $4 where id = $1 and viagem_id = $2 and situacao <> 'CANCELADO'`, [
      i.passageiroId,
      viagemId,
      i.presente ? 'PRESENTE' : 'FALTA',
      i.presente ? null : i.observacao,
    ]);
  }
}

/** Valores da prestação de contas: adiantado, despesas e saldo (TR 1.2.40.22). */
export async function prestacaoContas(c: pg.PoolClient | pg.Pool, viagemId: number) {
  const r = (
    await c.query(
      `select coalesce((select sum(valor) from tra.viagem_adiantamento where viagem_id = $1), 0)::numeric adiantado,
              coalesce((select sum(valor_total) from tra.viagem_despesa where viagem_id = $1), 0)::numeric despesas`,
      [viagemId],
    )
  ).rows[0];
  const adiantado = Number(r.adiantado);
  const despesas = Number(r.despesas);
  return { adiantado, despesas, saldo: Math.round((adiantado - despesas) * 100) / 100 };
}

export interface DespesaEntrada {
  despesaId: number;
  data: string;
  descricao?: string | null;
  quantidade: number;
  valorUnitario: number;
  documento?: string | null;
}

export async function lancarDespesa(c: pg.PoolClient, viagemId: number, d: DespesaEntrada) {
  await c.query(`insert into tra.viagem_despesa (viagem_id, despesa_id, data, descricao, quantidade, valor_unitario, valor_total, documento) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    viagemId,
    d.despesaId,
    d.data,
    d.descricao ?? null,
    d.quantidade,
    d.valorUnitario,
    Math.round(d.quantidade * d.valorUnitario * 100) / 100,
    d.documento ?? null,
  ]);
}

/**
 * Fechamento: data/hora de chegada, km final e despesas; impede concluir com acompanhantes indefinidos;
 * calcula o custo do transporte de cada paciente e atualiza o hodômetro do veículo (TR 1.2.40.9, 1.2.40.20, 1.2.40.22).
 */
export async function fecharViagem(
  c: pg.PoolClient,
  id: number,
  b: { dataChegada: string; horaChegada: string; kmInicial?: number | null; kmFinal: number; despesas?: DespesaEntrada[] },
  u?: Usuario,
) {
  const v = (await c.query(`select *, data_saida::text ds from tra.viagem where id = $1 for update`, [id])).rows[0];
  if (!v) throw new ErroHttp(404, 'Viagem não encontrada.');
  if (v.situacao !== 'CONFIRMADA') throw new ErroHttp(422, v.situacao === 'ABERTA' ? 'Confirme a viagem antes de fechá-la.' : 'Viagem já encerrada.');
  if (v.ds > agoraLocal().data) throw new ErroHttp(422, 'A viagem ainda não ocorreu: o fechamento só é permitido a partir da data de saída.');
  const indef = (
    await c.query(
      `select p.nome from tra.viagem_acompanhante a join tra.viagem_passageiro vp on vp.id = a.passageiro_id join cad.pessoa p on p.id = vp.paciente_id
        where vp.viagem_id = $1 and vp.situacao <> 'CANCELADO' and a.indefinido`,
      [id],
    )
  ).rows;
  if (indef.length)
    throw new ErroHttp(422, `Não é possível concluir a viagem: identifique os acompanhantes indefinidos de ${[...new Set(indef.map((x) => x.nome))].join(', ')} (TR 1.2.40.20).`);
  const kmInicial = b.kmInicial ?? v.km_inicial;
  if (kmInicial == null) throw new ErroHttp(422, 'Informe o km inicial do veículo.');
  if (b.kmFinal < kmInicial) throw new ErroHttp(422, 'O km final não pode ser menor que o km inicial.');
  if (`${b.dataChegada} ${b.horaChegada}` < `${v.ds} ${hhmm(v.hora_saida)}`) throw new ErroHttp(422, 'A chegada não pode ser anterior à saída.');
  for (const d of b.despesas ?? []) await lancarDespesa(c, id, d);
  // Pacientes sem registro de ausência são considerados transportados.
  await c.query(`update tra.viagem_passageiro set situacao = 'PRESENTE' where viagem_id = $1 and situacao in ('AGENDADO','CONFIRMADO')`, [id]);
  const contas = await prestacaoContas(c, id);
  const transportados = Number((await c.query(`select count(*)::int n from tra.viagem_passageiro where viagem_id = $1 and situacao = 'PRESENTE'`, [id])).rows[0].n);
  const base = v.valor_viagem != null ? Number(v.valor_viagem) : contas.despesas;
  const custo = transportados ? Math.round((base / transportados) * 100) / 100 : null;
  await c.query(`update tra.viagem_passageiro set custo = case when situacao = 'PRESENTE' then $2::numeric else null end where viagem_id = $1`, [id, custo]);
  await c.query(
    `update tra.viagem set situacao = 'CONCLUIDA', data_chegada = $2, hora_chegada = $3, km_inicial = $4, km_final = $5, custo_paciente = $6, fechada_em = now(), fechada_por = $7 where id = $1`,
    [id, b.dataChegada, b.horaChegada, kmInicial, b.kmFinal, custo, u?.id ?? null],
  );
  await c.query(`update tra.veiculo set km_atual = greatest(coalesce(km_atual, 0), $2) where id = $1`, [v.veiculo_id, b.kmFinal]);
  return { ...contas, transportados, custoPaciente: custo, kmRodados: b.kmFinal - kmInicial };
}
