// Regras do atendimento: recepção, senhas, triagem, produção automática, prescrições,
// exames, encaminhamentos e encerramento.
import type pg from 'pg';
import { consultarUm } from '../../db/pool.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { lancarProducao } from '../faturamento/producao.js';
import { incluirListaEspera } from '../agendamento/servico.js';

export const PRIORIDADE_RISCO: Record<string, number> = { VERMELHO: 1, LARANJA: 2, AMARELO: 3, VERDE: 4, AZUL: 5 };

/** Senha sequencial diária por unidade e prefixo da fila (TR 1.2.15.27). */
export async function proximaSenha(c: pg.PoolClient, unidadeId: number, prefixo: string) {
  const r = await c.query(
    `insert into amb.senha_sequencia (unidade_id, prefixo, data, ultimo) values ($1, $2, current_date, 1)
     on conflict (unidade_id, prefixo, data) do update set ultimo = amb.senha_sequencia.ultimo + 1 returning ultimo`,
    [unidadeId, prefixo],
  );
  return `${prefixo}${String(r.rows[0].ultimo).padStart(3, '0')}`;
}

export function calcularImc(peso?: number | null, alturaCm?: number | null) {
  if (!peso || !alturaCm) return null;
  const m = alturaCm / 100;
  return Math.round((peso / (m * m)) * 100) / 100;
}

/**
 * Escore de risco de Framingham (D'Agostino, 2008 - escore com IMC, sem exames laboratoriais quando
 * colesterol não informado). Retorna risco cardiovascular em 10 anos (TR 1.2.32.23).
 */
export function framingham(d: { sexo: string; idade: number; pas: number; tratado?: boolean; fumante?: boolean; diabetico?: boolean; colesterol?: number | null; hdl?: number | null; imc?: number | null }) {
  const ln = Math.log;
  let soma: number;
  let s0: number;
  let media: number;
  if (d.colesterol && d.hdl) {
    if (d.sexo === 'F') {
      soma = 2.32888 * ln(d.idade) + 1.20904 * ln(d.colesterol) - 0.70833 * ln(d.hdl) + (d.tratado ? 2.82263 : 2.76157) * ln(d.pas) + (d.fumante ? 0.52873 : 0) + (d.diabetico ? 0.69154 : 0);
      s0 = 0.95012;
      media = 26.1931;
    } else {
      soma = 3.06117 * ln(d.idade) + 1.1237 * ln(d.colesterol) - 0.93263 * ln(d.hdl) + (d.tratado ? 1.99881 : 1.93303) * ln(d.pas) + (d.fumante ? 0.65451 : 0) + (d.diabetico ? 0.57367 : 0);
      s0 = 0.88936;
      media = 23.9802;
    }
  } else if (d.imc) {
    if (d.sexo === 'F') {
      soma = 2.72107 * ln(d.idade) + 0.51125 * ln(d.imc) + (d.tratado ? 2.88267 : 2.81291) * ln(d.pas) + (d.fumante ? 0.61868 : 0) + (d.diabetico ? 0.77763 : 0);
      s0 = 0.94833;
      media = 26.0145;
    } else {
      soma = 3.11296 * ln(d.idade) + 0.79277 * ln(d.imc) + (d.tratado ? 1.92672 : 1.85508) * ln(d.pas) + (d.fumante ? 0.70953 : 0) + (d.diabetico ? 0.5316 : 0);
      s0 = 0.88431;
      media = 23.9388;
    }
  } else return null;
  const risco = Math.round((1 - Math.pow(s0, Math.exp(soma - media))) * 1000) / 10;
  return { percentual: risco, classificacao: risco < 10 ? 'BAIXO' : risco < 20 ? 'MODERADO' : 'ALTO' };
}

