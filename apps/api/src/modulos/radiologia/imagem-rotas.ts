// Rotas comuns aos módulos de Radiologia (TR 1.2.45) e Ecografia (TR 1.2.50): recepção/lista de trabalho,
// execução, laudo, assinatura, impressão, envelope, entrega, prontuário e cadastros auxiliares.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { lerArquivo } from '../../servicos/arquivos.js';
import type { ResultadoEmissao } from '../../servicos/relatorios.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario, registrarRotina, temPermissao, type Usuario } from '../../seguranca/usuario.js';
import { parametro, registrarProvedorAlerta } from '../cadastros/alertas.js';
import { nomes, type ConfigImagem } from './imagem.js';
import {
  adicionarImagem,
  anexarResultado,
  aplicarVariaveis,
  assinanteDoExame,
  assinar,
  copiarCbosDoSigtap,
  desfazerFalta,
  executar,
  exameOuErro,
  exigirLaudoEditavel,
  gerarEnvelope,
  gerarPdfLaudo,
  gerarPreviaModelo,
  importarSigtap,
  incluirAvulso,
  LAUDO_LIBERADO,
  listar,
  modelosDoExame,
  preencherDoSigtap,
  registrarChegada,
  registrarEntrega,
  registrarFalta,
  registrarNaoRetirado,
  removerImagem,
  retificar,
  salvarLaudo,
  selectLista,
  sincronizarAgenda,
  validarPacienteExame,
  variaveis,
} from './imagem-servico.js';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const opcional = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), t.optional());
const numero = opcional(z.coerce.number());
const texto = opcional(z.string());

const pdf = (reply: FastifyReply, r: ResultadoEmissao | { conteudo: Buffer; nome: string; mime?: string }) =>
  reply
    .header('content-type', (r as any).mime ?? 'application/pdf')
    .header('content-disposition', `inline; filename="${encodeURIComponent(r.nome)}"`)
    .send(r.conteudo);

/** Ganchos do cadastro genérico: preenchimento SIGTAP, modelo padrão único e bloqueio de laudos liberados. */
export function registrarGanchosImagem(cfg: ConfigImagem) {
  const n = nomes(cfg);
  const s = cfg.esquema;
  registrarGanchos(n.exame, {
    async antesSalvar(d, { cliente, atual }) {
      if (d.procedimento_id || !atual) await preencherDoSigtap(cliente, d);
      if (d.idade_minima != null && d.idade_maxima != null && Number(d.idade_minima) > Number(d.idade_maxima)) throw new ErroHttp(422, 'A idade mínima não pode ser maior que a máxima.');
    },
    async depoisSalvar(r, { cliente, atual }) {
      if (!atual) await copiarCbosDoSigtap(cliente, cfg, r.id);
    },
  });
  registrarGanchos(n.modelo, {
    async depoisSalvar(r, { cliente }) {
      if (r.padrao) await cliente.query(`update ${s}.modelo_laudo set padrao = false where id <> $1 and exame_id is not distinct from $2 and profissional_id is not distinct from $3 and padrao`, [r.id, r.exame_id, r.profissional_id]);
    },
  });
  registrarGanchos(n.imagem, {
    async antesSalvar(d, { cliente, atual }) {
      exigirLaudoEditavel(await exameOuErro(cliente, cfg, Number(d.atendimento_id ?? atual?.atendimento_id)));
    },
    async antesExcluir(r, { cliente }) {
      exigirLaudoEditavel(await exameOuErro(cliente, cfg, Number(r.atendimento_id)));
    },
  });
  registrarGanchos(n.atendimento, {
    async antesSalvar(d, { atual }) {
      if (atual && LAUDO_LIBERADO.includes(atual.situacao_laudo)) throw new ErroHttp(422, 'Exame com laudo liberado: utilize a retificação na tela de laudo.');
      if (!atual) {
        d.situacao = 'PRESENTE';
        d.situacao_laudo = 'NAO_DIGITADO';
        d.situacao_entrega = 'PENDENTE';
      }
    },
    async antesExcluir(r) {
      if (r.situacao !== 'AGENDADO' || r.situacao_laudo !== 'NAO_DIGITADO') throw new ErroHttp(422, 'Somente exames ainda não atendidos podem ser excluídos.');
    },
  });

  // Aviso no cabeçalho do paciente, no atendimento/prontuário, de laudos liberados recentemente (TR 1.2.45.8.13, 1.2.50.8.13).
  registrarProvedorAlerta(async (p, ctx) => {
    if (!ctx.usuario || !['atendimento', 'prontuario'].includes(ctx.rotina ?? '') || !temPermissao(ctx.usuario, 'prontuario:consultar')) return [];
    const dias = await parametro<number>(`${s}.alerta_dias_laudo`, 30);
    const laudos = await consultar(
      `select coalesce(e.nome, pr.nome) exame, coalesce(t.assinado_em, t.anexado_em) em from ${s}.atendimento t join ${s}.exame e on e.id = t.exame_id
         left join cad.procedimento pr on pr.id = t.procedimento_id
        where t.paciente_id = $1 and t.situacao_laudo in ('ASSINADO','ANEXADO','IMPRESSO') and coalesce(t.assinado_em, t.anexado_em) > now() - make_interval(days => $2)
        order by 2 desc limit 3`,
      [p.id, dias],
    );
    return laudos.map((l) => ({
      tipo: `laudo_${s}`,
      nivel: 'info' as const,
      mensagem: `Laudo de ${cfg.titulo.toLowerCase()} liberado em ${new Date(l.em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}: ${l.exame} (veja Exames no histórico do paciente).`,
    }));
  });
}

