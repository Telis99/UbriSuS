// Regras do laboratório: recepção das requisições (prontuário ou externas), previsão de entrega,
// presença, coleta com recipientes e baixa de materiais, digitação com referências/alertas/Delta-Check,
// liberação (assinatura) por profissional autorizado, entrega e ocorrências (TR 1.2.47).
import type pg from 'pg';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { conferirSenha } from '../../seguranca/senha.js';
import { parametro } from '../cadastros/alertas.js';
import { proximoNumero } from '../atendimento/servico.js';
import { baixarFefo } from '../farmacia/servico.js';
import { lancarProducao } from '../faturamento/producao.js';
import {
  aplicarFormulas,
  classificar,
  deltaCheck,
  DESCRICAO_SINAL,
  escolherReferencia,
  formatar,
  idadeEmDias,
  numero,
  textoReferencia,
  type Referencia,
  type Sinal,
} from './calculo.js';

type C = pg.PoolClient;
type Cliente = pg.PoolClient | pg.Pool;

/** Data e hora locais (America/Sao_Paulo) como texto 'AAAA-MM-DD HH:MM:SS'. */
export const agoraLocal = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const hojeLocal = () => agoraLocal().slice(0, 10);

// ---------------------------------------------------------------------------
// Parâmetros do módulo (registrados no carga.ts)
// ---------------------------------------------------------------------------
export const P = {
  destacarUpa: () => parametro<boolean>('lab.destacar_upa', true),
  confirmarPresenca: () => parametro<boolean>('lab.confirmar_presenca', false),
  coletaComPresenca: () => parametro<boolean>('lab.coleta_com_presenca', false),
  exigirMateriaisColeta: () => parametro<boolean>('lab.exigir_materiais_coleta', false),
  exigirMaterialExaminar: () => parametro<boolean>('lab.exigir_material_examinar', false),
  producaoColeta: () => parametro<{ ativo: boolean; procedimentoCodigo: string; carater: string; grupoAtendimento: string }>('lab.producao_coleta', { ativo: true, procedimentoCodigo: '0201020041', carater: '01', grupoAtendimento: 'ELETIVO' }),
  producaoExame: () => parametro<boolean>('lab.producao_exame', true),
  etiquetasAposColeta: () => parametro<'PERGUNTAR' | 'AUTOMATICO' | 'NAO'>('lab.etiquetas_apos_coleta', 'PERGUNTAR'),
  mapasAposColeta: () => parametro<boolean>('lab.mapas_apos_coleta', false),
  interfaceEnvioAutomatico: () => parametro<boolean>('lab.interface_envio_automatico', true),
  interfaceAssina: () => parametro<boolean>('lab.interface_assina', false),
  interfaceProfissional: () => parametro<number | null>('lab.interface_profissional_id', null),
  tamanhoMaximoPdf: () => parametro<number>('lab.tamanho_maximo_pdf_mb', 5),
};

// ---------------------------------------------------------------------------
// Numeração e rastreabilidade (TR 1.2.47.19)
// ---------------------------------------------------------------------------
export async function proximoNumeroLab(c: C) {
  const ano = hojeLocal().slice(0, 4);
  const r = (await c.query(`select max(numero) n from lab.requisicao where numero like $1`, [`L${ano}%`])).rows[0];
  const seq = r.n ? Number(String(r.n).slice(5)) + 1 : 1;
  return `L${ano}${String(seq).padStart(6, '0')}`;
}

/** Código de barras da amostra: dígitos do número da requisição + sequência (rastreável em todos os setores). */
export async function codigoAmostra(c: C, numeroReq: string) {
  const base = numeroReq.replace(/\D/g, '');
  const r = (await c.query(`select count(*)::int n from lab.amostra where codigo_barras like $1`, [`${base}%`])).rows[0];
  let seq = r.n + 1;
  while ((await c.query(`select 1 from lab.amostra where codigo_barras = $1`, [`${base}${String(seq).padStart(2, '0')}`])).rowCount) seq++;
  return { codigo: `${base}${String(seq).padStart(2, '0')}`, sequencia: seq };
}

// ---------------------------------------------------------------------------
// Previsão de entrega (TR 1.2.47.17): horário de corte, dias de rotina, funcionamento e feriados
// ---------------------------------------------------------------------------
const DIA_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
const somarDias = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const diaDaSemana = (d: string) => DIA_SEMANA[new Date(d + 'T12:00:00Z').getUTCDay()];

export async function previsaoEntrega(c: Cliente, exameIds: number[], laboratorioId: number | null, base: string = agoraLocal()) {
  if (!exameIds.length) return null;
  const lab = laboratorioId ? (await c.query(`select hora_corte::text, dias_funcionamento, unidade_id from lab.laboratorio where id = $1`, [laboratorioId])).rows[0] : null;
  const funcionamento: string[] = lab?.dias_funcionamento?.length ? lab.dias_funcionamento : ['SEG', 'TER', 'QUA', 'QUI', 'SEX'];
  const feriados = new Set(
    (
      await c.query(`select data::text d from cad.feriado where data between $1::date and $1::date + 120 and (unidade_id is null or unidade_id = $2)`, [base.slice(0, 10), lab?.unidade_id ?? null])
    ).rows.map((r) => r.d),
  );
  const util = (d: string, dias: string[]) => dias.includes(diaDaSemana(d)) && !feriados.has(d);
  const exames = (await c.query(`select id, prazo_entrega_dias, dias_rotina from lab.exame where id = any($1)`, [exameIds])).rows;
  let maior: string | null = null;
  for (const e of exames) {
    let d = base.slice(0, 10);
    if (lab?.hora_corte && base.slice(11, 16) > lab.hora_corte.slice(0, 5)) d = somarDias(d, 1);
    const rotina: string[] = e.dias_rotina?.length ? e.dias_rotina : funcionamento;
    for (let i = 0; i < 60 && !util(d, rotina); i++) d = somarDias(d, 1);
    let falta = Number(e.prazo_entrega_dias ?? 0);
    while (falta > 0) {
      d = somarDias(d, 1);
      if (util(d, funcionamento)) falta--;
    }
    if (!maior || d > maior) maior = d;
  }
  return maior;
}

// ---------------------------------------------------------------------------
// Layout, referências e avaliação do resultado
// ---------------------------------------------------------------------------
export interface VariavelCompleta {
  id: number;
  codigo: string;
  rotulo: string;
  tipo: string;
  ordem: number;
  unidade_medida: string | null;
  casas_decimais: number | null;
  opcoes: string | null;
  formula: string | null;
  valor_padrao: string | null;
  obrigatoria: boolean;
  permite_alterar_rotulo: boolean;
  permite_alterar_valor: boolean;
  alinhamento: string | null;
  recuo: number | null;
  negrito: boolean;
  delta_percentual: number | null;
  delta_dias: number | null;
  refs: Referencia[];
  referencia?: Referencia | null;
  referencia_texto?: string;
}

export async function layoutDoExame(c: Cliente, exameId: number): Promise<VariavelCompleta[]> {
  const exame = (await c.query(`select casas_decimais from lab.exame where id = $1`, [exameId])).rows[0];
  const vs = (
    await c.query(
      `select v.*, coalesce((select json_agg(r order by r.sexo desc, r.idade_min nulls first) from lab.valor_referencia r where r.variavel_id = v.id), '[]') refs
         from lab.exame_variavel v where v.exame_id = $1 order by v.ordem, v.id`,
      [exameId],
    )
  ).rows;
  return vs.map((v) => ({ ...v, casas_decimais: v.casas_decimais ?? exame?.casas_decimais ?? 2, delta_percentual: v.delta_percentual == null ? null : Number(v.delta_percentual) }));
}

