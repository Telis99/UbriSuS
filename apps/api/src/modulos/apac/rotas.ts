// Rotas da APAC: laudo de solicitação/autorização impresso, autorização, negativa, cancelamento,
// encerramento, vínculo da produção e exportação do arquivo APAC do SIA (TR 1.2.13.1.18 a 1.2.13.1.20).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { salvarArquivo } from '../../servicos/arquivos.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { registrarRelatorio, PERIODO } from '../../servicos/catalogo.js';
import { contextoDe, ErroHttp, exigirPermissao } from '../../seguranca/usuario.js';
import { posicoes } from '../aih/layout.js';
import { autorizarApac, gerarArquivoApac, LAYOUT_APAC_CABECALHO, LAYOUT_APAC_CORPO, LAYOUT_APAC_PROCEDIMENTO, vincularProducao } from './servico.js';

registrarPermissao('apac_autorizacao', 'Autorização de APAC', 'FAT', ['executar']);
registrarPermissao('apac_exportacao', 'Exportação do arquivo APAC (SIA)', 'FAT', ['executar']);

const idDe = (req: FastifyRequest) => Number((req.params as any).id);
const fmt = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

registrarGanchos('apac_laudo', {
  async antesSalvar(d, { cliente: c, atual }) {
    if (atual && atual.situacao !== 'SOLICITADO') {
      const permitidos = new Set(['motivo_saida', 'observacao']);
      if (Object.keys(d).some((k) => !permitidos.has(k) && String(d[k] ?? '') !== String(atual[k] ?? '') && !(atual[k] instanceof Date))) throw new ErroHttp(422, 'APAC já autorizada: apenas motivo de saída e observações podem ser alterados.');
    }
    const final = { ...(atual ?? {}), ...d };
    if (final.tipo_apac === '2' && !final.apac_anterior) throw new ErroHttp(422, 'Informe o número da APAC anterior para a continuidade.', { apac_anterior: 'Obrigatório na continuidade.' });
    const pac = (await c.query(`select sexo, prontuario, situacao from cad.pessoa where id = $1`, [final.paciente_id])).rows[0];
    if (!atual && pac?.situacao === 'FALECIDO') throw new ErroHttp(422, 'Paciente registrado como falecido.');
    if (!final.prontuario && pac?.prontuario) d.prontuario = pac.prontuario;
    const proc = (await c.query(`select nome, sexo from cad.procedimento where id = $1`, [final.procedimento_id])).rows[0];
    if (proc && ['M', 'F'].includes(proc.sexo) && pac?.sexo !== proc.sexo) throw new ErroHttp(422, `${proc.nome}: permitido somente para o sexo ${proc.sexo === 'F' ? 'feminino' : 'masculino'}.`);
    if (!atual) d.situacao = 'SOLICITADO';
  },
  async depoisSalvar(r, { cliente: c, atual }) {
    if (!atual) await c.query(`update apac.laudo set numero_laudo = $2 where id = $1`, [r.id, `AP${new Date().getFullYear()}${String(r.id).padStart(6, '0')}`]);
  },
});

registrarGanchos('apac_procedimento', {
  async antesSalvar(d, { cliente: c, atual }) {
    const final = { ...(atual ?? {}), ...d };
    if (!/^\d{6}$/.test(String(final.competencia ?? ''))) throw new ErroHttp(422, 'Competência no formato AAAAMM.');
    const l = (await c.query(`select situacao, validade_inicio::text vi, validade_fim::text vf from apac.laudo where id = $1`, [final.laudo_id])).rows[0];
    if (l?.situacao !== 'AUTORIZADO') throw new ErroHttp(422, 'Lance procedimentos somente em APAC autorizada.');
    const cmpt = `${final.competencia.slice(0, 4)}-${final.competencia.slice(4)}`;
    if (cmpt < l.vi.slice(0, 7) || cmpt > l.vf.slice(0, 7)) throw new ErroHttp(422, `Competência fora da validade da APAC (${fmt(l.vi)} a ${fmt(l.vf)}).`);
    const p = (await c.query(`select coalesce(valor_sa, 0) + coalesce(valor_sp, 0) v from cad.procedimento where id = $1`, [final.procedimento_id])).rows[0];
    d.valor = Number(p?.v ?? 0) * Number(final.quantidade ?? 1);
    if (final.profissional_id && !final.cbo_codigo) {
      const v = (await c.query(`select cb.codigo from cad.vinculo v join cad.cbo cb on cb.id = v.cbo_id where v.profissional_id = $1 and v.ativo limit 1`, [final.profissional_id])).rows[0];
      if (v) d.cbo_codigo = v.codigo;
    }
  },
});

