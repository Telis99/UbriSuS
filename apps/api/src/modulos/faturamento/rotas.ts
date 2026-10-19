import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { salvarArquivo } from '../../servicos/arquivos.js';
import { contextoDe, ErroHttp, exigirPermissao } from '../../seguranca/usuario.js';
import { gerarBpa, importarBpa, revalidarCompetencia } from './bpa.js';
import { lancarProducao } from './producao.js';
import './relatorios.js';

registrarPermissao('faturamento_bpa', 'Geração e importação do BPA', 'FAT', ['executar']);

// Digitação da produção de unidades não informatizadas passa pelas mesmas validações SIGTAP (TR 1.2.13.1.29).
registrarGanchos('producao', {
  antesSalvar(d, { atual }) {
    if (atual?.situacao === 'EXPORTADO') throw new ErroHttp(422, 'Produção já exportada no BPA não pode ser alterada.');
    if (!atual) d.origem = 'DIGITACAO';
  },
});
registrarGanchos('competencia', {
  antesSalvar(d) {
    if (d.competencia && !/^\d{6}$/.test(d.competencia)) throw new ErroHttp(422, 'Competência no formato AAAAMM.', { competencia: 'Formato AAAAMM.' });
  },
});

export async function rotasFaturamento(app: FastifyInstance) {
  // Resumo da competência: produção por situação e instrumento.
  app.get('/api/faturamento/resumo', async (req) => {
    exigirPermissao(req, 'producao:consultar');
    const q = req.query as any;
    const competencia = q.competencia ?? new Date().toISOString().slice(0, 7).replace('-', '');
    const linhas = await consultar(
      `select p.instrumento, p.situacao, count(*)::int registros, sum(p.quantidade)::int quantidade, coalesce(sum(p.valor), 0)::numeric valor
         from fat.producao p where p.competencia = $1 and ($2::bigint is null or p.unidade_id = $2) group by 1,2 order by 1,2`,
      [competencia, q.unidadeId ? Number(q.unidadeId) : null],
    );
    const criticas = await consultar(
      `select p.id, p.data::text data, u.nome unidade, pr.codigo || ' - ' || pr.nome procedimento, pf.nome profissional, p.cbo_codigo, pa.nome paciente, p.critica, p.origem
         from fat.producao p join cad.unidade u on u.id = p.unidade_id join cad.procedimento pr on pr.id = p.procedimento_id
         left join cad.profissional pf on pf.id = p.profissional_id left join cad.pessoa pa on pa.id = p.paciente_id
        where p.competencia = $1 and p.situacao = 'CRITICA' and ($2::bigint is null or p.unidade_id = $2) order by p.data limit 500`,
      [competencia, q.unidadeId ? Number(q.unidadeId) : null],
    );
    const lotes = await consultar(
      `select l.id, l.competencia, u.nome unidade, l.linhas, l.campo_controle, l.gerado_em, l.arquivo_id from fat.lote_bpa l left join cad.unidade u on u.id = l.unidade_id where l.competencia = $1 order by l.id desc`,
      [competencia],
    );
    const comp = await consultar(`select * from fat.competencia where competencia = $1`, [competencia]);
    return { competencia, situacao: comp[0]?.situacao ?? 'ABERTA', linhas, criticas, lotes };
  });

  app.post('/api/faturamento/revalidar', async (req) => {
    exigirPermissao(req, 'faturamento_bpa:executar');
    const { competencia } = z.object({ competencia: z.string().regex(/^\d{6}$/) }).parse(req.body);
    return transacao(contextoDe(req, 'faturamento:revalidar'), (c) => revalidarCompetencia(c, competencia));
  });

  // Geração do arquivo BPA agrupado (um arquivo para o município) ou por unidade (TR 1.2.13.1.24, 1.2.13.1.25).
  app.post('/api/faturamento/bpa', async (req, reply) => {
    const u = exigirPermissao(req, 'faturamento_bpa:executar');
    const b = z.object({ competencia: z.string().regex(/^\d{6}$/), unidadeId: z.number().nullish(), incluirCriticas: z.boolean().default(false), fecharCompetencia: z.boolean().default(false) }).parse(req.body);
    const r = await transacao(contextoDe(req, 'faturamento:bpa'), async (c) => {
      const bpa = await gerarBpa(c, b.competencia, b.unidadeId ?? null, b.incluirCriticas);
      const arquivoId = await salvarArquivo(bpa.nome, 'text/plain', bpa.conteudo, u.id);
      const lote = (
        await c.query(`insert into fat.lote_bpa (competencia, unidade_id, arquivo_id, linhas, campo_controle, gerado_em) values ($1,$2,$3,$4,$5,now()) returning id`, [
          b.competencia,
          b.unidadeId ?? null,
          arquivoId,
          bpa.linhas,
          bpa.controle,
        ])
      ).rows[0];
      await c.query(`update fat.producao set situacao = 'EXPORTADO', lote_bpa_id = $2 where id = any($1)`, [bpa.ids, lote.id]);
      if (b.fecharCompetencia)
        await c.query(
          `insert into fat.competencia (competencia, inicio, fim, situacao) values ($1, to_date($1, 'YYYYMM'), (to_date($1, 'YYYYMM') + interval '1 month - 1 day')::date, 'ENVIADA')
           on conflict (competencia) do update set situacao = 'ENVIADA'`,
          [b.competencia],
        );
      return bpa;
    });
    return reply
      .header('content-type', 'text/plain; charset=iso-8859-1')
      .header('content-disposition', `attachment; filename="${r.nome}"`)
      .header('x-bpa-resumo', JSON.stringify({ linhas: r.linhas, folhas: r.folhas, controle: r.controle, consolidado: r.consolidado, individualizado: r.individualizado }))
      .send(r.conteudo);
  });

  app.post('/api/faturamento/importar-bpa', async (req) => {
    exigirPermissao(req, 'faturamento_bpa:executar');
    const { conteudo } = z.object({ conteudo: z.string().min(10) }).parse(req.body);
    return transacao(contextoDe(req, 'faturamento:importacao'), (c) => importarBpa(c, conteudo));
  });

  // Digitação rápida da produção (unidades não informatizadas), com críticas SIGTAP.
  app.post('/api/faturamento/digitacao', async (req) => {
    exigirPermissao(req, 'producao:incluir');
    const b = z
      .object({
        unidadeId: z.number(),
        profissionalId: z.number().nullish(),
        data: z.string(),
        itens: z.array(z.object({ procedimentoId: z.number(), quantidade: z.number().int().positive(), pacienteId: z.number().nullish(), cidCodigo: z.string().nullish() })).min(1),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'faturamento:digitacao'), async (c) => {
      const res = [];
      for (const i of b.itens)
        res.push(await lancarProducao(c, { data: b.data, unidadeId: b.unidadeId, profissionalId: b.profissionalId ?? null, procedimentoId: i.procedimentoId, quantidade: i.quantidade, pacienteId: i.pacienteId ?? null, cidCodigo: i.cidCodigo ?? null, origem: 'DIGITACAO' }));
      return res;
    });
  });
}
