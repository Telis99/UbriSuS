// Rotas do e-SUS AB: ações programáticas (inscrições, eventos e benefícios), agenda/dashboard das reuniões
// de equipe, teleconsulta com consentimento do paciente, indicadores com exame solicitado automático,
// fila da RNDS e exportações LEDI (CDS/RAS) e HIPERDIA (TR 1.2.36, 1.2.13.1.2 a 1.2.13.1.14, 1.2.13.1.37, 1.2.13.1.38).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { salvarArquivo } from '../../servicos/arquivos.js';
import { contextoDe, ErroHttp, exigirPermissao } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { lancarProducao } from '../faturamento/producao.js';
import { registrarAcaoRaas, tipoRaasDoProcedimento } from '../raas/servico.js';
import { posicoes } from '../aih/layout.js';
import { FICHAS, gerarLoteLedi, type TipoFicha } from './ledi.js';
import { enfileirarRac, enviarPendentesRnds, gerarArquivoHiperdia, gerarCadastrosHiperdia, gerarCronograma, LAYOUT_HIPERDIA, situacaoIndicador, validarBeneficio, validarInscricao } from './servico.js';
import './relatorios.js';

registrarPermissao('esus_exportar', 'Exportação e-SUS AB (LEDI/CDS) e HIPERDIA', 'ESUS', ['executar']);
registrarPermissao('esus_rnds', 'Envio de registros à RNDS', 'ESUS', ['executar']);

const idDe = (req: FastifyRequest) => Number((req.params as any).id);
const hoje = () => new Date().toISOString().slice(0, 10);
const html = (titulo: string, corpo: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>` +
  `<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#222}button,a.botao{display:inline-block;background:#1c7ed6;color:#fff;border:0;padding:12px 20px;border-radius:6px;font-size:16px;text-decoration:none}p{line-height:1.5}</style></head><body>${corpo}</body></html>`;
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]!);

registrarGanchos('esus_inscricao', {
  async antesSalvar(d, { cliente: c, atual, id }) {
    const final = { ...(atual ?? {}), ...d };
    for (const k of ['data_inicial', 'data_final']) if (final[k] instanceof Date) final[k] = final[k].toISOString().slice(0, 10);
    await validarInscricao(c, final, id);
    if (final.situacao !== 'ATIVO' && !final.data_final) d.data_final = hoje();
  },
  async depoisSalvar(r, { cliente: c }) {
    await gerarCronograma(c, r.id);
  },
});
registrarGanchos('esus_inscricao_beneficio', {
  async antesSalvar(d, { cliente: c, atual }) {
    const final = { ...(atual ?? {}), ...d };
    if (final.data instanceof Date) final.data = final.data.toISOString().slice(0, 10);
    await validarBeneficio(c, final);
    d.proxima_concessao = final.proxima_concessao ?? null;
    if (!d.descricao && final.descricao) d.descricao = final.descricao;
  },
});
registrarGanchos('esus_inscricao_evento', {
  antesSalvar(d, { atual }) {
    if (d.data_realizacao && (!atual || atual.situacao === 'PREVISTO')) d.situacao = 'REALIZADO';
  },
});
registrarGanchos('esus_reuniao', {
  antesSalvar(d, { atual }) {
    const f = { ...(atual ?? {}), ...d };
    if (f.hora_fim && f.hora_fim <= f.hora_inicio) throw new ErroHttp(422, 'Horário final anterior ao inicial.');
    if (f.situacao === 'REALIZADA' && !f.ata) throw new ErroHttp(422, 'Registre a ata para concluir a reunião.', { ata: 'Obrigatória na reunião realizada.' });
  },
});
registrarGanchos('esus_atividade_coletiva', {
  antesSalvar(d, { atual }) {
    const f = { ...(atual ?? {}), ...d };
    if (Array.isArray(f.participantes_ids) && !f.participantes) d.participantes = f.participantes_ids.length;
  },
});
// Atendimento domiciliar alimenta o RAAS-AD ou a produção, sem redigitação (TR 1.2.13.1.14, 1.2.44.1).
registrarGanchos('esus_atendimento_domiciliar', {
  async depoisSalvar(r, { cliente: c, atual }) {
    if (atual || !r.procedimento_id) return;
    const data = (await c.query(`select data::text d from esus.atendimento_domiciliar where id = $1`, [r.id])).rows[0].d;
    if (await tipoRaasDoProcedimento(c, r.procedimento_id)) {
      const acao = await registrarAcaoRaas(c, { tipo: 'DOMICILIAR', unidadeId: r.unidade_id, pacienteId: r.paciente_id, data, procedimentoId: r.procedimento_id, profissionalId: r.profissional_id, local: 'D', origem: `esus_atdom:${r.id}`, cidId: r.cid_id });
      await c.query(`update esus.atendimento_domiciliar set raas_acao_id = $2 where id = $1`, [r.id, acao]);
    } else {
      await lancarProducao(c, { data, unidadeId: r.unidade_id, profissionalId: r.profissional_id, procedimentoId: r.procedimento_id, pacienteId: r.paciente_id, origem: 'ATENDIMENTO', referencia: `esus_atdom:${r.id}` });
    }
  },
});
registrarGanchos('esus_teleconsulta', {
  antesSalvar(d, { atual }) {
    if (!atual) {
      d.token = randomBytes(24).toString('base64url');
      d.sala = `ubrisus-${randomBytes(9).toString('hex')}`;
      d.situacao = 'AGENDADA';
    }
  },
});