/** Seleciona a referência de cada variável para o sexo e a idade do paciente na data. */
export function referenciasDoPaciente(layout: VariavelCompleta[], sexo: string | null, nascimento: string | null, data?: Date) {
  const dias = idadeEmDias(nascimento, data ?? new Date());
  return layout.map((v) => {
    const r = escolherReferencia(v.refs ?? [], sexo, dias);
    return { ...v, referencia: r, referencia_texto: textoReferencia(r, v.unidade_medida, v.casas_decimais) };
  });
}

export interface Alerta {
  codigo: string;
  rotulo: string;
  tipo: 'REFERENCIA' | 'CRITICO' | 'DELTA' | 'EQUIPAMENTO';
  sinal?: Sinal | null;
  mensagem: string;
}

/** Aplica fórmulas e avalia referências e Delta-Check (TR 1.2.47.43.47, 1.2.47.43.54, 1.2.47.43.56). */
export function avaliarResultado(
  layout: VariavelCompleta[],
  valoresDigitados: Record<string, any>,
  paciente: { sexo: string | null; nascimento: string | null },
  anterior: { valores: Record<string, any>; data: string } | null,
) {
  const dias = idadeEmDias(paciente.nascimento);
  const extras = { IDADE: dias === null ? null : Math.floor(dias / 365.25), MASCULINO: paciente.sexo === 'M' ? 1 : 0, FEMININO: paciente.sexo === 'F' ? 1 : 0 };
  const calculados = aplicarFormulas(layout, valoresDigitados, extras);
  const valores: Record<string, any> = {};
  for (const v of layout) {
    if (v.tipo === 'TITULO') continue;
    const digitado = valoresDigitados[v.codigo];
    // Valor calculado prevalece, salvo quando a variável permite ajuste manual e foi informado (TR 1.2.47.6.2).
    valores[v.codigo] = v.tipo === 'CALCULO' && !(v.permite_alterar_valor && digitado !== undefined && digitado !== null && digitado !== '') ? calculados[v.codigo] : digitado;
    // Numéricos gravados como número (vírgula ou ponto na digitação).
    if (v.tipo === 'NUMERICO' && numero(digitado) !== null) valores[v.codigo] = numero(digitado);
  }
  const alertas: Alerta[] = [];
  const pendentes: string[] = [];
  const sinais: Record<string, Sinal | null> = {};
  const refs = referenciasDoPaciente(layout, paciente.sexo, paciente.nascimento);
  for (const v of refs) {
    if (v.tipo === 'TITULO') continue;
    const valor = valores[v.codigo];
    if ((valor === null || valor === undefined || valor === '') && v.obrigatoria) pendentes.push(v.codigo);
    const s = classificar(valor, v.tipo, v.referencia ?? null);
    sinais[v.codigo] = s;
    if (s && s !== 'NORMAL')
      alertas.push({
        codigo: v.codigo,
        rotulo: v.rotulo,
        tipo: s.startsWith('CRITICO') ? 'CRITICO' : 'REFERENCIA',
        sinal: s,
        mensagem: `${v.rotulo}: ${v.tipo === 'NUMERICO' || v.tipo === 'CALCULO' ? formatar(numero(valor), v.casas_decimais) : valor} ${v.unidade_medida ?? ''} ${DESCRICAO_SINAL[s]} (${v.referencia_texto || 'sem referência'}).`.replace(/\s+/g, ' '),
      });
    if (anterior && v.delta_percentual) {
      const limiteDias = v.delta_dias ?? 365;
      const idadeAnterior = (Date.now() - new Date(anterior.data).getTime()) / 86_400_000;
      if (idadeAnterior <= limiteDias) {
        const d = deltaCheck(valor, anterior.valores?.[v.codigo], v.delta_percentual);
        if (d?.excedeu)
          alertas.push({
            codigo: v.codigo,
            rotulo: v.rotulo,
            tipo: 'DELTA',
            mensagem: `Delta-Check: ${v.rotulo} variou ${d.variacao.toLocaleString('pt-BR')}% em relação ao resultado anterior (${formatar(numero(anterior.valores?.[v.codigo]), v.casas_decimais)} em ${anterior.data.slice(0, 10).split('-').reverse().join('/')}); limite ${v.delta_percentual}%.`,
          });
      }
    }
  }
  return { valores, alertas, pendentes, sinais, referencias: refs };
}

/** Último resultado liberado do mesmo exame para o paciente (Delta-Check e histórico). */
export async function resultadoAnterior(c: Cliente, pacienteId: number, exameId: number, excetoItemId: number | null) {
  const r = (
    await c.query(
      `select i.valores, i.liberado_em::text data from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id
        where r.paciente_id = $1 and i.exame_id = $2 and i.situacao = 'LIBERADO' and i.id <> coalesce($3::bigint, 0) and i.valores is not null
        order by i.liberado_em desc limit 1`,
      [pacienteId, exameId, excetoItemId],
    )
  ).rows[0];
  return r ? { valores: r.valores as Record<string, any>, data: r.data as string } : null;
}

/** Resumo textual do resultado (gravado no prontuário do paciente, TR 1.2.47.43.71). */
export function textoResultado(layout: VariavelCompleta[], valores: Record<string, any>, rotulos: Record<string, string> | null, observacao?: string | null) {
  const linhas: string[] = [];
  for (const v of layout) {
    const rot = rotulos?.[v.codigo] || v.rotulo;
    if (v.tipo === 'TITULO') {
      linhas.push(rot.toUpperCase());
      continue;
    }
    const val = valores?.[v.codigo];
    if (val === null || val === undefined || val === '') continue;
    const txt = v.tipo === 'NUMERICO' || v.tipo === 'CALCULO' ? formatar(numero(val), v.casas_decimais) : String(val);
    linhas.push(`${rot}: ${txt}${v.unidade_medida ? ' ' + v.unidade_medida : ''}${v.referencia_texto ? ` (ref.: ${v.referencia_texto})` : ''}`);
  }
  if (observacao) linhas.push(`Obs.: ${observacao}`);
  return linhas.join('\n');
}

export async function pacienteDaRequisicao(c: Cliente, requisicaoId: number) {
  return (
    await c.query(
      `select p.id, p.nome, p.sexo, p.data_nascimento::text nascimento, p.prontuario, p.cns, p.cpf from lab.requisicao r join cad.pessoa p on p.id = r.paciente_id where r.id = $1`,
      [requisicaoId],
    )
  ).rows[0];
}

// ---------------------------------------------------------------------------
// Requisições (TR 1.2.47.43.1 a 1.2.47.43.12, 1.2.47.43.22, 1.2.47.43.24)
// ---------------------------------------------------------------------------
export interface NovaRequisicao {
  pacienteId: number;
  solicitacaoId?: number | null;
  agendamentoId?: number | null;
  laboratorioId?: number | null;
  unidadeSolicitanteId?: number | null;
  profissionalSolicitanteId?: number | null;
  solicitanteExterno?: string | null;
  convenioId?: number | null;
  origem?: string;
  urgente?: boolean;
  dataAgendada?: string | null;
  horaAgendada?: string | null;
  dadosClinicos?: string | null;
  observacao?: string | null;
  itens: { exameId: number; solicitacaoItemId?: number | null; materialId?: number | null }[];
  confirmarAvisos?: boolean;
}

