import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario } from '../../seguranca/usuario.js';
import { idadeTexto } from '../../compartilhado/validacao.js';
import { parametro, registrarProvedorAlerta } from '../cadastros/alertas.js';
import { atrasadas, carteira, encerrarFrasco, excluirVacinacao, lotesAplicacao, registrarVacinacao } from './servico.js';
import './relatorios.js';

registrarPermissao('exportacao_sipni', 'Exportação de dados ao SI-PNI / RNDS', 'IMU', ['executar']);

const fmtData = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

// O registro de vacinação passa pelas regras de aplicação; o cadastro genérico só altera dados descritivos.
registrarGanchos('vacinacao', {
  antesSalvar(d, { atual }) {
    if (!atual) throw new ErroHttp(422, 'Registre aplicações, resgates e aprazamentos pela carteira de vacinação.');
    for (const k of Object.keys(d)) if (!['data', 'observacao', 'local_aplicacao', 'via', 'profissional_texto', 'lote_texto', 'data_aprazada'].includes(k)) delete d[k];
    if (d.data && atual.tipo === 'APLICACAO' && d.data > new Date().toISOString().slice(0, 10)) throw new ErroHttp(422, 'Data de aplicação futura.');
  },
});

// Alerta de vacinas em atraso no atendimento, recepção e vacinação (TR 1.2.39.1.15).
registrarProvedorAlerta(async (p, ctx) => {
  if (!(await parametro<boolean>('imunizacao.alertar_atrasadas', true))) return [];
  if (ctx.rotina && !['atendimento', 'recepcao', 'vacinacao', 'agendamento'].includes(ctx.rotina)) return [];
  const a = await atrasadas(p.id).catch(() => []);
  if (!a.length) return [];
  return [{ tipo: 'vacina_atrasada', nivel: 'aviso', mensagem: `Vacinas em atraso: ${a.map((x) => `${x.sigla} ${x.dose}`).join(', ')}.`, dados: a.map((x) => ({ imunobiologicoId: x.imunobiologicoId, doseId: x.doseId })) }];
});

