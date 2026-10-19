import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { emitirTabela } from '../../servicos/relatorios.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario, temPermissao } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { CLASSIFICACAO_CHAMADO, SLA_CHAMADO } from './entidades.js';

registrarPermissao('suporte_atendimento', 'Atendimento de chamados (equipe da contratada)', 'TEC', ['executar']);

/** Horas de expediente do órgão entre duas datas, excluindo fins de semana e feriados (TR 1.1.1.76). */
export async function horasUteis(inicio: Date, fim: Date): Promise<number> {
  const exp = await parametro<{ inicio: string; fim: string }>('suporte.expediente', { inicio: '08:00', fim: '17:00' });
  const feriados = new Set(
    (await consultar(`select data::text d from cad.feriado where unidade_id is null and data between $1::date and $2::date`, [inicio, fim])).map((r) => r.d),
  );
  const [hi, mi] = exp.inicio.split(':').map(Number);
  const [hf, mf] = exp.fim.split(':').map(Number);
  let total = 0;
  const dia = new Date(inicio);
  dia.setHours(0, 0, 0, 0);
  while (dia <= fim) {
    const iso = dia.toISOString().slice(0, 10);
    if (dia.getDay() !== 0 && dia.getDay() !== 6 && !feriados.has(iso)) {
      const a = new Date(dia);
      a.setHours(hi, mi, 0, 0);
      const b = new Date(dia);
      b.setHours(hf, mf, 0, 0);
      const ini = Math.max(a.getTime(), inicio.getTime());
      const f = Math.min(b.getTime(), fim.getTime());
      if (f > ini) total += (f - ini) / 3_600_000;
    }
    dia.setDate(dia.getDate() + 1);
  }
  return Math.round(total * 100) / 100;
}