async function laboratorioPadrao(c: C) {
  return (await c.query(`select id from lab.laboratorio where ativo and tipo = 'PROPRIO' order by id limit 1`)).rows[0]?.id ?? null;
}

export async function criarRequisicao(c: C, d: NovaRequisicao, u: Usuario) {
  if (!d.itens.length) throw new ErroHttp(422, 'Informe ao menos um exame.');
  const pac = (await c.query(`select id, sexo, data_nascimento::text nascimento from cad.pessoa where id = $1`, [d.pacienteId])).rows[0];
  if (!pac) throw new ErroHttp(404, 'Paciente não encontrado.');
  const laboratorioId = d.laboratorioId ?? (await laboratorioPadrao(c));
  const exigirMaterial = await P.exigirMaterialExaminar();
  const avisos: string[] = [];
  const exames = new Map<number, any>();
  for (const it of d.itens) {
    const e = (
      await c.query(`select e.*, p.valor_sa, p.nome procedimento from lab.exame e join cad.procedimento p on p.id = e.procedimento_id where e.id = $1`, [it.exameId])
    ).rows[0];
    if (!e || !e.ativo) throw new ErroHttp(422, 'Exame inexistente ou inativo.');
    exames.set(it.exameId, e);
    // Material a examinar obrigatório quando não veio na requisição (TR 1.2.47.43.22).
    if (exigirMaterial && !it.materialId && !e.material_id) throw new ErroHttp(422, `Selecione o material a examinar para ${e.nome}.`, { materialObrigatorio: it.exameId });
    const anos = pac.nascimento ? Math.floor((idadeEmDias(pac.nascimento) ?? 0) / 365.25) : null;
    if (e.sexo && e.sexo !== 'A' && pac.sexo && pac.sexo !== e.sexo) avisos.push(`${e.nome} é indicado somente para o sexo ${e.sexo === 'F' ? 'feminino' : 'masculino'}.`);
    if (anos !== null && ((e.idade_min != null && anos < e.idade_min) || (e.idade_max != null && anos > e.idade_max))) avisos.push(`${e.nome}: paciente fora da faixa etária do exame.`);
    const repetido = (
      await c.query(
        `select 1 from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id where r.paciente_id = $1 and i.exame_id = $2 and i.situacao not in ('LIBERADO','CANCELADO')`,
        [d.pacienteId, it.exameId],
      )
    ).rowCount;
    if (repetido) avisos.push(`${e.nome} já está em andamento no laboratório para este paciente.`);
  }
  if (avisos.length && !d.confirmarAvisos) throw new ErroHttp(409, avisos.join(' '), { avisos, exigeConfirmacao: true });
  const numero = await proximoNumeroLab(c);
  const previsao = await previsaoEntrega(c, d.itens.map((i) => i.exameId), laboratorioId, d.dataAgendada && d.dataAgendada > hojeLocal() ? `${d.dataAgendada} 00:00:00` : agoraLocal());
  const req = (
    await c.query(
      `insert into lab.requisicao (numero, paciente_id, solicitacao_id, agendamento_id, laboratorio_id, unidade_solicitante_id, profissional_solicitante_id, solicitante_externo,
                                   convenio_id, origem, urgente, data_agendada, hora_agendada, presenca, data_prevista_entrega, situacao, dados_clinicos, observacao, operador_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12::date, current_date),$13,'AGENDADO',$14,'RECEBIDA',$15,$16,$17) returning *`,
      [
        numero,
        d.pacienteId,
        d.solicitacaoId ?? null,
        d.agendamentoId ?? null,
        laboratorioId,
        d.unidadeSolicitanteId ?? null,
        d.profissionalSolicitanteId ?? null,
        d.solicitanteExterno ?? null,
        d.convenioId ?? null,
        d.origem ?? 'EXTERNA',
        !!d.urgente,
        d.dataAgendada ?? null,
        d.horaAgendada ?? null,
        previsao,
        d.dadosClinicos ?? null,
        d.observacao ?? null,
        u.id,
      ],
    )
  ).rows[0];
  for (const it of d.itens) {
    const e = exames.get(it.exameId);
    await c.query(
      `insert into lab.requisicao_exame (requisicao_id, exame_id, solicitacao_item_id, material_id, laboratorio_id, situacao, valor, interface_situacao)
       values ($1,$2,$3,$4,$5,'AGUARDANDO_COLETA',$6,$7)`,
      [req.id, it.exameId, it.solicitacaoItemId ?? null, it.materialId ?? e.material_id ?? null, e.laboratorio_id ?? laboratorioId, e.valor ?? e.valor_sa ?? 0, e.usa_interfaceamento ? 'PENDENTE' : null],
    );
  }
  return req;
}

/** Recebe no laboratório a requisição feita no prontuário (amb.solicitacao_exame). */
export async function receberSolicitacao(c: C, solicitacaoId: number, u: Usuario, opcoes: { laboratorioId?: number | null; dataAgendada?: string | null; confirmarAvisos?: boolean } = {}) {
  const s = (await c.query(`select * from amb.solicitacao_exame where id = $1`, [solicitacaoId])).rows[0];
  if (!s) throw new ErroHttp(404, 'Requisição não encontrada.');
  if (s.situacao === 'CANCELADO') throw new ErroHttp(422, 'Requisição cancelada no prontuário.');
  const itens = (
    await c.query(
      `select i.id, i.material, (select e.id from lab.exame e where e.procedimento_id = i.procedimento_id and e.ativo order by e.id limit 1) exame_id
         from amb.solicitacao_exame_item i
        where i.solicitacao_id = $1 and i.situacao in ('REQUISITADO','AGENDADO')
          and not exists (select 1 from lab.requisicao_exame x where x.solicitacao_item_id = i.id and x.situacao <> 'CANCELADO')`,
      [solicitacaoId],
    )
  ).rows.filter((i) => i.exame_id);
  if (!itens.length) throw new ErroHttp(422, 'Nenhum exame laboratorial pendente nesta requisição.');
  const ag = (
    await c.query(`select id, data::text, hora::text from age.agendamento where requisicao_id = $1 and situacao not in ('CANCELADO','TRANSFERIDO') order by data desc limit 1`, [solicitacaoId])
  ).rows[0];
  const materiais = new Map<string, number>();
  for (const i of itens)
    if (i.material && !materiais.has(i.material)) {
      const m = (await c.query(`select id from lab.material where upper(nome) = upper($1) limit 1`, [i.material])).rows[0];
      if (m) materiais.set(i.material, m.id);
    }
  const req = await criarRequisicao(
    c,
    {
      pacienteId: s.paciente_id,
      solicitacaoId,
      agendamentoId: ag?.id ?? null,
      laboratorioId: opcoes.laboratorioId,
      unidadeSolicitanteId: s.unidade_id,
      profissionalSolicitanteId: s.profissional_id,
      origem: s.origem_upa ? 'UPA' : 'REDE',
      urgente: s.prioridade && s.prioridade !== 'AZUL',
      dataAgendada: opcoes.dataAgendada ?? ag?.data ?? null,
      horaAgendada: ag?.hora ?? null,
      dadosClinicos: s.dados_clinicos,
      itens: itens.map((i) => ({ exameId: i.exame_id, solicitacaoItemId: i.id, materialId: i.material ? (materiais.get(i.material) ?? null) : null })),
      confirmarAvisos: opcoes.confirmarAvisos,
    },
    u,
  );
  await c.query(`update amb.solicitacao_exame set situacao = 'AGENDADO' where id = $1 and situacao = 'REQUISITADO'`, [solicitacaoId]);
  await c.query(`update amb.solicitacao_exame_item set situacao = 'AGENDADO' where id = any($1) and situacao = 'REQUISITADO'`, [itens.map((i) => i.id)]);
  return req;
}

