// Rotas do módulo de AIH: tramitação dos laudos, autorização individual e em massa, cancelamento com
// liberador, internação e saída, impressões, exportação SISAIH01/CIHA01 e web service de recebimento
// de laudos de sistemas de terceiros (TR 1.2.37, 1.2.38, 1.2.13.1.15 a 1.2.13.1.23).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { inserir, registrarGanchos } from '../../meta/crud.js';
import { obterEntidade } from '../../meta/registro.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { salvarArquivo } from '../../servicos/arquivos.js';
import { conferirSenha, gerarHashSenha } from '../../seguranca/senha.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { pdfAutorizacao, pdfEtiquetas, pdfLaudo } from './documentos.js';
import { gerarCiha01, gerarRegistrosCiha, gerarSisaih01, LAYOUT_CIHA01, LAYOUT_SISAIH01 } from './exportacao.js';
import { posicoes } from './layout.js';
import { aprovar, arquivar, autorizar, autorizarLote, baseDe, cancelarAutorizacao, glosar, historico, internar, marcarPaga, montarNumero, proximoNumero, registrarSaida } from './servico.js';
import './relatorios.js';

registrarPermissao('aih_autorizacao', 'Autorização de AIH (auditor)', 'AIH', ['executar']);
registrarPermissao('aih_liberacao', 'Liberação do cancelamento de autorização de AIH', 'AIH', ['executar']);
registrarPermissao('aih_exportacao', 'Exportação SISAIH01 / CIHA01', 'AIH', ['executar']);

const pdf = (reply: any, r: { nome: string; conteudo: Buffer }) => reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
const idDe = (req: FastifyRequest) => Number((req.params as any).id);

// ---------------------------------------------------------------------------
// Regras de gravação pelo cadastro genérico
// ---------------------------------------------------------------------------
const CAMPOS_APOS_AUTORIZACAO = new Set(['enfermaria', 'leito', 'procedimento_realizado_id', 'competencia', 'profissional_executante_id', 'unidade_executante_id']);
const igual = (a: unknown, b: unknown) => {
  if (a instanceof Date || b instanceof Date) return new Date(a as any).getTime() === new Date(b as any).getTime() || String(a ?? '').slice(0, 10) === String(b ?? '').slice(0, 10);
  return String(a ?? '') === String(b ?? '');
};