/** Verifica restrições de horário de trabalho do operador para registrar atendimento (TR 1.1.1.32.1). */
export function conferirHorarioTrabalho(u: Usuario) {
  const agora = new Date();
  const local = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  if (u.diasTrabalho?.length && !u.diasTrabalho.includes(String(local.getDay())))
    throw new ErroHttp(403, 'Registro de atendimento bloqueado: fora dos dias de trabalho do profissional.');
  if (u.horarioInicio && u.horarioFim) {
    const hm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
    if (hm < u.horarioInicio.slice(0, 5) || hm > u.horarioFim.slice(0, 5))
      throw new ErroHttp(403, `Registro de atendimento bloqueado: fora do horário de trabalho (${u.horarioInicio.slice(0, 5)} às ${u.horarioFim.slice(0, 5)}).`);
  }
}

export async function registrarSinaisVitais(c: pg.PoolClient, atendimento: any, sv: Record<string, any>, profissionalId: number | null) {
  const campos = [
    'peso', 'altura', 'cintura', 'abdomen', 'quadril', 'perimetro_cefalico', 'perimetro_toracico', 'pa_sistolica', 'pa_diastolica', 'temperatura',
    'frequencia_cardiaca', 'frequencia_respiratoria', 'saturacao', 'glicemia', 'glicemia_momento', 'colesterol_total', 'hdl', 'fumante',
    'altura_uterina', 'bcf', 'semanas_gestacao', 'dor', 'observacao',
  ];
  const dados: Record<string, any> = {};
  for (const k of campos) if (sv[k] !== undefined && sv[k] !== null && sv[k] !== '') dados[k] = sv[k];
  if (!Object.keys(dados).length) return null;
  dados.imc = calcularImc(dados.peso, dados.altura);
  if (dados.cintura && dados.quadril) dados.rcq = Math.round((dados.cintura / dados.quadril) * 100) / 100;
  const nomes = Object.keys(dados);
  const r = await c.query(
    `insert into amb.sinais_vitais (paciente_id, atendimento_id, data_hora, profissional_id, ${nomes.join(',')})
     values ($1,$2,now(),$3,${nomes.map((_, i) => `$${i + 4}`).join(',')}) returning *`,
    [atendimento.paciente_id, atendimento.id, profissionalId, ...nomes.map((n) => dados[n])],
  );
  // Produção automática da aferição de pressão e do teste de glicemia (TR 1.2.17.19, 1.2.17.20).
  const base = { data: new Date(), unidadeId: atendimento.unidade_id, profissionalId, pacienteId: atendimento.paciente_id, referencia: `atendimento:${atendimento.id}` };
  if (dados.pa_sistolica && dados.pa_diastolica) await lancarProducao(c, { ...base, procedimentoCodigo: '0301100039', origem: 'AFERICAO_PA' });
  if (dados.glicemia) await lancarProducao(c, { ...base, procedimentoCodigo: '0214010015', origem: 'GLICEMIA' });
  return r.rows[0];
}

export async function proximoNumero(c: pg.PoolClient, tabela: 'amb.prescricao' | 'amb.solicitacao_exame', prefixo: string) {
  const ano = new Date().getFullYear();
  const r = await c.query(`select count(*)::int + 1 n from ${tabela} where extract(year from criado_em) = $1`, [ano]);
  let n = r.rows[0].n;
  while ((await c.query(`select 1 from ${tabela} where numero = $1`, [`${prefixo}${ano}${String(n).padStart(6, '0')}`])).rowCount) n++;
  return `${prefixo}${ano}${String(n).padStart(6, '0')}`;
}

/** Alergia a princípio ativo do medicamento (TR 1.2.25.9, 1.2.32.50). */
export async function alergiasConflitantes(c: pg.PoolClient | pg.Pool, pacienteId: number, produtoIds: number[]) {
  if (!produtoIds.length) return [];
  return (
    await c.query(
      `select pr.id produto_id, pr.nome produto, a.substancia, a.gravidade from far.produto pr
         join cad.pessoa_alergia a on a.pessoa_id = $1 and a.tipo = 'MEDICAMENTO'
          and ((a.dcb_id is not null and a.dcb_id = pr.dcb_id)
               or cad.fn_normalizar(coalesce(pr.principio_ativo, '') || ' ' || pr.nome) like '%' || cad.fn_normalizar(a.substancia) || '%')
        where pr.id = any($2)`,
      [pacienteId, produtoIds],
    )
  ).rows;
}