/** Requisição externa/balcão: também gera a requisição no prontuário para integrar os resultados ao histórico (TR 1.2.48.13). */
export async function criarRequisicaoExterna(c: C, d: NovaRequisicao, u: Usuario) {
  const numero = await proximoNumero(c, 'amb.solicitacao_exame', 'X');
  const s = (
    await c.query(
      `insert into amb.solicitacao_exame (numero, paciente_id, profissional_id, unidade_id, data, dados_clinicos, prioridade, uso_interno, origem_upa, situacao)
       values ($1,$2,$3,$4,coalesce($5::date, current_date),$6,$7,false,$8,'AGENDADO') returning id`,
      [numero, d.pacienteId, d.profissionalSolicitanteId ?? null, d.unidadeSolicitanteId ?? u.unidadeAtual, d.dataAgendada ?? null, d.dadosClinicos ?? null, d.urgente ? 'AMARELO' : 'AZUL', d.origem === 'UPA'],
    )
  ).rows[0];
  const itens = [];
  for (const it of d.itens) {
    const e = (await c.query(`select procedimento_id, (select nome from lab.material where id = coalesce($2::bigint, lab.exame.material_id)) material from lab.exame where id = $1`, [it.exameId, it.materialId ?? null])).rows[0];
    if (!e) throw new ErroHttp(422, 'Exame inexistente.');
    const si = (
      await c.query(`insert into amb.solicitacao_exame_item (solicitacao_id, procedimento_id, material, quantidade, situacao) values ($1,$2,$3,1,'AGENDADO') returning id`, [s.id, e.procedimento_id, e.material])
    ).rows[0];
    itens.push({ ...it, solicitacaoItemId: si.id });
  }
  return criarRequisicao(c, { ...d, solicitacaoId: s.id, itens }, u);
}

/** Recalcula a situação da requisição a partir dos exames. */
export async function atualizarSituacaoRequisicao(c: C, requisicaoId: number) {
  const r = (
    await c.query(
      `select r.situacao, count(i.*) filter (where i.situacao <> 'CANCELADO')::int total,
              count(i.*) filter (where i.situacao = 'AGUARDANDO_COLETA')::int aguardando,
              count(i.*) filter (where i.situacao = 'LIBERADO')::int liberados
         from lab.requisicao r left join lab.requisicao_exame i on i.requisicao_id = r.id where r.id = $1 group by r.id`,
      [requisicaoId],
    )
  ).rows[0];
  if (!r) return;
  let nova: string;
  if (!r.total) nova = 'CANCELADA';
  else if (r.liberados === r.total) nova = ['ENTREGUE', 'NAO_RETIRADA'].includes(r.situacao) ? r.situacao : 'LIBERADA';
  else if (r.liberados > 0) nova = 'LIBERADA_PARCIAL';
  else if (r.aguardando === r.total) nova = 'RECEBIDA';
  else if (r.aguardando > 0) nova = 'COLETA_PARCIAL';
  else nova = 'COLETADA';
  if (nova !== r.situacao) await c.query(`update lab.requisicao set situacao = $2 where id = $1`, [requisicaoId, nova]);
  return nova;
}

async function travarRequisicao(c: C, id: number) {
  const r = (await c.query(`select * from lab.requisicao where id = $1 for update`, [id])).rows[0];
  if (!r) throw new ErroHttp(404, 'Requisição não encontrada.');
  if (r.situacao === 'CANCELADA') throw new ErroHttp(422, 'Requisição cancelada.');
  return r;
}

/** Confirmação de presença ou falta (TR 1.2.47.43.4, 1.2.47.43.11, 1.2.47.43.15, 1.2.47.43.61). */
export async function registrarPresenca(c: C, id: number, presente: boolean, u: Usuario) {
  const r = await travarRequisicao(c, id);
  await c.query(`update lab.requisicao set presenca = $2, presenca_em = now() where id = $1`, [id, presente ? 'PRESENTE' : 'FALTOU']);
  if (r.agendamento_id) await c.query(`update age.agendamento set situacao = $2 where id = $1 and situacao in ('AGENDADO','CONFIRMADO')`, [r.agendamento_id, presente ? 'PRESENTE' : 'FALTA']);
  let coleta = null;
  // Coleta registrada automaticamente junto com a presença (parâmetro, TR 1.2.47.43.15).
  if (presente && (await P.coletaComPresenca())) {
    const pend = (await c.query(`select count(*)::int n from lab.requisicao_exame where requisicao_id = $1 and situacao = 'AGUARDANDO_COLETA'`, [id])).rows[0].n;
    if (pend) coleta = await registrarColeta(c, id, { profissionalId: u.profissionalId, ignorarMateriais: true }, u);
  }
  return { ok: true, coleta };
}

/** Reagendamento da coleta quando a configuração do exame permite (TR 1.2.47.24, 1.2.47.43.12). */
export async function reagendarColeta(c: C, id: number, data: string, motivo: string, u: Usuario) {
  const r = await travarRequisicao(c, id);
  const bloqueados = (
    await c.query(
      `select e.nome from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.requisicao_id = $1 and i.situacao = 'AGUARDANDO_COLETA' and not e.permite_reagendamento`,
      [id],
    )
  ).rows;
  if (bloqueados.length) throw new ErroHttp(422, `O cadastro não permite reagendar a coleta de: ${bloqueados.map((b) => b.nome).join(', ')}.`);
  if (data < hojeLocal()) throw new ErroHttp(422, 'A nova data não pode ser anterior a hoje.');
  const exames = (await c.query(`select exame_id from lab.requisicao_exame where requisicao_id = $1 and situacao <> 'CANCELADO'`, [id])).rows.map((x) => x.exame_id);
  const previsao = await previsaoEntrega(c, exames, r.laboratorio_id, `${data} 00:00:00`);
  await c.query(
    `update lab.requisicao set data_agendada = $2, presenca = 'AGENDADO', presenca_em = null, data_prevista_entrega = $3,
            observacao = trim(coalesce(observacao, '') || E'\n' || $4) where id = $1`,
    [id, data, previsao, `Coleta reagendada de ${String(r.data_agendada ?? '').slice(0, 10)} para ${data} por ${u.nome}: ${motivo}`],
  );
  return { ok: true, previsao };
}

// ---------------------------------------------------------------------------
// Coleta (TR 1.2.47.10, 1.2.47.25, 1.2.47.43.13, 1.2.47.43.16 a 1.2.47.43.25)
// ---------------------------------------------------------------------------
export interface Tubo {
  chave: string;
  recipienteId: number | null;
  recipiente: string;
  cor: string | null;
  corNome: string | null;
  materialId: number | null;
  material: string | null;
  secaoId: number | null;
  sequencia: number;
  quantidade: number;
  volume: number;
  espacoMorto: number | null;
  produtoId: number | null;
  itens: number[];
  siglas: string[];
}