registrarGanchos('aih_laudo', {
  async antesSalvar(d, { cliente: c, atual }) {
    if (atual && ['AUTORIZADO', 'ARQUIVADO'].includes(atual.situacao)) {
      const proibidos = Object.keys(d).filter((k) => !CAMPOS_APOS_AUTORIZACAO.has(k) && !igual(d[k], atual[k]));
      if (proibidos.length) throw new ErroHttp(422, `Laudo ${atual.situacao.toLowerCase()}: os dados da solicitação não podem mais ser alterados (${proibidos.join(', ')}).`);
    }
    const final = { ...(atual ?? {}), ...d };
    if (!atual) {
      d.data_hora = d.data_hora ?? new Date().toISOString();
      d.situacao = d.situacao ?? 'SOLICITADO';
      d.origem = d.origem ?? 'DIGITADO';
    }
    const pac = (await c.query(`select sexo, situacao, prontuario, data_obito from cad.pessoa where id = $1`, [final.paciente_id])).rows[0];
    if (!pac) throw new ErroHttp(422, 'Paciente não encontrado.');
    if (!atual && pac.situacao === 'FALECIDO') throw new ErroHttp(422, 'Paciente registrado como falecido.');
    if (!final.prontuario && pac.prontuario) d.prontuario = pac.prontuario;
    // Compatibilidade de sexo do procedimento e do CID (regras SIGTAP / CID-10).
    const proc = (await c.query(`select nome, sexo, valor_sh, valor_sp, ativo from cad.procedimento where id = $1`, [final.procedimento_id])).rows[0];
    if (!proc) throw new ErroHttp(422, 'Procedimento não encontrado.');
    if (['M', 'F'].includes(proc.sexo) && pac.sexo && pac.sexo !== proc.sexo) throw new ErroHttp(422, `${proc.nome}: procedimento permitido somente para o sexo ${proc.sexo === 'F' ? 'feminino' : 'masculino'}.`, { procedimento_id: 'Incompatível com o sexo do paciente.' });
    for (const campo of ['cid_principal_id', 'cid_secundario_id']) {
      if (!final[campo]) continue;
      const cid = (await c.query(`select codigo, restricao_sexo from cad.cid where id = $1`, [final[campo]])).rows[0];
      if (cid && ['M', 'F'].includes(cid.restricao_sexo) && pac.sexo && pac.sexo !== cid.restricao_sexo) throw new ErroHttp(422, `CID ${cid.codigo} incompatível com o sexo do paciente.`, { [campo]: 'Incompatível com o sexo do paciente.' });
    }
    if (!atual || d.procedimento_id !== undefined) {
      d.valor_sh = Number(proc.valor_sh ?? 0);
      d.valor_sp = Number(proc.valor_sp ?? 0);
      d.valor_total = d.valor_sh + d.valor_sp;
    }
  },
  async depoisSalvar(r, { cliente: c, atual, usuario }) {
    if (!atual) {
      const numero = `${new Date().getFullYear()}${String(r.id).padStart(6, '0')}`;
      await c.query(`update aih.laudo set numero_laudo = $2 where id = $1`, [r.id, numero]);
      r.numero_laudo = numero;
      await historico(c, r.id, 'INCLUSAO', null, r.situacao, r.origem === 'WEBSERVICE' ? `Recebido por web service (${r.sistema_origem ?? ''})` : null, usuario?.id ?? null);
    }
  },
  async antesExcluir(r, { cliente: c }) {
    if (r.numero_aih || ['AUTORIZADO', 'ARQUIVADO'].includes(r.situacao)) throw new ErroHttp(409, 'Laudo autorizado/arquivado não pode ser excluído; cancele a autorização antes.');
    await c.query(`delete from aih.historico where laudo_id = $1`, [r.id]);
    await c.query(`delete from aih.procedimento where laudo_id = $1`, [r.id]);
  },
});

registrarGanchos('aih_faixa', {
  antesSalvar(d, { atual }) {
    const final = { ...(atual ?? {}), ...d };
    const n = String(final.numero_inicial ?? '').replace(/\D/g, '');
    if (n.length !== 12 && n.length !== 13) throw new ErroHttp(422, 'Número inicial deve ter 12 ou 13 dígitos.', { numero_inicial: 'Informe 12 ou 13 dígitos.' });
    d.numero_inicial = montarNumero(n.slice(0, 12));
    if (final.validade_fim < final.validade_inicio) throw new ErroHttp(422, 'Validade final anterior à inicial.', { validade_fim: 'Data inválida.' });
    d.numero_final = montarNumero(baseDe(d.numero_inicial) + BigInt(final.quantidade) - 1n);
  },
  async antesExcluir(r, { cliente: c }) {
    if ((await c.query(`select 1 from aih.numero where faixa_id = $1 limit 1`, [r.id])).rowCount) throw new ErroHttp(409, 'Faixa com números já utilizados não pode ser excluída; desative-a.');
  },
});

registrarGanchos('aih_procedimento', {
  async antesSalvar(d, { cliente: c, atual }) {
    const final = { ...(atual ?? {}), ...d };
    const proc = (await c.query(`select coalesce(valor_sh,0) + coalesce(valor_sp,0) + coalesce(valor_sa,0) v from cad.procedimento where id = $1`, [final.procedimento_id])).rows[0];
    d.valor = Number(proc?.v ?? 0) * Number(final.quantidade ?? 1);
    if (final.profissional_id && !final.cbo_codigo) {
      const v = (await c.query(`select cb.codigo from cad.vinculo v join cad.cbo cb on cb.id = v.cbo_id where v.profissional_id = $1 and v.ativo limit 1`, [final.profissional_id])).rows[0];
      if (v) d.cbo_codigo = v.codigo;
    }
  },
});