const TIPO_RECEITA_PRODUTO = `coalesce((select tipo_receita from far.produto where id = $1), 'BASICA')`;

export interface ItemPrescricao {
  produtoId?: number | null;
  descricao?: string;
  quantidade?: number;
  posologia?: string;
  via?: string;
  dose?: string;
  intervaloHoras?: number;
  duracaoDias?: number;
  usoContinuo?: boolean;
  tipoReceita?: string;
}

/**
 * Cria as receitas do atendimento separando os medicamentos por tipo de receita
 * (simples, controle especial, notificações, antimicrobianos) (TR 1.2.32.54).
 */
export async function prescrever(
  c: pg.PoolClient,
  at: { id: number | null; paciente_id: number; unidade_id: number },
  profissionalId: number | null,
  itens: ItemPrescricao[],
  opcoes: { usoInterno?: boolean; orientacoes?: string; confirmarAlergia?: boolean },
) {
  const conflitos = await alergiasConflitantes(c, at.paciente_id, itens.map((i) => i.produtoId).filter(Boolean) as number[]);
  if (conflitos.length && !opcoes.confirmarAlergia) {
    throw new ErroHttp(409, `Paciente com restrição alérgica: ${conflitos.map((x) => `${x.produto} (${x.substancia})`).join('; ')}.`, { alergias: conflitos, exigeConfirmacao: true });
  }
  const grupos = new Map<string, ItemPrescricao[]>();
  for (const i of itens) {
    const tipo = i.tipoReceita ?? (i.produtoId ? (await c.query(`select ${TIPO_RECEITA_PRODUTO} t`, [i.produtoId])).rows[0].t : 'BASICA');
    grupos.set(tipo, [...(grupos.get(tipo) ?? []), i]);
  }
  const receitas = [];
  for (const [tipo, lista] of grupos) {
    const validadeDias =
      Math.min(
        ...(await Promise.all(
          lista.map(async (i) => (i.produtoId ? ((await c.query(`select validade_receita_dias v from far.produto where id = $1`, [i.produtoId])).rows[0]?.v ?? null) : null)),
        )).filter((v): v is number => v != null),
        { BASICA: 180, BRANCA_C: 30, AZUL_B: 30, AMARELA_A: 30, ANTIMICROBIANO: 10, OUTROS: 180 }[tipo] ?? 180,
      );
    const numero = await proximoNumero(c, 'amb.prescricao', 'R');
    const rec = (
      await c.query(
        `insert into amb.prescricao (numero, paciente_id, atendimento_id, profissional_id, unidade_id, data, tipo_receita, validade, uso_interno, situacao, orientacoes)
         values ($1,$2,$3,$4,$5,current_date,$6,current_date + $7::int,$8,'ABERTA',$9) returning *`,
        [numero, at.paciente_id, at.id, profissionalId, at.unidade_id, tipo, validadeDias, !!opcoes.usoInterno, opcoes.orientacoes ?? null],
      )
    ).rows[0];
    for (const i of lista) {
      const desc = i.descricao ?? (i.produtoId ? (await c.query(`select nome || coalesce(' ' || concentracao, '') n from far.produto where id = $1`, [i.produtoId])).rows[0]?.n : null);
      await c.query(
        `insert into amb.prescricao_item (prescricao_id, produto_id, descricao, quantidade, posologia, via, dose, intervalo_horas, duracao_dias, uso_continuo, quantidade_dispensada, reservado)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11)`,
        [rec.id, i.produtoId ?? null, desc, i.quantidade ?? null, i.posologia ?? null, i.via ?? 'ORAL', i.dose ?? null, i.intervaloHoras ?? null, i.duracaoDias ?? null, !!i.usoContinuo, !!i.produtoId],
      );
    }
    receitas.push(rec);
  }
  return receitas;
}