export async function rotasSuporte(app: FastifyInstance) {
  app.post('/api/suporte/chamados', async (req) => {
    const u = exigirUsuario(req);
    const c = z
      .object({ titulo: z.string().min(3).max(150), texto: z.string().min(1), modulo: z.string().max(60).optional(), classificacao: z.string().optional() })
      .parse(req.body);
    return transacao(contextoDe(req, 'suporte'), async (cli) => {
      const seq = (await cli.query(`select count(*)::int + 1 n from sis.chamado where extract(year from aberto_em) = extract(year from now())`)).rows[0].n;
      const protocolo = `${new Date().getFullYear()}${String(seq).padStart(6, '0')}`;
      const classificacao = CLASSIFICACAO_CHAMADO.some(([k]) => k === c.classificacao) ? c.classificacao : 'CHAMADO_PLATAFORMA';
      const ch = (
        await cli.query(
          `insert into sis.chamado (protocolo, operador_id, unidade_id, titulo, classificacao, modulo, situacao, aberto_em)
           values ($1,$2,$3,$4,$5,$6,'ABERTO',now()) returning *`,
          [protocolo, u.id, u.unidadeAtual, c.titulo, classificacao, c.modulo ?? null],
        )
      ).rows[0];
      await cli.query(`insert into sis.chamado_mensagem (chamado_id, autor_id, suporte, texto) values ($1,$2,false,$3)`, [ch.id, u.id, c.texto]);
      return ch;
    });
  });

  app.get('/api/suporte/meus-chamados', async (req) => {
    const u = exigirUsuario(req);
    const todos = temPermissao(u, 'suporte_atendimento:executar') && (req.query as any).todos;
    return consultar(
      `select c.*, coalesce(o.nome, o.login) as solicitante,
              (select count(*)::int from sis.chamado_mensagem m where m.chamado_id = c.id) as mensagens
         from sis.chamado c left join seg.operador o on o.id = c.operador_id
        where ($1::boolean or c.operador_id = $2) order by c.id desc limit 100`,
      [!!todos, u.id],
    );
  });

  async function chamadoAcessivel(id: number, u: ReturnType<typeof exigirUsuario>) {
    const ch = await consultarUm(`select * from sis.chamado where id = $1`, [id]);
    if (!ch) throw new ErroHttp(404, 'Chamado não encontrado.');
    if (ch.operador_id !== u.id && !temPermissao(u, 'suporte_atendimento:executar') && !temPermissao(u, 'chamado:consultar'))
      throw new ErroHttp(403, 'Chamado de outro operador.');
    return ch;
  }

  app.get('/api/suporte/chamados/:id/mensagens', async (req) => {
    const u = exigirUsuario(req);
    const ch = await chamadoAcessivel(Number((req.params as any).id), u);
    const mensagens = await consultar(
      `select m.id, m.texto, m.suporte, m.criado_em, m.anexo_id, coalesce(o.nome, o.login) as autor
         from sis.chamado_mensagem m left join seg.operador o on o.id = m.autor_id where m.chamado_id = $1 order by m.id`,
      [ch.id],
    );
    return { chamado: ch, mensagens };
  });

  app.post('/api/suporte/chamados/:id/mensagens', async (req) => {
    const u = exigirUsuario(req);
    const ch = await chamadoAcessivel(Number((req.params as any).id), u);
    const { texto, anexoId } = z.object({ texto: z.string().min(1), anexoId: z.string().uuid().optional() }).parse(req.body);
    const suporte = temPermissao(u, 'suporte_atendimento:executar') && ch.operador_id !== u.id;
    await transacao(contextoDe(req, 'suporte'), async (c) => {
      await c.query(`insert into sis.chamado_mensagem (chamado_id, autor_id, suporte, texto, anexo_id) values ($1,$2,$3,$4,$5)`, [
        ch.id,
        u.id,
        suporte,
        texto,
        anexoId ?? null,
      ]);
      if (suporte) {
        await c.query(
          `update sis.chamado set primeira_resposta_em = coalesce(primeira_resposta_em, now()),
                  situacao = case when situacao = 'ABERTO' then 'EM_ATENDIMENTO' else situacao end where id = $1`,
          [ch.id],
        );
      } else if (ch.situacao === 'AGUARDANDO_SOLICITANTE') {
        await c.query(`update sis.chamado set situacao = 'EM_ATENDIMENTO' where id = $1`, [ch.id]);
      }
    });
    return { ok: true };
  });

  app.post('/api/suporte/chamados/:id/encerrar', async (req) => {
    const u = exigirUsuario(req);
    const ch = await chamadoAcessivel(Number((req.params as any).id), u);
    const { solucao, causaExterna } = z.object({ solucao: z.string().min(1), causaExterna: z.boolean().default(false) }).parse(req.body);
    const fim = new Date();
    const horas = await horasUteis(new Date(ch.aberto_em), fim);
    await transacao(contextoDe(req, 'suporte'), (c) =>
      c.query(
        `update sis.chamado set situacao = 'RESOLVIDO', encerrado_em = $2, horas_uteis_reparo = $3, solucao = $4, causa_externa = $5 where id = $1`,
        [ch.id, fim, horas, solucao, causaExterna],
      ),
    );
    return { ok: true, horasUteis: horas };
  });

  // Relatório mensal de chamados e cálculo do MTtR por classificação (TR 1.1.1.75, 1.1.1.78, 1.1.1.79).
  app.get('/api/suporte/mttr', async (req, reply) => {
    const u = exigirPermissao(req, 'chamado:consultar');
    const q = req.query as any;
    const competencia = String(q.competencia ?? new Date().toISOString().slice(0, 7));
    const linhas = await consultar(
      `select classificacao, count(*)::int as ocorrencias, coalesce(sum(horas_uteis_reparo), 0)::float as horas
         from sis.chamado
        where encerrado_em is not null and not causa_externa and to_char(encerrado_em, 'YYYY-MM') <= $1
          and to_char(encerrado_em, 'YYYY') = substr($1, 1, 4)
        group by classificacao`,
      [competencia],
    );
    const resultado = CLASSIFICACAO_CHAMADO.map(([k, rotulo]) => {
      const l = linhas.find((x) => x.classificacao === k);
      const mttr = l && l.ocorrencias ? l.horas / l.ocorrencias : 0;
      const sla = SLA_CHAMADO[k];
      return {
        classificacao: rotulo,
        ocorrencias: l?.ocorrencias ?? 0,
        horas: l?.horas ?? 0,
        mttr: Math.round(mttr * 100) / 100,
        limite: sla.horas,
        cumprido: mttr <= sla.horas,
        desconto_percentual: mttr > sla.horas ? sla.multa : 0,
      };
    });
    const chamados = await consultar(
      `select c.protocolo, c.titulo, c.classificacao, c.aberto_em, c.encerrado_em, c.horas_uteis_reparo, c.causa_externa, coalesce(o.nome, o.login) solicitante
         from sis.chamado c left join seg.operador o on o.id = c.operador_id
        where to_char(c.aberto_em, 'YYYY-MM') = $1 order by c.aberto_em`,
      [competencia],
    );
    if (q.formato) {
      const r = await emitirTabela(
        { relatorio: 'suporte:chamados', titulo: `Relatório de chamados - ${competencia}`, formato: q.formato, filtros: { competencia }, orientacao: 'landscape' },
        {
          titulo: `Relatório de chamados - competência ${competencia}`,
          colunas: [
            { campo: 'protocolo', titulo: 'Protocolo' },
            { campo: 'titulo', titulo: 'Assunto' },
            { campo: 'solicitante', titulo: 'Solicitante' },
            { campo: 'classificacao', titulo: 'Classificação' },
            { campo: 'aberto_em', titulo: 'Abertura', formato: 'data_hora' },
            { campo: 'encerrado_em', titulo: 'Encerramento', formato: 'data_hora' },
            { campo: 'horas_uteis_reparo', titulo: 'Horas úteis', formato: 'decimal', total: true },
          ],
          linhas: chamados,
        },
        u,
      );
      return reply.header('content-type', r.mime).header('content-disposition', `attachment; filename="${r.nome}"`).send(r.conteudo);
    }
    return { competencia, indicadores: resultado, chamados };
  });
}