registrarGanchos('aih_ciha', {
  antesSalvar(d, { atual }) {
    const final = { ...(atual ?? {}), ...d };
    if (!/^\d{6}$/.test(String(final.competencia ?? ''))) throw new ErroHttp(422, 'Competência no formato AAAAMM.', { competencia: 'Formato AAAAMM.' });
    if (final.data_fim && final.data_fim < final.data_inicio) throw new ErroHttp(422, 'Data da alta anterior ao início.', { data_fim: 'Data inválida.' });
  },
});

registrarGanchos('aih_integracao', {
  async antesSalvar(d, { atual }) {
    if (d.senha) {
      if (String(d.senha).length < 8) throw new ErroHttp(422, 'A senha do web service deve ter ao menos 8 caracteres.', { senha: 'Mínimo de 8 caracteres.' });
      d.senha_hash = await gerarHashSenha(d.senha);
    }
    d.senha = null;
    if (!atual && !d.senha_hash) throw new ErroHttp(422, 'Informe a senha de acesso do sistema integrado.', { senha: 'Obrigatória na inclusão.' });
  },
});

// ---------------------------------------------------------------------------
// Web service de laudos AIH (TR 1.2.38.1, 1.2.38.2)
// ---------------------------------------------------------------------------
const esquemaWebservice = z.object({
  identificadorExterno: z.string().max(60).optional(),
  estabelecimentoSolicitante: z.object({ cnes: z.string().regex(/^\d{7}$/) }),
  estabelecimentoExecutante: z.object({ cnes: z.string().regex(/^\d{7}$/) }).optional(),
  paciente: z.object({
    cns: z.string().optional(),
    cpf: z.string().optional(),
    nome: z.string().min(3),
    dataNascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sexo: z.enum(['M', 'F']),
    racaCor: z.enum(['01', '02', '03', '04', '05', '99']).default('99'),
    nomeMae: z.string().optional(),
    prontuario: z.string().optional(),
  }),
  laudo: z.object({
    dataHora: z.string().optional(),
    procedimento: z.string().regex(/^\d{10}$/),
    carater: z.string().regex(/^0[1-6]$/).default('01'),
    clinica: z.string().regex(/^\d{2}$/).default('03'),
    cidPrincipal: z.string().min(3),
    cidSecundario: z.string().optional(),
    sinaisSintomas: z.string().min(3),
    condicoesInternacao: z.string().min(3),
    resultadosProvas: z.string().optional(),
    diagnosticoInicial: z.string().min(3),
    causaExterna: z.enum(['ACIDENTE_TRANSITO', 'ACIDENTE_TRABALHO', 'ACIDENTE_TRAJETO', 'VIOLENCIA', 'OUTRAS']).optional(),
  }),
  profissional: z.object({ cns: z.string().optional(), cpf: z.string().optional(), conselho: z.string().optional(), registro: z.string().optional(), nome: z.string().optional() }),
});

async function autenticarSistema(req: FastifyRequest) {
  const cfg = await parametro<{ ativo: boolean }>('aih.webservice', { ativo: false });
  if (!cfg?.ativo) throw new ErroHttp(503, 'Web service de laudos AIH desativado pela administração do sistema.');
  const cab = String(req.headers.authorization ?? '');
  if (!cab.startsWith('Basic ')) throw new ErroHttp(401, 'Informe usuário e senha (HTTP Basic).');
  const [login, ...resto] = Buffer.from(cab.slice(6), 'base64').toString('utf8').split(':');
  const cred = await consultarUm(`select * from aih.integracao where login = $1 and ativo`, [login]);
  if (!cred || !(await conferirSenha(resto.join(':'), cred.senha_hash))) throw new ErroHttp(401, 'Usuário ou senha do web service inválidos.');
  return cred;
}

const digitos = (v?: string) => (v ?? '').replace(/\D/g, '') || null;

