// Rotas do laboratório (TR 1.2.47) e do interfaceamento de equipamentos (TR 1.2.48).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { hashToken, gerarToken } from '../../seguranca/senha.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario, registrarRotina, temPermissao, type Usuario } from '../../seguranca/usuario.js';
import { salvarArquivo, lerArquivo } from '../../servicos/arquivos.js';
import type { ResultadoEmissao } from '../../servicos/relatorios.js';
import { idadeDetalhada } from '../../compartilhado/validacao.js';
import { confirmarEntrada } from '../farmacia/servico.js';
import { gerarBpa } from '../faturamento/bpa.js';
import { calcular, variaveisDaFormula } from './calculo.js';
import {
  CAMPOS_ETIQUETA,
  CAMPOS_MODELO,
  camposEtiqueta,
  dadosEtiquetas,
  emitirCapaFaturamento,
  emitirComprovante,
  emitirEnvelope,
  emitirEtiquetas,
  emitirEtiquetasMateriais,
  emitirLaudo,
  emitirMapaPersonalizado,
  emitirMapaSintetico,
  emitirProtocolo,
  LINHAS_PADRAO,
  mapaPersonalizado,
  modeloEtiqueta,
  previaLaudo,
} from './documentos.js';
import { listaDeTrabalho, processarMensagem, registrarResultadoControle, responderConsulta, retirarPendentes } from './interface.js';
import {
  anexarResultadoPdf,
  atualizarSituacaoRequisicao,
  avaliarResultado,
  cancelarLiberacao,
  conferirSenhaOperador,
  criarRequisicao,
  criarRequisicaoExterna,
  descartarAmostra,
  layoutDoExame,
  liberarItens,
  P,
  planoColeta,
  previsaoEntrega,
  profissionalLiberador,
  reagendarColeta,
  receberSolicitacao,
  referenciasDoPaciente,
  registrarColeta,
  registrarEntrega,
  registrarOcorrencia,
  registrarPresenca,
  resultadoAnterior,
  salvarResultado,
  textoResultado,
} from './servico.js';
import './relatorios.js';

registrarPermissao('lab_coleta', 'Registro de coleta de amostras', 'LAB', ['executar']);
registrarPermissao('lab_resultado', 'Digitação de resultados de exames', 'LAB', ['executar']);
registrarPermissao('lab_liberacao', 'Liberação (assinatura) de laudos laboratoriais', 'LAB', ['executar', 'cancelar']);
registrarPermissao('lab_entrega', 'Entrega de resultados de exames', 'LAB', ['executar']);
registrarPermissao('int_comunicacao', 'Comunicação com equipamentos interfaceados', 'INT', ['executar']);

const num = z.coerce.number();
const idParam = (req: FastifyRequest) => Number((req.params as any).id);
const pdf = (reply: FastifyReply, r: ResultadoEmissao) =>
  reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).header('x-codigo-relatorio', r.codigo).send(r.conteudo);
const lista = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map((x) => Number(x))
    .filter((x) => x > 0);

// Requisições, exames e amostras são mantidos pelas rotinas do laboratório (rastreabilidade).
registrarGanchos('lab_requisicao', {
  antesSalvar(d, { atual }) {
    if (!atual) throw new ErroHttp(422, 'Utilize a tela "Recepção e coleta" para cadastrar requisições do laboratório.');
    for (const k of Object.keys(d)) if (!['observacao', 'dados_clinicos', 'convenio_id', 'solicitante_externo', 'urgente'].includes(k)) delete d[k];
  },
});
for (const ent of ['lab_requisicao_exame', 'lab_amostra', 'lab_coleta_insumo', 'lab_ocorrencia', 'int_controle_resultado', 'int_mensagem'])
  registrarGanchos(ent, {
    antesSalvar() {
      throw new ErroHttp(422, 'Registro mantido pelas rotinas do laboratório (recepção, coleta, digitação, ocorrências e controle de qualidade).');
    },
    antesExcluir() {
      throw new ErroHttp(422, 'Registro de rastreabilidade: exclusão não permitida.');
    },
  });
// Validação das fórmulas e códigos das variáveis (TR 1.2.47.6.2.2).
registrarGanchos('lab_exame_variavel', {
  async antesSalvar(d, { cliente, atual }) {
    const codigo = (d.codigo ?? atual?.codigo ?? '').toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(codigo)) throw new ErroHttp(422, 'Código da variável: use letras, números e _ (iniciando por letra).', { codigo: 'Formato inválido.' });
    if (['IDADE', 'MASCULINO', 'FEMININO'].includes(codigo)) throw new ErroHttp(422, 'Código reservado.', { codigo: 'Reservado.' });
    const tipo = d.tipo ?? atual?.tipo;
    const formula = d.formula ?? atual?.formula;
    if (tipo === 'CALCULO') {
      if (!formula) throw new ErroHttp(422, 'Informe a fórmula da variável de cálculo.', { formula: 'Obrigatória.' });
      const exameId = d.exame_id ?? atual?.exame_id;
      const existentes = new Set((await cliente.query(`select codigo from lab.exame_variavel where exame_id = $1`, [exameId])).rows.map((r) => r.codigo));
      existentes.add(codigo);
      try {
        const vars = variaveisDaFormula(formula);
        const faltam = vars.filter((v) => !existentes.has(v) && !['IDADE', 'MASCULINO', 'FEMININO'].includes(v));
        if (faltam.length) throw new Error(`variáveis inexistentes no exame: ${faltam.join(', ')}`);
        calcular(formula, Object.fromEntries(vars.map((v) => [v, 1])));
      } catch (e) {
        throw new ErroHttp(422, `Fórmula inválida: ${(e as Error).message}`, { formula: 'Inválida.' });
      }
    }
    if (tipo === 'LISTA' && !(d.opcoes ?? atual?.opcoes)) throw new ErroHttp(422, 'Informe as opções da lista separadas por ponto e vírgula.', { opcoes: 'Obrigatório.' });
  },
});
// Nova versão do modelo de laudo a cada alteração do conteúdo; laudos liberados mantêm o modelo congelado (TR 1.2.47.43.55).
registrarGanchos('lab_modelo_laudo', {
  async depoisSalvar(r, { cliente, atual }) {
    if (atual && atual.html !== r.html) await cliente.query(`update lab.modelo_laudo set versao = coalesce(versao, 1) + 1 where id = $1`, [r.id]);
  },
});
registrarGanchos('lab_modelo_etiqueta', {
  async depoisSalvar(r, { cliente }) {
    if (r.padrao) await cliente.query(`update lab.modelo_etiqueta set padrao = false where id <> $1 and tipo = $2`, [r.id, r.tipo]);
  },
});

/** Operadores de laboratório de apoio (portal do prestador) enxergam somente os exames do seu laboratório (TR 1.2.47.18). */
async function laboratoriosDoApoio(u: Usuario): Promise<number[] | null> {
  if (u.administrador || !u.unidades.length) return null;
  const labs = await consultar(`select id, tipo from lab.laboratorio where unidade_id = any($1) and ativo`, [u.unidades]);
  if (!labs.length || labs.some((l) => l.tipo === 'PROPRIO')) return null;
  return labs.map((l) => Number(l.id));
}

async function laboratorioPorToken(req: FastifyRequest) {
  const token = String(req.headers['x-token-laboratorio'] ?? '');
  if (!token) throw new ErroHttp(401, 'Informe o token do laboratório (cabeçalho x-token-laboratorio).');
  const l = await consultarUm(`select * from lab.laboratorio where token_hash = $1 and ativo`, [hashToken(token)]);
  if (!l) throw new ErroHttp(401, 'Token do laboratório inválido.');
  return l;
}

async function equipamentoPorToken(req: FastifyRequest) {
  const token = String(req.headers['x-token-equipamento'] ?? '');
  const eq = token ? await consultarUm(`select * from lab.equipamento where id = $1 and token_hash = $2 and ativo`, [idParam(req), hashToken(token)]) : null;
  if (!eq) throw new ErroHttp(401, 'Token do equipamento inválido.');
  return eq;
}

const textoCorpo = (req: FastifyRequest) => (typeof req.body === 'string' ? { conteudo: req.body as string, protocolo: null } : z.object({ conteudo: z.string().min(1), protocolo: z.string().nullish() }).parse(req.body));