/** Recipientes e materiais necessários para coletar os exames pendentes (integral ou parcial). */
export async function planoColeta(c: Cliente, requisicaoId: number, itensSelecionados?: number[] | null) {
  const linhas = (
    await c.query(
      `select i.id item_id, e.id exame_id, e.sigla, e.nome, coalesce(e.quantidade_amostras, 1) amostras, e.secao_id, coalesce(i.material_id, er.material_id, e.material_id) material_id,
              er.recipiente_id, coalesce(er.quantidade, 1) quantidade, coalesce(er.volume_coleta_ml, 0) volume, coalesce(er.compartilhavel, true) compartilhavel,
              rc.nome recipiente, rc.cor, rc.cor_nome, rc.espaco_morto_ml, rc.produto_id, m.nome material, e.instrucoes_coleta, e.preparo_paciente
         from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id
         left join lab.exame_recipiente er on er.exame_id = e.id
         left join lab.recipiente rc on rc.id = er.recipiente_id
         left join lab.material m on m.id = coalesce(i.material_id, er.material_id, e.material_id)
        where i.requisicao_id = $1 and i.situacao = 'AGUARDANDO_COLETA' and ($2::bigint[] is null or i.id = any($2))
        order by i.id`,
      [requisicaoId, itensSelecionados?.length ? itensSelecionados : null],
    )
  ).rows;
  const tubos = new Map<string, Tubo>();
  for (const l of linhas) {
    for (let seq = 1; seq <= Number(l.amostras); seq++) {
      const chave = l.compartilhavel ? `${l.recipiente_id ?? 0}:${l.material_id ?? 0}:${seq}` : `item${l.item_id}:${l.recipiente_id ?? 0}:${seq}`;
      const t: Tubo = tubos.get(chave) ?? {
        chave,
        recipienteId: l.recipiente_id,
        recipiente: l.recipiente ?? 'Recipiente não configurado',
        cor: l.cor,
        corNome: l.cor_nome,
        materialId: l.material_id,
        material: l.material,
        secaoId: l.secao_id,
        sequencia: seq,
        quantidade: 0,
        volume: 0,
        espacoMorto: l.espaco_morto_ml == null ? null : Number(l.espaco_morto_ml),
        produtoId: l.produto_id,
        itens: [],
        siglas: [],
      };
      t.quantidade = Math.max(t.quantidade, Number(l.quantidade));
      t.volume += Number(l.volume);
      if (!t.itens.includes(l.item_id)) t.itens.push(l.item_id);
      if (!t.siglas.includes(l.sigla)) t.siglas.push(l.sigla);
      tubos.set(chave, t);
    }
  }
  const itens = [...new Map(linhas.map((l) => [l.item_id, { id: l.item_id, exameId: l.exame_id, sigla: l.sigla, nome: l.nome, material: l.material, amostras: Number(l.amostras), instrucoes: l.instrucoes_coleta, preparo: l.preparo_paciente }])).values()];
  // Materiais de consumo sugeridos para a etapa de coleta (TR 1.2.47.43.16).
  const insumos = new Map<number, { produtoId: number; nome: string; quantidade: number }>();
  const exameIds = [...new Set(linhas.map((l) => l.exame_id))];
  if (exameIds.length) {
    for (const x of (
      await c.query(
        `select ei.produto_id, p.nome || coalesce(' ' || p.concentracao, '') nome, sum(ei.quantidade) q from lab.exame_insumo ei join far.produto p on p.id = ei.produto_id
          where ei.exame_id = any($1) and ei.etapa = 'COLETA' group by 1, 2`,
        [exameIds],
      )
    ).rows)
      insumos.set(x.produto_id, { produtoId: x.produto_id, nome: x.nome, quantidade: Number(x.q) });
  }
  for (const t of tubos.values()) {
    if (!t.produtoId) continue;
    const p = insumos.get(t.produtoId) ?? { produtoId: t.produtoId, nome: (await c.query(`select nome from far.produto where id = $1`, [t.produtoId])).rows[0]?.nome ?? 'Recipiente', quantidade: 0 };
    p.quantidade += t.quantidade;
    insumos.set(t.produtoId, p);
  }
  return { tubos: [...tubos.values()], itens, insumos: [...insumos.values()] };
}

export async function registrarColeta(
  c: C,
  requisicaoId: number,
  d: { itens?: number[] | null; profissionalId?: number | null; dataHora?: string | null; materiais?: { produtoId: number; quantidade: number }[]; unidadeEstoqueId?: number | null; ignorarMateriais?: boolean },
  u: Usuario,
) {
  const r = await travarRequisicao(c, requisicaoId);
  if ((await P.confirmarPresenca()) && r.presenca !== 'PRESENTE' && !(await P.coletaComPresenca()))
    throw new ErroHttp(422, 'Confirme a presença do paciente antes de registrar a coleta (TR 1.2.47.43.11).');
  const plano = await planoColeta(c, requisicaoId, d.itens);
  if (!plano.itens.length) throw new ErroHttp(422, 'Nenhum exame pendente de coleta foi selecionado.');
  const materiais = (d.materiais ?? []).filter((m) => m.quantidade > 0);
  if (!d.ignorarMateriais && (await P.exigirMateriaisColeta()) && !materiais.length) throw new ErroHttp(422, 'Informe os materiais usados na coleta (parâmetro do laboratório, TR 1.2.47.43.18).');
  const dataHora = d.dataHora ?? new Date().toISOString();
  const amostras = [];
  for (const t of plano.tubos) {
    for (let q = 0; q < t.quantidade; q++) {
      const { codigo, sequencia } = await codigoAmostra(c, r.numero);
      const a = (
        await c.query(
          `insert into lab.amostra (requisicao_id, codigo_barras, sequencia, recipiente_id, material_id, secao_id, volume_ml, coletada_em, profissional_coleta_id, operador_id, situacao, itens)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'COLETADA',$11) returning *`,
          [requisicaoId, codigo, sequencia, t.recipienteId, t.materialId, t.secaoId, t.volume || null, dataHora, d.profissionalId ?? u.profissionalId, u.id, JSON.stringify(t.itens)],
        )
      ).rows[0];
      amostras.push({ ...a, recipiente: t.recipiente, siglas: t.siglas });
    }
  }
  const ids = plano.itens.map((i) => i.id);
  // Exames repassados a laboratório de apoio ficam "em análise" até o retorno do resultado (TR 1.2.48.12).
  await c.query(
    `update lab.requisicao_exame i set situacao = case when l.tipo = 'APOIO' then 'EM_ANALISE' else 'COLETADO' end
       from lab.requisicao_exame x left join lab.laboratorio l on l.id = x.laboratorio_id where x.id = i.id and i.id = any($1)`,
    [ids],
  );
  await c.query(
    `update amb.solicitacao_exame_item set situacao = 'COLETADO' where id in (select solicitacao_item_id from lab.requisicao_exame where id = any($1)) and situacao in ('REQUISITADO','AGENDADO')`,
    [ids],
  );
  await c.query(`update lab.requisicao set presenca = 'PRESENTE', presenca_em = coalesce(presenca_em, now()) where id = $1`, [requisicaoId]);
  const situacao = await atualizarSituacaoRequisicao(c, requisicaoId);
  // Baixa automática dos materiais usados na coleta (TR 1.2.47.43.17).
  const estoque = d.unidadeEstoqueId ?? (await c.query(`select unidade_id from lab.laboratorio where id = $1`, [r.laboratorio_id])).rows[0]?.unidade_id ?? u.unidadeAtual;
  for (const m of materiais) {
    if (!estoque) throw new ErroHttp(422, 'Informe a unidade de estoque para a baixa dos materiais.');
    await baixarFefo(c, { unidadeId: estoque, produtoId: m.produtoId, quantidade: m.quantidade, tipo: 'CONSUMO', pacienteId: r.paciente_id, documento: `LAB ${r.numero}`, operadorId: u.id });
    await c.query(`insert into lab.coleta_insumo (requisicao_id, produto_id, quantidade, unidade_id, data_hora) values ($1,$2,$3,$4,now())`, [requisicaoId, m.produtoId, m.quantidade, estoque]);
  }
  // Produção da coleta para faturamento, com procedimento e caráter parametrizados (TR 1.2.47.43.19 a 1.2.47.43.21).
  const pc = await P.producaoColeta();
  let producao = null;
  if (pc?.ativo && pc.procedimentoCodigo) {
    const ja = (await c.query(`select 1 from fat.producao where referencia = $1`, [`lab_coleta:${requisicaoId}`])).rowCount;
    const unidadeLab = (await c.query(`select unidade_id from lab.laboratorio where id = $1`, [r.laboratorio_id])).rows[0]?.unidade_id;
    const unidade = unidadeLab ?? u.unidadeAtual;
    if (!ja && unidade)
      producao = await lancarProducao(c, {
        data: dataHora.slice(0, 10),
        unidadeId: unidade,
        profissionalId: d.profissionalId ?? u.profissionalId,
        procedimentoCodigo: pc.procedimentoCodigo,
        pacienteId: r.paciente_id,
        carater: pc.carater ?? '01',
        origem: 'COLETA',
        referencia: `lab_coleta:${requisicaoId}`,
      });
  }
  // Envio automático dos pedidos aos equipamentos interfaceados (TR 1.2.47.43.25).
  const { enviarPedidosEquipamentos } = await import('./interface.js');
  const enviados = (await P.interfaceEnvioAutomatico()) ? await enviarPedidosEquipamentos(c, amostras.map((a) => a.id)) : 0;
  return {
    amostras,
    situacao,
    producao,
    pedidosEquipamentos: enviados,
    etiquetas: await P.etiquetasAposColeta(),
    mapas: await P.mapasAposColeta(),
  };
}