export async function rotasImunizacao(app: FastifyInstance) {
  app.get('/api/imunizacao/carteira/:pacienteId', async (req) => {
    exigirPermissao(req, 'vacinacao:consultar');
    return carteira(Number((req.params as any).pacienteId));
  });

  app.get('/api/imunizacao/lotes', async (req) => {
    const u = exigirUsuario(req);
    const q = req.query as any;
    return lotesAplicacao(Number(q.unidadeId ?? u.unidadeAtual), Number(q.imunobiologicoId));
  });

  // Campanhas vigentes e grupos aplicáveis ao paciente (TR 1.2.39.1.34).
  app.get('/api/imunizacao/campanhas-vigentes', async (req) => {
    exigirUsuario(req);
    const q = req.query as any;
    return consultar(
      `select c.id, c.nome, c.estrategia, g.id grupo_id, g.nome grupo, g.imunobiologico_id, g.dose_id
         from imu.campanha c join imu.campanha_grupo g on g.campanha_id = c.id
        where c.ativo and current_date between c.inicio and c.fim and ($1::bigint is null or g.imunobiologico_id = $1)
          and ($2::int is null or ((g.idade_minima_dias is null or $2 >= g.idade_minima_dias) and (g.idade_maxima_dias is null or $2 <= g.idade_maxima_dias)))
        order by c.nome, g.nome`,
      [q.imunobiologicoId ? Number(q.imunobiologicoId) : null, q.idadeDias ? Number(q.idadeDias) : null],
    );
  });

  app.post('/api/imunizacao/vacinacoes', async (req, reply) => {
    const u = exigirPermissao(req, 'vacinacao:incluir');
    const b = z
      .object({
        pacienteId: z.number(),
        imunobiologicoId: z.number(),
        doseId: z.number().nullish(),
        tipo: z.enum(['APLICACAO', 'RESGATE', 'APRAZAMENTO', 'INDICACAO']),
        data: z.string().optional(),
        unidadeId: z.number().nullish(),
        loteId: z.number().nullish(),
        loteTexto: z.string().nullish(),
        profissionalTexto: z.string().nullish(),
        estrategia: z.string().optional(),
        campanhaId: z.number().nullish(),
        grupoId: z.number().nullish(),
        viaAplicacao: z.string().nullish(),
        localAplicacao: z.string().nullish(),
        diluenteLoteId: z.number().nullish(),
        novoFrasco: z.boolean().optional(),
        observacao: z.string().nullish(),
        confirmarAvisos: z.boolean().optional(),
      })
      .parse(req.body);
    return reply.status(201).send(await transacao(contextoDe(req, 'vacinacao'), (c) => registrarVacinacao(c, b, u)));
  });

  app.delete('/api/imunizacao/vacinacoes/:id', async (req) => {
    const u = exigirPermissao(req, 'vacinacao:excluir');
    await transacao(contextoDe(req, 'vacinacao:excluir'), (c) => excluirVacinacao(c, Number((req.params as any).id), u));
    return { ok: true };
  });

  app.post('/api/imunizacao/frascos/:id/encerrar', async (req) => {
    exigirPermissao(req, 'frasco_aberto:alterar');
    await transacao(contextoDe(req, 'frasco:encerrar'), (c) => encerrarFrasco(c, Number((req.params as any).id)));
    return { ok: true };
  });

  // Busca ativa: pacientes com doses pendentes conforme o quadro de cobertura (TR 1.2.39.1.56).
  app.get('/api/imunizacao/pendentes', async (req) => {
    exigirPermissao(req, 'vacinacao:consultar');
    const q = req.query as any;
    return consultar(
      `with pac as (
         select p.id, p.nome, p.nome_mae, p.data_nascimento, p.sexo, p.celular, b.nome bairro, (current_date - p.data_nascimento) idade
           from cad.pessoa p left join cad.bairro b on b.id = p.bairro_id
          where p.situacao = 'ATIVO' and p.data_nascimento is not null
            and ($1::bigint is null or p.unidade_referencia_id = $1) and ($2::bigint is null or p.bairro_id = $2)
            and ($6::text is null or cad.fn_normalizar(p.nome) like '%' || cad.fn_normalizar($6) || '%')
            and ($7::text is null or cad.fn_normalizar(p.nome_mae) like '%' || cad.fn_normalizar($7) || '%')
            and ($8::date is null or p.data_nascimento = $8)
       )
       select pac.id paciente_id, pac.nome, pac.nome_mae, pac.data_nascimento::text nascimento, pac.bairro, pac.celular, i.id imunobiologico_id, i.sigla, i.nome imunobiologico,
              d.id dose_id, d.sigla dose, q.estrategia, (pac.data_nascimento + q.idade_minima_dias)::text previsto
         from pac join imu.quadro_cobertura q on pac.idade >= q.idade_minima_dias and (q.idade_maxima_dias is null or pac.idade <= q.idade_maxima_dias)
              and (q.sexo is null or q.sexo = 'A' or q.sexo = pac.sexo) and q.faixa_carteira is distinct from 'GESTANTE'
         join imu.imunobiologico i on i.id = q.imunobiologico_id and i.ativo join imu.dose d on d.id = q.dose_id
        where ($3::bigint is null or i.id = $3) and ($4::text is null or q.estrategia = $4) and ($5::bigint is null or d.id = $5)
          and not exists (select 1 from imu.vacinacao v where v.paciente_id = pac.id and v.imunobiologico_id = q.imunobiologico_id and v.dose_id = q.dose_id and v.tipo in ('APLICACAO','RESGATE'))
          and not exists (select 1 from imu.vacinacao v join imu.imunobiologico_equivalencia e on e.imunobiologico_id = v.imunobiologico_id and (e.dose_id is null or e.dose_id = v.dose_id)
                           where v.paciente_id = pac.id and e.equivale_id = q.imunobiologico_id and (e.equivale_dose_id is null or e.equivale_dose_id = q.dose_id) and v.tipo in ('APLICACAO','RESGATE'))
        order by pac.nome, i.ordem_carteira, d.ordem limit 2000`,
      [q.unidadeId ? Number(q.unidadeId) : null, q.bairroId ? Number(q.bairroId) : null, q.imunobiologicoId ? Number(q.imunobiologicoId) : null, q.estrategia || null, q.doseId ? Number(q.doseId) : null, q.nome || null, q.mae || null, q.nascimento || null],
    );
  });

  // Painel da campanha em tempo real com percentual da meta por grupo (TR 1.2.39.1.55).
  app.get('/api/imunizacao/campanhas/:id/painel', async (req) => {
    exigirPermissao(req, 'campanha_vacinacao:consultar');
    const id = Number((req.params as any).id);
    const campanha = await consultarUm(`select id, nome, inicio::text, fim::text, estrategia from imu.campanha where id = $1`, [id]);
    if (!campanha) throw new ErroHttp(404, 'Campanha não encontrada.');
    const grupos = await consultar(
      `select g.id, g.nome, i.sigla imunobiologico, d.sigla dose, g.populacao_alvo, g.meta_percentual,
              round(coalesce(g.populacao_alvo, 0) * coalesce(g.meta_percentual, 100) / 100.0) meta,
              (select count(*)::int from imu.vacinacao v where v.grupo_id = g.id and v.tipo = 'APLICACAO') aplicadas
         from imu.campanha_grupo g join imu.imunobiologico i on i.id = g.imunobiologico_id left join imu.dose d on d.id = g.dose_id where g.campanha_id = $1 order by g.nome`,
      [id],
    );
    const diario = await consultar(
      `select v.data::text dia, count(*)::int aplicadas from imu.vacinacao v where v.campanha_id = $1 and v.tipo = 'APLICACAO' group by 1 order by 1`,
      [id],
    );
    const porUnidade = await consultar(
      `select u.nome unidade, count(*)::int aplicadas from imu.vacinacao v join cad.unidade u on u.id = v.unidade_id where v.campanha_id = $1 and v.tipo = 'APLICACAO' group by 1 order by 2 desc`,
      [id],
    );
    return {
      campanha,
      grupos: grupos.map((g) => ({ ...g, meta: Number(g.meta), percentual: Number(g.meta) ? Math.round((g.aplicadas / Number(g.meta)) * 1000) / 10 : null })),
      diario,
      porUnidade,
    };
  });

  // Carteira de vacinação e histórico impressos (TR 1.2.39.2.7, 1.2.39.2.8).
  app.get('/api/imunizacao/carteira/:pacienteId/impressao', async (req, reply) => {
    const u = exigirPermissao(req, 'vacinacao:consultar');
    const pid = Number((req.params as any).pacienteId);
    const historico = (req.query as any).historico === 'true';
    const cart = await carteira(pid);
    const pac = await consultarUm(`select nome, cns, cpf, nome_mae, data_nascimento::text nasc, sexo from cad.pessoa where id = $1`, [pid]);
    const aplicadas = cart.registros.filter((r) => r.tipo === 'APLICACAO' || r.tipo === 'RESGATE');
    const corpo: any[] = [
      {
        table: {
          widths: [90, '*', 90, '*'],
          body: [
            [{ text: 'Nome', bold: true }, pac.nome, { text: 'Nascimento', bold: true }, `${fmtData(pac.nasc)} (${idadeTexto(pac.nasc)})`],
            [{ text: 'CNS', bold: true }, pac.cns ?? '-', { text: 'Mãe', bold: true }, pac.nome_mae ?? '-'],
          ],
        },
        layout: 'noBorders',
        fontSize: 9,
        margin: [0, 0, 0, 8],
      },
    ];
    if (historico) {
      corpo.push({
        table: {
          headerRows: 1,
          widths: [60, '*', 40, 70, 60, '*', 50],
          body: [
            ['Data', 'Imunobiológico', 'Dose', 'Registro', 'Lote', 'Unidade / profissional', 'CNES'].map((t) => ({ text: t, style: 'th' })),
            ...aplicadas.map((r) => [fmtData(r.data), r.imunobiologico, r.dose ?? '', r.tipo === 'RESGATE' ? 'Resgate' : r.inadvertida ? 'Aplicação (inadvertida)' : 'Aplicação', r.lote ?? '', `${r.unidade ?? ''} ${r.profissional ? '- ' + r.profissional : ''}`, r.cnes ?? '']),
          ],
        },
        fontSize: 8,
        layout: 'lightHorizontalLines',
      });
    } else {
      const faixas = ['CRIANCA', 'ADOLESCENTE', 'ADULTO', 'IDOSO', 'GESTANTE'];
      const nomes: Record<string, string> = { CRIANCA: 'Criança', ADOLESCENTE: 'Adolescente', ADULTO: 'Adulto', IDOSO: 'Idoso', GESTANTE: 'Gestante' };
      for (const f of faixas) {
        const itens = cart.itens.filter((i) => i.faixa === f);
        if (!itens.length) continue;
        corpo.push({ text: nomes[f], style: 'h2' });
        const porVacina = new Map<string, typeof itens>();
        for (const i of itens) porVacina.set(i.sigla, [...(porVacina.get(i.sigla) ?? []), i]);
        const celulas = [...porVacina.entries()].map(([sigla, ds]) => ({
          stack: [
            { text: sigla, bold: true, fontSize: 8, alignment: 'center' },
            ...ds.map((d) => {
              const r = d.registro;
              const cor = { AZUL: '#d0ebff', VERDE: '#d3f9d8', VERMELHO: '#ffe3e3', CINZA: '#f1f3f5' }[d.cor];
              return {
                table: {
                  widths: ['*'],
                  body: [
                    [
                      {
                        text: [
                          { text: `${d.dose}\n`, bold: true },
                          r && (r.tipo === 'APLICACAO' || r.tipo === 'RESGATE') ? `${fmtData(r.data)}\nLote ${r.lote ?? '-'}\n${r.cnes ?? ''} ${(r.profissional ?? '').split(' ')[0]}` : r?.tipo === 'APRAZAMENTO' ? `Aprazada ${fmtData(r.data)}` : `Prevista ${fmtData(d.previstoPara)}`,
                        ],
                        fontSize: 6.5,
                        fillColor: cor,
                        alignment: 'center',
                      },
                    ],
                  ],
                },
                margin: [1, 1, 1, 1],
              };
            }),
          ],
          width: 64,
        }));
        for (let k = 0; k < celulas.length; k += 8) corpo.push({ columns: celulas.slice(k, k + 8), columnGap: 2, margin: [0, 2, 0, 4] });
      }
      if (cart.outrasAplicacoes.length) {
        corpo.push({ text: 'Outras aplicações (campanhas e esquemas especiais)', style: 'h2' });
        corpo.push({ ul: cart.outrasAplicacoes.map((r: any) => `${fmtData(r.data)} - ${r.imunobiologico} ${r.dose ?? ''} - lote ${r.lote ?? '-'} - ${r.unidade ?? ''}`), fontSize: 8 });
      }
      corpo.push({ text: 'Legenda: azul = aplicada/resgatada · verde = no prazo/aprazada · vermelho = em atraso · cinza = ainda não indicada', fontSize: 7, italics: true, margin: [0, 8, 0, 0] });
    }
    const r = await emitirDocumento(
      { relatorio: historico ? 'imunizacao:historico' : 'imunizacao:carteira', titulo: historico ? 'Histórico de vacinação' : 'Carteira de vacinação', filtros: { paciente: pid } },
      corpo,
      { orientacao: historico ? 'portrait' : 'landscape' },
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
  });

  // Exportação ao SI-PNI: vacinados, registros (RIA no padrão RNDS/FHIR) e movimentação (TR 1.2.39.2.10).
  app.get('/api/imunizacao/exportar/sipni', async (req, reply) => {
    exigirPermissao(req, 'exportacao_sipni:executar');
    const q = req.query as any;
    const de = q.de ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const ate = q.ate ?? new Date().toISOString().slice(0, 10);
    const tipo = (q.tipo ?? 'registros') as string;
    const cnesPadrao = (await consultarUm(`select cnes from cad.unidade where id = $1`, [Number(q.unidadeId ?? 0)]))?.cnes;
    if (tipo === 'movimentacao') {
      const linhas = await consultar(
        `select u.cnes, i.codigo_sipni imunobiologico, coalesce(ap.sigla, '') apresentacao, coalesce(fb.codigo_sipni, '') produtor, l.lote, to_char(m.data_hora, 'YYYYMM') competencia,
                sum(m.quantidade) filter (where m.quantidade > 0) entradas, -sum(m.quantidade) filter (where m.tipo in ('VACINACAO')) utilizadas,
                -sum(m.quantidade) filter (where m.tipo = 'INUTILIZACAO') perdas, -sum(m.quantidade) filter (where m.tipo = 'TRANSFERENCIA_SAIDA') remanejadas
           from far.movimento_estoque m join imu.imunobiologico i on i.produto_id = m.produto_id join cad.unidade u on u.id = m.unidade_id
           join far.estoque_lote l on l.id = m.lote_id left join far.fabricante fb on fb.id = l.fabricante_id
           left join far.produto p on p.id = m.produto_id left join far.apresentacao ap on ap.id = p.apresentacao_id
          where m.data_hora::date between $1 and $2 and ($3::bigint is null or m.unidade_id = $3) group by 1,2,3,4,5,6 order by 1,2`,
        [de, ate, q.unidadeId ? Number(q.unidadeId) : null],
      );
      const csv = ['CNES;IMUNOBIOLOGICO;APRESENTACAO;PRODUTOR;LOTE;COMPETENCIA;ENTRADAS;UTILIZADAS;PERDAS;REMANEJADAS', ...linhas.map((l) => [l.cnes, l.imunobiologico, l.apresentacao, l.produtor, l.lote, l.competencia, Number(l.entradas ?? 0), Number(l.utilizadas ?? 0), Number(l.perdas ?? 0), Number(l.remanejadas ?? 0)].join(';'))].join('\r\n');
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="sipni_movimentacao_${de}_${ate}.csv"`).send(csv);
    }
    const regs = await consultar(
      `select v.id, v.data::text data, v.tipo, v.inadvertida, v.estrategia, i.codigo_sipni imunobiologico, d.codigo_sipni dose, coalesce(l.lote, v.lote_texto) lote,
              coalesce(fb.codigo_sipni, '') produtor, u.cnes, (select pp.cns from cad.pessoa pp where pp.id = pr.pessoa_id) cns_profissional, p.cns, p.cpf, p.nome, p.data_nascimento::text nascimento, p.sexo, p.raca_cor, p.nome_mae,
              (select m.codigo_ibge from cad.municipio m where m.id = p.municipio_id) municipio, v.gestante, v.via, v.local_aplicacao
         from imu.vacinacao v join cad.pessoa p on p.id = v.paciente_id join imu.imunobiologico i on i.id = v.imunobiologico_id left join imu.dose d on d.id = v.dose_id
         left join far.estoque_lote l on l.id = v.lote_id left join far.fabricante fb on fb.id = coalesce(v.fabricante_id, l.fabricante_id)
         left join cad.unidade u on u.id = v.unidade_id left join cad.profissional pr on pr.id = v.profissional_id
        where v.tipo in ('APLICACAO','RESGATE') and v.data between $1 and $2 and ($3::bigint is null or v.unidade_id = $3) order by v.data`,
      [de, ate, q.unidadeId ? Number(q.unidadeId) : null],
    );
    if (tipo === 'vacinados') {
      const vistos = new Map<string, any>();
      for (const r of regs) vistos.set(r.cns ?? r.cpf ?? r.nome, r);
      const csv = ['CNS;CPF;NOME;NASCIMENTO;SEXO;RACA_COR;NOME_MAE;MUNICIPIO_IBGE', ...[...vistos.values()].map((r) => [r.cns ?? '', r.cpf ?? '', r.nome, r.nascimento, r.sexo, r.raca_cor ?? '', r.nome_mae ?? '', r.municipio ?? ''].join(';'))].join('\r\n');
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="sipni_vacinados_${de}_${ate}.csv"`).send(csv);
    }
    // Registro de Imunobiológico Administrado no padrão FHIR R4 da RNDS (Immunization).
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: new Date().toISOString(),
      entry: regs.map((r) => ({
        fullUrl: `urn:uuid:vacinacao-${r.id}`,
        resource: {
          resourceType: 'Immunization',
          meta: { profile: ['http://www.saude.gov.br/fhir/r4/StructureDefinition/BRImunobiologicoAdministrado-2.0'] },
          status: 'completed',
          primarySource: r.tipo === 'APLICACAO',
          reportOrigin: r.tipo === 'RESGATE' ? { coding: [{ code: 'RESGATE' }] } : undefined,
          vaccineCode: { coding: [{ system: 'http://www.saude.gov.br/fhir/r4/CodeSystem/BRImunobiologico', code: r.imunobiologico }] },
          patient: { identifier: { system: r.cns ? 'http://www.saude.gov.br/fhir/r4/NamingSystem/cns' : 'http://www.saude.gov.br/fhir/r4/NamingSystem/cpf', value: r.cns ?? r.cpf } },
          occurrenceDateTime: r.data,
          lotNumber: r.lote,
          manufacturer: r.produtor ? { identifier: { value: r.produtor } } : undefined,
          performer: [{ actor: { identifier: { system: 'http://www.saude.gov.br/fhir/r4/NamingSystem/cnes', value: r.cnes ?? cnesPadrao } } }, ...(r.cns_profissional ? [{ actor: { identifier: { system: 'http://www.saude.gov.br/fhir/r4/NamingSystem/cns', value: r.cns_profissional } } }] : [])],
          protocolApplied: [{ doseNumberString: r.dose ?? '', series: r.estrategia }],
          route: r.via ? { coding: [{ code: r.via }] } : undefined,
          site: r.local_aplicacao ? { coding: [{ code: r.local_aplicacao }] } : undefined,
          extension: r.inadvertida ? [{ url: 'http://www.saude.gov.br/fhir/r4/StructureDefinition/BRAplicacaoInadvertida', valueBoolean: true }] : undefined,
        },
      })),
    };
    await transacao(contextoDe(req, 'sipni:exportacao'), (c) => c.query(`update imu.vacinacao set exportado_sipni_em = now() where id = any($1)`, [regs.map((r) => r.id)]));
    return reply.header('content-type', 'application/fhir+json').header('content-disposition', `attachment; filename="sipni_registros_${de}_${ate}.json"`).send(JSON.stringify(bundle, null, 1));
  });
}