export default async function rotasLaboratorio(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // Recepção: pacientes agendados e pesquisas (TR 1.2.47.43.1 a 1.2.47.43.10)
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/recepcao', async (req) => {
    const u = exigirPermissao(req, 'lab_requisicao:consultar');
    const q = req.query as Record<string, string | undefined>;
    const params: unknown[] = [];
    const w: string[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    if (q.de) w.push(`coalesce(r.data_agendada, r.criado_em::date) >= ${p(q.de)}::date`);
    if (q.ate) w.push(`coalesce(r.data_agendada, r.criado_em::date) <= ${p(q.ate)}::date`);
    if (q.busca?.trim()) {
      const b = q.busca.trim();
      const dig = b.replace(/\D/g, '');
      const cond = [`r.numero = ${p(b.toUpperCase())}`, `f_unaccent(pa.nome) ilike f_unaccent(${p(`%${b}%`)})`, `pa.prontuario = ${p(b)}`];
      if (dig && dig === b) cond.push(`pa.id::text = ${p(dig)}`, `pa.cpf = ${p(dig)}`, `pa.cns = ${p(dig)}`, `exists (select 1 from lab.amostra a where a.requisicao_id = r.id and a.codigo_barras = ${p(dig)})`);
      w.push(`(${cond.join(' or ')})`);
    }
    if (q.pacienteId) w.push(`r.paciente_id = ${p(Number(q.pacienteId))}`);
    if (q.unidadeSolicitanteId) w.push(`r.unidade_solicitante_id = ${p(Number(q.unidadeSolicitanteId))}`);
    if (q.laboratorioId) w.push(`r.laboratorio_id = ${p(Number(q.laboratorioId))}`);
    if (q.convenioId) w.push(`r.convenio_id = ${p(Number(q.convenioId))}`);
    if (q.procedimentoId) w.push(`exists (select 1 from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.requisicao_id = r.id and e.procedimento_id = ${p(Number(q.procedimentoId))})`);
    if (q.exameId) w.push(`exists (select 1 from lab.requisicao_exame i where i.requisicao_id = r.id and i.exame_id = ${p(Number(q.exameId))})`);
    if (q.secaoId) w.push(`exists (select 1 from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.requisicao_id = r.id and e.secao_id = ${p(Number(q.secaoId))})`);
    if (q.presenca) w.push(`r.presenca = ${p(q.presenca)}`);
    if (q.situacao) w.push(`r.situacao = ${p(q.situacao)}`);
    const itensDe = (cond: string) => `exists (select 1 from lab.requisicao_exame i where i.requisicao_id = r.id and i.situacao <> 'CANCELADO' and ${cond})`;
    const todosDe = (cond: string) => `not exists (select 1 from lab.requisicao_exame i where i.requisicao_id = r.id and i.situacao <> 'CANCELADO' and not (${cond}))`;
    // Coleta realizada, não realizada ou parcial (exames com mais de uma amostra) (TR 1.2.47.43.3).
    if (q.coleta === 'REALIZADA') w.push(todosDe(`i.situacao <> 'AGUARDANDO_COLETA'`));
    if (q.coleta === 'NAO_REALIZADA') w.push(todosDe(`i.situacao = 'AGUARDANDO_COLETA'`));
    if (q.coleta === 'PARCIAL')
      w.push(`(r.situacao = 'COLETA_PARCIAL' or exists (select 1 from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.requisicao_id = r.id and e.quantidade_amostras > 1
                 and (select count(*) from lab.amostra a where a.requisicao_id = r.id and a.situacao = 'COLETADA' and a.itens @> jsonb_build_array(i.id)) between 1 and e.quantidade_amostras - 1))`);
    // Situação do laudo: não digitado, digitado, digitado parcialmente e assinado (TR 1.2.47.43.7).
    if (q.laudo === 'NAO_DIGITADO') w.push(itensDe(`i.situacao in ('COLETADO','EM_ANALISE')`));
    if (q.laudo === 'PARCIAL') w.push(itensDe(`i.situacao = 'DIGITADO_PARCIAL'`));
    if (q.laudo === 'DIGITADO') w.push(itensDe(`i.situacao = 'DIGITADO'`));
    if (q.laudo === 'ASSINADO') w.push(itensDe(`i.situacao = 'LIBERADO'`));
    // Impresso ou aguardando impressão (TR 1.2.47.43.8).
    if (q.impressao === 'IMPRESSO') w.push(itensDe(`i.situacao = 'LIBERADO' and i.impresso_em is not null`));
    if (q.impressao === 'AGUARDANDO') w.push(itensDe(`i.situacao = 'LIBERADO' and i.impresso_em is null`));
    // Aguardando entrega, entregue ou não retirado (TR 1.2.47.43.9).
    if (q.entrega === 'AGUARDANDO') w.push(`r.situacao in ('LIBERADA','LIBERADA_PARCIAL')`);
    if (q.entrega === 'ENTREGUE') w.push(`r.situacao = 'ENTREGUE'`);
    if (q.entrega === 'NAO_RETIRADA') w.push(`r.situacao = 'NAO_RETIRADA'`);
    const apoio = await laboratoriosDoApoio(u);
    if (apoio) w.push(`exists (select 1 from lab.requisicao_exame i where i.requisicao_id = r.id and i.laboratorio_id = any(${p(apoio)}))`);
    const destacar = await P.destacarUpa();
    const linhas = await consultar(
      `select r.id, r.numero, r.data_agendada::text data_agendada, to_char(r.hora_agendada, 'HH24:MI') hora_agendada, r.presenca, r.situacao, r.urgente, r.origem,
              r.data_prevista_entrega::text previsao, r.criado_em, pa.id paciente_id, pa.nome paciente, pa.prontuario, pa.cns, pa.cpf, pa.data_nascimento::text nascimento, pa.sexo,
              us.nome unidade_solicitante, us.tipo_unidade, coalesce(ps.nome, r.solicitante_externo) profissional_solicitante, cv.nome convenio, l.nome laboratorio,
              (${destacar ? `r.origem = 'UPA' or us.tipo_unidade = 'UPA'` : 'false'}) destaque,
              (select json_agg(json_build_object('id', i.id, 'sigla', e.sigla, 'exame', e.nome, 'procedimento', pr.codigo || ' - ' || pr.nome, 'secao', s.nome,
                       'material', m.nome, 'situacao', i.situacao, 'impresso', i.impresso_em is not null) order by e.nome)
                 from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id join cad.procedimento pr on pr.id = e.procedimento_id
                 left join lab.secao s on s.id = e.secao_id left join lab.material m on m.id = i.material_id where i.requisicao_id = r.id and i.situacao <> 'CANCELADO') exames
         from lab.requisicao r join cad.pessoa pa on pa.id = r.paciente_id left join cad.unidade us on us.id = r.unidade_solicitante_id
         left join cad.profissional ps on ps.id = r.profissional_solicitante_id left join cad.convenio cv on cv.id = r.convenio_id
         left join lab.laboratorio l on l.id = r.laboratorio_id
        ${w.length ? 'where ' + w.join(' and ') : ''}
        order by ${destacar ? `(r.origem = 'UPA' or us.tipo_unidade = 'UPA') desc,` : ''} r.urgente desc, coalesce(r.data_agendada, r.criado_em::date), r.hora_agendada nulls last, r.id
        limit 300`,
      params,
    );
    return { linhas, destacarUpa: destacar, confirmarPresenca: await P.confirmarPresenca(), coletaComPresenca: await P.coletaComPresenca() };
  });

  // Requisições do prontuário (e agendamentos de exame) ainda não recebidas no laboratório.
  app.get('/api/laboratorio/pendentes-prontuario', async (req) => {
    exigirPermissao(req, 'lab_requisicao:incluir');
    const q = req.query as any;
    return consultar(
      `select s.id, s.numero, s.data::text data, s.prioridade, s.origem_upa, p.id paciente_id, p.nome paciente, p.prontuario, u.nome unidade, pr.nome profissional,
              (select a.data::text from age.agendamento a where a.requisicao_id = s.id and a.situacao not in ('CANCELADO','TRANSFERIDO') order by a.data desc limit 1) data_agendada,
              json_agg(json_build_object('id', i.id, 'exame', e.sigla || ' - ' || e.nome, 'material', i.material)) exames
         from amb.solicitacao_exame s join amb.solicitacao_exame_item i on i.solicitacao_id = s.id
         join lab.exame e on e.procedimento_id = i.procedimento_id and e.ativo
         join cad.pessoa p on p.id = s.paciente_id left join cad.unidade u on u.id = s.unidade_id left join cad.profissional pr on pr.id = s.profissional_id
        where s.situacao in ('REQUISITADO','AGENDADO') and i.situacao in ('REQUISITADO','AGENDADO') and not s.uso_interno
          and not exists (select 1 from lab.requisicao_exame x where x.solicitacao_item_id = i.id and x.situacao <> 'CANCELADO')
          and ($1::text is null or s.numero = upper($1) or f_unaccent(p.nome) ilike f_unaccent('%' || $1 || '%'))
        group by s.id, p.id, u.nome, pr.nome order by s.origem_upa desc, s.data desc limit 200`,
      [q.busca?.trim() || null],
    );
  });

  // Cadastro: recebimento da requisição do prontuário ou requisição externa.
  app.post('/api/laboratorio/requisicoes', async (req) => {
    const u = exigirPermissao(req, 'lab_requisicao:incluir');
    const b = z
      .object({
        solicitacaoId: num.nullish(),
        pacienteId: num.nullish(),
        laboratorioId: num.nullish(),
        unidadeSolicitanteId: num.nullish(),
        profissionalSolicitanteId: num.nullish(),
        solicitanteExterno: z.string().nullish(),
        convenioId: num.nullish(),
        origem: z.enum(['REDE', 'UPA', 'EXTERNA', 'APOIO']).default('EXTERNA'),
        urgente: z.boolean().default(false),
        dataAgendada: z.string().nullish(),
        horaAgendada: z.string().nullish(),
        dadosClinicos: z.string().nullish(),
        observacao: z.string().nullish(),
        itens: z.array(z.object({ exameId: num, materialId: num.nullish() })).default([]),
        confirmarAvisos: z.boolean().default(false),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'lab_requisicao:incluir'), async (c) => {
      if (b.solicitacaoId) return receberSolicitacao(c, b.solicitacaoId, u, b);
      if (!b.pacienteId) throw new ErroHttp(422, 'Selecione o paciente.');
      if (!b.unidadeSolicitanteId && !b.solicitanteExterno && !b.profissionalSolicitanteId) throw new ErroHttp(422, 'Informe a unidade ou o profissional solicitante.');
      return criarRequisicaoExterna(c, { ...b, pacienteId: b.pacienteId }, u);
    });
  });

  app.get('/api/laboratorio/requisicoes/:id', async (req) => {
    exigirPermissao(req, 'lab_requisicao:consultar');
    const id = idParam(req);
    const r = await consultarUm(
      `select r.*, r.data_agendada::text data_agendada, r.data_prevista_entrega::text data_prevista_entrega, to_char(r.hora_agendada, 'HH24:MI') hora_agendada,
              us.nome unidade_solicitante, ps.nome profissional_solicitante, cv.nome convenio, l.nome laboratorio, s.numero numero_prontuario
         from lab.requisicao r left join cad.unidade us on us.id = r.unidade_solicitante_id left join cad.profissional ps on ps.id = r.profissional_solicitante_id
         left join cad.convenio cv on cv.id = r.convenio_id left join lab.laboratorio l on l.id = r.laboratorio_id left join amb.solicitacao_exame s on s.id = r.solicitacao_id
        where r.id = $1`,
      [id],
    );
    if (!r) throw new ErroHttp(404, 'Requisição não encontrada.');
    const itens = await consultar(
      `select i.id, i.exame_id, i.situacao, i.valor, i.material_id, m.nome material, i.laboratorio_id, l.nome laboratorio, l.tipo laboratorio_tipo, i.liberado_em, i.impresso_em,
              i.digitado_em, i.interface_situacao, i.laudo_arquivo_id, i.anexo_externo, e.nome exame, e.sigla, e.permite_recoleta, e.permite_reagendamento, e.quantidade_amostras,
              e.preparo_paciente, e.instrucoes_coleta, s.nome secao, pr.codigo procedimento
         from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id join cad.procedimento pr on pr.id = e.procedimento_id
         left join lab.secao s on s.id = e.secao_id left join lab.material m on m.id = i.material_id left join lab.laboratorio l on l.id = i.laboratorio_id
        where i.requisicao_id = $1 order by e.nome`,
      [id],
    );
    const amostras = await consultar(
      `select a.id, a.codigo_barras, a.sequencia, a.situacao, a.coletada_em, a.motivo_descarte, a.volume_ml, rc.nome recipiente, rc.cor, rc.cor_nome, m.nome material, s.nome secao, pc.nome profissional,
              (select string_agg(e.sigla, ', ') from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id where i.id in (select jsonb_array_elements_text(a.itens)::bigint)) exames
         from lab.amostra a left join lab.recipiente rc on rc.id = a.recipiente_id left join lab.material m on m.id = a.material_id left join lab.secao s on s.id = a.secao_id
         left join cad.profissional pc on pc.id = a.profissional_coleta_id where a.requisicao_id = $1 order by a.sequencia`,
      [id],
    );
    const ocorrencias = await consultar(
      `select o.id, o.data_hora, o.descricao, o.notificado, m.nome motivo, e.sigla exame, coalesce(op.nome, op.login) operador from lab.ocorrencia o join lab.motivo_ocorrencia m on m.id = o.motivo_id
         left join lab.requisicao_exame i on i.id = o.item_id left join lab.exame e on e.id = i.exame_id left join seg.operador op on op.id = o.operador_id where o.requisicao_id = $1 order by o.data_hora desc`,
      [id],
    );
    return { ...r, itens, amostras, ocorrencias };
  });

  // Conferência e alteração dos dados da requisição em uma única tela (TR 1.2.47.43.24).
  app.put('/api/laboratorio/requisicoes/:id', async (req) => {
    exigirPermissao(req, 'lab_requisicao:alterar');
    const b = z
      .object({
        unidadeSolicitanteId: num.nullish(),
        profissionalSolicitanteId: num.nullish(),
        solicitanteExterno: z.string().nullish(),
        convenioId: num.nullish(),
        urgente: z.boolean().optional(),
        dadosClinicos: z.string().nullish(),
        observacao: z.string().nullish(),
        dataAgendada: z.string().nullish(),
        horaAgendada: z.string().nullish(),
        materiais: z.record(z.string(), num.nullable()).optional(),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'lab_requisicao:conferencia'), async (c) => {
      const r = (await c.query(`select * from lab.requisicao where id = $1 for update`, [idParam(req)])).rows[0];
      if (!r) throw new ErroHttp(404, 'Requisição não encontrada.');
      await c.query(
        `update lab.requisicao set unidade_solicitante_id = $2, profissional_solicitante_id = $3, solicitante_externo = $4, convenio_id = $5, urgente = coalesce($6, urgente),
                dados_clinicos = $7, observacao = $8, data_agendada = coalesce($9::date, data_agendada), hora_agendada = $10 where id = $1`,
        [r.id, b.unidadeSolicitanteId ?? null, b.profissionalSolicitanteId ?? null, b.solicitanteExterno ?? null, b.convenioId ?? null, b.urgente ?? null, b.dadosClinicos ?? null, b.observacao ?? null, b.dataAgendada ?? null, b.horaAgendada ?? null],
      );
      for (const [item, mat] of Object.entries(b.materiais ?? {}))
        await c.query(`update lab.requisicao_exame set material_id = $3 where id = $1 and requisicao_id = $2 and situacao = 'AGUARDANDO_COLETA'`, [Number(item), r.id, mat]);
      return { ok: true };
    });
  });

  app.post('/api/laboratorio/requisicoes/:id/exames', async (req) => {
    const u = exigirPermissao(req, 'lab_requisicao:alterar');
    const b = z.object({ exameId: num, materialId: num.nullish() }).parse(req.body);
    return transacao(contextoDe(req, 'lab_requisicao:incluir_exame'), async (c) => {
      const r = (await c.query(`select * from lab.requisicao where id = $1 for update`, [idParam(req)])).rows[0];
      if (!r) throw new ErroHttp(404, 'Requisição não encontrada.');
      const e = (await c.query(`select e.*, p.valor_sa from lab.exame e join cad.procedimento p on p.id = e.procedimento_id where e.id = $1 and e.ativo`, [b.exameId])).rows[0];
      if (!e) throw new ErroHttp(422, 'Exame inexistente ou inativo.');
      if (!b.materialId && !e.material_id && (await P.exigirMaterialExaminar())) throw new ErroHttp(422, 'Selecione o material a examinar.');
      let solItem = null;
      if (r.solicitacao_id)
        solItem = (
          await c.query(`insert into amb.solicitacao_exame_item (solicitacao_id, procedimento_id, quantidade, situacao) values ($1,$2,1,'AGENDADO') returning id`, [r.solicitacao_id, e.procedimento_id])
        ).rows[0].id;
      await c.query(
        `insert into lab.requisicao_exame (requisicao_id, exame_id, solicitacao_item_id, material_id, laboratorio_id, situacao, valor, interface_situacao) values ($1,$2,$3,$4,$5,'AGUARDANDO_COLETA',$6,$7)`,
        [r.id, e.id, solItem, b.materialId ?? e.material_id, e.laboratorio_id ?? r.laboratorio_id, e.valor ?? e.valor_sa ?? 0, e.usa_interfaceamento ? 'PENDENTE' : null],
      );
      const exames = (await c.query(`select exame_id from lab.requisicao_exame where requisicao_id = $1 and situacao <> 'CANCELADO'`, [r.id])).rows.map((x) => x.exame_id);
      await c.query(`update lab.requisicao set data_prevista_entrega = $2 where id = $1`, [r.id, await previsaoEntrega(c, exames, r.laboratorio_id)]);
      await atualizarSituacaoRequisicao(c, r.id);
      await registrarRotina(req, 'lab_requisicao', 'incluir_exame', { requisicao: r.id, exame: e.id, operador: u.id });
      return { ok: true };
    });
  });

  app.post('/api/laboratorio/itens/:id/cancelar', async (req) => {
    exigirPermissao(req, 'lab_requisicao:alterar');
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    return transacao(contextoDe(req, 'lab_requisicao:cancelar_exame'), async (c) => {
      const it = (await c.query(`select * from lab.requisicao_exame where id = $1 for update`, [idParam(req)])).rows[0];
      if (!it) throw new ErroHttp(404, 'Exame não encontrado.');
      if (it.situacao === 'LIBERADO') throw new ErroHttp(422, 'Exame com resultado liberado não pode ser cancelado.');
      await c.query(`update lab.requisicao_exame set situacao = 'CANCELADO', cancelado_motivo = $2 where id = $1`, [it.id, motivo]);
      if (it.solicitacao_item_id) await c.query(`update amb.solicitacao_exame_item set situacao = 'CANCELADO' where id = $1`, [it.solicitacao_item_id]);
      await atualizarSituacaoRequisicao(c, it.requisicao_id);
      return { ok: true };
    });
  });

  app.post('/api/laboratorio/requisicoes/:id/presenca', async (req) => {
    const u = exigirPermissao(req, 'lab_requisicao:alterar');
    const { presente } = z.object({ presente: z.boolean() }).parse(req.body);
    return transacao(contextoDe(req, presente ? 'lab:presenca' : 'lab:falta'), (c) => registrarPresenca(c, idParam(req), presente, u));
  });

  app.post('/api/laboratorio/requisicoes/:id/reagendar', async (req) => {
    const u = exigirPermissao(req, 'lab_requisicao:alterar');
    const b = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), motivo: z.string().min(3) }).parse(req.body);
    return transacao(contextoDe(req, 'lab:reagendar'), (c) => reagendarColeta(c, idParam(req), b.data, b.motivo, u));
  });

  // ---------------------------------------------------------------------------
  // Coleta (TR 1.2.47.10, 1.2.47.15, 1.2.47.43.13 a 1.2.47.43.29)
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/requisicoes/:id/coleta', async (req) => {
    exigirPermissao(req, 'lab_coleta:executar');
    const itens = lista((req.query as any).itens);
    const plano = await planoColeta(pool, idParam(req), itens.length ? itens : null);
    return { ...plano, exigirMateriais: await P.exigirMateriaisColeta(), confirmarPresenca: await P.confirmarPresenca() };
  });

  app.post('/api/laboratorio/requisicoes/:id/coleta', async (req) => {
    const u = exigirPermissao(req, 'lab_coleta:executar');
    const b = z
      .object({
        itens: z.array(num).nullish(),
        profissionalId: num.nullish(),
        dataHora: z.string().nullish(),
        unidadeEstoqueId: num.nullish(),
        materiais: z.array(z.object({ produtoId: num, quantidade: num })).default([]),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'lab_coleta:executar'), (c) => registrarColeta(c, idParam(req), b, u));
  });

  app.post('/api/laboratorio/amostras/:id/descartar', async (req) => {
    const u = exigirPermissao(req, 'lab_coleta:executar');
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    return transacao(contextoDe(req, 'lab:descartar_amostra'), (c) => descartarAmostra(c, idParam(req), motivo, u));
  });

  // ---------------------------------------------------------------------------
  // Etiquetas, comprovante, protocolo, capa de faturamento e envelope
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/requisicoes/:id/etiquetas', async (req, reply) => {
    const u = exigirPermissao(req, 'lab_requisicao:consultar');
    const q = req.query as any;
    const amostras = lista(q.amostras);
    const dados = await dadosEtiquetas(pool, amostras.length ? { amostraIds: amostras } : { requisicaoIds: [idParam(req)] });
    return pdf(reply, await emitirEtiquetas(await modeloEtiqueta(pool, q.modeloId ? Number(q.modeloId) : null), dados.map(camposEtiqueta), u));
  });

  // Impressão de etiquetas em lote (TR 1.2.47.43.32).
  app.post('/api/laboratorio/etiquetas', async (req, reply) => {
    const u = exigirPermissao(req, 'lab_requisicao:consultar');
    const b = z.object({ requisicaoIds: z.array(num).default([]), amostraIds: z.array(num).default([]), modeloId: num.nullish() }).parse(req.body);
    const dados = await dadosEtiquetas(pool, b.amostraIds.length ? { amostraIds: b.amostraIds } : { requisicaoIds: b.requisicaoIds });
    return pdf(reply, await emitirEtiquetas(await modeloEtiqueta(pool, b.modeloId), dados.map(camposEtiqueta), u));
  });

  // Teste do modelo de etiqueta com dados fictícios (TR 1.2.47.43.38).
  app.post('/api/laboratorio/etiquetas/previa', async (req, reply) => {
    const u = exigirPermissao(req, 'lab_modelo_etiqueta:consultar');
    const b = z.object({ largura_mm: num, altura_mm: num, termica: z.boolean().default(true), linhas: z.array(z.any()).nullish() }).parse(req.body);
    return pdf(reply, await emitirEtiquetas({ ...b, linhas: b.linhas ?? null }, [EXEMPLO_ETIQUETA], u, 'lab:etiqueta-previa'));
  });

  app.get('/api/laboratorio/etiquetas/campos', async (req) => {
    exigirUsuario(req);
    return { campos: CAMPOS_ETIQUETA, padrao: LINHAS_PADRAO, exemplo: EXEMPLO_ETIQUETA };
  });

  app.get('/api/laboratorio/requisicoes/:id/comprovante', async (req, reply) => pdf(reply, await emitirComprovante(pool, idParam(req), exigirPermissao(req, 'lab_requisicao:consultar'))));
  app.get('/api/laboratorio/requisicoes/:id/protocolo', async (req, reply) => pdf(reply, await emitirProtocolo(pool, idParam(req), exigirPermissao(req, 'lab_requisicao:consultar'))));
  app.get('/api/laboratorio/requisicoes/:id/envelope', async (req, reply) => pdf(reply, await emitirEnvelope(pool, idParam(req), exigirPermissao(req, 'lab_requisicao:consultar'))));
  app.post('/api/laboratorio/capas-faturamento', async (req, reply) => {
    const u = exigirPermissao(req, 'lab_requisicao:consultar');
    const { ids } = z.object({ ids: z.array(num).min(1) }).parse(req.body);
    return pdf(reply, await emitirCapaFaturamento(pool, ids, u));
  });

  // ---------------------------------------------------------------------------
  // Mapas de trabalho (TR 1.2.47.30 a 1.2.47.32.5, 1.2.47.43.30, 1.2.47.43.31)
  // ---------------------------------------------------------------------------
  const filtroMapa = (q: any) => ({
    secaoId: q.secaoId ? Number(q.secaoId) : null,
    exameId: q.exameId ? Number(q.exameId) : null,
    laboratorioId: q.laboratorioId ? Number(q.laboratorioId) : null,
    requisicaoIds: lista(q.requisicoes),
    de: q.de || null,
    ate: q.ate || null,
  });
  app.get('/api/laboratorio/mapa', async (req, reply) => pdf(reply, await emitirMapaSintetico(pool, filtroMapa(req.query), exigirPermissao(req, 'lab_requisicao:consultar'))));
  app.get('/api/laboratorio/mapa-personalizado/:id', async (req, reply) => {
    const u = exigirPermissao(req, 'lab_requisicao:consultar');
    const q = req.query as any;
    if (q.formato === 'html') {
      const r = await mapaPersonalizado(pool, idParam(req), filtroMapa(q));
      return reply.header('content-type', 'text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8"><title>${r.modelo.nome}</title><style>@page{size:${r.modelo.orientacao === 'PAISAGEM' ? 'landscape' : 'portrait'}}body{font-family:Arial,sans-serif;font-size:12px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:2px 4px}</style></head><body>${r.html}</body></html>`);
    }
    return pdf(reply, await emitirMapaPersonalizado(pool, idParam(req), filtroMapa(q), u));
  });

  // ---------------------------------------------------------------------------
  // Digitação de resultados (TR 1.2.47.43.43 a 1.2.47.43.60)
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/digitacao', async (req) => {
    const u = exigirPermissao(req, 'lab_resultado:executar');
    const q = req.query as any;
    const situacoes = q.situacao ? String(q.situacao).split(',') : ['COLETADO', 'EM_ANALISE', 'DIGITADO_PARCIAL'];
    const apoio = await laboratoriosDoApoio(u);
    return consultar(
      `select i.id, i.situacao, i.requisicao_id, r.numero, r.urgente, r.origem, p.id paciente_id, p.nome paciente, e.nome exame, e.sigla, s.nome secao, i.digitado_em, i.interface_situacao,
              (select min(a.coletada_em) from lab.amostra a where a.requisicao_id = r.id and a.situacao <> 'DESCARTADA' and a.itens @> jsonb_build_array(i.id)) coletada_em, l.nome laboratorio
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join cad.pessoa p on p.id = r.paciente_id join lab.exame e on e.id = i.exame_id
         left join lab.secao s on s.id = e.secao_id left join lab.laboratorio l on l.id = i.laboratorio_id
        where i.situacao = any($1) and ($2::bigint is null or e.secao_id = $2) and ($3::bigint is null or i.laboratorio_id = $3) and ($4::bigint is null or r.id = $4)
          and ($5::bigint is null or r.paciente_id = $5) and ($6::bigint[] is null or i.laboratorio_id = any($6)) and ($7::text is null or r.numero = upper($7) or f_unaccent(p.nome) ilike f_unaccent('%' || $7 || '%'))
        order by ${q.modo === 'PACIENTE' ? 'p.nome, r.id, e.nome' : 's.ordem nulls last, s.nome, r.urgente desc, r.id, e.nome'} limit 500`,
      [situacoes, q.secaoId ? Number(q.secaoId) : null, q.laboratorioId ? Number(q.laboratorioId) : null, q.requisicaoId ? Number(q.requisicaoId) : null, q.pacienteId ? Number(q.pacienteId) : null, apoio, q.busca?.trim() || null],
    );
  });

  app.get('/api/laboratorio/itens/:id', async (req) => {
    exigirPermissao(req, 'lab_requisicao:consultar');
    const id = idParam(req);
    const it = await consultarUm(
      `select i.*, r.numero, r.paciente_id, r.urgente, r.dados_clinicos, e.nome exame, e.sigla, e.metodo, e.secao_id, s.nome secao, m.nome material,
              p.nome paciente, p.sexo, p.data_nascimento::text nascimento, pl.nome liberador
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id join cad.pessoa p on p.id = r.paciente_id
         left join lab.secao s on s.id = e.secao_id left join lab.material m on m.id = i.material_id left join cad.profissional pl on pl.id = i.liberado_por
        where i.id = $1`,
      [id],
    );
    if (!it) throw new ErroHttp(404, 'Exame não encontrado.');
    const layout = it.layout?.variaveis ?? referenciasDoPaciente(await layoutDoExame(pool, it.exame_id), it.sexo, it.nascimento);
    const anterior = await resultadoAnterior(pool, it.paciente_id, it.exame_id, id);
    const predefinidos = await consultar(`select id, variavel_codigo, texto from lab.resultado_predefinido where ativo and (exame_id = $1 or exame_id is null) order by exame_id nulls last, texto`, [it.exame_id]);
    const amostras = await consultar(`select codigo_barras, coletada_em, situacao from lab.amostra where requisicao_id = $1 and itens @> jsonb_build_array($2::bigint) order by sequencia`, [it.requisicao_id, id]);
    const idade = it.nascimento ? idadeDetalhada(it.nascimento) : null;
    return { ...it, layout, anterior, predefinidos, amostras, idade, bloqueado: it.situacao === 'LIBERADO' };
  });

  // Avaliação em tempo real durante a digitação: fórmulas, referências e Delta-Check (sem gravar).
  app.post('/api/laboratorio/itens/:id/avaliar', async (req) => {
    exigirPermissao(req, 'lab_resultado:executar');
    const { valores } = z.object({ valores: z.record(z.any()) }).parse(req.body);
    const it = await consultarUm(`select i.exame_id, r.paciente_id, p.sexo, p.data_nascimento::text nascimento from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join cad.pessoa p on p.id = r.paciente_id where i.id = $1`, [idParam(req)]);
    if (!it) throw new ErroHttp(404, 'Exame não encontrado.');
    const layout = await layoutDoExame(pool, it.exame_id);
    const r = avaliarResultado(layout, valores, it, await resultadoAnterior(pool, it.paciente_id, it.exame_id, idParam(req)));
    return { valores: r.valores, alertas: r.alertas, pendentes: r.pendentes, sinais: r.sinais };
  });

  app.put('/api/laboratorio/itens/:id/resultado', async (req) => {
    const u = exigirPermissao(req, 'lab_resultado:executar');
    const b = z.object({ valores: z.record(z.any()), rotulos: z.record(z.string()).nullish(), observacao: z.string().nullish(), parcial: z.boolean().default(false) }).parse(req.body);
    const apoio = await laboratoriosDoApoio(u);
    return transacao(contextoDe(req, 'lab_resultado:executar'), async (c) => {
      if (apoio) {
        const lab = (await c.query(`select laboratorio_id from lab.requisicao_exame where id = $1`, [idParam(req)])).rows[0];
        if (!lab || !apoio.includes(Number(lab.laboratorio_id))) throw new ErroHttp(403, 'Exame não pertence ao seu laboratório.');
      }
      return salvarResultado(c, idParam(req), b, u);
    });
  });

  app.post('/api/laboratorio/itens/:id/anexo', async (req) => {
    const u = exigirPermissao(req, 'lab_resultado:executar');
    const { arquivoId } = z.object({ arquivoId: z.string().uuid() }).parse(req.body);
    return transacao(contextoDe(req, 'lab:anexar_resultado'), (c) => anexarResultadoPdf(c, idParam(req), arquivoId, u));
  });

  // ---------------------------------------------------------------------------
  // Liberação (TR 1.2.47.43.57, 1.2.47.43.58, 1.2.47.43.63, 1.2.47.43.64, 1.2.47.43.70)
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/liberacao', async (req) => {
    const u = exigirPermissao(req, 'lab_liberacao:executar');
    const q = req.query as any;
    const apoio = await laboratoriosDoApoio(u);
    const linhas = await consultar(
      `select i.id, i.situacao, i.valores, i.rotulos, i.alertas, i.observacao_resultado, i.digitado_em, i.liberado_em, i.exame_id, r.id requisicao_id, r.numero, r.urgente,
              p.nome paciente, p.sexo, p.data_nascimento::text nascimento, e.nome exame, e.sigla, s.nome secao, pl.nome liberador,
              (select coalesce(o.nome, o.login) from seg.operador o where o.id = i.digitado_por) digitador
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join cad.pessoa p on p.id = r.paciente_id join lab.exame e on e.id = i.exame_id
         left join lab.secao s on s.id = e.secao_id left join cad.profissional pl on pl.id = i.liberado_por
        where i.situacao = any($1) and ($2::bigint is null or e.secao_id = $2) and ($3::bigint[] is null or i.laboratorio_id = any($3))
          and ($4::text is null or r.numero = upper($4) or f_unaccent(p.nome) ilike f_unaccent('%' || $4 || '%'))
          and ($5::date is null or coalesce(i.liberado_em, i.digitado_em)::date >= $5) and ($6::date is null or coalesce(i.liberado_em, i.digitado_em)::date <= $6)
        order by r.urgente desc, r.id, e.nome limit 400`,
      [q.situacao ? String(q.situacao).split(',') : ['DIGITADO'], q.secaoId ? Number(q.secaoId) : null, apoio, q.busca?.trim() || null, q.de || null, q.ate || null],
    );
    const layouts = new Map<number, any[]>();
    for (const l of linhas) {
      if (!layouts.has(l.exame_id)) layouts.set(l.exame_id, await layoutDoExame(pool, l.exame_id));
      l.resumo = textoResultado(referenciasDoPaciente(layouts.get(l.exame_id)!, l.sexo, l.nascimento), l.valores ?? {}, l.rotulos, l.observacao_resultado);
      delete l.valores;
    }
    const prof = u.profissionalId ? await consultarUm(`select nome, liberador_laudo from cad.profissional where id = $1`, [u.profissionalId]) : null;
    return { linhas, profissional: prof };
  });

  // Liberação individual ou em lote, com confirmação pela senha do operador.
  app.post('/api/laboratorio/liberar', async (req) => {
    const u = exigirPermissao(req, 'lab_liberacao:executar');
    const b = z.object({ itens: z.array(num).min(1), senha: z.string().min(1) }).parse(req.body);
    const r = await transacao(contextoDe(req, 'lab_liberacao:executar'), async (c) => {
      await conferirSenhaOperador(c, u, b.senha);
      await profissionalLiberador(c, u.profissionalId);
      const res = await liberarItens(c, b.itens, u.profissionalId, u);
      // Laudo em PDF com código de validação gravado no prontuário (TR 1.2.47.43.71, 1.2.47.43.73).
      const porReq = new Map<number, number[]>();
      for (const l of res.liberados) porReq.set(l.requisicao_id, [...(porReq.get(l.requisicao_id) ?? []), l.id]);
      const laudos = [];
      for (const [req2, ids] of porReq) {
        const doc = await emitirLaudo(c, ids, u);
        await c.query(`update lab.requisicao_exame set laudo_arquivo_id = $2 where id = any($1)`, [ids, doc.arquivoId]);
        await c.query(`update amb.solicitacao_exame_item set resultado_arquivo_id = $2 where id in (select solicitacao_item_id from lab.requisicao_exame where id = any($1))`, [ids, doc.arquivoId]);
        laudos.push({ requisicaoId: req2, codigo: doc.codigo, arquivoId: doc.arquivoId });
      }
      return { liberados: res.liberados.length, erros: res.erros, laudos };
    });
    return r;
  });

  app.post('/api/laboratorio/itens/:id/cancelar-liberacao', async (req) => {
    const u = exigirPermissao(req, 'lab_liberacao:cancelar');
    const b = z.object({ motivo: z.string().min(3), senha: z.string().min(1) }).parse(req.body);
    await transacao(contextoDe(req, 'lab_liberacao:cancelar'), async (c) => {
      await conferirSenhaOperador(c, u, b.senha);
      await cancelarLiberacao(c, idParam(req), b.motivo, u);
    });
    await registrarRotina(req, 'lab_liberacao', 'cancelar', { item: idParam(req), motivo: b.motivo });
    return { ok: true };
  });

  // Laudo: somente após a liberação; visualização no monitor e impressão (TR 1.2.47.43.66, 1.2.47.43.72).
  app.get('/api/laboratorio/requisicoes/:id/laudo', async (req, reply) => {
    const u = exigirPermissao(req, 'lab_requisicao:consultar');
    const ids = (await consultar(`select id from lab.requisicao_exame where requisicao_id = $1 and situacao = 'LIBERADO' and not anexo_externo`, [idParam(req)])).map((x) => Number(x.id));
    if (!ids.length) throw new ErroHttp(422, 'Nenhum exame com assinatura liberada nesta requisição: o laudo só pode ser impresso após a liberação.');
    const doc = await emitirLaudo(pool, ids, u);
    if ((req.query as any).imprimir !== 'false') await transacao(contextoDe(req, 'lab:laudo_impresso'), (c) => c.query(`update lab.requisicao_exame set impresso_em = now() where id = any($1)`, [ids]));
    return pdf(reply, doc);
  });

  app.post('/api/laboratorio/laudos', async (req, reply) => {
    const u = exigirPermissao(req, 'lab_requisicao:consultar');
    const { requisicaoIds } = z.object({ requisicaoIds: z.array(num).min(1) }).parse(req.body);
    const ids = (await consultar(`select id from lab.requisicao_exame where requisicao_id = any($1) and situacao = 'LIBERADO' and not anexo_externo`, [requisicaoIds])).map((x) => Number(x.id));
    if (!ids.length) throw new ErroHttp(422, 'Nenhum exame liberado nas requisições selecionadas.');
    const doc = await emitirLaudo(pool, ids, u);
    await transacao(contextoDe(req, 'lab:laudo_impresso'), (c) => c.query(`update lab.requisicao_exame set impresso_em = now() where id = any($1)`, [ids]));
    return pdf(reply, doc);
  });

  app.get('/api/laboratorio/itens/:id/laudo', async (req, reply) => {
    const u = exigirUsuario(req);
    if (!temPermissao(u, 'lab_requisicao:consultar') && !temPermissao(u, 'prontuario:consultar')) throw new ErroHttp(403, 'Operador sem permissão.');
    const it = await consultarUm(`select id, situacao, laudo_arquivo_id from lab.requisicao_exame where id = $1`, [idParam(req)]);
    if (!it || it.situacao !== 'LIBERADO') throw new ErroHttp(422, 'Laudo disponível somente após a liberação.');
    if (it.laudo_arquivo_id) {
      const a = await lerArquivo(it.laudo_arquivo_id);
      return reply.header('content-type', a.tipo_mime).header('content-disposition', `inline; filename="${encodeURIComponent(a.nome)}"`).send(a.conteudo);
    }
    return pdf(reply, await emitirLaudo(pool, [it.id], u));
  });

  app.post('/api/laboratorio/requisicoes/:id/entrega', async (req) => {
    const u = exigirPermissao(req, 'lab_entrega:executar');
    const b = z.object({ retiradoPor: z.string().nullish(), naoRetirado: z.boolean().default(false) }).parse(req.body);
    return transacao(contextoDe(req, b.naoRetirado ? 'lab:nao_retirado' : 'lab:entrega'), (c) => registrarEntrega(c, idParam(req), b, u));
  });

  // ---------------------------------------------------------------------------
  // Dados do paciente durante a digitação (TR 1.2.47.43.60, 1.2.47.43.60.1)
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/pacientes/:id/resultados', async (req) => {
    exigirUsuario(req);
    const linhas = await consultar(
      `select i.id, i.exame_id, e.nome exame, e.sigla, r.numero, i.liberado_em, i.valores, i.rotulos, i.observacao_resultado, i.layout, i.alertas, i.laudo_arquivo_id, i.anexo_externo, pl.nome liberador
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id left join cad.profissional pl on pl.id = i.liberado_por
        where r.paciente_id = $1 and i.situacao = 'LIBERADO' and ($2::bigint is null or i.exame_id = $2) order by i.liberado_em desc limit 200`,
      [idParam(req), (req.query as any).exameId ? Number((req.query as any).exameId) : null],
    );
    return linhas.map((l) => {
      const resumo = l.anexo_externo ? 'Resultado anexado em PDF.' : textoResultado(l.layout?.variaveis ?? [], l.valores ?? {}, l.rotulos, l.observacao_resultado);
      const { layout: _l, ...resto } = l;
      return { ...resto, resumo };
    });
  });

  app.get('/api/laboratorio/pacientes/:id/contexto', async (req) => {
    exigirUsuario(req);
    const id = idParam(req);
    const seguro = async (sql: string) => {
      try {
        return await consultar(sql, [id]);
      } catch (e: any) {
        if (e.code === '42P01' || e.code === '42703') return [];
        throw e;
      }
    };
    return {
      alergias: await seguro(`select substancia, gravidade, tipo from cad.pessoa_alergia where pessoa_id = $1`),
      medicamentosEmUso: await seguro(
        `select d.data_hora, pr.nome || coalesce(' ' || pr.concentracao, '') produto, di.quantidade, di.termino_previsto from far.dispensacao_item di join far.dispensacao d on d.id = di.dispensacao_id
          join far.produto pr on pr.id = di.produto_id where d.paciente_id = $1 and d.situacao = 'EFETIVADA' and (di.termino_previsto is null or di.termino_previsto >= current_date - 7) order by d.data_hora desc limit 50`,
      ),
      usoContinuo: await seguro(
        `select distinct on (i.descricao) r.data, i.descricao, i.posologia from amb.prescricao r join amb.prescricao_item i on i.prescricao_id = r.id where r.paciente_id = $1 and i.uso_continuo order by i.descricao, r.data desc`,
      ),
      vacinas: await seguro(
        `select v.data, i.sigla || ' - ' || i.nome imunobiologico, d.sigla dose from imu.vacinacao v join imu.imunobiologico i on i.id = v.imunobiologico_id left join imu.dose d on d.id = v.dose_id
          where v.paciente_id = $1 and v.tipo in ('APLICACAO','RESGATE') order by v.data desc limit 100`,
      ),
    };
  });

  app.post('/api/laboratorio/ocorrencias', async (req) => {
    const u = exigirPermissao(req, 'lab_requisicao:alterar');
    const b = z.object({ requisicaoId: num, itemId: num.nullish(), motivoId: num, descricao: z.string().nullish() }).parse(req.body);
    return transacao(contextoDe(req, 'lab:ocorrencia'), (c) => registrarOcorrencia(c, b, u));
  });

  // ---------------------------------------------------------------------------
  // Configuração: layout, prévia e prazo (TR 1.2.47.7, 1.2.47.17, 1.2.47.37)
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/exames/:id/layout', async (req) => {
    exigirPermissao(req, 'lab_exame:consultar');
    const q = req.query as any;
    const nasc = new Date();
    nasc.setFullYear(nasc.getFullYear() - Number(q.idade ?? 40));
    const exame = await consultarUm(`select e.*, s.nome secao from lab.exame e left join lab.secao s on s.id = e.secao_id where e.id = $1`, [idParam(req)]);
    if (!exame) throw new ErroHttp(404, 'Exame não encontrado.');
    const layout = referenciasDoPaciente(await layoutDoExame(pool, idParam(req)), q.sexo ?? 'F', nasc.toISOString().slice(0, 10));
    const predefinidos = await consultar(`select id, variavel_codigo, texto from lab.resultado_predefinido where ativo and (exame_id = $1 or exame_id is null) order by texto`, [idParam(req)]);
    return { exame, layout, predefinidos };
  });

  app.post('/api/laboratorio/exames/:id/avaliar', async (req) => {
    exigirPermissao(req, 'lab_exame:consultar');
    const b = z.object({ valores: z.record(z.any()), sexo: z.string().default('F'), idade: num.default(40) }).parse(req.body);
    const nasc = new Date();
    nasc.setFullYear(nasc.getFullYear() - b.idade);
    const r = avaliarResultado(await layoutDoExame(pool, idParam(req)), b.valores, { sexo: b.sexo, nascimento: nasc.toISOString().slice(0, 10) }, null);
    return { valores: r.valores, alertas: r.alertas, pendentes: r.pendentes, sinais: r.sinais };
  });

  app.post('/api/laboratorio/exames/:id/previa-laudo', async (req, reply) => {
    const u = exigirPermissao(req, 'lab_exame:consultar');
    const b = z.object({ html: z.string().nullish(), orientacao: z.string().nullish(), sexo: z.string().optional(), idade: num.optional() }).parse(req.body ?? {});
    return pdf(reply, await previaLaudo(pool, { exameId: idParam(req), ...b }, u));
  });

  app.get('/api/laboratorio/exames/:id/prazo', async (req) => {
    exigirUsuario(req);
    const q = req.query as any;
    return { previsao: await previsaoEntrega(pool, [idParam(req)], q.laboratorioId ? Number(q.laboratorioId) : null, q.base || undefined) };
  });

  app.get('/api/laboratorio/modelos/campos', async (req) => {
    exigirUsuario(req);
    return { laudo: CAMPOS_MODELO, mapa: [...CAMPOS_MODELO.filter(([k]) => !['assinatura'].includes(k)), ['atendimento.solicitante', 'Profissional solicitante'], ['atendimento.unidade', 'Unidade solicitante'], ['atendimento.dados_clinicos', 'Dados clínicos']] };
  });

  // ---------------------------------------------------------------------------
  // Materiais, entradas e inutilizações do laboratório (TR 1.2.47.40 a 1.2.47.42)
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/materiais', async (req) => {
    exigirPermissao(req, 'produto:consultar');
    const q = req.query as any;
    return consultar(
      `select p.id, p.nome, p.concentracao, p.ativo, p.codigos_barras, p.estoque_minimo, g.nome grupo, cm.codigo catmat, cm.descricao catmat_descricao, p.preco_custo,
              coalesce((select sum(l.quantidade) from far.estoque_lote l where l.produto_id = p.id and not l.bloqueado), 0) saldo,
              (select count(*) from far.produto_similar s where s.produto_id = p.id)::int similares
         from far.produto p left join far.grupo_produto g on g.id = p.grupo_id left join far.catmat cm on cm.id = p.catmat_id
        where ($1::boolean or p.tipo = 'LABORATORIO') and ($2::text is null or f_unaccent(p.nome) ilike f_unaccent('%' || $2 || '%') or p.codigos_barras ilike '%' || $2 || '%')
          and ($3::bigint is null or p.grupo_id = $3) and ($4::text is null or cm.codigo ilike $4 || '%' or f_unaccent(cm.descricao) ilike f_unaccent('%' || $4 || '%'))
          and ($5::boolean is null or p.ativo = $5)
        order by p.nome limit 300`,
      [q.todos === 'true', q.nome?.trim() || null, q.grupoId ? Number(q.grupoId) : null, q.catmat?.trim() || null, q.situacao === 'ATIVO' ? true : q.situacao === 'INATIVO' ? false : null],
    );
  });

  app.post('/api/laboratorio/materiais/etiquetas', async (req, reply) => {
    const u = exigirPermissao(req, 'produto:consultar');
    const b = z.object({ ids: z.array(num).min(1), copias: num.default(1) }).parse(req.body);
    return pdf(reply, await emitirEtiquetasMateriais(pool, b.ids, b.copias, u));
  });

  // Histórico de entradas com pesquisa por data, nota, fornecedor e unidade (TR 1.2.47.41.1).
  app.get('/api/laboratorio/entradas', async (req) => {
    exigirPermissao(req, 'entrada:consultar');
    const q = req.query as any;
    return consultar(
      `select e.id, e.data_entrada::text data_entrada, e.data_compra::text data_compra, e.nota_numero, e.nota_serie, e.situacao, e.valor_nota, f.nome fornecedor, u.nome unidade,
              (select count(*) from far.entrada_item i where i.entrada_id = e.id)::int itens,
              (select sum(i.quantidade * coalesce(i.valor_unitario, 0)) from far.entrada_item i where i.entrada_id = e.id) total
         from far.entrada e left join far.fornecedor f on f.id = e.fornecedor_id join cad.unidade u on u.id = e.unidade_id
        where ($1::date is null or e.data_entrada >= $1) and ($2::date is null or e.data_entrada <= $2) and ($3::text is null or e.nota_numero ilike $3 || '%')
          and ($4::text is null or f_unaccent(f.nome) ilike f_unaccent('%' || $4 || '%')) and ($5::bigint is null or e.unidade_id = $5)
          and ($6::boolean or exists (select 1 from far.entrada_item i join far.produto p on p.id = i.produto_id where i.entrada_id = e.id and p.tipo = 'LABORATORIO'))
        order by e.data_entrada desc, e.id desc limit 300`,
      [q.de || null, q.ate || null, q.nota?.trim() || null, q.fornecedor?.trim() || null, q.unidadeId ? Number(q.unidadeId) : null, q.todos === 'true'],
    );
  });

  // Entrada com nota fiscal e itens lidos por código de barras (TR 1.2.47.41.2 a 1.2.47.41.4.1).
  app.post('/api/laboratorio/entradas', async (req) => {
    const u = exigirPermissao(req, 'entrada:incluir');
    const b = z
      .object({
        unidadeId: num,
        fornecedorId: num.nullish(),
        notaNumero: z.string().min(1),
        notaSerie: z.string().nullish(),
        dataCompra: z.string().nullish(),
        dataEntrada: z.string(),
        valorNota: num.nullish(),
        confirmar: z.boolean().default(true),
        ignorarDiferencaValor: z.boolean().default(false),
        itens: z.array(z.object({ produtoId: num, lote: z.string().min(1), validade: z.string(), quantidade: num.positive(), valorUnitario: num.nullish(), fabricanteId: num.nullish() })).min(1),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'entrada:incluir'), async (c) => {
      const e = (
        await c.query(
          `insert into far.entrada (unidade_id, tipo, fornecedor_id, nota_numero, nota_serie, data_compra, data_entrada, valor_nota, situacao) values ($1,'FORNECEDOR',$2,$3,$4,$5,$6,$7,'DIGITACAO') returning id`,
          [b.unidadeId, b.fornecedorId ?? null, b.notaNumero, b.notaSerie ?? null, b.dataCompra ?? null, b.dataEntrada, b.valorNota ?? null],
        )
      ).rows[0];
      for (const i of b.itens)
        await c.query(`insert into far.entrada_item (entrada_id, produto_id, fabricante_id, lote, validade, quantidade, valor_unitario) values ($1,$2,$3,$4,$5,$6,$7)`, [
          e.id,
          i.produtoId,
          i.fabricanteId ?? null,
          i.lote,
          i.validade,
          i.quantidade,
          i.valorUnitario ?? null,
        ]);
      if (!b.confirmar) return { id: e.id, situacao: 'DIGITACAO' };
      const r = await confirmarEntrada(c, e.id, u, { ignorarDiferencaValor: b.ignorarDiferencaValor });
      return { id: e.id, ...r };
    });
  });

  // Consulta de inutilizações por data, produto, lote, quantidade, vencimento e motivo (TR 1.2.47.42.3, 1.2.47.42.4).
  app.get('/api/laboratorio/inutilizacoes', async (req) => {
    exigirPermissao(req, 'inutilizacao:consultar');
    const q = req.query as any;
    return consultar(
      `select i.id, i.data::text data, pr.nome produto, l.lote, l.validade::text validade, i.quantidade, i.valor_total, u.nome unidade, m.nome motivo, i.observacao
         from far.inutilizacao i join far.produto pr on pr.id = i.produto_id join far.estoque_lote l on l.id = i.lote_id join cad.unidade u on u.id = i.unidade_id
         join far.motivo_inutilizacao m on m.id = i.motivo_id
        where ($1::date is null or i.data >= $1) and ($2::date is null or i.data <= $2) and ($3::text is null or f_unaccent(pr.nome) ilike f_unaccent('%' || $3 || '%'))
          and ($4::text is null or l.lote ilike $4 || '%') and ($5::numeric is null or i.quantidade = $5) and ($6::date is null or l.validade = $6) and ($7::bigint is null or i.motivo_id = $7)
          and ($8::boolean or pr.tipo = 'LABORATORIO')
        order by i.data desc, i.id desc limit 300`,
      [q.de || null, q.ate || null, q.produto?.trim() || null, q.lote?.trim() || null, q.quantidade ? Number(q.quantidade) : null, q.vencimento || null, q.motivoId ? Number(q.motivoId) : null, q.todos === 'true'],
    );
  });

  // ---------------------------------------------------------------------------
  // Painel do laboratório
  // ---------------------------------------------------------------------------
  app.get('/api/laboratorio/painel', async (req) => {
    exigirPermissao(req, 'lab_requisicao:consultar');
    const total = await consultarUm(
      `select count(*) filter (where r.criado_em::date = current_date)::int recebidas_hoje,
              count(*) filter (where r.data_agendada = current_date)::int agendadas_hoje,
              count(*) filter (where r.data_agendada = current_date and r.presenca = 'FALTOU')::int faltas_hoje,
              count(*) filter (where r.situacao in ('RECEBIDA','COLETA_PARCIAL') and r.data_agendada <= current_date and r.presenca <> 'FALTOU')::int aguardando_coleta,
              count(*) filter (where r.situacao in ('LIBERADA','LIBERADA_PARCIAL'))::int aguardando_entrega,
              count(*) filter (where r.data_prevista_entrega < current_date and r.situacao not in ('LIBERADA','ENTREGUE','NAO_RETIRADA','CANCELADA'))::int atrasadas
         from lab.requisicao r`,
    );
    const itens = await consultar(
      `select coalesce(s.nome, 'Sem seção') secao, count(*) filter (where i.situacao in ('COLETADO','EM_ANALISE'))::int a_digitar,
              count(*) filter (where i.situacao = 'DIGITADO_PARCIAL')::int parciais, count(*) filter (where i.situacao = 'DIGITADO')::int a_liberar,
              count(*) filter (where i.situacao = 'LIBERADO' and i.liberado_em::date = current_date)::int liberados_hoje
         from lab.requisicao_exame i join lab.exame e on e.id = i.exame_id left join lab.secao s on s.id = e.secao_id
        where i.situacao <> 'CANCELADO' and (i.situacao <> 'LIBERADO' or i.liberado_em::date = current_date) group by 1 order by 1`,
    );
    const tat = await consultarUm(
      `select round(avg(extract(epoch from (i.liberado_em - a.coletada_em)) / 3600)::numeric, 1) horas
         from lab.requisicao_exame i join lateral (select min(coletada_em) coletada_em from lab.amostra a where a.itens @> jsonb_build_array(i.id)) a on true
        where i.situacao = 'LIBERADO' and i.liberado_em > now() - interval '30 days'`,
    );
    return { ...total, porSecao: itens, tempoMedioHoras: tat?.horas ?? null };
  });

  // ---------------------------------------------------------------------------
  // Laboratórios de apoio: token, WebService e faturamento (TR 1.2.47.18, 1.2.48.12 a 1.2.48.14)
  // ---------------------------------------------------------------------------
  app.post('/api/laboratorio/laboratorios/:id/token', async (req) => {
    exigirPermissao(req, 'lab_laboratorio:alterar');
    const token = gerarToken();
    await transacao(contextoDe(req, 'lab_laboratorio:token'), (c) => c.query(`update lab.laboratorio set token_hash = $2, token_gerado_em = now() where id = $1`, [idParam(req), hashToken(token)]));
    return { token, aviso: 'Guarde o token: ele não será exibido novamente.' };
  });

  app.get('/api/publico/laboratorio/apoio/pedidos', async (req) => {
    const lab = await laboratorioPorToken(req);
    const linhas = await consultar(
      `select i.id item_id, r.numero requisicao, e.sigla exame, e.nome exame_nome, pr.codigo procedimento, p.nome paciente, p.sexo, p.data_nascimento::text nascimento, p.cns,
              (select string_agg(a.codigo_barras, ',') from lab.amostra a where a.requisicao_id = r.id and a.situacao <> 'DESCARTADA' and a.itens @> jsonb_build_array(i.id)) amostras,
              (select json_agg(json_build_object('codigo', v.codigo, 'rotulo', v.rotulo, 'tipo', v.tipo, 'unidade', v.unidade_medida) order by v.ordem) from lab.exame_variavel v where v.exame_id = e.id and v.tipo <> 'TITULO') variaveis
         from lab.requisicao_exame i join lab.requisicao r on r.id = i.requisicao_id join lab.exame e on e.id = i.exame_id join cad.procedimento pr on pr.id = e.procedimento_id
         join cad.pessoa p on p.id = r.paciente_id where i.laboratorio_id = $1 and i.situacao in ('COLETADO','EM_ANALISE','DIGITADO_PARCIAL') order by r.id`,
      [lab.id],
    );
    return { laboratorio: lab.nome, pedidos: linhas };
  });

  app.post('/api/publico/laboratorio/apoio/resultados', async (req) => {
    const lab = await laboratorioPorToken(req);
    const b = z
      .object({
        resultados: z
          .array(
            z.object({
              itemId: num.optional(),
              amostra: z.string().optional(),
              exame: z.string().optional(),
              valores: z.record(z.any()).default({}),
              observacao: z.string().nullish(),
              assinadoPor: z.string().nullish(),
              liberar: z.boolean().default(false),
              pdfBase64: z.string().nullish(),
            }),
          )
          .min(1),
      })
      .parse(req.body);
    return transacao({ usuarioId: null, ip: req.ip, rotina: `lab:webservice_apoio:${lab.id}` }, async (c) => {
      const saida = [];
      for (const r of b.resultados) {
        const item = r.itemId
          ? (await c.query(`select id from lab.requisicao_exame where id = $1 and laboratorio_id = $2`, [r.itemId, lab.id])).rows[0]
          : (
              await c.query(
                `select i.id from lab.amostra a join lab.requisicao_exame i on i.id in (select jsonb_array_elements_text(a.itens)::bigint) join lab.exame e on e.id = i.exame_id
                  where a.codigo_barras = $1 and upper(e.sigla) = upper($2) and i.laboratorio_id = $3`,
                [r.amostra ?? '', r.exame ?? '', lab.id],
              )
            ).rows[0];
        if (!item) {
          saida.push({ itemId: r.itemId, amostra: r.amostra, exame: r.exame, ok: false, erro: 'Exame não encontrado para este laboratório.' });
          continue;
        }
        try {
          await c.query('savepoint ws');
          if (r.pdfBase64) {
            const arq = await salvarArquivo(`resultado_${item.id}.pdf`, 'application/pdf', Buffer.from(r.pdfBase64, 'base64'), null, c);
            await c.query(
              `update lab.requisicao_exame set situacao = 'LIBERADO', anexo_externo = true, laudo_arquivo_id = $2, liberado_em = now(), layout = $3 where id = $1 and situacao <> 'LIBERADO'`,
              [item.id, arq, JSON.stringify({ assinanteExterno: r.assinadoPor ?? lab.nome })],
            );
            await c.query(`update amb.solicitacao_exame_item set situacao = 'REALIZADO', resultado_texto = $2, resultado_arquivo_id = $3, resultado_liberado_em = now() where id = (select solicitacao_item_id from lab.requisicao_exame where id = $1)`, [item.id, `Resultado do laboratório de apoio ${lab.nome} (PDF).`, arq]);
            await atualizarSituacaoRequisicao(c, (await c.query(`select requisicao_id from lab.requisicao_exame where id = $1`, [item.id])).rows[0].requisicao_id);
            saida.push({ itemId: item.id, ok: true, situacao: 'LIBERADO' });
          } else {
            const s = await salvarResultado(c, item.id, { valores: r.valores, observacao: r.observacao }, null);
            let situacao = s.situacao;
            if (r.liberar && s.situacao === 'DIGITADO') {
              const lib = await liberarItens(c, [item.id], null, null, { assinanteExterno: r.assinadoPor ?? lab.responsavel_tecnico ?? lab.nome });
              if (lib.liberados.length) {
                const doc = await emitirLaudo(c, [item.id], undefined);
                await c.query(`update lab.requisicao_exame set laudo_arquivo_id = $2 where id = $1`, [item.id, doc.arquivoId]);
                await c.query(`update amb.solicitacao_exame_item set resultado_arquivo_id = $2 where id = (select solicitacao_item_id from lab.requisicao_exame where id = $1)`, [item.id, doc.arquivoId]);
                situacao = 'LIBERADO';
              }
            }
            saida.push({ itemId: item.id, ok: true, situacao, alertas: s.alertas.map((a) => a.mensagem) });
          }
          await c.query('release savepoint ws');
        } catch (e) {
          await c.query('rollback to savepoint ws');
          saida.push({ itemId: item.id, ok: false, erro: (e as Error).message });
        }
      }
      return { laboratorio: lab.nome, resultados: saida };
    });
  });

  // Arquivo de faturamento SUS (BPA consolidado e individualizado) dos pedidos repassados ao apoio (TR 1.2.48.14).
  app.get('/api/laboratorio/laboratorios/:id/bpa', async (req, reply) => {
    exigirPermissao(req, 'lab_requisicao:exportar');
    const comp = String((req.query as any).competencia ?? '');
    const lab = await consultarUm(`select * from lab.laboratorio where id = $1`, [idParam(req)]);
    if (!lab?.unidade_id) throw new ErroHttp(422, 'Informe a unidade/prestador (CNES) do laboratório para gerar o faturamento.');
    const bpa = await transacao(contextoDe(req, 'lab:bpa_apoio'), (c) => gerarBpa(c, comp, lab.unidade_id, true));
    return reply
      .header('content-type', 'text/plain; charset=iso-8859-1')
      .header('content-disposition', `attachment; filename="${bpa.nome}"`)
      .header('x-bpa-resumo', JSON.stringify({ linhas: bpa.linhas, consolidado: bpa.consolidado, individualizado: bpa.individualizado }))
      .send(bpa.conteudo);
  });

  // ---------------------------------------------------------------------------
  // Interfaceamento (TR 1.2.48)
  // ---------------------------------------------------------------------------
  app.post('/api/interfaceamento/equipamentos/:id/mensagens', async (req) => {
    const u = exigirPermissao(req, 'int_comunicacao:executar');
    const b = textoCorpo(req);
    return transacao(contextoDe(req, 'int:mensagem'), (c) => processarMensagem(c, idParam(req), b.conteudo, u, b.protocolo));
  });
  app.get('/api/interfaceamento/equipamentos/:id/consulta', async (req) => {
    exigirPermissao(req, 'int_comunicacao:executar');
    const amostra = String((req.query as any).amostra ?? '').trim();
    if (!amostra) throw new ErroHttp(422, 'Informe o código da amostra.');
    return transacao(contextoDe(req, 'int:consulta'), (c) => responderConsulta(c, idParam(req), amostra));
  });
  app.get('/api/interfaceamento/equipamentos/:id/pendentes', async (req) => {
    exigirPermissao(req, 'int_comunicacao:executar');
    return transacao(contextoDe(req, 'int:pendentes'), (c) => retirarPendentes(c, idParam(req)));
  });
  app.get('/api/interfaceamento/equipamentos/:id/lista-trabalho', async (req, reply) => {
    const u = exigirPermissao(req, 'int_comunicacao:executar');
    const eq = await consultarUm(`select nome from lab.equipamento where id = $1`, [idParam(req)]);
    if (!eq) throw new ErroHttp(404, 'Equipamento não encontrado.');
    const r = await transacao(contextoDe(req, 'int:lista_trabalho'), (c) => listaDeTrabalho(c, idParam(req)));
    if ((req.query as any).formato === 'csv') return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="lista_trabalho_${idParam(req)}.csv"`).send(r.csv);
    const { emitirDocumento } = await import('../../servicos/relatorios.js');
    const doc = await emitirDocumento(
      { relatorio: 'int:lista-trabalho', titulo: `Lista de trabalho - ${eq.nome}`, filtros: { equipamento: idParam(req), t: Date.now() } },
      [
        {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', 'auto', '*', 'auto'],
            body: [
              ['Posição', 'Amostra', 'Requisição', 'Paciente', 'Ensaios'].map((t) => ({ text: t, style: 'th' })),
              ...r.linhas.map((l: any) => [String(l.posicao), l.codigo_barras, l.numero, l.paciente, l.ensaios].map((t) => ({ text: t, style: 'td' }))),
            ],
          },
        },
      ],
      { orientacao: 'landscape' },
      u,
    );
    return pdf(reply, doc);
  });
  app.post('/api/interfaceamento/equipamentos/:id/token', async (req) => {
    exigirPermissao(req, 'int_equipamento:alterar');
    const token = gerarToken();
    await transacao(contextoDe(req, 'int_equipamento:token'), (c) => c.query(`update lab.equipamento set token_hash = $2 where id = $1`, [idParam(req), hashToken(token)]));
    return { token, aviso: 'Configure este token no agente de comunicação do equipamento.' };
  });
  // Monitor: situação dos equipamentos, mensagens e exames por etapa da automação (TR 1.2.48.10).
  app.get('/api/interfaceamento/monitor', async (req) => {
    exigirPermissao(req, 'int_equipamento:consultar');
    const equipamentos = await consultar(
      `select e.id, e.nome, e.fabricante, e.modelo, e.protocolo, e.comunicacao, e.request_mode, e.automatizado, e.ultima_comunicacao, e.ativo, s.nome secao,
              (select count(*) from lab.interface_mensagem m where m.equipamento_id = e.id and m.direcao = 'ENVIADA' and m.situacao = 'PENDENTE')::int pendentes,
              (select count(*) from lab.interface_mensagem m where m.equipamento_id = e.id and m.situacao in ('ERRO','PARCIAL') and m.data_hora > now() - interval '1 day')::int erros_24h,
              (select count(*) from lab.equipamento_parametro p where p.equipamento_id = e.id and p.ativo)::int parametros
         from lab.equipamento e left join lab.secao s on s.id = e.secao_id order by e.nome`,
    );
    const mensagens = await consultar(
      `select m.id, m.equipamento_id, eq.nome equipamento, m.data_hora, m.direcao, m.protocolo, m.amostra, m.situacao, m.resultados, m.detalhes from lab.interface_mensagem m
         join lab.equipamento eq on eq.id = m.equipamento_id order by m.id desc limit 100`,
    );
    const itens = await consultar(
      `select coalesce(i.interface_situacao, 'SEM_INTERFACE') situacao, count(*)::int quantidade from lab.requisicao_exame i where i.situacao in ('COLETADO','EM_ANALISE','DIGITADO_PARCIAL','DIGITADO') group by 1`,
    );
    return { equipamentos, mensagens, itens };
  });
  app.get('/api/interfaceamento/mensagens/:id', async (req) => {
    exigirPermissao(req, 'int_mensagem:consultar');
    return consultarUm(`select * from lab.interface_mensagem where id = $1`, [idParam(req)]);
  });

  // Agente de comunicação centralizado: um único servidor para todos os analisadores (TR 1.2.48.4, 1.2.48.11).
  app.post('/api/publico/interfaceamento/:id/mensagens', async (req) => {
    const eq = await equipamentoPorToken(req);
    const b = textoCorpo(req);
    return transacao({ usuarioId: null, ip: req.ip, rotina: `int:agente:${eq.id}` }, (c) => processarMensagem(c, eq.id, b.conteudo, null, b.protocolo));
  });
  app.get('/api/publico/interfaceamento/:id/pendentes', async (req) => {
    const eq = await equipamentoPorToken(req);
    return transacao({ usuarioId: null, ip: req.ip, rotina: `int:agente:${eq.id}` }, (c) => retirarPendentes(c, eq.id));
  });
  app.get('/api/publico/interfaceamento/:id/consulta', async (req, reply) => {
    const eq = await equipamentoPorToken(req);
    const r = await transacao({ usuarioId: null, ip: req.ip, rotina: `int:agente:${eq.id}` }, (c) => responderConsulta(c, eq.id, String((req.query as any).amostra ?? '')));
    return reply.header('content-type', 'text/plain; charset=utf-8').send(r.conteudo);
  });

  // Controle de qualidade: lançamento e gráfico de Levey-Jennings (TR 1.2.48.3).
  app.post('/api/interfaceamento/cq/:id/resultados', async (req) => {
    const u = exigirPermissao(req, 'int_controle:alterar');
    const b = z.object({ valor: num, acaoCorretiva: z.string().nullish() }).parse(req.body);
    return transacao(contextoDe(req, 'int:cq'), (c) => registrarResultadoControle(c, idParam(req), b.valor, 'MANUAL', u, b.acaoCorretiva));
  });
  app.get('/api/interfaceamento/cq/:id', async (req) => {
    exigirPermissao(req, 'int_controle:consultar');
    const controle = await consultarUm(
      `select c.*, c.validade::text validade, e.nome equipamento, x.nome exame from lab.cq_controle c join lab.equipamento e on e.id = c.equipamento_id join lab.exame x on x.id = c.exame_id where c.id = $1`,
      [idParam(req)],
    );
    if (!controle) throw new ErroHttp(404, 'Controle não encontrado.');
    const resultados = await consultar(`select id, data_hora, valor, desvios, violacoes, situacao, origem, acao_corretiva from lab.cq_resultado where controle_id = $1 order by data_hora desc, id desc limit 60`, [idParam(req)]);
    return { controle, resultados: resultados.reverse() };
  });
}

const EXEMPLO_ETIQUETA: Record<string, string> = {
  'paciente.nome': 'MARIA DA SILVA SANTOS',
  'paciente.codigo': '1234',
  'paciente.prontuario': '000123',
  'paciente.nascimento': '01/01/1980',
  'requisicao.numero': 'L2026000001',
  'amostra.codigo': '202600000101',
  'amostra.numero': '1',
  'amostra.material': 'SANGUE',
  'amostra.recipiente': 'TUBO EDTA 4 ML',
  'amostra.cor': 'ROXA',
  'amostra.volume': '4,0',
  'amostra.espaco_morto': '0,5',
  'exames.siglas': 'HMG GLI',
  'exames.codigo_interface': 'CBC',
  'coleta.data': '19/10/2026',
  'coleta.hora': '07:30',
  'secao.nome': 'HEMATOLOGIA',
  'laboratorio.nome': 'LABORATÓRIO MUNICIPAL',
};
