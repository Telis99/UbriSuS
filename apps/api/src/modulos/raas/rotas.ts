// Rotas do RAAS: painel da competência, geração das ações a partir dos atendimentos, arquivo de
// exportação e importação, espelho impresso por usuário (TR 1.2.44, 1.2.13.1.36).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { salvarArquivo } from '../../servicos/arquivos.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { contextoDe, ErroHttp, exigirPermissao } from '../../seguranca/usuario.js';
import { posicoes } from '../aih/layout.js';
import { gerarAcoesDaProducao, gerarArquivoRaas, importarRaas, LAYOUT_RAAS_ACAO, LAYOUT_RAAS_CABECALHO, LAYOUT_RAAS_USUARIO, type TipoRaas } from './servico.js';
import { DESFECHO_RAAS, ORIGEM_RAAS } from './opcoes.js';
import './relatorios.js';

registrarPermissao('raas_arquivo', 'Exportação e importação do arquivo RAAS', 'RAAS', ['executar']);

const fmt = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const rot = (l: [string, string][], v?: string | null) => l.find(([k]) => k === v)?.[1] ?? v ?? '';

registrarGanchos('raas_registro', {
  antesSalvar(d, { atual }) {
    const final = { ...(atual ?? {}), ...d };
    if (!/^\d{6}$/.test(String(final.competencia ?? ''))) throw new ErroHttp(422, 'Competência no formato AAAAMM.', { competencia: 'Formato AAAAMM.' });
    if (final.tipo === 'DOMICILIAR' && !final.modalidade_ad) d.modalidade_ad = 'AD2';
    if (final.data_fim && final.data_fim < final.data_inicio) throw new ErroHttp(422, 'Data de conclusão anterior à admissão.');
  },
});
registrarGanchos('raas_acao', {
  async antesSalvar(d, { cliente: c, atual }) {
    const final = { ...(atual ?? {}), ...d };
    const r = (await c.query(`select competencia from raas.registro where id = $1`, [final.registro_id])).rows[0];
    if (r && String(final.data).slice(0, 7).replace('-', '') !== r.competencia) throw new ErroHttp(422, `A data da ação deve estar na competência ${r.competencia} do RAAS.`);
    if (!atual) d.origem = d.origem ?? 'digitacao';
    if (final.profissional_id && !final.cbo_codigo) {
      const v = (await c.query(`select cb.codigo from cad.vinculo v join cad.cbo cb on cb.id = v.cbo_id where v.profissional_id = $1 and v.ativo limit 1`, [final.profissional_id])).rows[0];
      if (v) d.cbo_codigo = v.codigo;
    }
  },
});