export async function registrarRotasImagem(app: FastifyInstance, cfg: ConfigImagem) {
  const n = nomes(cfg);
  const s = cfg.esquema;
  const base = `/api/${cfg.rota}`;
  const consultarP = `${n.atendimento}:consultar`;
  const recepcao = `${n.permRecepcao}:executar`;
  const idDe = (req: any) => Number(req.params.id);

  const detalhe = async (id: number, u: Usuario) => {
    const t = (await consultarUm(`${selectLista(s)} where t.id = $1`, [id])) ?? null;
    if (!t) throw new ErroHttp(404, 'Exame não encontrado.');
    const bruto = await exameOuErro(pool, cfg, id);
    const imagens = await consultar(`select i.id, i.arquivo_id, i.descricao, i.incluir_laudo, a.tipo_mime, a.nome from ${s}.imagem i join sis.arquivo a on a.id = i.arquivo_id where i.atendimento_id = $1 order by i.id`, [id]);
    const assinante = await assinanteDoExame(pool, cfg, u.profissionalId, bruto.exame_id);
    const editavel = !bruto.resultado_arquivo_id && ['NAO_DIGITADO', 'DIGITADO'].includes(bruto.situacao_laudo) && !['CANCELADO', 'FALTOSO'].includes(bruto.situacao);
    const ex = await consultarUm(`select * from ${s}.exame where id = $1`, [bruto.exame_id]);
    const extras = await consultarUm(
      `select l.nome laudista, d.login digitado_por_login, m.nome modelo, eq.nome equipamento from ${s}.atendimento t
         left join cad.profissional l on l.id = t.laudista_id left join seg.operador d on d.id = t.digitado_por
         left join ${s}.modelo_laudo m on m.id = t.modelo_id left join ${s}.equipamento eq on eq.id = t.equipamento_id where t.id = $1`,
      [id],
    );
    return {
      ...bruto,
      ...t,
      ...extras,
      exame: ex,
      imagens,
      avisos: await validarPacienteExame(pool, cfg, bruto.exame_id, bruto.paciente_id),
      pode: {
        editar: editavel && temPermissao(u, `${n.permLaudo}:digitar`),
        assinar: editavel && bruto.situacao_laudo === 'DIGITADO' && !!assinante && temPermissao(u, `${n.permLaudo}:assinar`),
        imprimir: ['ASSINADO', 'IMPRESSO'].includes(bruto.situacao_laudo) || !!bruto.resultado_arquivo_id,
        envelope: LAUDO_LIBERADO.includes(bruto.situacao_laudo),
        retificar: LAUDO_LIBERADO.includes(bruto.situacao_laudo) && temPermissao(u, `${n.permLaudo}:retificar`),
        entregar: LAUDO_LIBERADO.includes(bruto.situacao_laudo) && temPermissao(u, `${n.permLaudo}:entregar`),
      },
      assinanteHabilitado: !!assinante,
      exigeSenha: await parametro<boolean>(`${s}.assinatura_confirmar_senha`, true),
    };
  };

  // ---------------------------------------------------------------------------
  // Recepção e lista de trabalho
  // ---------------------------------------------------------------------------

  // Primeira tela: pacientes com exames agendados na data, com pesquisa por paciente, convênio e status do laudo
  // (TR 1.2.45.8.1 a 1.2.45.8.4, 1.2.50.8.1 a 1.2.50.8.4).
  app.get(`${base}/lista`, async (req) => {
    const u = exigirPermissao(req, consultarP);
    const f = z
      .object({
        de: texto,
        ate: texto,
        todasDatas: opcional(z.enum(['true', 'false'])),
        unidadeId: numero,
        pacienteId: numero,
        nome: texto,
        prontuario: texto,
        unidadeSolicitanteId: numero,
        procedimento: texto,
        cpf: texto,
        cns: texto,
        convenioId: numero,
        requisicao: texto,
        situacao: texto,
        situacaoLaudo: texto,
        situacaoEntrega: texto,
        exameId: numero,
      })
      .parse(req.query);
    const todas = f.todasDatas === 'true';
    const de = todas ? undefined : (f.de ?? hoje());
    const ate = todas ? undefined : (f.ate ?? de);
    if (de && ate && ate >= de && (new Date(ate).getTime() - new Date(de).getTime()) / 86_400_000 <= 62) {
      await transacao(contextoDe(req, `${s}:sincronizar`), (c) => sincronizarAgenda(c, cfg, de, ate));
    }
    return listar(cfg, { ...f, de, ate, unidadeId: f.unidadeId ?? (u.administrador ? undefined : (u.unidadeAtual ?? undefined)) });
  });

  // Indicadores do dia para a recepção.
  app.get(`${base}/painel`, async (req) => {
    exigirPermissao(req, consultarP);
    const q = req.query as any;
    const data = q.data || hoje();
    return consultarUm(
      `select count(*) filter (where situacao <> 'CANCELADO')::int total, count(*) filter (where situacao = 'AGENDADO')::int agendados,
              count(*) filter (where situacao = 'PRESENTE')::int presentes, count(*) filter (where situacao = 'REALIZADO')::int realizados,
              count(*) filter (where situacao = 'FALTOSO')::int faltosos,
              (select count(*)::int from ${s}.atendimento x where x.situacao = 'REALIZADO' and x.situacao_laudo in ('NAO_DIGITADO','DIGITADO')) laudos_pendentes,
              (select count(*)::int from ${s}.atendimento x where x.situacao_laudo in ('ASSINADO','ANEXADO','IMPRESSO') and x.situacao_entrega = 'PENDENTE') aguardando_retirada
         from ${s}.atendimento where data = $1 and ($2::bigint is null or unidade_id = $2)`,
      [data, q.unidadeId ? Number(q.unidadeId) : null],
    );
  });

  // Requisições eletrônicas pendentes do paciente com exames deste módulo (atendimento sem agendamento).
  app.get(`${base}/requisicoes-pendentes`, async (req) => {
    exigirPermissao(req, consultarP);
    const pacienteId = Number((req.query as any).pacienteId);
    return consultar(
      `select i.id solicitacao_item_id, s.numero, s.data::text data, e.id exame_id, coalesce(e.nome, pr.nome) exame, i.estrutura, p.nome solicitante, u.nome unidade_solicitante,
              s.unidade_id unidade_solicitante_id, s.profissional_id profissional_solicitante_id
         from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id join ${s}.exame e on e.procedimento_id = i.procedimento_id and e.ativo
         join cad.procedimento pr on pr.id = i.procedimento_id left join cad.profissional p on p.id = s.profissional_id left join cad.unidade u on u.id = s.unidade_id
        where s.paciente_id = $1 and i.situacao in ('REQUISITADO','AGENDADO') and s.situacao <> 'CANCELADO'
          and not exists (select 1 from ${s}.atendimento t where t.solicitacao_item_id = i.id and t.situacao <> 'CANCELADO') order by s.data desc`,
      [pacienteId],
    );
  });

  app.post(`${base}/atendimentos`, async (req) => {
    const u = exigirPermissao(req, recepcao);
    const b = z
      .object({
        pacienteId: z.number(),
        exameId: z.number(),
        estrutura: z.string().optional(),
        lateralidade: z.string().optional(),
        unidadeId: z.number().optional(),
        unidadeSolicitanteId: z.number().optional(),
        profissionalSolicitanteId: z.number().optional(),
        requisicao: z.string().max(20).optional(),
        solicitacaoItemId: z.number().optional(),
        convenioId: z.number().optional(),
        urgente: z.boolean().optional(),
        confirmarAvisos: z.boolean().optional(),
      })
      .parse(req.body);
    const unidadeId = b.unidadeId ?? u.unidadeAtual;
    if (!unidadeId) throw new ErroHttp(422, 'Selecione a unidade prestadora.');
    const avisos = await validarPacienteExame(pool, cfg, b.exameId, b.pacienteId);
    if (avisos.length && !b.confirmarAvisos) throw new ErroHttp(409, avisos.join(' '), { exigeConfirmacao: true });
    return transacao(contextoDe(req, `${s}:incluir`), (c) => incluirAvulso(c, cfg, { ...b, unidadeId }));
  });

  app.get(`${base}/atendimentos/:id`, async (req) => {
    const u = exigirPermissao(req, consultarP);
    return detalhe(idDe(req), u);
  });

  app.post(`${base}/atendimentos/:id/chegada`, async (req) => {
    exigirPermissao(req, recepcao);
    return transacao(contextoDe(req, `${s}:chegada`), (c) => registrarChegada(c, cfg, idDe(req)));
  });

  // Execução: executante, sala/equipamento, incidências, filmes e contraste; lança a produção (BPA).
  app.post(`${base}/atendimentos/:id/execucao`, async (req) => {
    const u = exigirPermissao(req, recepcao);
    const b = z
      .object({
        tecnicoId: z.number().nullish(),
        equipamentoId: z.number().nullish(),
        estrutura: z.string().max(120).nullish(),
        lateralidade: z.string().nullish(),
        incidencias: z.string().max(120).nullish(),
        filmesQuantidade: z.number().int().min(0).nullish(),
        filmeTamanho: z.string().nullish(),
        filmesPerdidos: z.number().int().min(0).nullish(),
        contraste: z.boolean().nullish(),
        contrasteDescricao: z.string().max(120).nullish(),
        observacao: z.string().nullish(),
      })
      .parse(req.body);
    const limpo = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    return transacao(contextoDe(req, `${s}:execucao`), (c) => executar(c, cfg, idDe(req), limpo, u));
  });

  app.post(`${base}/atendimentos/:id/falta`, async (req) => {
    exigirPermissao(req, recepcao);
    const { motivo } = z.object({ motivo: z.string().max(250).optional() }).parse(req.body ?? {});
    await transacao(contextoDe(req, `${s}:falta`), (c) => registrarFalta(c, cfg, idDe(req), motivo));
    return { ok: true };
  });

  app.post(`${base}/atendimentos/:id/desfazer-falta`, async (req) => {
    exigirPermissao(req, recepcao);
    await transacao(contextoDe(req, `${s}:falta`), (c) => desfazerFalta(c, cfg, idDe(req)));
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Laudo
  // ---------------------------------------------------------------------------

  app.get(`${base}/atendimentos/:id/modelos`, async (req) => {
    const u = exigirPermissao(req, consultarP);
    const t = await exameOuErro(pool, cfg, idDe(req));
    return modelosDoExame(cfg, t.exame_id, u.profissionalId);
  });

  // Aplica o modelo de resultado ao exame, substituindo as variáveis (TR 1.2.45.3, 1.2.50.3).
  app.get(`${base}/atendimentos/:id/modelos/:modeloId`, async (req) => {
    exigirPermissao(req, consultarP);
    const m = await consultarUm(`select * from ${s}.modelo_laudo where id = $1 and ativo`, [Number((req.params as any).modeloId)]);
    if (!m) throw new ErroHttp(404, 'Modelo não encontrado.');
    const v = await variaveis(pool, cfg, idDe(req));
    return { id: m.id, nome: m.nome, texto: aplicarVariaveis(m.texto, v), conclusao: aplicarVariaveis(m.conclusao, v) };
  });

  app.put(`${base}/atendimentos/:id/laudo`, async (req) => {
    const u = exigirPermissao(req, `${n.permLaudo}:digitar`);
    const b = z.object({ texto: z.string().max(60_000), conclusao: z.string().max(10_000).nullish(), modeloId: z.number().nullish(), laudistaId: z.number().nullish() }).parse(req.body);
    await transacao(contextoDe(req, `${s}:laudo`), (c) => salvarLaudo(c, cfg, idDe(req), b, u));
    return detalhe(idDe(req), u);
  });

  app.post(`${base}/atendimentos/:id/imagens`, async (req) => {
    exigirPermissao(req, `${n.permLaudo}:digitar`);
    const b = z.object({ arquivoId: z.string().uuid(), descricao: z.string().max(120).optional(), incluirLaudo: z.boolean().optional() }).parse(req.body);
    return transacao(contextoDe(req, `${s}:imagem`), (c) => adicionarImagem(c, cfg, idDe(req), b));
  });

  app.delete(`${base}/atendimentos/:id/imagens/:imagemId`, async (req) => {
    exigirPermissao(req, `${n.permLaudo}:digitar`);
    await transacao(contextoDe(req, `${s}:imagem`), (c) => removerImagem(c, cfg, idDe(req), Number((req.params as any).imagemId)));
    return { ok: true };
  });

  app.post(`${base}/atendimentos/:id/resultado-anexo`, async (req) => {
    const u = exigirPermissao(req, `${n.permLaudo}:digitar`);
    const { arquivoId } = z.object({ arquivoId: z.string().uuid() }).parse(req.body);
    await transacao(contextoDe(req, `${s}:anexar-resultado`), (c) => anexarResultado(c, cfg, idDe(req), arquivoId, u));
    return detalhe(idDe(req), u);
  });

  app.post(`${base}/atendimentos/:id/assinar`, async (req) => {
    const u = exigirPermissao(req, `${n.permLaudo}:assinar`);
    const { senha } = z.object({ senha: z.string().optional() }).parse(req.body ?? {});
    const r = await transacao(contextoDe(req, `${s}:assinar`), (c) => assinar(c, cfg, idDe(req), u, senha));
    return { ...(await detalhe(idDe(req), u)), codigo: r.codigo };
  });

  app.post(`${base}/atendimentos/:id/retificar`, async (req) => {
    const u = exigirPermissao(req, `${n.permLaudo}:retificar`);
    const { motivo } = z.object({ motivo: z.string().min(5).max(250) }).parse(req.body);
    await transacao(contextoDe(req, `${s}:retificar`), (c) => retificar(c, cfg, idDe(req), motivo, u));
    return detalhe(idDe(req), u);
  });

  // Impressão do resultado somente após a assinatura (TR 1.2.45.8.10, 1.2.50.8.10); status "Impresso" (TR 1.2.50.8.4).
  app.get(`${base}/atendimentos/:id/laudo.pdf`, async (req, reply) => {
    const u = exigirPermissao(req, consultarP);
    const id = idDe(req);
    const cab = (req.query as any).cabecalho as 'PRESTADOR' | 'SOLICITANTE' | undefined;
    const r = await transacao(contextoDe(req, `${s}:imprimir`), async (c) => {
      const t = await exameOuErro(c, cfg, id, true);
      if (t.resultado_arquivo_id) {
        const a = await lerArquivo(t.resultado_arquivo_id, c);
        await c.query(`update ${s}.atendimento set situacao_laudo = 'IMPRESSO', impresso_em = now(), impressoes = coalesce(impressoes, 0) + 1 where id = $1`, [id]);
        return { conteudo: a.conteudo, nome: a.nome, mime: a.tipo_mime };
      }
      const doc = await gerarPdfLaudo(c, cfg, id, u, { cabecalho: cab === 'SOLICITANTE' ? 'SOLICITANTE' : cab === 'PRESTADOR' ? 'PRESTADOR' : undefined });
      await c.query(
        `update ${s}.atendimento set situacao_laudo = 'IMPRESSO', impresso_em = now(), impressoes = coalesce(impressoes, 0) + 1, laudo_arquivo_id = $2, codigo_validacao = $3 where id = $1`,
        [id, doc.arquivoId, doc.codigo],
      );
      return doc;
    });
    return pdf(reply, r);
  });

  // Envelope somente após a assinatura (TR 1.2.45.8.11, 1.2.50.8.11).
  app.get(`${base}/atendimentos/:id/envelope.pdf`, async (req, reply) => {
    const u = exigirPermissao(req, consultarP);
    const r = await transacao(contextoDe(req, `${s}:envelope`), (c) => gerarEnvelope(c, cfg, idDe(req), u));
    return pdf(reply, r);
  });

  // Resultado liberado (PDF do laudo ou arquivo anexado) para consulta no prontuário (TR 1.2.45.8.13, 1.2.50.8.13).
  app.get(`${base}/atendimentos/:id/resultado`, async (req, reply) => {
    const u = exigirUsuario(req);
    if (!temPermissao(u, consultarP) && !temPermissao(u, 'prontuario:consultar')) throw new ErroHttp(403, 'Operador sem permissão para esta ação.');
    const t = await exameOuErro(pool, cfg, idDe(req));
    const arq = t.resultado_arquivo_id ?? t.laudo_arquivo_id;
    if (!LAUDO_LIBERADO.includes(t.situacao_laudo) || !arq) throw new ErroHttp(422, 'Resultado ainda não liberado.');
    await registrarRotina(req, 'prontuario', `${s}:resultado`, { exame: t.id, paciente: t.paciente_id });
    const a = await lerArquivo(arq);
    return pdf(reply, { conteudo: a.conteudo, nome: a.nome, mime: a.tipo_mime });
  });

  // Laudos liberados do paciente para o profissional solicitante (TR 1.2.45.8.12, 1.2.45.8.13, 1.2.50.8.12, 1.2.50.8.13).
  app.get(`${base}/pacientes/:id/laudos`, async (req) => {
    const u = exigirUsuario(req);
    if (!temPermissao(u, consultarP) && !temPermissao(u, 'prontuario:consultar')) throw new ErroHttp(403, 'Operador sem permissão para esta ação.');
    await registrarRotina(req, 'prontuario', `${s}:laudos`, { paciente: idDe(req) });
    return consultar(
      `select t.id, t.data::text data, coalesce(e.nome, pr.nome) exame, t.estrutura, t.requisicao, t.situacao_laudo, t.assinado_em, t.anexado_em,
              t.laudo_texto, t.conclusao, t.codigo_validacao, (t.resultado_arquivo_id is not null) anexado, pa.nome assinante, pa.conselho, pa.registro_conselho,
              ps.nome solicitante, up.nome unidade
         from ${s}.atendimento t join ${s}.exame e on e.id = t.exame_id left join cad.procedimento pr on pr.id = t.procedimento_id
         left join cad.profissional pa on pa.id = t.assinante_id left join cad.profissional ps on ps.id = t.profissional_solicitante_id
         left join cad.unidade up on up.id = t.unidade_id
        where t.paciente_id = $1 and t.situacao_laudo in ('ASSINADO','ANEXADO','IMPRESSO') order by t.data desc, t.id desc`,
      [idDe(req)],
    );
  });

  // ---------------------------------------------------------------------------
  // Entrega dos resultados
  // ---------------------------------------------------------------------------

  app.get(`${base}/entregas`, async (req) => {
    const u = exigirPermissao(req, consultarP);
    const q = z.object({ situacao: texto, de: texto, ate: texto, nome: texto, diasMinimos: numero, unidadeId: numero }).parse(req.query);
    const params: unknown[] = [q.situacao ? q.situacao.split(',') : ['PENDENTE'], q.de ?? null, q.ate ?? null, q.nome ?? null, q.diasMinimos ?? null, q.unidadeId ?? (u.administrador ? null : u.unidadeAtual)];
    return consultar(
      `${selectLista(s)}
        where t.situacao_laudo in ('ASSINADO','ANEXADO','IMPRESSO') and t.situacao_entrega = any($1)
          and ($2::date is null or t.data >= $2) and ($3::date is null or t.data <= $3)
          and ($4::text is null or cad.fn_normalizar(p.nome) like '%' || cad.fn_normalizar($4) || '%')
          and ($5::int is null or coalesce(t.assinado_em, t.anexado_em) <= now() - make_interval(days => $5))
          and ($6::bigint is null or t.unidade_id = $6)
        order by coalesce(t.assinado_em, t.anexado_em) limit 500`,
      params,
    );
  });

  app.post(`${base}/atendimentos/:id/entrega`, async (req) => {
    const u = exigirPermissao(req, `${n.permLaudo}:entregar`);
    const b = z.object({ retiradoPor: z.string().min(3).max(120), documento: z.string().max(40).optional() }).parse(req.body);
    await transacao(contextoDe(req, `${s}:entrega`), (c) => registrarEntrega(c, cfg, idDe(req), b, u));
    return { ok: true };
  });

  app.post(`${base}/atendimentos/:id/nao-retirado`, async (req) => {
    const u = exigirPermissao(req, `${n.permLaudo}:entregar`);
    const { motivo } = z.object({ motivo: z.string().max(250).optional() }).parse(req.body ?? {});
    await transacao(contextoDe(req, `${s}:nao-retirado`), (c) => registrarNaoRetirado(c, cfg, idDe(req), motivo, u));
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Cadastros auxiliares
  // ---------------------------------------------------------------------------

  // Prévia do modelo de resultado (TR 1.2.45.4, 1.2.50.4).
  app.get(`${base}/modelos/:id/previa`, async (req, reply) => {
    const u = exigirPermissao(req, `${n.modelo}:consultar`);
    const m = await consultarUm(`select m.*, e.nome exame from ${s}.modelo_laudo m left join ${s}.exame e on e.id = m.exame_id where m.id = $1`, [idDe(req)]);
    if (!m) throw new ErroHttp(404, 'Modelo não encontrado.');
    return pdf(reply, await gerarPreviaModelo(cfg, { texto: m.texto, conclusao: m.conclusao, nome: m.nome, exame: m.exame }, u));
  });

  app.post(`${base}/modelos/previa`, async (req, reply) => {
    const u = exigirPermissao(req, `${n.modelo}:consultar`);
    const b = z.object({ texto: z.string().default(''), conclusao: z.string().nullish(), nome: z.string().optional(), exameId: z.number().nullish() }).parse(req.body);
    const ex = b.exameId ? await consultarUm(`select nome from ${s}.exame where id = $1`, [b.exameId]) : null;
    return pdf(reply, await gerarPreviaModelo(cfg, { texto: b.texto, conclusao: b.conclusao, nome: b.nome, exame: ex?.nome }, u));
  });

  app.post(`${base}/exames/importar-sigtap`, async (req) => {
    exigirPermissao(req, `${n.exame}:incluir`);
    const qtd = await transacao(contextoDe(req, `${s}:importar-sigtap`), (c) => importarSigtap(c, cfg));
    return { importados: qtd };
  });

  app.get(`${base}/exames/:id/validar-paciente`, async (req) => {
    exigirPermissao(req, consultarP);
    return { avisos: await validarPacienteExame(pool, cfg, idDe(req), Number((req.query as any).pacienteId)) };
  });
}
