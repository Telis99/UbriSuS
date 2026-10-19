// Regras de negócio comuns à Radiologia (TR 1.2.45) e à Ecografia (TR 1.2.50): lista de trabalho a partir
// da agenda de exames, execução, laudo com modelos, assinatura gráfica, liberação no prontuário,
// impressão do resultado/envelope com código de validação, entrega e produção para o faturamento.
import type pg from 'pg';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { idadeTexto } from '../../compartilhado/validacao.js';
import { consultar, consultarUm, pool } from '../../db/pool.js';
import { lerArquivo } from '../../servicos/arquivos.js';
import { obterIdentidade } from '../../servicos/pdf.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { conferirSenha } from '../../seguranca/senha.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { proximoNumero } from '../atendimento/servico.js';
import { lancarProducao } from '../faturamento/producao.js';
import { LATERALIDADE, nomes, SITUACAO_LAUDO, type ConfigImagem } from './imagem.js';

const fmtData = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');
const fmtDataHora = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');
const rotuloDe = (opcoes: [string, string][], v?: string | null) => opcoes.find(([k]) => k === v)?.[1] ?? v ?? '';

/** Laudo liberado: assinado, com resultado anexado ou já impresso. */
export const LAUDO_LIBERADO = ['ASSINADO', 'ANEXADO', 'IMPRESSO'];

// ---------------------------------------------------------------------------
// Lista de trabalho a partir da agenda de exames
// ---------------------------------------------------------------------------

/**
 * Gera os registros da lista de trabalho a partir dos exames agendados (agenda de exames com cotas) cujo
 * procedimento pertence ao cadastro de exames do módulo e ajusta os cancelados/transferidos.
 */
export async function sincronizarAgenda(c: pg.PoolClient, cfg: ConfigImagem, de: string, ate: string) {
  const s = cfg.esquema;
  await c.query(
    `insert into ${s}.atendimento (data, hora, paciente_id, exame_id, procedimento_id, estrutura, unidade_id, unidade_solicitante_id, profissional_solicitante_id,
                                   requisicao, solicitacao_id, solicitacao_item_id, agendamento_id, agendamento_procedimento_id, convenio_id, urgente, situacao)
     select a.data, a.hora, a.paciente_id, e.id, ap.procedimento_id, coalesce(ap.estrutura, si.estrutura, si2.estrutura), a.unidade_id,
            coalesce(a.unidade_solicitante_id, sx.unidade_id), coalesce(a.profissional_solicitante_id, sx.profissional_id), sx.numero, sx.id,
            coalesce(si.id, si2.id), a.id, ap.id, a.convenio_id, coalesce(a.urgente, false),
            case when a.situacao in ('PRESENTE','ATENDIDO') then 'PRESENTE' when a.situacao = 'FALTA' then 'FALTOSO' else 'AGENDADO' end
       from age.agendamento a
       join age.agendamento_procedimento ap on ap.agendamento_id = a.id
       join ${s}.exame e on e.procedimento_id = ap.procedimento_id and e.ativo
       left join amb.solicitacao_exame_item si on si.id = ap.solicitacao_item_id
       left join amb.solicitacao_exame sx on sx.id = coalesce(a.requisicao_id, si.solicitacao_id)
       left join lateral (select x.id, x.estrutura from amb.solicitacao_exame_item x
                           where si.id is null and x.solicitacao_id = a.requisicao_id and x.procedimento_id = ap.procedimento_id and x.situacao <> 'CANCELADO'
                           order by x.id limit 1) si2 on true
      where a.data between $1 and $2 and a.situacao not in ('CANCELADO','TRANSFERIDO')
     on conflict (agendamento_procedimento_id) do nothing`,
    [de, ate],
  );
  await c.query(
    `update ${s}.atendimento t set situacao = 'CANCELADO'
       from age.agendamento a where a.id = t.agendamento_id and t.data between $1 and $2
        and a.situacao in ('CANCELADO','TRANSFERIDO') and t.situacao = 'AGENDADO'`,
    [de, ate],
  );
}

export interface FiltroLista {
  de?: string;
  ate?: string;
  unidadeId?: number;
  pacienteId?: number;
  nome?: string;
  prontuario?: string;
  unidadeSolicitanteId?: number;
  procedimento?: string;
  cpf?: string;
  cns?: string;
  convenioId?: number;
  requisicao?: string;
  situacao?: string;
  situacaoLaudo?: string;
  situacaoEntrega?: string;
  exameId?: number;
}

/** Campos exibidos na lista de trabalho (TR 1.2.45.8.1, 1.2.50.8.1.1 a 1.2.50.8.1.8). */
export function selectLista(s: string) {
  return `select t.id, t.data::text data, to_char(t.hora, 'HH24:MI') hora, t.paciente_id, p.nome paciente, p.nome_social, p.cpf, p.cns, p.sexo, p.data_nascimento::text nascimento,
                 coalesce((select pp.numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id order by (pp.unidade_id = t.unidade_id) desc, pp.id limit 1), p.prontuario) prontuario,
                 us.nome unidade_solicitante, ps.nome profissional_solicitante, t.requisicao, pr.codigo procedimento_codigo, coalesce(e.nome, pr.nome) procedimento,
                 t.estrutura, t.lateralidade, t.situacao, t.situacao_laudo, t.situacao_entrega, t.urgente, cv.nome convenio, up.nome unidade,
                 t.exame_id, t.unidade_id, t.agendamento_id, tec.nome executante, asn.nome assinante, t.assinado_em, t.resultado_arquivo_id, t.laudo_arquivo_id,
                 t.retirado_em, t.retirado_por, t.impressoes, t.envelope_em
            from ${s}.atendimento t join cad.pessoa p on p.id = t.paciente_id
            join ${s}.exame e on e.id = t.exame_id left join cad.procedimento pr on pr.id = t.procedimento_id
            left join cad.unidade us on us.id = t.unidade_solicitante_id left join cad.profissional ps on ps.id = t.profissional_solicitante_id
            left join cad.unidade up on up.id = t.unidade_id left join cad.convenio cv on cv.id = t.convenio_id
            left join cad.profissional tec on tec.id = t.tecnico_id left join cad.profissional asn on asn.id = t.assinante_id`;
}

/**
 * Pesquisa da recepção: código, nome, data, prontuário, unidade solicitante, procedimento, CPF e CNS do
 * paciente, convênio e status do laudo (TR 1.2.45.8.2 a 1.2.45.8.4, 1.2.50.8.2.1 a 1.2.50.8.2.8, 1.2.50.8.3, 1.2.50.8.4).
 */