export default async function rotasEsus(app: FastifyInstance) {
  // ---- Ações programáticas ----
  app.get('/api/esus/acoes', async (req) => {
    exigirPermissao(req, 'esus_acao:consultar');
    return consultar(
      `select a.id, a.nome, a.data_inicio::text data_inicio, a.data_fim::text data_fim, a.max_inscricoes, a.concede_beneficio, a.tipo_beneficio, a.ativo,
              (select count(*)::int from esus.inscricao i where i.acao_id = a.id and i.situacao = 'ATIVO') ativos,
              (select count(*)::int from esus.inscricao i where i.acao_id = a.id and i.situacao <> 'ATIVO') encerrados,
              (select count(*)::int from esus.inscricao_evento e join esus.inscricao i on i.id = e.inscricao_id where i.acao_id = a.id and e.situacao = 'PREVISTO' and e.prazo_limite < current_date) atrasados,
              (select string_agg(u.nome, ', ') from esus.acao_local l join cad.unidade u on u.id = l.unidade_id where l.acao_id = a.id) locais
         from esus.acao_programatica a order by a.ativo desc, a.data_inicio desc`,
    );
  });

  app.get('/api/esus/acoes/:id/inscricoes', async (req) => {
    exigirPermissao(req, 'esus_inscricao:consultar');
    return consultar(
      `select i.id, i.paciente_id, pa.nome, pa.cns, i.data_inicial::text data_inicial, i.data_final::text data_final, i.recebe_beneficio, i.situacao, u.nome local,
              (select min(e.data_prevista)::text from esus.inscricao_evento e where e.inscricao_id = i.id and e.situacao = 'PREVISTO' and e.data_prevista >= current_date) proximo_evento,
              (select count(*)::int from esus.inscricao_evento e where e.inscricao_id = i.id and e.situacao = 'PREVISTO' and e.prazo_limite < current_date) atrasados,
              (select max(b.data)::text from esus.inscricao_beneficio b where b.inscricao_id = i.id) ultimo_beneficio,
              (select min(b.proxima_concessao)::text from esus.inscricao_beneficio b where b.inscricao_id = i.id and b.data = (select max(data) from esus.inscricao_beneficio x where x.inscricao_id = i.id)) proximo_beneficio
         from esus.inscricao i join cad.pessoa pa on pa.id = i.paciente_id left join cad.unidade u on u.id = i.unidade_id where i.acao_id = $1 order by i.situacao, pa.nome`,
      [idDe(req)],
    );
  });

  app.get('/api/esus/inscricoes/:id/eventos', async (req) => {
    exigirPermissao(req, 'esus_inscricao:consultar');
    return consultar(
      `select e.id, e.nome, e.frequencia_dias, e.data_prevista::text data_prevista, e.prazo_limite::text prazo_limite, e.data_realizacao::text data_realizacao,
              case when e.situacao = 'PREVISTO' and e.prazo_limite < current_date then 'ATRASADO' else e.situacao end situacao
         from esus.inscricao_evento e where e.inscricao_id = $1 order by e.data_prevista`,
      [idDe(req)],
    );
  });

  app.post('/api/esus/inscricoes/eventos/:id/realizar', async (req) => {
    exigirPermissao(req, 'esus_inscricao:alterar');
    const b = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), faltou: z.boolean().optional() }).parse(req.body ?? {});
    await transacao(contextoDe(req, 'esus:evento'), (c) =>
      c.query(`update esus.inscricao_evento set situacao = $2, data_realizacao = $3 where id = $1`, [idDe(req), b.faltou ? 'FALTOU' : 'REALIZADO', b.faltou ? null : (b.data ?? hoje())]),
    );
    return { ok: true };
  });

  app.post('/api/esus/inscricoes/:id/cronograma', async (req) => {
    exigirPermissao(req, 'esus_inscricao:alterar');
    return { criados: await transacao(contextoDe(req, 'esus:cronograma'), (c) => gerarCronograma(c, idDe(req))) };
  });

  // ---- Reuniões de equipe: agenda do mês (dashboard) (TR 1.2.36.13) ----
  app.get('/api/esus/reunioes', async (req) => {
    exigirPermissao(req, 'esus_reuniao:consultar');
    const q = req.query as any;
    const mes = /^\d{4}-\d{2}$/.test(q.mes ?? '') ? q.mes : hoje().slice(0, 7);
    const reunioes = await consultar(
      `select r.id, r.data::text data, to_char(r.hora_inicio, 'HH24:MI') hora_inicio, to_char(r.hora_fim, 'HH24:MI') hora_fim, r.tipo, r.equipe, r.local, r.pauta, r.ata, r.situacao, r.participantes,
              u.nome unidade, r.unidade_id,
              (select json_agg(pf.nome order by pf.nome) from cad.profissional pf where r.participantes ? pf.id::text or r.participantes @> to_jsonb(pf.id)) nomes_participantes
         from esus.reuniao r join cad.unidade u on u.id = r.unidade_id
        where r.data >= ($1 || '-01')::date and r.data < ($1 || '-01')::date + interval '1 month' and ($2::bigint is null or r.unidade_id = $2) order by r.data, r.hora_inicio`,
      [mes, q.unidadeId ? Number(q.unidadeId) : null],
    );
    const resumo = await consultarUm(
      `select count(*) filter (where situacao = 'AGENDADA' and data >= current_date)::int proximas, count(*) filter (where situacao = 'REALIZADA')::int realizadas,
              count(*) filter (where situacao = 'AGENDADA' and data < current_date)::int sem_registro
         from esus.reuniao where data >= ($1 || '-01')::date and data < ($1 || '-01')::date + interval '1 month' and ($2::bigint is null or unidade_id = $2)`,
      [mes, q.unidadeId ? Number(q.unidadeId) : null],
    );
    return { mes, reunioes, resumo };
  });

  // ---- Teleconsulta (TR 1.2.36.11) ----
  app.get('/api/esus/teleconsultas', async (req) => {
    exigirPermissao(req, 'esus_teleconsulta:consultar');
    const cfg = await parametro<{ servidor: string }>('esus.teleconsulta', { servidor: 'https://meet.jit.si' });
    const linhas = await consultar(
      `select t.id, t.data_hora, t.modalidade, t.situacao, t.sala, t.token, t.consentimento_em, t.inicio_em, t.fim_em, pa.nome paciente, pa.celular, pf.nome profissional, u.nome unidade
         from esus.teleconsulta t join cad.pessoa pa on pa.id = t.paciente_id join cad.profissional pf on pf.id = t.profissional_id join cad.unidade u on u.id = t.unidade_id
        where t.data_hora::date >= current_date - 30 order by t.data_hora desc limit 200`,
    );
    return linhas.map((l) => ({ ...l, url_sala: `${cfg.servidor.replace(/\/$/, '')}/${l.sala}`, url_paciente: `/api/publico/teleconsulta/${l.token}`, token: undefined }));
  });

  app.post('/api/esus/teleconsultas/:id/iniciar', async (req) => {
    exigirPermissao(req, 'esus_teleconsulta:alterar');
    const cfg = await parametro<{ servidor: string }>('esus.teleconsulta', { servidor: 'https://meet.jit.si' });
    const t = await transacao(contextoDe(req, 'esus:teleconsulta'), async (c) => {
      const t = (await c.query(`select * from esus.teleconsulta where id = $1 for update`, [idDe(req)])).rows[0];
      if (!t) throw new ErroHttp(404, 'Teleconsulta não encontrada.');
      if (['ENCERRADA', 'CANCELADA'].includes(t.situacao)) throw new ErroHttp(409, 'Teleconsulta encerrada.');
      if (!t.consentimento_em) throw new ErroHttp(409, 'Aguardando o consentimento do paciente (termo enviado pelo link da teleconsulta).', { semConsentimento: true });
      await c.query(`update esus.teleconsulta set situacao = 'EM_ANDAMENTO', inicio_em = coalesce(inicio_em, now()) where id = $1`, [t.id]);
      return t;
    });
    return { url: `${cfg.servidor.replace(/\/$/, '')}/${t.sala}` };
  });

  app.post('/api/esus/teleconsultas/:id/encerrar', async (req) => {
    const u = exigirPermissao(req, 'esus_teleconsulta:alterar');
    const b = z.object({ registro: z.string().min(5), cidId: z.number().nullish() }).parse(req.body);
    await transacao(contextoDe(req, 'esus:teleconsulta'), async (c) => {
      const t = (await c.query(`update esus.teleconsulta set situacao = 'ENCERRADA', fim_em = now(), registro = $2, cid_id = coalesce($3, cid_id) where id = $1 and situacao = 'EM_ANDAMENTO' returning *`, [idDe(req), b.registro, b.cidId ?? null])).rows[0];
      if (!t) throw new ErroHttp(409, 'A teleconsulta não está em andamento.');
      // Teleconsulta compõe a produção (consulta na atenção primária / especializada).
      const proc = (await c.query(`select id from cad.procedimento where codigo = '0301010064'`)).rows[0];
      if (proc) await lancarProducao(c, { data: new Date(t.data_hora).toISOString().slice(0, 10), unidadeId: t.unidade_id, profissionalId: t.profissional_id ?? u.profissionalId, procedimentoId: proc.id, pacienteId: t.paciente_id, origem: 'ATENDIMENTO', referencia: `teleconsulta:${t.id}` });
    });
    return { ok: true };
  });

  // Página pública do paciente: termo de consentimento (Res. CFM 2.314/2022, LGPD) e acesso à sala.
  app.get('/api/publico/teleconsulta/:token', { config: { publica: true } }, async (req, reply) => {
    const t = await consultarUm(
      `select t.*, pa.nome paciente, pf.nome profissional, pf.conselho, pf.registro_conselho, u.nome unidade from esus.teleconsulta t join cad.pessoa pa on pa.id = t.paciente_id
         join cad.profissional pf on pf.id = t.profissional_id join cad.unidade u on u.id = t.unidade_id where t.token = $1`,
      [(req.params as any).token],
    );
    reply.header('content-type', 'text/html; charset=utf-8');
    if (!t || ['ENCERRADA', 'CANCELADA'].includes(t.situacao)) return html('Teleconsulta', '<h2>Teleconsulta indisponível</h2><p>O link é inválido ou a teleconsulta foi encerrada.</p>');
    const quando = new Date(t.data_hora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return html(
      'Teleconsulta',
      `<h2>Teleconsulta - ${esc(t.unidade)}</h2><p>Paciente: <b>${esc(t.paciente)}</b><br>Profissional: ${esc(t.profissional)} (${esc(t.conselho)} ${esc(t.registro_conselho)})<br>Data: ${esc(quando)}</p>` +
        `<h3>Termo de consentimento livre e esclarecido</h3><p>Declaro estar ciente de que o atendimento será realizado por telemedicina, nos termos da Lei 14.510/2022 e da Resolução CFM 2.314/2022; que posso recusá-lo e solicitar atendimento presencial; que as informações serão registradas no prontuário eletrônico, com sigilo e proteção de dados pessoais (Lei 13.709/2018 - LGPD); e que a sala virtual é exclusiva para este atendimento.</p>` +
        (t.consentimento_em
          ? `<p>Consentimento registrado em ${esc(new Date(t.consentimento_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}.</p><form method="post" action="/api/publico/teleconsulta/${esc(t.token)}/consentir"><button type="submit">Entrar na sala</button></form>`
          : `<form method="post" action="/api/publico/teleconsulta/${esc(t.token)}/consentir"><button type="submit">Li e concordo - entrar na teleconsulta</button></form>`),
    );
  });

  app.post('/api/publico/teleconsulta/:token/consentir', { config: { publica: true } }, async (req, reply) => {
    const cfg = await parametro<{ servidor: string }>('esus.teleconsulta', { servidor: 'https://meet.jit.si' });
    const t = await consultarUm(`update esus.teleconsulta set consentimento_em = coalesce(consentimento_em, now()), consentimento_ip = coalesce(consentimento_ip, $2) where token = $1 and situacao in ('AGENDADA','EM_ANDAMENTO') returning sala`, [
      (req.params as any).token,
      req.ip,
    ]);
    reply.header('content-type', 'text/html; charset=utf-8');
    if (!t) return html('Teleconsulta', '<h2>Teleconsulta indisponível</h2>');
    const url = `${cfg.servidor.replace(/\/$/, '')}/${t.sala}`;
    return html('Teleconsulta', `<h2>Consentimento registrado</h2><p>Aguarde o profissional na sala virtual.</p><p><a class="botao" href="${esc(url)}" rel="noopener">Abrir a sala da teleconsulta</a></p>`);
  });

  // ---- Indicadores (TR 1.2.36.12) ----
  app.get('/api/esus/indicadores', async (req) => {
    exigirPermissao(req, 'esus_indicador:consultar');
    const q = req.query as any;
    const inds = await consultar(`select id from esus.indicador where ativo order by nome`);
    const out = [];
    for (const i of inds) {
      const r = await situacaoIndicador(pool, i.id, q.unidadeId ? Number(q.unidadeId) : null);
      out.push({ id: i.id, nome: r.indicador.nome, publico: r.indicador.publico, total: r.total, realizados: r.realizados, solicitados: r.solicitados, pendentes: r.pendentes });
    }
    return out;
  });
  app.get('/api/esus/indicadores/:id/nominal', async (req) => {
    exigirPermissao(req, 'esus_indicador:consultar');
    const q = req.query as any;
    return situacaoIndicador(pool, idDe(req), q.unidadeId ? Number(q.unidadeId) : null);
  });

  // ---- RNDS (TR 1.2.36.10) ----
  app.get('/api/esus/rnds', async (req) => {
    exigirPermissao(req, 'esus_rnds:executar');
    const cfg = await parametro<{ ativo: boolean }>('integracao.rnds', { ativo: false });
    const resumo = await consultar(`select situacao, count(*)::int n from esus.rnds_envio group by 1`);
    const ultimos = await consultar(
      `select r.id, r.tipo, r.referencia, r.situacao, r.protocolo, r.tentativas, r.enviado_em, r.criado_em, left(r.resposta, 300) resposta, pa.nome paciente
         from esus.rnds_envio r left join cad.pessoa pa on pa.id = r.paciente_id order by r.id desc limit 100`,
    );
    return { ativo: !!cfg?.ativo, resumo, ultimos };
  });
  app.get('/api/esus/rnds/:id', async (req) => {
    exigirPermissao(req, 'esus_rnds:executar');
    return consultarUm(`select * from esus.rnds_envio where id = $1`, [idDe(req)]);
  });
  app.post('/api/esus/rnds/enfileirar', async (req) => {
    exigirPermissao(req, 'esus_rnds:executar');
    const b = z.object({ de: z.string(), ate: z.string() }).parse(req.body);
    return transacao(contextoDe(req, 'esus:rnds'), (c) => enfileirarRac(c, b.de, b.ate));
  });
  app.post('/api/esus/rnds/enviar', async (req) => {
    exigirPermissao(req, 'esus_rnds:executar');
    return transacao(contextoDe(req, 'esus:rnds'), (c) => enviarPendentesRnds(c));
  });

  // ---- Exportação LEDI / CDS (TR 1.2.13.1.2 a 1.2.13.1.14, 1.2.13.1.38) ----
  app.get('/api/esus/exportacoes', async (req) => {
    exigirPermissao(req, 'esus_exportar:executar');
    const lotes = await consultar(`select e.*, u.nome unidade from esus.exportacao e left join cad.unidade u on u.id = e.unidade_id order by e.id desc limit 50`);
    const ultima = await consultarUm(`select max(gerado_em) ultima from esus.exportacao where sistema = 'LEDI'`);
    return { fichas: Object.entries(FICHAS).map(([chave, f]) => ({ chave, titulo: f.titulo, tipo: f.tipo })), lotes, ultima: ultima?.ultima ?? null };
  });

  app.post('/api/esus/exportar', async (req, reply) => {
    const u = exigirPermissao(req, 'esus_exportar:executar');
    const b = z
      .object({
        fichas: z.array(z.enum(Object.keys(FICHAS) as [TipoFicha, ...TipoFicha[]])).min(1),
        modalidade: z.enum(['TOTAL', 'PARCIAL']),
        de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        unidadeId: z.number().nullish(),
      })
      .parse(req.body);
    const r = await transacao(contextoDe(req, 'esus:exportar'), async (c) => {
      const exp = (await c.query(`insert into esus.exportacao (sistema, modalidade, unidade_id, de, ate, gerado_em) values ('LEDI',$1,$2,$3,$4,now()) returning id`, [b.modalidade, b.unidadeId ?? null, b.de, b.ate])).rows[0];
      const lote = await gerarLoteLedi(c, { ...b, unidadeId: b.unidadeId ?? null }, exp.id);
      if (!lote.total) throw new ErroHttp(422, b.modalidade === 'PARCIAL' ? 'Nenhum registro novo ou alterado desde a última exportação.' : 'Nenhum registro no período para as fichas selecionadas.');
      const nome = `esus_ledi_${b.de.replace(/-/g, '')}_${b.ate.replace(/-/g, '')}_${exp.id}.zip`;
      const arquivoId = await salvarArquivo(nome, 'application/zip', lote.conteudo, u.id, c);
      await c.query(`update esus.exportacao set fichas = $2, registros = $3, arquivo_id = $4 where id = $1`, [exp.id, JSON.stringify(lote.resumo), lote.total, arquivoId]);
      return { ...lote, nome };
    });
    return reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="${r.nome}"`).header('x-resumo', JSON.stringify(r.resumo)).send(r.conteudo);
  });

  // ---- HIPERDIA (TR 1.2.13.1.37) ----
  app.post('/api/esus/hiperdia/gerar', async (req) => {
    exigirPermissao(req, 'esus_hiperdia:incluir');
    const b = z.object({ de: z.string(), ate: z.string() }).parse(req.body);
    return transacao(contextoDe(req, 'esus:hiperdia'), (c) => gerarCadastrosHiperdia(c, b.de, b.ate));
  });
  app.post('/api/esus/hiperdia/exportar', async (req, reply) => {
    const u = exigirPermissao(req, 'esus_exportar:executar');
    const b = z.object({ de: z.string(), ate: z.string(), unidadeId: z.number().nullish(), parcial: z.boolean().default(false) }).parse(req.body);
    const r = await transacao(contextoDe(req, 'esus:hiperdia-exportar'), async (c) => {
      await gerarCadastrosHiperdia(c, b.de, b.ate);
      const arq = await gerarArquivoHiperdia(c, b.de, b.ate, b.unidadeId ?? null, b.parcial);
      const nome = `HIPERDIA_${b.de.replace(/-/g, '')}_${b.ate.replace(/-/g, '')}.TXT`;
      const arquivoId = await salvarArquivo(nome, 'text/plain', arq.conteudo, u.id, c);
      await c.query(`insert into esus.exportacao (sistema, modalidade, unidade_id, de, ate, registros, arquivo_id, gerado_em, fichas) values ('HIPERDIA',$1,$2,$3,$4,$5,$6,now(),$7)`, [
        b.parcial ? 'PARCIAL' : 'TOTAL',
        b.unidadeId ?? null,
        b.de,
        b.ate,
        arq.registros,
        arquivoId,
        JSON.stringify({ HIPERDIA: arq.registros }),
      ]);
      await c.query(`update esus.hiperdia set exportado_em = now() where id = any($1)`, [arq.ids]);
      return { ...arq, nome };
    });
    return reply.header('content-type', 'text/plain; charset=iso-8859-1').header('content-disposition', `attachment; filename="${r.nome}"`).send(r.conteudo);
  });
  app.get('/api/esus/hiperdia/layout', async (req) => {
    exigirPermissao(req, 'esus_hiperdia:consultar');
    return posicoes(LAYOUT_HIPERDIA);
  });
}