registrarRelatorio({
  id: 'apac-autorizadas',
  modulo: 'FAT',
  grupo: 'APAC',
  permissao: 'apac_laudo:exportar',
  titulo: 'APACs por situação e estabelecimento',
  tr: ['1.2.13.1.19'],
  filtros: [...PERIODO, { nome: 'situacao', rotulo: 'Situação', tipo: 'opcao', opcoes: [['SOLICITADO', 'Solicitado'], ['AUTORIZADO', 'Autorizado'], ['NEGADO', 'Negado'], ['CANCELADO', 'Cancelado'], ['ENCERRADO', 'Encerrado']] }],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(ue.nome, '-') executante, l.numero_laudo, l.numero_apac, pa.nome paciente, pr.codigo || ' - ' || pr.nome procedimento, l.situacao,
              l.validade_inicio::text vi, l.validade_fim::text vf, (select coalesce(sum(valor), 0) from apac.procedimento x where x.laudo_id = l.id) valor
         from apac.laudo l join cad.pessoa pa on pa.id = l.paciente_id join cad.procedimento pr on pr.id = l.procedimento_id left join cad.unidade ue on ue.id = l.unidade_executante_id
        where l.data_solicitacao between $1 and $2 and ($3::text is null or l.situacao = $3) order by 1, 2`,
      [f.de, f.ate, f.situacao || null],
    );
    return {
      linhas,
      agrupar: ['executante'],
      orientacao: 'landscape',
      colunas: [
        { campo: 'executante', titulo: 'Executante' },
        { campo: 'numero_laudo', titulo: 'Laudo' },
        { campo: 'numero_apac', titulo: 'Nº APAC' },
        { campo: 'paciente', titulo: 'Paciente' },
        { campo: 'procedimento', titulo: 'Procedimento' },
        { campo: 'situacao', titulo: 'Situação' },
        { campo: 'vi', titulo: 'Validade de', formato: 'data' },
        { campo: 'vf', titulo: 'até', formato: 'data' },
        { campo: 'valor', titulo: 'Valor realizado', formato: 'moeda', total: true },
      ],
    };
  },
});

export default async function rotasApac(app: FastifyInstance) {
  app.get('/api/apac/laudos', async (req) => {
    exigirPermissao(req, 'apac_laudo:consultar');
    const q = req.query as any;
    return consultar(
      `select l.id, l.numero_laudo, l.data_solicitacao::text data_solicitacao, l.tipo_apac, l.situacao, l.numero_apac, l.validade_inicio::text validade_inicio, l.validade_fim::text validade_fim,
              pa.nome paciente, pr.codigo || ' - ' || pr.nome procedimento, ue.nome executante, l.unidade_executante_id, l.motivo,
              (select count(*)::int from apac.procedimento x where x.laudo_id = l.id) procedimentos
         from apac.laudo l join cad.pessoa pa on pa.id = l.paciente_id join cad.procedimento pr on pr.id = l.procedimento_id left join cad.unidade ue on ue.id = l.unidade_executante_id
        where ($1::text is null or l.situacao = $1) and ($2::text is null or pa.nome_busca like cad.fn_normalizar($2) || '%' or l.numero_apac = $2)
        order by case l.situacao when 'SOLICITADO' then 1 when 'AUTORIZADO' then 2 else 3 end, l.data_solicitacao desc limit 500`,
      [q.situacao || null, q.busca || null],
    );
  });

  // Laudo para solicitação/autorização de APAC impresso (TR 1.2.13.1.18).
  app.get('/api/apac/laudos/:id/pdf', async (req, reply) => {
    const u = exigirPermissao(req, 'apac_laudo:consultar');
    const l = await consultarUm(
      `select l.*, l.data_solicitacao::text ds, l.validade_inicio::text vi, l.validade_fim::text vf, pa.nome paciente, pa.cns, pa.sexo, pa.data_nascimento::text nasc, pa.nome_mae,
              us.nome solicitante_unidade, us.cnes cnes_sol, ue.nome executante, ue.cnes cnes_exec, pr.codigo proc, pr.nome proc_nome, cp.codigo || ' - ' || cp.nome cid,
              cs.codigo || ' - ' || cs.nome cid2, ps.nome medico, ps.conselho, ps.registro_conselho, az.nome autorizador, oe.codigo emissor
         from apac.laudo l join cad.pessoa pa on pa.id = l.paciente_id join cad.procedimento pr on pr.id = l.procedimento_id
         left join cad.unidade us on us.id = l.unidade_solicitante_id left join cad.unidade ue on ue.id = l.unidade_executante_id
         left join cad.cid cp on cp.id = l.cid_principal_id left join cad.cid cs on cs.id = l.cid_secundario_id
         left join cad.profissional ps on ps.id = l.profissional_solicitante_id left join cad.profissional az on az.id = l.autorizador_id left join aih.orgao_emissor oe on oe.id = l.orgao_emissor_id
        where l.id = $1`,
      [idDe(req)],
    );
    if (!l) throw new ErroHttp(404, 'Laudo não encontrado.');
    const caixa = (r: string, v: string) => ({ stack: [{ text: r, fontSize: 6.5, color: '#555' }, { text: v || ' ', fontSize: 9 }] });
    const linha = (...cel: [string, string][]) => ({ table: { widths: cel.map(() => '*'), body: [cel.map(([r, v]) => caixa(r, v))] }, layout: { hLineColor: () => '#bbb', vLineColor: () => '#bbb' } });
    const r = await emitirDocumento(
      { relatorio: 'apac:laudo', titulo: 'Laudo para solicitação/autorização de procedimento ambulatorial (APAC)', filtros: { laudo: l.id, emissao: Date.now() } },
      [
        { columns: [{ text: `Laudo ${l.numero_laudo}`, bold: true }, { image: await codigoBarras(l.numero_laudo ?? String(l.id)), width: 140, alignment: 'right' }] },
        { text: 'Estabelecimentos', style: 'h2' },
        linha(['Solicitante', l.solicitante_unidade ?? ''], ['CNES', l.cnes_sol ?? '']),
        linha(['Executante', l.executante ?? ''], ['CNES', l.cnes_exec ?? '']),
        { text: 'Paciente', style: 'h2' },
        linha(['Nome', l.paciente], ['CNS', l.cns ?? ''], ['Nascimento', fmt(l.nasc)], ['Sexo', l.sexo]),
        linha(['Nome da mãe', l.nome_mae ?? ''], ['Prontuário', l.prontuario ?? '']),
        { text: 'Procedimento solicitado', style: 'h2' },
        linha(['Código', l.proc], ['Procedimento', l.proc_nome], ['Quantidade', String(l.quantidade ?? 1)], ['Tipo', { 1: 'Inicial', 2: 'Continuidade', 3: 'Única' }[l.tipo_apac as 1] ?? '']),
        linha(['CID-10 principal', l.cid ?? ''], ['CID-10 secundário', l.cid2 ?? '']),
        linha(['Justificativa / dados clínicos', l.justificativa ?? '']),
        linha(['Profissional solicitante', `${l.medico ?? ''} ${l.conselho ?? ''} ${l.registro_conselho ?? ''}`], ['Data da solicitação', fmt(l.ds)]),
        { text: '_____________________________________________', alignment: 'center', margin: [0, 26, 0, 0] },
        { text: 'Assinatura e carimbo do profissional solicitante', alignment: 'center', fontSize: 7 },
        { text: 'Autorização', style: 'h2' },
        linha(['Situação', l.situacao], ['Nº da APAC', l.numero_apac ?? ''], ['Órgão emissor', l.emissor ?? '']),
        linha(['Autorizador', l.autorizador ?? ''], ['Validade', l.vi ? `${fmt(l.vi)} a ${fmt(l.vf)}` : ''], ['Motivo (negativa/cancelamento)', l.motivo ?? '']),
        { text: '_____________________________________________', alignment: 'center', margin: [0, 26, 0, 0] },
        { text: 'Assinatura e carimbo do autorizador', alignment: 'center', fontSize: 7 },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
  });

  app.post('/api/apac/laudos/:id/autorizar', async (req) => {
    const u = exigirPermissao(req, 'apac_autorizacao:executar');
    const b = z.object({ numero: z.string().nullish(), autorizadorId: z.number(), data: z.string().nullish() }).parse(req.body);
    return transacao(contextoDe(req, 'apac:autorizar'), (c) => autorizarApac(c, idDe(req), b, u));
  });

  for (const [acao, situacao, origem] of [
    ['negar', 'NEGADO', ['SOLICITADO']],
    ['cancelar', 'CANCELADO', ['SOLICITADO', 'AUTORIZADO']],
    ['encerrar', 'ENCERRADO', ['AUTORIZADO']],
  ] as [string, string, string[]][]) {
    app.post(`/api/apac/laudos/:id/${acao}`, async (req) => {
      exigirPermissao(req, 'apac_autorizacao:executar');
      const b = z.object({ motivo: z.string().min(3), motivoSaida: z.string().nullish() }).parse(req.body);
      await transacao(contextoDe(req, `apac:${acao}`), async (c) => {
        const l = (await c.query(`select situacao, numero_apac from apac.laudo where id = $1 for update`, [idDe(req)])).rows[0];
        if (!l || !origem.includes(l.situacao)) throw new ErroHttp(409, `Operação não permitida para APAC na situação ${l?.situacao ?? '-'}.`);
        await c.query(`update apac.laudo set situacao = $2, motivo = $3, motivo_saida = coalesce($4, motivo_saida) where id = $1`, [idDe(req), situacao, b.motivo, b.motivoSaida ?? null]);
        if (situacao === 'CANCELADO' && l.numero_apac) await c.query(`update aih.numero set situacao = 'CANCELADO' where numero = $1`, [l.numero_apac]);
      });
      return { ok: true };
    });
  }

  // Produção do paciente lançada pelos atendimentos entra na APAC sem redigitação (TR 1.2.13.1.19).
  app.post('/api/apac/laudos/:id/vincular-producao', async (req) => {
    exigirPermissao(req, 'apac_laudo:alterar');
    return transacao(contextoDe(req, 'apac:vincular'), (c) => vincularProducao(c, idDe(req)));
  });

  // Arquivo de exportação para o SIA/APAC (TR 1.2.13.1.20).
  app.post('/api/apac/exportar', async (req, reply) => {
    const u = exigirPermissao(req, 'apac_exportacao:executar');
    const b = z.object({ competencia: z.string().regex(/^\d{6}$/), unidadeId: z.number().nullish() }).parse(req.body);
    const r = await transacao(contextoDe(req, 'apac:exportar'), async (c) => {
      const arq = await gerarArquivoApac(c, b.competencia, b.unidadeId ?? null);
      const arquivoId = await salvarArquivo(arq.nome, 'text/plain', arq.conteudo, u.id);
      const lote = (
        await c.query(`insert into apac.lote (competencia, unidade_id, apacs, linhas, campo_controle, arquivo_id, gerado_em) values ($1,$2,$3,$4,$5,$6,now()) returning id`, [
          b.competencia,
          b.unidadeId ?? null,
          arq.apacs,
          arq.linhas,
          arq.controle,
          arquivoId,
        ])
      ).rows[0];
      await c.query(`update apac.procedimento set lote_id = $2 where id = any($1)`, [arq.procIds, lote.id]);
      return arq;
    });
    return reply.header('content-type', 'text/plain; charset=iso-8859-1').header('content-disposition', `attachment; filename="${r.nome}"`).send(r.conteudo);
  });

  app.get('/api/apac/lotes', async (req) => {
    exigirPermissao(req, 'apac_laudo:consultar');
    return consultar(`select l.*, u.nome unidade from apac.lote l left join cad.unidade u on u.id = l.unidade_id order by l.id desc limit 50`);
  });

  app.get('/api/apac/layout', async (req) => {
    exigirPermissao(req, 'apac_laudo:consultar');
    return { cabecalho: posicoes(LAYOUT_APAC_CABECALHO), corpo: posicoes(LAYOUT_APAC_CORPO), procedimento: posicoes(LAYOUT_APAC_PROCEDIMENTO) };
  });
}