/**
 * Requisição de exames separada automaticamente por grupo de procedimentos para
 * direcionamento ao prestador (TR 1.2.32.7, 1.2.32.76), com alertas de repetição
 * e absenteísmo e justificativa acima do limite (TR 1.2.32.37 a 1.2.32.39).
 */
export async function requisitarExames(
  c: pg.PoolClient,
  at: { id: number | null; paciente_id: number; unidade_id: number; tipo_unidade?: string },
  profissionalId: number | null,
  itens: { procedimentoId: number; material?: string; estrutura?: string; quantidade?: number }[],
  opcoes: { dadosClinicos?: string; justificativa?: string; prioridade?: string; usoInterno?: boolean; confirmarAvisos?: boolean },
) {
  if (!itens.length) throw new ErroHttp(422, 'Selecione ao menos um exame.');
  const limite = await parametro<number>('exames.limite_sem_justificativa', 10);
  if (itens.length > limite && !opcoes.justificativa?.trim())
    throw new ErroHttp(422, `Informe a justificativa: a solicitação tem ${itens.length} exames, acima do limite de ${limite} definido pela Secretaria.`, { justificativa: 'Obrigatória.' });
  const avisos: string[] = [];
  const repetidos = (
    await c.query(
      `select pr.nome, s.situacao from amb.solicitacao_exame_item s join amb.solicitacao_exame r on r.id = s.solicitacao_id join cad.procedimento pr on pr.id = s.procedimento_id
        where r.paciente_id = $1 and s.procedimento_id = any($2) and s.situacao in ('REQUISITADO','AGENDADO','COLETADO')`,
      [at.paciente_id, itens.map((i) => i.procedimentoId)],
    )
  ).rows;
  for (const r of repetidos) avisos.push(`${r.nome} já ${r.situacao === 'REQUISITADO' ? 'requisitado' : r.situacao === 'AGENDADO' ? 'agendado' : 'coletado'} para o paciente.`);
  const faltas = (await c.query(`select count(*)::int n from age.agendamento where paciente_id = $1 and situacao in ('FALTA','ATRASO') and data > current_date - 365`, [at.paciente_id])).rows[0].n;
  if (faltas) avisos.push(`Paciente com ${faltas} registro(s) de absenteísmo (falta/atraso) nos últimos 12 meses.`);
  if (avisos.length && !opcoes.confirmarAvisos) throw new ErroHttp(409, avisos.join(' '), { avisos, exigeConfirmacao: true });

  const grupos = new Map<string, typeof itens>();
  for (const i of itens) {
    const proc = (await c.query(`select codigo from cad.procedimento where id = $1`, [i.procedimentoId])).rows[0];
    const chave = proc?.codigo?.slice(0, 4) ?? '0000';
    grupos.set(chave, [...(grupos.get(chave) ?? []), i]);
  }
  const requisicoes = [];
  for (const [, lista] of grupos) {
    const numero = await proximoNumero(c, 'amb.solicitacao_exame', 'X');
    const req = (
      await c.query(
        `insert into amb.solicitacao_exame (numero, paciente_id, atendimento_id, profissional_id, unidade_id, data, dados_clinicos, justificativa, prioridade, uso_interno, origem_upa, situacao)
         values ($1,$2,$3,$4,$5,current_date,$6,$7,$8,$9,$10,'REQUISITADO') returning *`,
        [numero, at.paciente_id, at.id, profissionalId, at.unidade_id, opcoes.dadosClinicos ?? null, opcoes.justificativa ?? null, opcoes.prioridade ?? 'AZUL', !!opcoes.usoInterno, at.tipo_unidade === 'UPA'],
      )
    ).rows[0];
    for (const i of lista) {
      await c.query(
        `insert into amb.solicitacao_exame_item (solicitacao_id, procedimento_id, material, estrutura, quantidade, situacao) values ($1,$2,$3,$4,$5,'REQUISITADO')`,
        [req.id, i.procedimentoId, i.material ?? null, i.estrutura ?? null, i.quantidade ?? 1],
      );
    }
    requisicoes.push(req);
  }
  return { requisicoes, avisos };
}