export async function listar(cfg: ConfigImagem, f: FiltroLista, limite = 500) {
  const params: unknown[] = [];
  const cond: string[] = [];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);
  if (f.de) cond.push(`t.data >= ${p(f.de)}`);
  if (f.ate) cond.push(`t.data <= ${p(f.ate)}`);
  if (f.unidadeId) cond.push(`t.unidade_id = ${p(f.unidadeId)}`);
  if (f.pacienteId) cond.push(`t.paciente_id = ${p(f.pacienteId)}`);
  if (f.nome) cond.push(`(cad.fn_normalizar(p.nome) like '%' || cad.fn_normalizar(${p(f.nome)}) || '%' or cad.fn_normalizar(coalesce(p.nome_social, '')) like '%' || cad.fn_normalizar(${p(f.nome)}) || '%')`);
  if (f.prontuario) cond.push(`(p.prontuario = ${p(f.prontuario)} or exists (select 1 from cad.pessoa_prontuario pp where pp.pessoa_id = p.id and pp.numero = ${p(f.prontuario)}))`);
  if (f.unidadeSolicitanteId) cond.push(`t.unidade_solicitante_id = ${p(f.unidadeSolicitanteId)}`);
  if (f.procedimento) cond.push(`(pr.codigo = ${p(f.procedimento)} or cad.fn_normalizar(coalesce(e.nome, pr.nome)) like '%' || cad.fn_normalizar(${p(f.procedimento)}) || '%')`);
  if (f.cpf) cond.push(`p.cpf = ${p(f.cpf.replace(/\D/g, ''))}`);
  if (f.cns) cond.push(`p.cns = ${p(f.cns.replace(/\D/g, ''))}`);
  if (f.convenioId) cond.push(`t.convenio_id = ${p(f.convenioId)}`);
  if (f.requisicao) cond.push(`t.requisicao = ${p(f.requisicao)}`);
  if (f.situacao) cond.push(`t.situacao = any(${p(f.situacao.split(','))})`);
  if (f.situacaoLaudo) cond.push(`t.situacao_laudo = any(${p(f.situacaoLaudo.split(','))})`);
  if (f.situacaoEntrega) cond.push(`t.situacao_entrega = any(${p(f.situacaoEntrega.split(','))})`);
  if (f.exameId) cond.push(`t.exame_id = ${p(f.exameId)}`);
  return consultar(
    `${selectLista(cfg.esquema)} ${cond.length ? 'where ' + cond.join(' and ') : ''}
      order by t.data, t.urgente desc, t.hora nulls last, p.nome limit ${Math.min(limite, 2000)}`,
    params,
  );
}

// ---------------------------------------------------------------------------
// Exame do paciente
// ---------------------------------------------------------------------------

export async function exameOuErro(c: pg.PoolClient | pg.Pool, cfg: ConfigImagem, id: number, bloquear = false) {
  const t = (await c.query(`select * from ${cfg.esquema}.atendimento where id = $1 ${bloquear ? 'for update' : ''}`, [id])).rows[0];
  if (!t) throw new ErroHttp(404, 'Exame não encontrado.');
  return t;
}

const exigirAtivo = (t: any) => {
  if (t.situacao === 'CANCELADO') throw new ErroHttp(422, 'Exame cancelado.');
  if (t.situacao === 'FALTOSO') throw new ErroHttp(422, 'Paciente registrado como faltoso. Desfaça a falta para continuar.');
};

/** Inclusão de exame sem agendamento prévio (urgência, demanda espontânea ou requisição externa). */
export async function incluirAvulso(
  c: pg.PoolClient,
  cfg: ConfigImagem,
  d: { pacienteId: number; exameId: number; estrutura?: string; lateralidade?: string; unidadeId: number; unidadeSolicitanteId?: number; profissionalSolicitanteId?: number; requisicao?: string; solicitacaoItemId?: number; convenioId?: number; urgente?: boolean },
) {
  const s = cfg.esquema;
  const ex = (await c.query(`select * from ${s}.exame where id = $1 and ativo`, [d.exameId])).rows[0];
  if (!ex) throw new ErroHttp(422, 'Exame inexistente ou inativo.');
  let item: any = null;
  if (d.solicitacaoItemId) {
    item = (
      await c.query(
        `select i.*, s.numero, s.unidade_id sol_unidade, s.profissional_id sol_prof from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id where i.id = $1`,
        [d.solicitacaoItemId],
      )
    ).rows[0];
    if (!item) throw new ErroHttp(404, 'Item da requisição não encontrado.');
    if (item.procedimento_id !== ex.procedimento_id) throw new ErroHttp(422, 'O exame não corresponde ao item da requisição.');
  }
  const r = await c.query(
    `insert into ${s}.atendimento (data, hora, paciente_id, exame_id, procedimento_id, estrutura, lateralidade, unidade_id, unidade_solicitante_id, profissional_solicitante_id,
                                   requisicao, solicitacao_id, solicitacao_item_id, convenio_id, urgente, situacao, chegada_em)
     values (current_date, localtime(0), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PRESENTE', now()) returning *`,
    [
      d.pacienteId,
      ex.id,
      ex.procedimento_id,
      d.estrutura ?? item?.estrutura ?? null,
      d.lateralidade ?? 'NA',
      d.unidadeId,
      d.unidadeSolicitanteId ?? item?.sol_unidade ?? null,
      d.profissionalSolicitanteId ?? item?.sol_prof ?? null,
      d.requisicao ?? item?.numero ?? null,
      item?.solicitacao_id ?? null,
      item?.id ?? null,
      d.convenioId ?? null,
      !!d.urgente,
    ],
  );
  return r.rows[0];
}

/** Chegada do paciente (check-in) na recepção do serviço. */
export async function registrarChegada(c: pg.PoolClient, cfg: ConfigImagem, id: number) {
  const t = await exameOuErro(c, cfg, id, true);
  exigirAtivo(t);
  if (t.situacao !== 'AGENDADO') return t;
  await c.query(`update ${cfg.esquema}.atendimento set situacao = 'PRESENTE', chegada_em = now() where id = $1`, [id]);
  if (t.agendamento_id) await c.query(`update age.agendamento set situacao = 'PRESENTE' where id = $1 and situacao in ('AGENDADO','CONFIRMADO','ATRASO')`, [t.agendamento_id]);
  return { ...t, situacao: 'PRESENTE' };
}

export interface DadosExecucao {
  tecnicoId?: number | null;
  equipamentoId?: number | null;
  estrutura?: string | null;
  lateralidade?: string | null;
  incidencias?: string | null;
  filmesQuantidade?: number | null;
  filmeTamanho?: string | null;
  filmesPerdidos?: number | null;
  contraste?: boolean | null;
  contrasteDescricao?: string | null;
  observacao?: string | null;
}

/**
 * Registra a execução do exame (executante, sala/equipamento, incidências, filmes e contraste), conclui o
 * agendamento e lança a produção ambulatorial (BPA) sem redigitação.
 */