/** Descarte de amostra com retorno do exame à fila de coleta (TR 1.2.47.23, 1.2.47.43.14, 1.2.47.43.14.1). */
export async function descartarAmostra(c: C, amostraId: number, motivo: string, u: Usuario) {
  const a = (await c.query(`select * from lab.amostra where id = $1 for update`, [amostraId])).rows[0];
  if (!a) throw new ErroHttp(404, 'Amostra não encontrada.');
  if (a.situacao === 'DESCARTADA') throw new ErroHttp(422, 'Amostra já descartada.');
  const itens: number[] = a.itens ?? [];
  const exames = (
    await c.query(`select i.id, i.situacao, e.nome, e.permite_recoleta from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.id = any($1)`, [itens])
  ).rows;
  const sem = exames.filter((e) => !e.permite_recoleta);
  if (sem.length) throw new ErroHttp(422, `O cadastro não permite recoleta de: ${sem.map((e) => e.nome).join(', ')}.`);
  if (exames.some((e) => e.situacao === 'LIBERADO')) throw new ErroHttp(422, 'Há resultado liberado para esta amostra; cancele a liberação antes do descarte.');
  await c.query(`update lab.amostra set situacao = 'DESCARTADA', motivo_descarte = $2 where id = $1`, [amostraId, `${motivo} (${u.nome})`]);
  // Exames sem outra amostra válida voltam para a fila de coleta.
  for (const e of exames) {
    const outra = (
      await c.query(`select 1 from lab.amostra where requisicao_id = $1 and id <> $2 and situacao <> 'DESCARTADA' and itens @> $3::jsonb`, [a.requisicao_id, amostraId, JSON.stringify([e.id])])
    ).rowCount;
    if (!outra) {
      await c.query(`update lab.requisicao_exame set situacao = 'AGUARDANDO_COLETA', valores = null, alertas = null where id = $1`, [e.id]);
      await c.query(`update amb.solicitacao_exame_item set situacao = 'AGENDADO' where id = (select solicitacao_item_id from lab.requisicao_exame where id = $1)`, [e.id]);
    }
  }
  await atualizarSituacaoRequisicao(c, a.requisicao_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Digitação de resultados (TR 1.2.47.43.46 a 1.2.47.43.53, 1.2.47.43.56, 1.2.47.43.59)
// ---------------------------------------------------------------------------
export async function salvarResultado(
  c: C,
  itemId: number,
  d: { valores: Record<string, any>; rotulos?: Record<string, string> | null; observacao?: string | null; parcial?: boolean; alertasEquipamento?: Alerta[] },
  u: Usuario | null,
) {
  const it = (await c.query(`select i.*, r.paciente_id from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id where i.id = $1 for update of i`, [itemId])).rows[0];
  if (!it) throw new ErroHttp(404, 'Exame não encontrado.');
  if (it.situacao === 'LIBERADO') throw new ErroHttp(409, 'Resultado já liberado (assinado): a alteração está bloqueada. Cancele a liberação, se autorizado (TR 1.2.47.43.53, 1.2.47.43.65).');
  if (it.situacao === 'CANCELADO') throw new ErroHttp(422, 'Exame cancelado.');
  if (it.situacao === 'AGUARDANDO_COLETA') throw new ErroHttp(422, 'Registre a coleta da amostra antes de digitar o resultado.');
  const layout = await layoutDoExame(c, it.exame_id);
  const pac = (await c.query(`select sexo, data_nascimento::text nascimento from cad.pessoa where id = $1`, [it.paciente_id])).rows[0];
  const anterior = await resultadoAnterior(c, it.paciente_id, it.exame_id, itemId);
  // Variáveis com texto editável: somente as autorizadas no layout (TR 1.2.47.6.1).
  const rotulos: Record<string, string> = {};
  for (const v of layout) if (v.permite_alterar_rotulo && d.rotulos?.[v.codigo] && d.rotulos[v.codigo] !== v.rotulo) rotulos[v.codigo] = d.rotulos[v.codigo];
  const av = avaliarResultado(layout, d.valores ?? {}, pac, anterior);
  for (const v of layout)
    if (v.tipo === 'LISTA' && v.opcoes && av.valores[v.codigo] && !v.permite_alterar_valor) {
      const ops = v.opcoes.split(';').map((o) => o.trim().toUpperCase());
      if (!ops.includes(String(av.valores[v.codigo]).trim().toUpperCase())) throw new ErroHttp(422, `${v.rotulo}: selecione uma das opções da lista.`);
    }
  const alertas = [...av.alertas, ...(d.alertasEquipamento ?? [])];
  const situacao = d.parcial || av.pendentes.length ? 'DIGITADO_PARCIAL' : 'DIGITADO';
  await c.query(
    `update lab.requisicao_exame set valores = $2, rotulos = $3, observacao_resultado = $4, alertas = $5, situacao = $6, digitado_em = now(), digitado_por = $7 where id = $1`,
    [itemId, JSON.stringify(av.valores), JSON.stringify(rotulos), d.observacao ?? null, JSON.stringify(alertas), situacao, u?.id ?? null],
  );
  return { situacao, valores: av.valores, alertas, pendentes: av.pendentes, sinais: av.sinais };
}

// ---------------------------------------------------------------------------
// Liberação / assinatura (TR 1.2.47.38, 1.2.47.39, 1.2.47.43.55, 1.2.47.43.57, 1.2.47.43.58, 1.2.47.43.63 a 1.2.47.43.65)
// ---------------------------------------------------------------------------
export async function conferirSenhaOperador(c: C, u: Usuario, senha: string | undefined | null) {
  const op = (await c.query(`select senha_hash from seg.operador where id = $1`, [u.id])).rows[0];
  if (!senha || !(await conferirSenha(senha, op?.senha_hash))) throw new ErroHttp(403, 'Senha do operador não confere: a liberação não foi realizada (TR 1.2.47.43.64.1).');
}

export async function profissionalLiberador(c: Cliente, profissionalId: number | null) {
  if (!profissionalId) throw new ErroHttp(403, 'Operador sem profissional vinculado: somente profissionais autorizados assinam laudos (TR 1.2.47.43.58).');
  const p = (await c.query(`select id, nome, liberador_laudo, ativo from cad.profissional where id = $1`, [profissionalId])).rows[0];
  if (!p?.liberador_laudo || !p.ativo) throw new ErroHttp(403, 'Profissional não autorizado a assinar laudos laboratoriais (cadastro do profissional: "Liberador de laudos").');
  return p;
}

/** Modelo de laudo aplicável ao exame/material: específico do exame e do material tem prioridade (TR 1.2.47.35). */
export async function modeloDoExame(c: Cliente, exameId: number, materialId: number | null) {
  return (
    await c.query(
      `select id, html, orientacao, versao from lab.modelo_laudo
        where ativo and html is not null and (exame_id = $1 or exame_id is null) and (material_id = $2 or material_id is null)
        order by (exame_id is not null) desc, (material_id is not null) desc, id limit 1`,
      [exameId, materialId],
    )
  ).rows[0] ?? null;
}

/**
 * Libera os exames: congela o layout, o modelo e as referências usados (alterações posteriores do
 * cadastro não afetam laudos liberados, TR 1.2.47.43.55), publica no prontuário e lança a produção.
 */
export async function liberarItens(c: C, itemIds: number[], profissionalId: number | null, u: Usuario | null, opcoes: { assinanteExterno?: string | null } = {}) {
  const liberados: any[] = [];
  const erros: string[] = [];
  for (const id of itemIds) {
    const it = (
      await c.query(
        `select i.*, r.paciente_id, r.numero, e.nome exame, e.procedimento_id, l.unidade_id lab_unidade
           from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id
           left join lab.laboratorio l on l.id = i.laboratorio_id where i.id = $1 for update of i`,
        [id],
      )
    ).rows[0];
    if (!it) continue;
    if (it.situacao !== 'DIGITADO') {
      erros.push(`${it.numero} - ${it.exame}: ${it.situacao === 'DIGITADO_PARCIAL' ? 'digitação parcial; conclua o resultado antes de liberar' : `situação ${it.situacao.toLowerCase().replace('_', ' ')}`}.`);
      continue;
    }
    const layout = await layoutDoExame(c, it.exame_id);
    const pac = (await c.query(`select sexo, data_nascimento::text nascimento from cad.pessoa where id = $1`, [it.paciente_id])).rows[0];
    const congelado = referenciasDoPaciente(layout, pac.sexo, pac.nascimento);
    const modelo = await modeloDoExame(c, it.exame_id, it.material_id);
    await c.query(
      `update lab.requisicao_exame set situacao = 'LIBERADO', liberado_em = now(), liberado_por = $2, liberado_operador_id = $3, layout = $4, modelo_laudo_id = $5 where id = $1`,
      [id, profissionalId, u?.id ?? null, JSON.stringify({ variaveis: congelado, modelo, assinanteExterno: opcoes.assinanteExterno ?? null }), modelo?.id ?? null],
    );
    const texto = textoResultado(congelado, it.valores ?? {}, it.rotulos, it.observacao_resultado);
    if (it.solicitacao_item_id)
      await c.query(`update amb.solicitacao_exame_item set situacao = 'REALIZADO', resultado_texto = $2, resultado_liberado_em = now() where id = $1 and situacao <> 'AVALIADO'`, [it.solicitacao_item_id, texto]);
    // Produção do exame para o faturamento SUS (BPA) no laboratório executor (TR 1.2.48.14).
    if ((await P.producaoExame()) && !it.producao_id) {
      const unidade = it.lab_unidade ?? u?.unidadeAtual;
      if (unidade) {
        const p = await lancarProducao(c, { data: hojeLocal(), unidadeId: unidade, profissionalId, procedimentoId: it.procedimento_id, pacienteId: it.paciente_id, origem: 'EXAME', referencia: `lab_item:${id}` });
        if (p) await c.query(`update lab.requisicao_exame set producao_id = $2 where id = $1`, [id, p.id]);
      }
    }
    liberados.push(it);
  }
  for (const req of new Set(liberados.map((l) => l.requisicao_id))) await atualizarSituacaoRequisicao(c, req);
  // Aviso ao profissional solicitante: laudo disponível no prontuário (TR 1.2.47.43.73).
  for (const req of new Set(liberados.map((l) => l.requisicao_id))) {
    const r = (await c.query(`select r.numero, r.profissional_solicitante_id, p.nome from lab.requisicao r join cad.pessoa p on p.id = r.paciente_id where r.id = $1`, [req])).rows[0];
    if (r?.profissional_solicitante_id)
      await notificarProfissional(c, r.profissional_solicitante_id, 'Resultado de exame liberado', `Os resultados da requisição ${r.numero} de ${r.nome} estão disponíveis no prontuário do paciente.`);
  }
  return { liberados, erros };
}

export async function notificarProfissional(c: C, profissionalId: number, titulo: string, mensagem: string) {
  const r = await c.query(
    `insert into sis.notificacao_operador (destinatario_id, titulo, mensagem) select id, $2, $3 from seg.operador where profissional_id = $1 and ativo`,
    [profissionalId, titulo, mensagem],
  );
  return r.rowCount ?? 0;
}

/** Cancelamento da liberação por operador autorizado (TR 1.2.47.43.70). */
export async function cancelarLiberacao(c: C, itemId: number, motivo: string, u: Usuario) {
  const it = (await c.query(`select * from lab.requisicao_exame where id = $1 for update`, [itemId])).rows[0];
  if (!it) throw new ErroHttp(404, 'Exame não encontrado.');
  if (it.situacao !== 'LIBERADO') throw new ErroHttp(422, 'O exame não está liberado.');
  await c.query(
    `update lab.requisicao_exame set situacao = case when anexo_externo then 'COLETADO' else 'DIGITADO' end, liberado_em = null, liberado_por = null, liberado_operador_id = null,
            layout = null, modelo_laudo_id = null, laudo_arquivo_id = null, anexo_externo = false, impresso_em = null, producao_id = null,
            observacao_resultado = trim(coalesce(observacao_resultado, '') || E'\n' || $2) where id = $1`,
    [itemId, `[Liberação cancelada em ${agoraLocal().slice(0, 16)} por ${u.nome}: ${motivo}]`],
  );
  if (it.solicitacao_item_id)
    await c.query(`update amb.solicitacao_exame_item set situacao = 'COLETADO', resultado_texto = null, resultado_arquivo_id = null, resultado_liberado_em = null where id = $1`, [it.solicitacao_item_id]);
  if (it.producao_id) await c.query(`delete from fat.producao where id = $1 and situacao <> 'EXPORTADO'`, [it.producao_id]);
  await atualizarSituacaoRequisicao(c, it.requisicao_id);
  return { ok: true };
}

/** Resultado anexado em PDF: considerado liberado e assinado, disponível no prontuário (TR 1.2.47.43.41, 1.2.47.43.42). */
export async function anexarResultadoPdf(c: C, itemId: number, arquivoId: string, u: Usuario) {
  const arq = (await c.query(`select tipo_mime, tamanho from sis.arquivo where id = $1`, [arquivoId])).rows[0];
  if (!arq) throw new ErroHttp(404, 'Arquivo não encontrado.');
  if (arq.tipo_mime !== 'application/pdf') throw new ErroHttp(422, 'O resultado deve ser anexado em formato PDF.');
  const limite = await P.tamanhoMaximoPdf();
  if (Number(arq.tamanho) > limite * 1024 * 1024) throw new ErroHttp(413, `Arquivo maior que o limite de ${limite} MB configurado para resultados digitalizados.`);
  const it = (await c.query(`select i.*, r.paciente_id, e.procedimento_id, l.unidade_id lab_unidade from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id left join lab.laboratorio l on l.id = i.laboratorio_id where i.id = $1 for update of i`, [itemId])).rows[0];
  if (!it) throw new ErroHttp(404, 'Exame não encontrado.');
  if (it.situacao === 'LIBERADO') throw new ErroHttp(409, 'Exame já liberado.');
  if (it.situacao === 'CANCELADO') throw new ErroHttp(422, 'Exame cancelado.');
  await c.query(
    `update lab.requisicao_exame set situacao = 'LIBERADO', anexo_externo = true, laudo_arquivo_id = $2, liberado_em = now(), liberado_por = $3, liberado_operador_id = $4 where id = $1`,
    [itemId, arquivoId, u.profissionalId, u.id],
  );
  if (it.solicitacao_item_id)
    await c.query(`update amb.solicitacao_exame_item set situacao = 'REALIZADO', resultado_texto = 'Resultado anexado em PDF.', resultado_arquivo_id = $2, resultado_liberado_em = now() where id = $1`, [it.solicitacao_item_id, arquivoId]);
  if ((await P.producaoExame()) && (it.lab_unidade ?? u.unidadeAtual)) {
    const p = await lancarProducao(c, { data: hojeLocal(), unidadeId: it.lab_unidade ?? u.unidadeAtual, profissionalId: u.profissionalId, procedimentoId: it.procedimento_id, pacienteId: it.paciente_id, origem: 'EXAME', referencia: `lab_item:${itemId}` });
    if (p) await c.query(`update lab.requisicao_exame set producao_id = $2 where id = $1`, [itemId, p.id]);
  }
  await atualizarSituacaoRequisicao(c, it.requisicao_id);
  return { ok: true };
}

/** Entrega do resultado ou registro de não retirado (TR 1.2.47.43.62, 1.2.47.43.69). */
export async function registrarEntrega(c: C, requisicaoId: number, d: { retiradoPor?: string | null; naoRetirado?: boolean }, u: Usuario) {
  const r = await travarRequisicao(c, requisicaoId);
  const lib = (await c.query(`select count(*)::int n from lab.requisicao_exame where requisicao_id = $1 and situacao = 'LIBERADO'`, [requisicaoId])).rows[0].n;
  if (!lib) throw new ErroHttp(422, 'Somente após a liberação da assinatura é possível registrar a entrega ou a não retirada do resultado.');
  if (d.naoRetirado) await c.query(`update lab.requisicao set situacao = 'NAO_RETIRADA' where id = $1`, [requisicaoId]);
  else {
    if (!d.retiradoPor?.trim()) throw new ErroHttp(422, 'Informe quem retirou o resultado.');
    await c.query(`update lab.requisicao set situacao = 'ENTREGUE', entregue_em = now(), entregue_a = $2 where id = $1`, [requisicaoId, `${d.retiradoPor} (entregue por ${u.nome})`]);
  }
  return { ok: true, situacaoAnterior: r.situacao };
}

/** Ocorrência com motivo pré-definido e aviso ao solicitante/origem (TR 1.2.47.20, 1.2.47.21). */
export async function registrarOcorrencia(c: C, d: { requisicaoId: number; itemId?: number | null; motivoId: number; descricao?: string | null }, u: Usuario) {
  const r = (
    await c.query(
      `select r.*, p.nome paciente from lab.requisicao r join cad.pessoa p on p.id = r.paciente_id where r.id = $1`,
      [d.requisicaoId],
    )
  ).rows[0];
  if (!r) throw new ErroHttp(404, 'Requisição não encontrada.');
  const m = (await c.query(`select * from lab.motivo_ocorrencia where id = $1`, [d.motivoId])).rows[0];
  if (!m) throw new ErroHttp(422, 'Motivo inválido.');
  const exame = d.itemId ? (await c.query(`select e.nome from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.id = $1`, [d.itemId])).rows[0]?.nome : null;
  const oc = (
    await c.query(`insert into lab.ocorrencia (requisicao_id, item_id, motivo_id, data_hora, descricao, operador_id, notificado) values ($1,$2,$3,now(),$4,$5,false) returning *`, [
      d.requisicaoId,
      d.itemId ?? null,
      d.motivoId,
      d.descricao ?? null,
      u.id,
    ])
  ).rows[0];
  let notificados = 0;
  if (m.notificar_solicitante) {
    const msg = `Requisição ${r.numero} (${r.paciente})${exame ? ` - ${exame}` : ''}: ${m.nome}${d.descricao ? `. ${d.descricao}` : ''}.`;
    if (r.profissional_solicitante_id) notificados += await notificarProfissional(c, r.profissional_solicitante_id, 'Ocorrência no laboratório', msg);
    // Origem: operadores com a unidade solicitante como unidade padrão.
    if (r.unidade_solicitante_id)
      notificados +=
        (
          await c.query(
            `insert into sis.notificacao_operador (destinatario_id, titulo, mensagem)
             select id, 'Ocorrência no laboratório', $2 from seg.operador where unidade_padrao_id = $1 and ativo and (profissional_id is distinct from $3) limit 20`,
            [r.unidade_solicitante_id, msg, r.profissional_solicitante_id],
          )
        ).rowCount ?? 0;
    await c.query(`update lab.ocorrencia set notificado = $2 where id = $1`, [oc.id, notificados > 0]);
  }
  // Motivo que exige recoleta: descarta as amostras do exame e o devolve à fila.
  const situacaoItem = d.itemId ? (await c.query(`select situacao from lab.requisicao_exame where id = $1`, [d.itemId])).rows[0]?.situacao : null;
  if (m.exige_recoleta && d.itemId && !['LIBERADO', 'CANCELADO'].includes(situacaoItem)) {
    const am = (await c.query(`select id from lab.amostra where requisicao_id = $1 and situacao = 'COLETADA' and itens @> $2::jsonb`, [d.requisicaoId, JSON.stringify([d.itemId])])).rows;
    for (const a of am) await descartarAmostra(c, a.id, `Ocorrência: ${m.nome}`, u);
  }
  return { ...oc, notificado: notificados > 0, notificados };
}