/** Encaminhamento pronto para agendamento/regulação após o atendimento (TR 1.2.32.71). */
export async function encaminhar(c: pg.PoolClient, at: { id: number | null; paciente_id: number; unidade_id: number }, profissionalId: number | null, e: Record<string, any>) {
  const enc = (
    await c.query(
      `insert into amb.encaminhamento (paciente_id, atendimento_id, profissional_id, data, tipo_encaminhamento_id, especialidade_id, subespecialidade, urgencia,
                                       prioritario, justificativa_prioridade, investigacao, diagnostico, cid_id, referencia, situacao)
       values ($1,$2,$3,current_date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDENTE') returning *`,
      [
        at.paciente_id,
        at.id,
        profissionalId,
        e.tipoEncaminhamentoId ?? null,
        e.especialidadeId ?? null,
        e.subespecialidade ?? null,
        e.urgencia ?? 'AZUL',
        !!e.prioritario,
        e.justificativaPrioridade ?? null,
        e.investigacao ?? null,
        e.diagnostico ?? null,
        e.cidId ?? null,
        e.referencia ?? null,
      ],
    )
  ).rows[0];
  if (e.especialidadeId) {
    const esp = (await c.query(`select regulada from cad.especialidade where id = $1`, [e.especialidadeId])).rows[0];
    await incluirListaEspera(c, {
      pacienteId: at.paciente_id,
      especialidadeId: e.especialidadeId,
      unidadeSolicitanteId: at.unidade_id,
      profissionalSolicitanteId: profissionalId,
      origem: 'ENCAMINHAMENTO',
      justificativa: [e.diagnostico, e.justificativaPrioridade].filter(Boolean).join(' - ') || null || undefined,
      regulada: esp?.regulada || !!e.prioritario,
      prioridade: e.urgencia ?? 'AZUL',
      encaminhamentoId: enc.id,
    });
    await c.query(`update amb.encaminhamento set situacao = 'LISTA_ESPERA' where id = $1`, [enc.id]);
  }
  return enc;
}