export default async function rotasRaas(app: FastifyInstance) {
  app.get('/api/raas/registros', async (req) => {
    exigirPermissao(req, 'raas_registro:consultar');
    const q = req.query as any;
    const competencia = q.competencia ?? new Date().toISOString().slice(0, 7).replace('-', '');
    const registros = await consultar(
      `select r.id, r.tipo, r.competencia, r.data_inicio::text data_inicio, r.data_fim::text data_fim, r.situacao, r.desfecho, r.modalidade_ad, pa.nome paciente, pa.cns, u.nome unidade,
              cp.codigo cid, (select count(*)::int from raas.acao a where a.registro_id = r.id) acoes, (select sum(quantidade)::int from raas.acao a where a.registro_id = r.id) quantidade
         from raas.registro r join cad.pessoa pa on pa.id = r.paciente_id join cad.unidade u on u.id = r.unidade_id left join cad.cid cp on cp.id = r.cid_principal_id
        where r.competencia = $1 and ($2::text is null or r.tipo = $2) and ($3::bigint is null or r.unidade_id = $3) order by r.tipo, pa.nome`,
      [competencia, q.tipo || null, q.unidadeId ? Number(q.unidadeId) : null],
    );
    const lotes = await consultar(`select l.*, u.nome unidade from raas.lote l left join cad.unidade u on u.id = l.unidade_id order by l.id desc limit 30`);
    const pendentes = await consultarUm(
      `select count(*)::int n from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id
        where p.competencia = $1 and p.paciente_id is not null and pr.instrumentos && array['08','09']::text[] and not exists (select 1 from raas.acao a where a.origem = 'producao:' || p.id)`,
      [competencia],
    );
    return { competencia, registros, lotes, pendentesProducao: pendentes?.n ?? 0 };
  });

  app.get('/api/raas/registros/:id/acoes', async (req) => {
    exigirPermissao(req, 'raas_registro:consultar');
    return consultar(
      `select a.id, a.data::text data, pr.codigo || ' - ' || pr.nome acao, a.quantidade, pf.nome profissional, a.cbo_codigo, a.local, a.origem
         from raas.acao a join cad.procedimento pr on pr.id = a.procedimento_id left join cad.profissional pf on pf.id = a.profissional_id where a.registro_id = $1 order by a.data, a.id`,
      [Number((req.params as any).id)],
    );
  });

  // Ações geradas dos atendimentos e da produção, sem digitação (TR 1.2.44.3, 1.2.44.5).
  app.post('/api/raas/gerar', async (req) => {
    exigirPermissao(req, 'raas_registro:incluir');
    const { competencia } = z.object({ competencia: z.string().regex(/^\d{6}$/) }).parse(req.body);
    return transacao(contextoDe(req, 'raas:gerar'), (c) => gerarAcoesDaProducao(c, competencia));
  });

  // Espelho do RAAS de um usuário (TR 1.2.44.6).
  app.get('/api/raas/registros/:id/espelho', async (req, reply) => {
    const u = exigirPermissao(req, 'raas_registro:consultar');
    const id = Number((req.params as any).id);
    const r = await consultarUm(
      `select r.*, r.data_inicio::text di, r.data_fim::text df, pa.nome, pa.cns, pa.data_nascimento::text nasc, pa.sexo, pa.nome_mae, un.nome unidade, un.cnes,
              cp.codigo || ' - ' || cp.nome cid, cs.codigo || ' - ' || cs.nome cid2, pf.nome responsavel
         from raas.registro r join cad.pessoa pa on pa.id = r.paciente_id join cad.unidade un on un.id = r.unidade_id left join cad.cid cp on cp.id = r.cid_principal_id
         left join cad.cid cs on cs.id = r.cid_secundario_id left join cad.profissional pf on pf.id = r.profissional_id where r.id = $1`,
      [id],
    );
    if (!r) throw new ErroHttp(404, 'RAAS não encontrado.');
    const acoes = await consultar(
      `select a.data::text data, pr.codigo, pr.nome, a.quantidade, pf.nome profissional, a.cbo_codigo, a.local from raas.acao a join cad.procedimento pr on pr.id = a.procedimento_id
         left join cad.profissional pf on pf.id = a.profissional_id where a.registro_id = $1 order by a.data`,
      [id],
    );
    const doc = await emitirDocumento(
      { relatorio: 'raas:espelho', titulo: `Espelho do RAAS ${r.tipo === 'DOMICILIAR' ? 'atenção domiciliar (RAAS-AD)' : 'psicossocial (RAAS-PS)'}`, filtros: { raas: id, emissao: Date.now() } },
      [
        { text: `Estabelecimento: ${r.unidade} (CNES ${r.cnes}) · Competência ${r.competencia.slice(4)}/${r.competencia.slice(0, 4)}`, bold: true },
        { text: `Usuário: ${r.nome} · CNS ${r.cns ?? '-'} · Nascimento ${fmt(r.nasc)} · Sexo ${r.sexo} · Mãe: ${r.nome_mae ?? '-'}`, margin: [0, 4, 0, 0] },
        { text: `Admissão: ${fmt(r.di)}${r.df ? ` · Conclusão: ${fmt(r.df)}` : ''} · Origem: ${rot(ORIGEM_RAAS, r.origem)} · Motivo de saída/permanência: ${rot(DESFECHO_RAAS, r.desfecho)}` },
        { text: `CID principal: ${r.cid ?? '-'} · CID secundário: ${r.cid2 ?? '-'}${r.tipo === 'DOMICILIAR' ? ` · Modalidade ${r.modalidade_ad ?? '-'} · Cuidador: ${r.cuidador ?? '-'}` : ` · Situação de rua: ${r.situacao_rua ? 'sim' : 'não'} · Substâncias: ${(r.substancias ?? []).join(', ') || '-'}`}` },
        { text: `Profissional responsável: ${r.responsavel ?? '-'}`, margin: [0, 0, 0, 8] },
        {
          table: {
            headerRows: 1,
            widths: [55, 60, '*', 30, 110, 45],
            body: [
              ['Data', 'Código', 'Ação realizada', 'Qtd.', 'Profissional (CBO)', 'Local'].map((t) => ({ text: t, style: 'th' })),
              ...acoes.map((a) => [fmt(a.data), a.codigo, a.nome, String(a.quantidade), `${a.profissional ?? '-'} ${a.cbo_codigo ?? ''}`, a.local === 'T' ? 'Território' : a.local === 'D' ? 'Domicílio' : 'Serviço'].map((t) => ({ text: t, style: 'td' }))),
            ],
          },
        },
        { text: `Total de ações: ${acoes.reduce((s, a) => s + a.quantidade, 0)}`, bold: true, margin: [0, 6, 0, 0] },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // Arquivo de exportação para o sistema RAAS (TR 1.2.44.3, 1.2.13.1.36).
  app.post('/api/raas/exportar', async (req, reply) => {
    const u = exigirPermissao(req, 'raas_arquivo:executar');
    const b = z.object({ competencia: z.string().regex(/^\d{6}$/), tipo: z.enum(['PSICOSSOCIAL', 'DOMICILIAR']).nullish(), unidadeId: z.number().nullish() }).parse(req.body);
    const r = await transacao(contextoDe(req, 'raas:exportar'), async (c) => {
      await gerarAcoesDaProducao(c, b.competencia);
      const arq = await gerarArquivoRaas(c, b.competencia, (b.tipo ?? null) as TipoRaas | null, b.unidadeId ?? null);
      const arquivoId = await salvarArquivo(arq.nome, 'text/plain', arq.conteudo, u.id);
      const lote = (
        await c.query(`insert into raas.lote (operacao, competencia, tipo, unidade_id, registros, acoes, arquivo_id, gerado_em) values ('EXPORTACAO',$1,$2,$3,$4,$5,$6,now()) returning id`, [
          b.competencia,
          b.tipo ?? 'TODOS',
          b.unidadeId ?? null,
          arq.registros,
          arq.acoes,
          arquivoId,
        ])
      ).rows[0];
      await c.query(`update raas.registro set situacao = 'EXPORTADO', lote_id = $2 where id = any($1)`, [arq.ids, lote.id]);
      return arq;
    });
    return reply.header('content-type', 'text/plain; charset=iso-8859-1').header('content-disposition', `attachment; filename="${r.nome}"`).send(r.conteudo);
  });

  // Importação do RAAS para o sistema (TR 1.2.44.4).
  app.post('/api/raas/importar', async (req) => {
    const u = exigirPermissao(req, 'raas_arquivo:executar');
    const { conteudo, nome } = z.object({ conteudo: z.string().min(10), nome: z.string().default('raas.txt') }).parse(req.body);
    return transacao(contextoDe(req, 'raas:importar'), async (c) => {
      const r = await importarRaas(c, conteudo);
      const arquivoId = await salvarArquivo(nome, 'text/plain', Buffer.from(conteudo, 'latin1'), u.id);
      await c.query(`insert into raas.lote (operacao, competencia, tipo, registros, acoes, criticas, arquivo_id, gerado_em) values ('IMPORTACAO',$1,'TODOS',$2,$3,$4,$5,now())`, [
        r.competencia,
        r.registros,
        r.acoes,
        r.criticas.join('\n') || null,
        arquivoId,
      ]);
      return r;
    });
  });

  app.get('/api/raas/layout', async (req) => {
    exigirPermissao(req, 'raas_registro:consultar');
    return { cabecalho: posicoes(LAYOUT_RAAS_CABECALHO), usuario: posicoes(LAYOUT_RAAS_USUARIO), acao: posicoes(LAYOUT_RAAS_ACAO) };
  });
}