export async function executar(c: pg.PoolClient, cfg: ConfigImagem, id: number, d: DadosExecucao, u: Usuario) {
  const s = cfg.esquema;
  const t = await exameOuErro(c, cfg, id, true);
  exigirAtivo(t);
  const executante = d.tecnicoId ?? t.tecnico_id ?? u.profissionalId ?? null;
  const ex = (await c.query(`select * from ${s}.exame where id = $1`, [t.exame_id])).rows[0];
  if (d.equipamentoId && !(await c.query(`select 1 from ${s}.equipamento where id = $1 and ativo`, [d.equipamentoId])).rowCount) throw new ErroHttp(422, 'Sala/equipamento inexistente ou inativo.');
  if (d.tecnicoId && !(await c.query(`select 1 from cad.profissional where id = $1 and ativo is not false`, [d.tecnicoId])).rowCount) throw new ErroHttp(422, 'Profissional executante inexistente ou inativo.');
  const sets: string[] = [`situacao = 'REALIZADO'`, `executado_em = coalesce(executado_em, now())`, `chegada_em = coalesce(chegada_em, now())`, `tecnico_id = $2`];
  const params: unknown[] = [id, executante];
  const set = (col: string, v: unknown) => {
    if (v === undefined) return;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  set('equipamento_id', d.equipamentoId);
  set('estrutura', d.estrutura);
  set('lateralidade', d.lateralidade);
  set('observacao_execucao', d.observacao);
  if (cfg.execucaoRadiologica) {
    set('incidencias', d.incidencias ?? (t.incidencias ? undefined : ex?.incidencias_padrao ?? undefined));
    set('filmes_quantidade', d.filmesQuantidade ?? (t.filmes_quantidade != null ? undefined : ex?.filmes_padrao ?? undefined));
    set('filme_tamanho', d.filmeTamanho ?? (t.filme_tamanho ? undefined : ex?.filme_tamanho_padrao ?? undefined));
    set('filmes_perdidos', d.filmesPerdidos);
    set('contraste', d.contraste ?? (t.contraste ? undefined : ex?.contraste ?? undefined));
    set('contraste_descricao', d.contrasteDescricao);
  }
  await c.query(`update ${s}.atendimento set ${sets.join(', ')} where id = $1`, params);
  if (t.agendamento_id) {
    await c.query(
      `update age.agendamento set situacao = 'ATENDIDO' where id = $1 and situacao in ('AGENDADO','CONFIRMADO','PRESENTE','ATRASO')
          and not exists (select 1 from ${s}.atendimento x where x.agendamento_id = $1 and x.situacao in ('AGENDADO','PRESENTE') and x.id <> $2)`,
      [t.agendamento_id, id],
    );
  }
  if (t.solicitacao_item_id) await c.query(`update amb.solicitacao_exame_item set situacao = 'REALIZADO', prestador_id = coalesce(prestador_id, $2) where id = $1 and situacao in ('REQUISITADO','AGENDADO','COLETADO')`, [t.solicitacao_item_id, t.unidade_id]);
  // Produção do prestador para o faturamento (BPA), uma única vez por exame (TR 1.2.45.9.1, 1.2.50.9.1).
  if (!t.producao_id && t.unidade_id) {
    const prod = await lancarProducao(c, {
      data: new Date().toISOString().slice(0, 10),
      unidadeId: t.unidade_id,
      profissionalId: executante,
      procedimentoId: t.procedimento_id,
      pacienteId: t.paciente_id,
      quantidade: 1,
      origem: 'EXAME',
      referencia: `${s}:${id}`,
    });
    if (prod) await c.query(`update ${s}.atendimento set producao_id = $2 where id = $1`, [id, prod.id]);
  }
  return exameOuErro(c, cfg, id);
}

/** Pacientes faltosos (TR 1.2.45.8.14): registra a falta e reflete no agendamento quando todos os exames faltaram. */
export async function registrarFalta(c: pg.PoolClient, cfg: ConfigImagem, id: number, motivo: string | undefined) {
  const s = cfg.esquema;
  const t = await exameOuErro(c, cfg, id, true);
  if (!['AGENDADO', 'PRESENTE'].includes(t.situacao)) throw new ErroHttp(422, 'Só é possível registrar falta de exame agendado e ainda não realizado.');
  await c.query(`update ${s}.atendimento set situacao = 'FALTOSO', falta_motivo = $2, falta_registrada_em = now() where id = $1`, [id, motivo ?? null]);
  if (t.agendamento_id) {
    await c.query(
      `update age.agendamento set situacao = 'FALTA', justificativa_falta = coalesce($2, justificativa_falta)
        where id = $1 and situacao in ('AGENDADO','CONFIRMADO','PRESENTE','ATRASO')
          and not exists (select 1 from ${s}.atendimento x where x.agendamento_id = $1 and x.situacao <> 'FALTOSO' and x.id <> $3)`,
      [t.agendamento_id, motivo ?? null, id],
    );
  }
}

export async function desfazerFalta(c: pg.PoolClient, cfg: ConfigImagem, id: number) {
  const t = await exameOuErro(c, cfg, id, true);
  if (t.situacao !== 'FALTOSO') throw new ErroHttp(422, 'O exame não está registrado como falta.');
  await c.query(`update ${cfg.esquema}.atendimento set situacao = 'AGENDADO', falta_motivo = null, falta_registrada_em = null where id = $1`, [id]);
  if (t.agendamento_id) await c.query(`update age.agendamento set situacao = 'AGENDADO' where id = $1 and situacao = 'FALTA'`, [t.agendamento_id]);
}

// ---------------------------------------------------------------------------
// Laudo
// ---------------------------------------------------------------------------

/** O resultado pode ser alterado enquanto não assinado e sem resultado anexado (TR 1.2.45.8.8, 1.2.50.8.8). */
export function exigirLaudoEditavel(t: any) {
  if (t.resultado_arquivo_id) throw new ErroHttp(422, 'O exame possui resultado anexado e não pode mais ser alterado.');
  if (!['NAO_DIGITADO', 'DIGITADO'].includes(t.situacao_laudo)) throw new ErroHttp(422, `Laudo ${rotuloDe(SITUACAO_LAUDO, t.situacao_laudo).toLowerCase()}: alteração não permitida. Utilize a retificação.`);
}

/** Variáveis disponíveis nos modelos de resultado. */
export async function variaveis(c: pg.PoolClient | pg.Pool, cfg: ConfigImagem, id: number): Promise<Record<string, string>> {
  const s = cfg.esquema;
  const r = await consultarUm(
    `select p.nome, p.nome_social, p.sexo, p.data_nascimento::text nasc, t.data::text data, coalesce(e.nome, pr.nome) exame, t.estrutura, t.lateralidade,
            ps.nome solicitante, t.requisicao, u.nome unidade
       from ${s}.atendimento t join cad.pessoa p on p.id = t.paciente_id join ${s}.exame e on e.id = t.exame_id
       left join cad.procedimento pr on pr.id = t.procedimento_id left join cad.profissional ps on ps.id = t.profissional_solicitante_id
       left join cad.unidade u on u.id = t.unidade_id where t.id = $1`,
    [id],
    c,
  );
  if (!r) throw new ErroHttp(404, 'Exame não encontrado.');
  return {
    paciente: r.nome_social ? `${r.nome_social} (${r.nome})` : r.nome,
    idade: idadeTexto(r.nasc),
    sexo: r.sexo === 'F' ? 'feminino' : r.sexo === 'M' ? 'masculino' : 'ignorado',
    data: fmtData(r.data),
    exame: r.exame ?? '',
    estrutura: r.estrutura ?? '',
    lateralidade: r.lateralidade && r.lateralidade !== 'NA' ? rotuloDe(LATERALIDADE, r.lateralidade).toLowerCase() : '',
    solicitante: r.solicitante ?? '',
    requisicao: r.requisicao ?? '',
    unidade: r.unidade ?? '',
  };
}

export const VARIAVEIS_EXEMPLO: Record<string, string> = {
  paciente: 'PACIENTE DE DEMONSTRAÇÃO',
  idade: '45 anos',
  sexo: 'feminino',
  data: new Date().toLocaleDateString('pt-BR'),
  exame: 'EXAME DE EXEMPLO',
  estrutura: 'ESTRUTURA EXEMPLO',
  lateralidade: 'direito',
  solicitante: 'PROFISSIONAL SOLICITANTE',
  requisicao: 'X2026000001',
  unidade: 'UNIDADE PRESTADORA',
};

export const aplicarVariaveis = (texto: string | null | undefined, v: Record<string, string>) => (texto ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

/** Modelos de resultado aplicáveis ao exame e ao laudista (gerais, do exame e pessoais). */
export async function modelosDoExame(cfg: ConfigImagem, exameId: number, profissionalId: number | null) {
  return consultar(
    `select id, nome, exame_id, profissional_id, padrao, texto, conclusao from ${cfg.esquema}.modelo_laudo
      where ativo and (exame_id is null or exame_id = $1) and (profissional_id is null or profissional_id = $2)
      order by (exame_id is null), padrao desc, nome`,
    [exameId, profissionalId ?? -1],
  );
}

/** Registro do resultado do exame com uso de modelos (TR 1.2.45.8.5, 1.2.50.8.5). */
export async function salvarLaudo(c: pg.PoolClient, cfg: ConfigImagem, id: number, d: { texto: string; conclusao?: string | null; modeloId?: number | null; laudistaId?: number | null }, u: Usuario) {
  let t = await exameOuErro(c, cfg, id, true);
  exigirAtivo(t);
  exigirLaudoEditavel(t);
  if (t.situacao !== 'REALIZADO') t = await executar(c, cfg, id, {}, u);
  const vazio = !d.texto.trim();
  await c.query(
    `update ${cfg.esquema}.atendimento set laudo_texto = $2, conclusao = $3, modelo_id = coalesce($4, modelo_id), laudista_id = coalesce($5, laudista_id, $6),
            situacao_laudo = $7, digitado_em = now(), digitado_por = $8 where id = $1`,
    [id, d.texto, d.conclusao ?? null, d.modeloId ?? null, d.laudistaId ?? null, u.profissionalId, vazio ? 'NAO_DIGITADO' : 'DIGITADO', u.id],
  );
  return exameOuErro(c, cfg, id);
}

/** Digitalizações de imagens anexadas ao resultado (TR 1.2.45.8.6, 1.2.50.8.6). */
export async function adicionarImagem(c: pg.PoolClient, cfg: ConfigImagem, id: number, d: { arquivoId: string; descricao?: string; incluirLaudo?: boolean }) {
  const t = await exameOuErro(c, cfg, id, true);
  exigirAtivo(t);
  exigirLaudoEditavel(t);
  const arq = (await c.query(`select tipo_mime from sis.arquivo where id = $1`, [d.arquivoId])).rows[0];
  if (!arq) throw new ErroHttp(404, 'Arquivo não encontrado.');
  if (!/^image\/(png|jpeg|webp)$/.test(arq.tipo_mime)) throw new ErroHttp(415, 'Envie a digitalização como imagem PNG ou JPEG.');
  return (
    await c.query(`insert into ${cfg.esquema}.imagem (atendimento_id, arquivo_id, descricao, incluir_laudo) values ($1,$2,$3,$4) returning *`, [
      id,
      d.arquivoId,
      d.descricao ?? null,
      d.incluirLaudo ?? true,
    ])
  ).rows[0];
}

export async function removerImagem(c: pg.PoolClient, cfg: ConfigImagem, id: number, imagemId: number) {
  const t = await exameOuErro(c, cfg, id, true);
  exigirLaudoEditavel(t);
  const r = await c.query(`delete from ${cfg.esquema}.imagem where id = $1 and atendimento_id = $2`, [imagemId, id]);
  if (!r.rowCount) throw new ErroHttp(404, 'Imagem não encontrada.');
}

/** Resultado anexado (arquivo do equipamento/PACS ou laudo externo) (TR 1.2.45.8.7, 1.2.50.8.7). */
export async function anexarResultado(c: pg.PoolClient, cfg: ConfigImagem, id: number, arquivoId: string, u: Usuario) {
  let t = await exameOuErro(c, cfg, id, true);
  exigirAtivo(t);
  exigirLaudoEditavel(t);
  const arq = (await c.query(`select tipo_mime from sis.arquivo where id = $1`, [arquivoId])).rows[0];
  if (!arq) throw new ErroHttp(404, 'Arquivo não encontrado.');
  if (t.situacao !== 'REALIZADO') t = await executar(c, cfg, id, {}, u);
  await c.query(
    `update ${cfg.esquema}.atendimento set resultado_arquivo_id = $2, anexado_em = now(), situacao_laudo = 'ANEXADO', laudista_id = coalesce(laudista_id, $3) where id = $1`,
    [id, arquivoId, u.profissionalId],
  );
  t = await exameOuErro(c, cfg, id);
  await liberarNoProntuario(c, cfg, t, arquivoId);
  return t;
}

/** Profissional habilitado a assinar o exame no cadastro de assinantes (TR 1.2.45.5, 1.2.50.5). */
export async function assinanteDoExame(c: pg.PoolClient | pg.Pool, cfg: ConfigImagem, profissionalId: number | null, exameId: number) {
  if (!profissionalId) return null;
  return consultarUm(
    `select a.id, a.titulo, coalesce(a.assinatura_grafica_id, p.assinatura_grafica_id) grafica
       from ${cfg.esquema}.assinante a join cad.profissional p on p.id = a.profissional_id
      where a.profissional_id = $1 and a.ativo and (a.exame_id is null or a.exame_id = $2) order by a.exame_id nulls last limit 1`,
    [profissionalId, exameId],
    c,
  );
}

/**
 * Assinatura dos resultados digitados (não anexados) pelo profissional assinante, com aplicação da assinatura
 * gráfica, o que permite a liberação a distância; o laudo é emitido com código de validação e liberado no
 * prontuário do paciente (TR 1.2.45.6, 1.2.45.8.9, 1.2.50.6, 1.2.50.8.9).
 */
export async function assinar(c: pg.PoolClient, cfg: ConfigImagem, id: number, u: Usuario, senha?: string) {
  const s = cfg.esquema;
  const t = await exameOuErro(c, cfg, id, true);
  if (t.resultado_arquivo_id) throw new ErroHttp(422, 'Resultado anexado: a assinatura se aplica somente a resultados digitados.');
  if (t.situacao_laudo !== 'DIGITADO' || !t.laudo_texto?.trim()) throw new ErroHttp(422, 'Digite o resultado antes de assinar.');
  if (!u.profissionalId) throw new ErroHttp(403, 'O operador não está vinculado a um profissional de saúde para assinar laudos.');
  const assinante = await assinanteDoExame(c, cfg, u.profissionalId, t.exame_id);
  if (!assinante) throw new ErroHttp(403, `Profissional não definido como assinante dos resultados de ${cfg.titulo.toLowerCase()} para este exame.`);
  if (await parametro<boolean>(`${s}.assinatura_confirmar_senha`, true)) {
    const op = (await c.query(`select senha_hash from seg.operador where id = $1`, [u.id])).rows[0];
    if (!senha || !(await conferirSenha(senha, op?.senha_hash))) throw new ErroHttp(422, 'Senha de confirmação da assinatura inválida.');
  }
  await c.query(
    `update ${s}.atendimento set situacao_laudo = 'ASSINADO', assinante_id = $2, assinado_em = now(), assinatura_grafica_id = $3, laudista_id = coalesce(laudista_id, $2) where id = $1`,
    [id, u.profissionalId, assinante.grafica ?? null],
  );
  const pdf = await gerarPdfLaudo(c, cfg, id, u, {});
  await c.query(`update ${s}.atendimento set laudo_arquivo_id = $2, codigo_validacao = $3 where id = $1`, [id, pdf.arquivoId, pdf.codigo]);
  await liberarNoProntuario(c, cfg, await exameOuErro(c, cfg, id), pdf.arquivoId);
  return { ...(await exameOuErro(c, cfg, id)), codigo: pdf.codigo };
}

/** Retificação de laudo liberado: guarda a versão anterior, recolhe o resultado do prontuário e reabre a digitação. */
export async function retificar(c: pg.PoolClient, cfg: ConfigImagem, id: number, motivo: string, u: Usuario) {
  const s = cfg.esquema;
  const t = await exameOuErro(c, cfg, id, true);
  if (!LAUDO_LIBERADO.includes(t.situacao_laudo)) throw new ErroHttp(422, 'Somente laudos liberados podem ser retificados.');
  const historico = [
    ...(Array.isArray(t.retificacoes) ? t.retificacoes : []),
    { em: new Date().toISOString(), operador: u.nome, motivo, texto: t.laudo_texto, conclusao: t.conclusao, assinante_id: t.assinante_id, assinado_em: t.assinado_em, anexo: t.resultado_arquivo_id, codigo: t.codigo_validacao },
  ];
  await c.query(
    `update ${s}.atendimento set situacao_laudo = case when coalesce(laudo_texto, '') = '' then 'NAO_DIGITADO' else 'DIGITADO' end, assinante_id = null, assinado_em = null,
            assinatura_grafica_id = null, resultado_arquivo_id = null, anexado_em = null, laudo_arquivo_id = null, codigo_validacao = null, retificacoes = $2 where id = $1`,
    [id, JSON.stringify(historico)],
  );
  if (t.solicitacao_item_id)
    await c.query(`update amb.solicitacao_exame_item set resultado_texto = $2, resultado_arquivo_id = null, resultado_liberado_em = null where id = $1`, [
      t.solicitacao_item_id,
      `Laudo em retificação: ${motivo}`,
    ]);
}

/**
 * Disponibiliza o resultado no histórico e no prontuário do paciente, no item da requisição do profissional
 * solicitante; exames sem requisição eletrônica geram a requisição correspondente
 * (TR 1.2.45.8.12, 1.2.45.8.13, 1.2.50.8.12, 1.2.50.8.13).
 */
export async function liberarNoProntuario(c: pg.PoolClient, cfg: ConfigImagem, t: any, arquivoId: string | null) {
  const s = cfg.esquema;
  let itemId = t.solicitacao_item_id as number | null;
  if (!itemId) {
    const numero = await proximoNumero(c, 'amb.solicitacao_exame', 'X');
    const sol = (
      await c.query(
        `insert into amb.solicitacao_exame (numero, paciente_id, profissional_id, unidade_id, data, dados_clinicos, situacao)
         values ($1,$2,$3,$4,$5,$6,'REALIZADO') returning id`,
        [numero, t.paciente_id, t.profissional_solicitante_id, t.unidade_solicitante_id ?? t.unidade_id, t.data, `Registrada pelo módulo de ${cfg.titulo}${t.requisicao ? ` (requisição ${t.requisicao})` : ''}.`],
      )
    ).rows[0];
    itemId = (
      await c.query(
        `insert into amb.solicitacao_exame_item (solicitacao_id, procedimento_id, estrutura, quantidade, situacao, prestador_id) values ($1,$2,$3,1,'REALIZADO',$4) returning id`,
        [sol.id, t.procedimento_id, t.estrutura, t.unidade_id],
      )
    ).rows[0].id;
    await c.query(`update ${s}.atendimento set solicitacao_id = $2, solicitacao_item_id = $3, requisicao = coalesce(requisicao, $4) where id = $1`, [t.id, sol.id, itemId, numero]);
  }
  const texto = t.resultado_arquivo_id
    ? `Resultado anexado em arquivo (${cfg.titulo}).${t.laudo_texto ? '\n' + t.laudo_texto : ''}`
    : [t.laudo_texto, t.conclusao ? `Conclusão: ${t.conclusao}` : null].filter(Boolean).join('\n\n');
  await c.query(
    `update amb.solicitacao_exame_item set resultado_texto = $2, resultado_arquivo_id = $3, resultado_liberado_em = now(),
            situacao = case when situacao = 'AVALIADO' then 'AVALIADO' else 'REALIZADO' end, prestador_id = coalesce(prestador_id, $4) where id = $1`,
    [itemId, texto, arquivoId, t.unidade_id],
  );
  await c.query(
    `update amb.solicitacao_exame s set situacao = 'REALIZADO' where s.id = (select solicitacao_id from amb.solicitacao_exame_item where id = $1)
        and not exists (select 1 from amb.solicitacao_exame_item i where i.solicitacao_id = s.id and i.situacao in ('REQUISITADO','AGENDADO','COLETADO'))`,
    [itemId],
  );
}

// ---------------------------------------------------------------------------
// Entrega do resultado
// ---------------------------------------------------------------------------

/** Exames retirados (TR 1.2.50.8.14): registra quem retirou o resultado. */
export async function registrarEntrega(c: pg.PoolClient, cfg: ConfigImagem, id: number, d: { retiradoPor: string; documento?: string }, u: Usuario) {
  const t = await exameOuErro(c, cfg, id, true);
  if (!LAUDO_LIBERADO.includes(t.situacao_laudo)) throw new ErroHttp(422, 'O resultado ainda não foi liberado (assinado ou anexado).');
  await c.query(
    `update ${cfg.esquema}.atendimento set situacao_entrega = 'RETIRADO', retirado_em = now(), retirado_por = $2, documento_retirada = $3, entrega_operador_id = $4, nao_retirado_motivo = null where id = $1`,
    [id, d.retiradoPor, d.documento ?? null, u.id],
  );
}

/** Cadastro de exames não retirados (TR 1.2.45.8.15). */
export async function registrarNaoRetirado(c: pg.PoolClient, cfg: ConfigImagem, id: number, motivo: string | undefined, u: Usuario) {
  const t = await exameOuErro(c, cfg, id, true);
  if (t.situacao_entrega === 'RETIRADO') throw new ErroHttp(422, 'O resultado já foi retirado.');
  if (!LAUDO_LIBERADO.includes(t.situacao_laudo)) throw new ErroHttp(422, 'O resultado ainda não foi liberado (assinado ou anexado).');
  await c.query(`update ${cfg.esquema}.atendimento set situacao_entrega = 'NAO_RETIRADO', nao_retirado_motivo = $2, entrega_operador_id = $3 where id = $1`, [id, motivo ?? null, u.id]);
}

// ---------------------------------------------------------------------------
// Documentos (laudo, prévia do modelo e envelope)
// ---------------------------------------------------------------------------

const dataUrl = async (arquivoId: string | null | undefined, cliente: pg.PoolClient | pg.Pool = pool) => {
  if (!arquivoId) return undefined;
  try {
    const a = await lerArquivo(arquivoId, cliente);
    if (!/^image\/(png|jpeg)$/.test(a.tipo_mime)) return undefined;
    return `data:${a.tipo_mime};base64,${a.conteudo.toString('base64')}`;
  } catch {
    return undefined;
  }
};

/**
 * Cabeçalho do resultado para a unidade do solicitante ou do prestador, com o cabeçalho personalizado
 * cadastrado para a unidade (TR 1.2.45.7, 1.2.50.7).
 */
export async function cabecalhoResultado(c: pg.PoolClient | pg.Pool, cfg: ConfigImagem, unidadeId: number | null): Promise<Content> {
  const ident = await obterIdentidade();
  const un = unidadeId
    ? await consultarUm(
        `select u.nome, u.cnes, u.numero, u.telefone, l.tipo_abreviatura, l.nome logradouro, b.nome bairro, m.nome municipio
           from cad.unidade u left join cad.logradouro l on l.id = u.logradouro_id left join cad.bairro b on b.id = u.bairro_id
           left join cad.municipio m on m.id = u.municipio_id where u.id = $1`,
        [unidadeId],
        c,
      )
    : null;
  const cab = await consultarUm(
    `select titulo, linhas, logo_id from ${cfg.esquema}.cabecalho where ativo and (unidade_id = $1 or unidade_id is null) order by unidade_id nulls last limit 1`,
    [unidadeId ?? -1],
    c,
  );
  const logo = (await dataUrl(cab?.logo_id, c)) ?? ident.brasao;
  const endereco = un ? [un.logradouro ? `${un.tipo_abreviatura ?? ''} ${un.logradouro}, ${un.numero ?? 's/n'}`.trim() : null, un.bairro, un.municipio].filter(Boolean).join(' - ') : '';
  return {
    margin: [36, 20, 36, 0],
    columns: [
      logo ? { image: logo, fit: [52, 52], width: 60 } : { text: '', width: 0 },
      {
        stack: [
          { text: ident.entidade, style: 'entidade' },
          { text: ident.secretaria, style: 'secretaria' },
          { text: [un?.nome, cab?.titulo ?? cfg.servico].filter(Boolean).join(' - '), bold: true, fontSize: 9, margin: [0, 2, 0, 0] },
          ...(endereco || un?.cnes ? [{ text: [endereco, un?.cnes ? `CNES ${un.cnes}` : null, un?.telefone ? `Tel. ${un.telefone}` : null].filter(Boolean).join(' · '), fontSize: 7, color: '#444' }] : []),
          ...(cab?.linhas ? [{ text: cab.linhas, fontSize: 7, color: '#444' }] : []),
        ],
      },
    ],
  };
}

interface DadosLaudo {
  titulo: string;
  paciente: [string, string][];
  texto: string;
  conclusao?: string | null;
  imagens: string[];
  assinatura?: { grafica?: string; nome: string; registro: string; titulo?: string | null; em?: string | null } | null;
  previa?: boolean;
}

function corpoLaudo(d: DadosLaudo): Content[] {
  const pares: any[] = [];
  for (let i = 0; i < d.paciente.length; i += 2) {
    const a = d.paciente[i];
    const b = d.paciente[i + 1];
    pares.push([{ text: a[0], bold: true, fontSize: 8 }, { text: a[1], fontSize: 8 }, { text: b?.[0] ?? '', bold: true, fontSize: 8 }, { text: b?.[1] ?? '', fontSize: 8 }]);
  }
  const conteudo: Content[] = [
    { text: d.titulo, alignment: 'center', bold: true, fontSize: 12, margin: [0, 0, 0, 8] },
    { table: { widths: [80, '*', 80, '*'], body: pares }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 10] },
    ...(d.previa ? [{ text: 'PRÉVIA DO MODELO - SEM VALOR DE RESULTADO', color: '#c92a2a', bold: true, alignment: 'center', margin: [0, 0, 0, 8] } as Content] : []),
    { text: 'RESULTADO', style: 'h2' },
    { text: d.texto || '-', lineHeight: 1.25, fontSize: 10, preserveLeadingSpaces: true } as any,
    ...(d.conclusao ? [{ text: 'CONCLUSÃO', style: 'h2' } as Content, { text: d.conclusao, bold: true, fontSize: 10, lineHeight: 1.2 } as Content] : []),
  ];
  if (d.imagens.length) {
    conteudo.push({ text: 'IMAGENS', style: 'h2' });
    for (let i = 0; i < d.imagens.length; i += 2) {
      conteudo.push({
        columns: [0, 1].map((k) => (d.imagens[i + k] ? { image: d.imagens[i + k], fit: [250, 190], alignment: 'center' } : { text: '' })),
        columnGap: 12,
        margin: [0, 0, 0, 8],
        unbreakable: true,
      } as any);
    }
  }
  if (d.assinatura) {
    conteudo.push({
      unbreakable: true,
      margin: [0, 24, 0, 0],
      stack: [
        ...(d.assinatura.grafica ? [{ image: d.assinatura.grafica, fit: [170, 60], alignment: 'center' } as Content] : [{ text: ' ', margin: [0, 24, 0, 0] } as Content]),
        { text: '_______________________________________________', alignment: 'center' },
        { text: d.assinatura.nome, alignment: 'center', bold: true },
        { text: [d.assinatura.titulo, d.assinatura.registro].filter(Boolean).join(' - '), alignment: 'center', fontSize: 8 },
        ...(d.assinatura.em ? [{ text: `Assinado eletronicamente em ${d.assinatura.em}`, alignment: 'center', fontSize: 7, color: '#555' } as Content] : []),
      ],
    } as any);
  }
  return conteudo;
}

const ajustarCabecalho = (cab: Content) => (doc: TDocumentDefinitions) => {
  doc.header = () => cab;
  doc.pageMargins = [36, 100, 36, 56];
};

/**
 * Laudo em PDF com cabeçalho do prestador ou do solicitante, imagens, assinatura gráfica e código de
 * validação; liberado somente após a assinatura (TR 1.2.45.8.10, 1.2.50.8.10).
 */
export async function gerarPdfLaudo(c: pg.PoolClient | pg.Pool, cfg: ConfigImagem, id: number, u: Usuario, o: { cabecalho?: 'PRESTADOR' | 'SOLICITANTE' }) {
  const s = cfg.esquema;
  const t = await consultarUm(
    `select t.*, t.data::text dt, p.nome, p.nome_social, p.sexo, p.data_nascimento::text nasc, p.cns,
            coalesce((select pp.numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id order by (pp.unidade_id = t.unidade_id) desc, pp.id limit 1), p.prontuario) prontuario,
            coalesce(e.nome, pr.nome) exame, pr.codigo, ps.nome solicitante, us.nome unidade_solicitante, cv.nome convenio,
            pa.nome assinante, pa.conselho, pa.registro_conselho, pa.uf_conselho
       from ${s}.atendimento t join cad.pessoa p on p.id = t.paciente_id join ${s}.exame e on e.id = t.exame_id
       left join cad.procedimento pr on pr.id = t.procedimento_id left join cad.profissional ps on ps.id = t.profissional_solicitante_id
       left join cad.unidade us on us.id = t.unidade_solicitante_id left join cad.convenio cv on cv.id = t.convenio_id
       left join cad.profissional pa on pa.id = t.assinante_id where t.id = $1`,
    [id],
    c,
  );
  if (!t) throw new ErroHttp(404, 'Exame não encontrado.');
  if (!['ASSINADO', 'IMPRESSO'].includes(t.situacao_laudo) || !t.assinante_id) throw new ErroHttp(422, 'A impressão do resultado é liberada somente após a assinatura.');
  const tipoCab = o.cabecalho ?? (await parametro<string>(`${s}.laudo_cabecalho`, 'PRESTADOR'));
  const cab = await cabecalhoResultado(c, cfg, tipoCab === 'SOLICITANTE' ? (t.unidade_solicitante_id ?? t.unidade_id) : t.unidade_id);
  const imagens = (await Promise.all((await consultar(`select arquivo_id from ${s}.imagem where atendimento_id = $1 and incluir_laudo order by id`, [id], c)).map((i) => dataUrl(i.arquivo_id, c)))).filter(Boolean) as string[];
  const assinante = await assinanteDoExame(c, cfg, t.assinante_id, t.exame_id);
  const corpo = corpoLaudo({
    titulo: `LAUDO DE ${String(t.exame).toUpperCase()}`,
    paciente: [
      ['Paciente', t.nome_social ? `${t.nome_social} (${t.nome})` : t.nome],
      ['Prontuário', t.prontuario ?? '-'],
      ['Idade / sexo', `${idadeTexto(t.nasc)} / ${t.sexo ?? '-'}`],
      ['CNS', t.cns ?? '-'],
      ['Exame', `${t.codigo ?? ''} ${t.exame}`.trim()],
      ['Estrutura / órgão', [t.estrutura, t.lateralidade && t.lateralidade !== 'NA' ? rotuloDe(LATERALIDADE, t.lateralidade) : null].filter(Boolean).join(' - ') || '-'],
      ['Data do exame', fmtData(t.dt)],
      ['Requisição', t.requisicao ?? '-'],
      ['Solicitante', t.solicitante ?? '-'],
      ['Unidade solicitante', t.unidade_solicitante ?? '-'],
      ...(t.convenio ? [['Convênio', t.convenio] as [string, string]] : []),
    ],
    texto: t.laudo_texto,
    conclusao: t.conclusao,
    imagens,
    assinatura: {
      grafica: await dataUrl(t.assinatura_grafica_id ?? assinante?.grafica, c),
      nome: t.assinante,
      registro: [t.conselho, t.registro_conselho, t.uf_conselho].filter(Boolean).join(' '),
      titulo: assinante?.titulo,
      em: fmtDataHora(t.assinado_em),
    },
  });
  return emitirDocumento(
    { relatorio: `${s}:laudo`, titulo: `Laudo de ${cfg.titulo.toLowerCase()}`, filtros: { exame: id, cabecalho: tipoCab, emissao: Date.now() } },
    corpo,
    {},
    u,
    ajustarCabecalho(cab),
  );
}

/** Visualização prévia do modelo de resultado com dados fictícios (TR 1.2.45.4, 1.2.50.4). */
export async function gerarPreviaModelo(cfg: ConfigImagem, d: { texto: string; conclusao?: string | null; nome?: string; exame?: string | null }, u: Usuario) {
  const v: Record<string, string> = { ...VARIAVEIS_EXEMPLO, exame: d.exame ?? VARIAVEIS_EXEMPLO.exame };
  const cab = await cabecalhoResultado(pool, cfg, u.unidadeAtual);
  const prof = u.profissionalId ? await consultarUm(`select p.nome, p.conselho, p.registro_conselho, p.uf_conselho, p.assinatura_grafica_id from cad.profissional p where p.id = $1`, [u.profissionalId]) : null;
  const corpo = corpoLaudo({
    titulo: `LAUDO DE ${v.exame.toUpperCase()}`,
    paciente: [
      ['Paciente', v.paciente],
      ['Prontuário', '000000'],
      ['Idade / sexo', `${v.idade} / F`],
      ['Requisição', v.requisicao],
      ['Exame', v.exame],
      ['Estrutura / órgão', v.estrutura],
    ],
    texto: aplicarVariaveis(d.texto, v),
    conclusao: aplicarVariaveis(d.conclusao, v),
    imagens: [],
    assinatura: { grafica: await dataUrl(prof?.assinatura_grafica_id), nome: prof?.nome ?? 'PROFISSIONAL ASSINANTE', registro: prof ? [prof.conselho, prof.registro_conselho, prof.uf_conselho].filter(Boolean).join(' ') : 'CRM 000000 SP', em: null },
    previa: true,
  });
  return emitirDocumento({ relatorio: `${cfg.esquema}:previa-modelo`, titulo: `Prévia do modelo${d.nome ? ` - ${d.nome}` : ''}`, filtros: { modelo: d.nome, emissao: Date.now() } }, corpo, {}, u, ajustarCabecalho(cab));
}

/** Envelope do resultado, liberado somente após a assinatura (TR 1.2.45.8.11, 1.2.50.8.11). */
export async function gerarEnvelope(c: pg.PoolClient | pg.Pool, cfg: ConfigImagem, id: number, u: Usuario) {
  const s = cfg.esquema;
  const t = await consultarUm(
    `select t.*, t.data::text dt, p.nome, p.nome_social, coalesce((select pp.numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id order by (pp.unidade_id = t.unidade_id) desc, pp.id limit 1), p.prontuario) prontuario,
            coalesce(e.nome, pr.nome) exame, ps.nome solicitante, us.nome unidade_solicitante, up.nome unidade
       from ${s}.atendimento t join cad.pessoa p on p.id = t.paciente_id join ${s}.exame e on e.id = t.exame_id
       left join cad.procedimento pr on pr.id = t.procedimento_id left join cad.profissional ps on ps.id = t.profissional_solicitante_id
       left join cad.unidade us on us.id = t.unidade_solicitante_id left join cad.unidade up on up.id = t.unidade_id where t.id = $1`,
    [id],
    c,
  );
  if (!t) throw new ErroHttp(404, 'Exame não encontrado.');
  if (!LAUDO_LIBERADO.includes(t.situacao_laudo)) throw new ErroHttp(422, 'A impressão do envelope é liberada somente após a assinatura do resultado.');
  const ident = await obterIdentidade();
  const corpo: Content[] = [
    {
      columns: [
        ident.brasao ? { image: ident.brasao, fit: [40, 40], width: 48 } : { text: '', width: 0 },
        { stack: [{ text: ident.entidade, bold: true }, { text: ident.secretaria, fontSize: 8 }, { text: `${t.unidade ?? ''} - ${cfg.servico}`, fontSize: 8 }] },
      ],
    },
    { text: 'CONFIDENCIAL - RESULTADO DE EXAME', alignment: 'right', bold: true, color: '#c92a2a', margin: [0, -30, 0, 40] },
    {
      margin: [180, 30, 0, 0],
      stack: [
        { text: 'PACIENTE', fontSize: 8, color: '#555' },
        { text: t.nome_social ? `${t.nome_social} (${t.nome})` : t.nome, fontSize: 14, bold: true },
        { text: `Prontuário: ${t.prontuario ?? '-'}   Requisição: ${t.requisicao ?? '-'}`, margin: [0, 4, 0, 0] },
        { text: `Exame: ${t.exame}${t.estrutura ? ` - ${t.estrutura}` : ''}` },
        { text: `Data do exame: ${fmtData(t.dt)}` },
        { text: `Solicitante: ${t.solicitante ?? '-'}${t.unidade_solicitante ? ` - ${t.unidade_solicitante}` : ''}` },
      ],
    },
  ];
  const r = await emitirDocumento(
    { relatorio: `${s}:envelope`, titulo: `Envelope do resultado - ${cfg.titulo}`, filtros: { exame: id, emissao: Date.now() } },
    corpo,
    { semCabecalho: true, semRodape: true, tamanho: { width: 649, height: 459 }, orientacao: 'landscape', margens: [30, 30, 30, 30] },
    u,
  );
  await c.query(`update ${s}.atendimento set envelope_em = now() where id = $1`, [id]);
  return r;
}

// ---------------------------------------------------------------------------
// Cadastro dos exames a partir do SIGTAP
// ---------------------------------------------------------------------------

/** Completa nome, sexo, faixa etária, instrumentos de registro, valor e CBOs a partir do SIGTAP. */
export async function preencherDoSigtap(c: pg.PoolClient, dados: Record<string, any>) {
  if (!dados.procedimento_id) return;
  const pr = (await c.query(`select * from cad.procedimento where id = $1`, [dados.procedimento_id])).rows[0];
  if (!pr) return;
  const anos = (m: number | null) => (m == null || m >= 9999 ? null : Math.floor(m / 12));
  if (!dados.nome) dados.nome = pr.nome;
  if (!dados.sexo || (dados.sexo === 'A' && ['M', 'F'].includes(pr.sexo))) dados.sexo = ['M', 'F'].includes(pr.sexo) ? pr.sexo : 'A';
  if (dados.idade_minima == null) dados.idade_minima = anos(pr.idade_minima_meses);
  if (dados.idade_maxima == null) dados.idade_maxima = anos(pr.idade_maxima_meses);
  if (!dados.instrumentos?.length && pr.instrumentos?.length) dados.instrumentos = pr.instrumentos;
  if (dados.valor == null) dados.valor = pr.valor_municipal ?? pr.valor_sa ?? null;
}

export async function copiarCbosDoSigtap(c: pg.PoolClient, cfg: ConfigImagem, exameId: number) {
  await c.query(
    `insert into ${cfg.esquema}.exame_cbo (exame_id, cbo_id)
     select e.id, pc.cbo_id from ${cfg.esquema}.exame e join cad.procedimento_cbo pc on pc.procedimento_id = e.procedimento_id
      where e.id = $1 and not exists (select 1 from ${cfg.esquema}.exame_cbo x where x.exame_id = e.id and x.cbo_id = pc.cbo_id)`,
    [exameId],
  );
}

/** Importa para o cadastro de exames os procedimentos SIGTAP do grupo do módulo ainda não cadastrados. */
export async function importarSigtap(c: pg.PoolClient, cfg: ConfigImagem) {
  const procs = (
    await c.query(
      `select id from cad.procedimento p where p.ativo is not false and p.codigo like any($1)
          and not exists (select 1 from ${cfg.esquema}.exame e where e.procedimento_id = p.id) order by p.codigo`,
      [cfg.grupoSigtap.map((g) => g + '%')],
    )
  ).rows;
  for (const p of procs) {
    const d: Record<string, any> = { procedimento_id: p.id };
    await preencherDoSigtap(c, d);
    const r = await c.query(
      `insert into ${cfg.esquema}.exame (procedimento_id, nome, sexo, idade_minima, idade_maxima, instrumentos, valor, ativo) values ($1,$2,$3,$4,$5,$6,$7,true) returning id`,
      [d.procedimento_id, d.nome, d.sexo, d.idade_minima, d.idade_maxima, d.instrumentos ?? null, d.valor],
    );
    await copiarCbosDoSigtap(c, cfg, r.rows[0].id);
  }
  return procs.length;
}

/** Valida sexo e faixa etária do paciente para o exame cadastrado. */
export async function validarPacienteExame(c: pg.PoolClient | pg.Pool, cfg: ConfigImagem, exameId: number, pacienteId: number) {
  const r = await consultarUm(
    `select e.nome, e.sexo, e.idade_minima, e.idade_maxima, p.sexo psexo, extract(year from age(current_date, p.data_nascimento))::int idade
       from ${cfg.esquema}.exame e, cad.pessoa p where e.id = $1 and p.id = $2`,
    [exameId, pacienteId],
    c,
  );
  const avisos: string[] = [];
  if (!r) return avisos;
  if (['M', 'F'].includes(r.sexo) && r.psexo && r.psexo !== r.sexo) avisos.push(`Exame permitido somente para o sexo ${r.sexo === 'F' ? 'feminino' : 'masculino'}.`);
  if (r.idade != null && r.idade_minima != null && r.idade < r.idade_minima) avisos.push(`Paciente abaixo da idade mínima do exame (${r.idade_minima} anos).`);
  if (r.idade != null && r.idade_maxima != null && r.idade > r.idade_maxima) avisos.push(`Paciente acima da idade máxima do exame (${r.idade_maxima} anos).`);
  return avisos;
}

export { nomes };