/** Encerra o atendimento: produção da consulta, procedimentos e aviso de agravos (TR 1.2.32.18, 1.2.32.28). */
export async function finalizar(c: pg.PoolClient, atendimentoId: number, b: { desfecho: string; procedimentos?: { procedimentoId: number; quantidade?: number }[]; retornoDias?: number }, u: Usuario) {
  const at = (await c.query(`select * from amb.atendimento where id = $1 for update`, [atendimentoId])).rows[0];
  if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
  if (['FINALIZADO', 'CANCELADO', 'NAO_ATENDIDO'].includes(at.situacao)) throw new ErroHttp(409, 'Atendimento já encerrado.');
  const observacao = b.desfecho === 'OBSERVACAO' || b.desfecho === 'OBSERVACAO_LONGA';
  const profissionalId = at.profissional_id ?? u.profissionalId;
  const cid = at.cid_id ? (await c.query(`select codigo, notificavel from cad.cid where id = $1`, [at.cid_id])).rows[0] : null;
  const base = { data: new Date(), unidadeId: at.unidade_id, profissionalId, pacienteId: at.paciente_id, cidCodigo: cid?.codigo, carater: at.carater, referencia: `atendimento:${at.id}` };

  if (!observacao) {
    const esp = at.especialidade_id ? (await c.query(`select procedimento_id from cad.especialidade where id = $1`, [at.especialidade_id])).rows[0] : null;
    const procConsulta = esp?.procedimento_id ?? (at.tipo_unidade === 'UPA' ? (await c.query(`select id from cad.procedimento where codigo = '0301060096'`)).rows[0]?.id : null);
    if (procConsulta) await lancarProducao(c, { ...base, procedimentoId: procConsulta, origem: at.tipo_unidade === 'ODONTOLOGIA' ? 'ODONTOLOGIA' : 'ATENDIMENTO' });
  }
  for (const p of b.procedimentos ?? []) await lancarProducao(c, { ...base, procedimentoId: p.procedimentoId, quantidade: p.quantidade, origem: 'PROCEDIMENTO' });

  // Agravos de notificação compulsória geram aviso automático à Vigilância (TR 1.2.32.28).
  const cids = [at.cid_id, ...((at.cids_secundarios as number[] | null) ?? [])].filter(Boolean);
  if (cids.length) {
    const notif = (await c.query(`select id from cad.cid where id = any($1) and notificavel`, [cids])).rows;
    for (const n of notif) {
      const ja = (await c.query(`select 1 from amb.notificacao_agravo where atendimento_id = $1 and cid_id = $2`, [at.id, n.id])).rowCount;
      if (!ja)
        await c.query(
          `insert into amb.notificacao_agravo (paciente_id, atendimento_id, cid_id, unidade_id, profissional_id, data_hora, situacao) values ($1,$2,$3,$4,$5,now(),'PENDENTE')`,
          [at.paciente_id, at.id, n.id, at.unidade_id, profissionalId],
        );
    }
  }
  await c.query(
    `update amb.atendimento set desfecho = $2, situacao = $3::varchar, fim_em = case when $3::varchar = 'FINALIZADO' then now() else fim_em end,
            observacao_inicio = case when $3::varchar = 'EM_OBSERVACAO' then coalesce(observacao_inicio, now()) else observacao_inicio end,
            observacao_fim = case when $3::varchar = 'FINALIZADO' and observacao_inicio is not null then now() else observacao_fim end,
            retorno_dias = $4, profissional_id = coalesce(profissional_id, $5) where id = $1`,
    [at.id, b.desfecho, observacao ? 'EM_OBSERVACAO' : 'FINALIZADO', b.retornoDias ?? null, profissionalId],
  );
  if (at.agendamento_id && !observacao) await c.query(`update age.agendamento set situacao = 'ATENDIDO' where id = $1`, [at.agendamento_id]);
  // Exames e receitas ficam prontos para regulação/agendamento e dispensação ao confirmar o atendimento.
  if (!observacao) {
    const itensExame = (
      await c.query(
        `select i.id, i.procedimento_id, s.prioridade from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id
          where s.atendimento_id = $1 and not s.uso_interno and i.situacao = 'REQUISITADO'
            and not exists (select 1 from age.lista_espera l where l.solicitacao_item_id = i.id)`,
        [at.id],
      )
    ).rows;
    if (await parametro<boolean>('exames.lista_espera_automatica', true)) {
      for (const it of itensExame) {
        await incluirListaEspera(c, {
          pacienteId: at.paciente_id,
          procedimentoId: it.procedimento_id,
          unidadeSolicitanteId: at.unidade_id,
          profissionalSolicitanteId: profissionalId,
          origem: 'EXAME',
          regulada: it.prioridade !== 'AZUL',
          prioridade: it.prioridade,
          solicitacaoItemId: it.id,
        });
      }
    }
  }
  return (await c.query(`select * from amb.atendimento where id = $1`, [at.id])).rows[0];
}

export async function atendimentoOuErro(id: number) {
  const a = await consultarUm(`select * from amb.atendimento where id = $1`, [id]);
  if (!a) throw new ErroHttp(404, 'Atendimento não encontrado.');
  return a;
}