export default async function rotasAih(app: FastifyInstance) {
  // Painel de laudos com filtros (tela de tramitação e autorização).
  app.get('/api/aih/laudos', async (req) => {
    exigirPermissao(req, 'aih_laudo:consultar');
    const q = req.query as any;
    return consultar(
      `select l.id, l.numero_laudo, l.data_hora, l.situacao, l.situacao_internacao, l.numero_aih, l.carater, l.clinica, l.valor_total, l.paga, l.origem,
              l.autorizado_em, l.data_internacao::text data_internacao, l.data_saida::text data_saida, l.motivo_saida,
              pa.id paciente_id, pa.nome paciente, pa.cns, us.nome unidade_solicitante, ue.nome unidade_executante, ue.id unidade_executante_id,
              p.codigo || ' - ' || p.nome procedimento, cp.codigo cid, ps.nome solicitante
         from aih.laudo l join cad.pessoa pa on pa.id = l.paciente_id join cad.procedimento p on p.id = l.procedimento_id
         left join cad.unidade us on us.id = l.unidade_solicitante_id left join cad.unidade ue on ue.id = l.unidade_executante_id
         left join cad.cid cp on cp.id = l.cid_principal_id left join cad.profissional ps on ps.id = l.profissional_solicitante_id
        where ($1::text is null or l.situacao = $1) and ($2::bigint is null or l.unidade_executante_id = $2)
          and ($3::text is null or pa.nome_busca like cad.fn_normalizar($3) || '%' or l.numero_aih = $3 or l.numero_laudo = $3 or pa.cns = $3)
          and ($4::text is null or l.situacao_internacao = $4) and l.data_hora::date between coalesce($5::date, '1900-01-01') and coalesce($6::date, '2999-12-31')
        order by case l.situacao when 'SOLICITADO' then 1 when 'APROVADO' then 2 when 'AUTORIZADO' then 3 else 4 end, l.data_hora desc limit 500`,
      [q.situacao || null, q.unidadeExecutanteId ? Number(q.unidadeExecutanteId) : null, q.busca || null, q.internacao || null, q.de || null, q.ate || null],
    );
  });

  app.get('/api/aih/laudos/:id', async (req) => {
    exigirPermissao(req, 'aih_laudo:consultar');
    const id = idDe(req);
    const l = await consultarUm(`select l.*, pa.nome paciente from aih.laudo l join cad.pessoa pa on pa.id = l.paciente_id where l.id = $1`, [id]);
    if (!l) throw new ErroHttp(404, 'Laudo não encontrado.');
    const historicoLaudo = await consultar(
      `select h.criado_em, h.acao, h.situacao_anterior, h.situacao_nova, h.detalhe, coalesce(o.nome, o.login) operador, coalesce(lb.nome, lb.login) liberador
         from aih.historico h left join seg.operador o on o.id = h.operador_id left join seg.operador lb on lb.id = h.liberador_id where h.laudo_id = $1 order by h.id`,
      [id],
    );
    const procedimentos = await consultar(
      `select ap.id, ap.data::text data, p.codigo || ' - ' || p.nome procedimento, ap.quantidade, ap.tipo, ap.valor, pf.nome profissional, ap.cbo_codigo
         from aih.procedimento ap join cad.procedimento p on p.id = ap.procedimento_id left join cad.profissional pf on pf.id = ap.profissional_id where ap.laudo_id = $1 order by ap.data, ap.id`,
      [id],
    );
    return { laudo: l, historico: historicoLaudo, procedimentos };
  });

  // Impressão automática após a inclusão e reimpressão do laudo (TR 1.2.37.4, 1.2.37.5).
  app.get('/api/aih/laudos/:id/pdf', async (req, reply) => {
    const u = exigirPermissao(req, 'aih_laudo:consultar');
    return pdf(reply, await pdfLaudo(idDe(req), u));
  });

  // Autorização em duas vias (TR 1.2.37.12).
  app.get('/api/aih/laudos/:id/autorizacao-pdf', async (req, reply) => {
    const u = exigirPermissao(req, 'aih_laudo:consultar');
    return pdf(reply, await pdfAutorizacao(idDe(req), u));
  });

  app.post('/api/aih/etiquetas', async (req, reply) => {
    const u = exigirPermissao(req, 'aih_laudo:consultar');
    const b = z.object({ ids: z.array(z.number()).optional(), de: z.string().optional(), ate: z.string().optional(), unidadeId: z.number().nullish() }).parse(req.body);
    return pdf(reply, await pdfEtiquetas(b, u));
  });

  app.post('/api/aih/laudos/:id/aprovar', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    await transacao(contextoDe(req, 'aih:aprovar'), (c) => aprovar(c, idDe(req), u));
    return { ok: true };
  });

  app.post('/api/aih/laudos/:id/glosar', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    await transacao(contextoDe(req, 'aih:glosar'), (c) => glosar(c, idDe(req), motivo, u));
    return { ok: true };
  });

  app.post('/api/aih/laudos/:id/arquivar', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    const { motivo } = z.object({ motivo: z.string().nullish() }).parse(req.body ?? {});
    await transacao(contextoDe(req, 'aih:arquivar'), (c) => arquivar(c, idDe(req), motivo ?? null, u));
    return { ok: true };
  });

  // Próxima AIH disponível pré-carregada na autorização individual (TR 1.2.37.10).
  app.get('/api/aih/proximo-numero', async (req) => {
    exigirPermissao(req, 'aih_autorizacao:executar');
    const q = req.query as any;
    const r = await transacao(contextoDe(req, 'aih:proximo-numero'), (c) => proximoNumero(c, { tipo: q.tipo === 'APAC' ? 'APAC' : 'AIH', unidadeId: q.unidadeId ? Number(q.unidadeId) : null, data: q.data || undefined }));
    return r ?? { numero: null };
  });

  app.post('/api/aih/laudos/:id/autorizar', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    const b = z.object({ numero: z.string().nullish(), autorizadorId: z.number(), data: z.string().nullish() }).parse(req.body);
    return transacao(contextoDe(req, 'aih:autorizar'), (c) => autorizar(c, idDe(req), b, u));
  });

  // Autorização em massa informando apenas o primeiro número (TR 1.2.37.11).
  app.post('/api/aih/autorizar-lote', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    const b = z.object({ ids: z.array(z.number()).min(1), primeiroNumero: z.string().nullish(), autorizadorId: z.number(), data: z.string().nullish() }).parse(req.body);
    return transacao(contextoDe(req, 'aih:autorizar-lote'), (c) => autorizarLote(c, b.ids, b, u));
  });

  // Cancelamento da autorização com liberador parametrizável (TR 1.2.37.13, 1.2.37.14).
  app.post('/api/aih/laudos/:id/cancelar-autorizacao', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    const b = z.object({ motivo: z.string().min(3), liberadorLogin: z.string().nullish(), liberadorSenha: z.string().nullish() }).parse(req.body);
    await transacao(contextoDe(req, 'aih:cancelar-autorizacao'), (c) => cancelarAutorizacao(c, idDe(req), b, u));
    return { ok: true };
  });

  app.get('/api/aih/parametros', async (req) => {
    exigirUsuario(req);
    return { cancelamentoExigeLiberador: await parametro<boolean>('aih.cancelamento_exige_liberador', true), webservice: await parametro('aih.webservice', { ativo: false }) };
  });

  // Inclusão de AIH já autorizada, dispensando os trâmites anteriores (TR 1.2.37.15).
  app.post('/api/aih/laudos/autorizada', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    const b = z.object({ dados: z.record(z.any()), numero: z.string().min(12), autorizadorId: z.number(), dataAutorizacao: z.string().nullish() }).parse(req.body);
    const e = obterEntidade('aih_laudo')!;
    return transacao(contextoDe(req, 'aih:inclusao-autorizada'), async (c) => {
      const novo = await inserir(e, { ...b.dados }, contextoDe(req), u, c);
      await c.query(`update aih.laudo set origem = 'AUTORIZADA' where id = $1`, [novo.id]);
      return autorizar(c, novo.id, { numero: b.numero, autorizadorId: b.autorizadorId, data: b.dataAutorizacao }, u, true);
    });
  });

  // Laudo recém-incluído na tela como "AIH já autorizada": autoriza com o número informado sem aprovação prévia (TR 1.2.37.15).
  app.post('/api/aih/laudos/:id/autorizar-direta', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    const b = z.object({ numero: z.string().min(12), autorizadorId: z.number(), data: z.string().nullish() }).parse(req.body);
    return transacao(contextoDe(req, 'aih:inclusao-autorizada'), async (c) => {
      const l = (await c.query(`select situacao from aih.laudo where id = $1`, [idDe(req)])).rows[0];
      if (!l || l.situacao !== 'SOLICITADO') throw new ErroHttp(409, 'A inclusão de AIH já autorizada vale apenas para laudos recém-incluídos.');
      await c.query(`update aih.laudo set origem = 'AUTORIZADA' where id = $1`, [idDe(req)]);
      return autorizar(c, idDe(req), b, u, true);
    });
  });

  app.post('/api/aih/laudos/:id/internar', async (req) => {
    const u = exigirPermissao(req, 'aih_laudo:alterar');
    const b = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), enfermaria: z.string().nullish(), leito: z.string().nullish() }).parse(req.body);
    await transacao(contextoDe(req, 'aih:internar'), (c) => internar(c, idDe(req), b, u));
    return { ok: true };
  });

  // Saída do paciente e óbito com atualização do cadastro (TR 1.2.37.16).
  app.post('/api/aih/laudos/:id/saida', async (req) => {
    const u = exigirPermissao(req, 'aih_laudo:alterar');
    const b = z
      .object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), motivo: z.string().regex(/^\d{2}$/), procedimentoRealizadoId: z.number().nullish(), declaracaoObito: z.string().nullish(), dataObito: z.string().nullish() })
      .parse(req.body);
    await transacao(contextoDe(req, 'aih:saida'), (c) => registrarSaida(c, idDe(req), b, u));
    return { ok: true };
  });

  // Identificação manual das AIHs pagas (TR 1.2.37.6).
  app.post('/api/aih/laudos/:id/paga', async (req) => {
    const u = exigirPermissao(req, 'aih_autorizacao:executar');
    const { paga } = z.object({ paga: z.boolean() }).parse(req.body);
    await transacao(contextoDe(req, 'aih:paga'), (c) => marcarPaga(c, idDe(req), paga, u));
    return { ok: true };
  });

  // Exportação SISAIH01 da competência (TR 1.2.13.1.15, 1.2.13.1.16, 1.2.13.1.17).
  app.post('/api/aih/sisaih01', async (req, reply) => {
    const u = exigirPermissao(req, 'aih_exportacao:executar');
    const b = z.object({ competencia: z.string().regex(/^\d{6}$/), unidadeId: z.number().nullish(), reexportar: z.boolean().default(false) }).parse(req.body);
    const r = await transacao(contextoDe(req, 'aih:sisaih01'), async (c) => {
      const seq = (await c.query(`select count(*)::int + 1 n from aih.lote where tipo = 'SISAIH01' and competencia = $1`, [b.competencia])).rows[0].n;
      const arq = await gerarSisaih01(c, b.competencia, b.unidadeId ?? null, seq, b.reexportar);
      const arquivoId = await salvarArquivo(arq.nome, 'text/plain', arq.conteudo, u.id);
      const lote = (await c.query(`insert into aih.lote (tipo, competencia, unidade_id, registros, arquivo_id, gerado_em) values ('SISAIH01',$1,$2,$3,$4,now()) returning id`, [b.competencia, b.unidadeId ?? null, arq.registros, arquivoId])).rows[0];
      await c.query(`update aih.laudo set lote_id = $2 where id = any($1)`, [arq.ids, lote.id]);
      return arq;
    });
    return reply.header('content-type', 'text/plain; charset=iso-8859-1').header('content-disposition', `attachment; filename="${r.nome}"`).header('x-registros', String(r.registros)).send(r.conteudo);
  });

  app.post('/api/aih/ciha/gerar', async (req) => {
    exigirPermissao(req, 'aih_exportacao:executar');
    const b = z.object({ competencia: z.string().regex(/^\d{6}$/) }).parse(req.body);
    return transacao(contextoDe(req, 'aih:ciha-gerar'), (c) => gerarRegistrosCiha(c, b.competencia));
  });

  // Exportação CIHA01 (TR 1.2.13.1.23).
  app.post('/api/aih/ciha01', async (req, reply) => {
    const u = exigirPermissao(req, 'aih_exportacao:executar');
    const b = z.object({ competencia: z.string().regex(/^\d{6}$/), unidadeId: z.number().nullish() }).parse(req.body);
    const r = await transacao(contextoDe(req, 'aih:ciha01'), async (c) => {
      const arq = await gerarCiha01(c, b.competencia, b.unidadeId ?? null);
      const arquivoId = await salvarArquivo(arq.nome, 'text/plain', arq.conteudo, u.id);
      const lote = (await c.query(`insert into aih.lote (tipo, competencia, unidade_id, registros, arquivo_id, gerado_em) values ('CIHA01',$1,$2,$3,$4,now()) returning id`, [b.competencia, b.unidadeId ?? null, arq.registros, arquivoId])).rows[0];
      await c.query(`update aih.ciha set lote_id = $2 where id = any($1)`, [arq.ids, lote.id]);
      return arq;
    });
    return reply.header('content-type', 'text/plain; charset=iso-8859-1').header('content-disposition', `attachment; filename="${r.nome}"`).header('x-registros', String(r.registros)).send(r.conteudo);
  });

  app.get('/api/aih/exportacoes', async (req) => {
    exigirPermissao(req, 'aih_exportacao:executar');
    const q = req.query as any;
    const lotes = await consultar(
      `select l.id, l.tipo, l.competencia, u.nome unidade, l.registros, l.arquivo_id, l.gerado_em from aih.lote l left join cad.unidade u on u.id = l.unidade_id
        where ($1::text is null or l.competencia = $1) order by l.id desc limit 100`,
      [q.competencia || null],
    );
    const pendentes = await consultarUm(
      `select count(*) filter (where situacao_internacao = 'ALTA' and lote_id is null and coalesce(competencia, to_char(data_saida, 'YYYYMM')) = $1)::int sisaih,
              (select count(*)::int from aih.ciha where competencia = $1 and lote_id is null) ciha
         from aih.laudo where numero_aih is not null`,
      [q.competencia || new Date().toISOString().slice(0, 7).replace('-', '')],
    );
    return { lotes, pendentes };
  });

  // Layouts documentados (posição inicial/final de cada campo).
  app.get('/api/aih/layout/:tipo', async (req) => {
    exigirUsuario(req);
    const t = (req.params as any).tipo;
    if (t === 'sisaih01') return posicoes(LAYOUT_SISAIH01);
    if (t === 'ciha01') return posicoes(LAYOUT_CIHA01);
    throw new ErroHttp(404, 'Layout inexistente.');
  });

  // Recebimento de laudos de AIH enviados por sistemas de terceiros (TR 1.2.38.1).
  app.post('/api/integracao/aih/laudos', { config: { publica: true } }, async (req, reply) => {
    const cred = await autenticarSistema(req);
    const b = esquemaWebservice.parse(req.body);
    const r = await transacao({ usuarioId: null, ip: req.ip, rotina: `aih:webservice:${cred.login}` }, async (c) => {
      const us = (await c.query(`select id from cad.unidade where cnes = $1`, [b.estabelecimentoSolicitante.cnes])).rows[0];
      if (!us) throw new ErroHttp(422, `Estabelecimento solicitante CNES ${b.estabelecimentoSolicitante.cnes} não cadastrado.`);
      const ue = b.estabelecimentoExecutante ? (await c.query(`select id from cad.unidade where cnes = $1`, [b.estabelecimentoExecutante.cnes])).rows[0] : null;
      if (b.estabelecimentoExecutante && !ue) throw new ErroHttp(422, `Estabelecimento executante CNES ${b.estabelecimentoExecutante.cnes} não cadastrado.`);
      const proc = (await c.query(`select id from cad.procedimento where codigo = $1`, [b.laudo.procedimento])).rows[0];
      if (!proc) throw new ErroHttp(422, `Procedimento ${b.laudo.procedimento} inexistente na tabela SIGTAP.`);
      const cid = async (codigo?: string) => (codigo ? (await c.query(`select id from cad.cid where replace(codigo, '.', '') = replace($1, '.', '')`, [codigo])).rows[0]?.id ?? null : null);
      const cidP = await cid(b.laudo.cidPrincipal);
      if (!cidP) throw new ErroHttp(422, `CID ${b.laudo.cidPrincipal} inexistente.`);
      const prof = (
        await c.query(
          `select pf.id from cad.profissional pf join cad.pessoa p on p.id = pf.pessoa_id
            where ($1::text is not null and p.cns = $1) or ($2::text is not null and p.cpf = $2) or ($3::text is not null and pf.registro_conselho = $3) limit 1`,
          [digitos(b.profissional.cns), digitos(b.profissional.cpf), b.profissional.registro ?? null],
        )
      ).rows[0];
      if (!prof) throw new ErroHttp(422, 'Profissional solicitante não localizado (CNS, CPF ou registro no conselho).');
      // Paciente pelo CNS/CPF; não localizado gera pré-cadastro para posterior complementação.
      let pac = (
        await c.query(`select id from cad.pessoa where ($1::text is not null and cns = $1) or ($2::text is not null and cpf = $2) limit 1`, [digitos(b.paciente.cns), digitos(b.paciente.cpf)])
      ).rows[0];
      if (!pac) {
        pac = await inserir(
          obterEntidade('paciente')!,
          { nome: b.paciente.nome.toUpperCase(), data_nascimento: b.paciente.dataNascimento, sexo: b.paciente.sexo, raca_cor: b.paciente.racaCor, cns: digitos(b.paciente.cns), cpf: digitos(b.paciente.cpf), nome_mae: b.paciente.nomeMae?.toUpperCase() ?? null, situacao: 'PRE_CADASTRO' },
          { usuarioId: null, ip: req.ip, rotina: 'aih:webservice' },
          undefined,
          c,
        );
      }
      const laudo = await inserir(
        obterEntidade('aih_laudo')!,
        {
          data_hora: b.laudo.dataHora ?? new Date().toISOString(),
          unidade_solicitante_id: us.id,
          unidade_executante_id: ue?.id ?? null,
          paciente_id: pac.id,
          prontuario: b.paciente.prontuario ?? null,
          clinica: b.laudo.clinica,
          carater: b.laudo.carater,
          procedimento_id: proc.id,
          profissional_solicitante_id: prof.id,
          sinais_sintomas: b.laudo.sinaisSintomas,
          condicoes_internacao: b.laudo.condicoesInternacao,
          resultados_provas: b.laudo.resultadosProvas ?? null,
          diagnostico_inicial: b.laudo.diagnosticoInicial,
          cid_principal_id: cidP,
          cid_secundario_id: await cid(b.laudo.cidSecundario),
          causa_externa: b.laudo.causaExterna ?? null,
        },
        { usuarioId: null, ip: req.ip, rotina: 'aih:webservice' },
        undefined,
        c,
      );
      await c.query(`update aih.laudo set origem = 'WEBSERVICE', sistema_origem = $2 where id = $1`, [laudo.id, `${cred.sistema ?? cred.login}${b.identificadorExterno ? ' #' + b.identificadorExterno : ''}`.slice(0, 80)]);
      await c.query(`update aih.integracao set ultimo_acesso = now(), laudos_recebidos = laudos_recebidos + 1 where id = $1`, [cred.id]);
      return { protocolo: laudo.numero_laudo, id: laudo.id, situacao: laudo.situacao };
    });
    return reply.status(201).send(r);
  });

  // Consulta da situação de um laudo enviado (retorno ao sistema de terceiros).
  app.get('/api/integracao/aih/laudos/:protocolo', { config: { publica: true } }, async (req) => {
    await autenticarSistema(req);
    const l = await consultarUm(
      `select numero_laudo protocolo, situacao, numero_aih, autorizado_em, motivo_glosa, situacao_internacao from aih.laudo where numero_laudo = $1 and origem = 'WEBSERVICE'`,
      [(req.params as any).protocolo],
    );
    if (!l) throw new ErroHttp(404, 'Protocolo não encontrado.');
    return l;
  });
}

