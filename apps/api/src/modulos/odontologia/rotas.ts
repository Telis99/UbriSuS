// Rotas do prontuário odontológico (TR 1.2.34): fila odontológica, odontograma interativo,
// plano de tratamento, Ficha de Atendimento Odontológico (FAO), vigilância em saúde bucal,
// fornecimento de material, anamnese, notificação de agravos, receita odontológica e documentos.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idadeDetalhada, idadeTexto } from '../../compartilhado/validacao.js';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario, registrarRotina, temPermissao } from '../../seguranca/usuario.js';
import { gerarAlertas, parametro } from '../cadastros/alertas.js';
import { PRIORIDADE_RISCO, proximaSenha } from '../atendimento/servico.js';
import { agendar } from '../agendamento/servico.js';
import { baixarFefo } from '../farmacia/servico.js';
import { CONDUTAS, MATERIAIS_ODONTO, TIPOS_ATENDIMENTO_SIA, TIPOS_CONSULTA, VIGILANCIA_SAUDE_BUCAL } from './entidades.js';
import {
  cancelarMarcacao,
  estadoOdontograma,
  executarMarcacao,
  indicesCpo,
  itensSigtap,
  marcacoesPaciente,
  registrarMarcacoes,
  validarItens,
} from './servico.js';
import './relatorios.js';

registrarPermissao('odontologia', 'Prontuário odontológico (odontograma, plano de tratamento, FAO)', 'ODO', ['consultar', 'executar']);
registrarPermissao('odontologia_receita', 'Configuração da impressão das receitas odontológicas', 'TEC', ['alterar']);

const fmt = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');
const fmtData = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');
const rotuloDe = (lista: [string, string][], v?: string | null) => lista.find(([k]) => k === v)?.[1] ?? v ?? '-';

export interface ConfigReceitaOdonto {
  cabecalho: boolean;
  rodape: boolean;
  logoSus: boolean;
  duasViasMesmaPagina: boolean;
  duasViasSimples: boolean;
  duasViasOutros: boolean;
  textoCabecalho: string;
}
export const CONFIG_RECEITA_PADRAO: ConfigReceitaOdonto = {
  cabecalho: true,
  rodape: true,
  logoSus: true,
  duasViasMesmaPagina: false,
  duasViasSimples: false,
  duasViasOutros: false,
  textoCabecalho: '',
};

const LOGO_SUS = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44" viewBox="0 0 120 44">
  <rect x="0" y="0" width="120" height="44" rx="6" fill="#ffffff" stroke="#00529b" stroke-width="2"/>
  <text x="60" y="27" font-family="Helvetica" font-size="24" font-weight="bold" fill="#00529b" text-anchor="middle">SUS</text>
  <text x="60" y="39" font-family="Helvetica" font-size="7" fill="#00529b" text-anchor="middle">Sistema Único de Saúde</text>
</svg>`;

async function pacienteCabecalho(pacienteId: number, unidadeId: number | null) {
  return consultarUm(
    `select p.id, p.nome, p.nome_social, p.data_nascimento::text nascimento, p.sexo, p.cns, p.cpf, p.nome_mae, p.nome_pai, p.foto_id, p.condicoes_saude,
            m.nome municipio, coalesce((select numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id and pp.unidade_id = $2), p.prontuario) prontuario,
            (select concat_ws(' ', l.tipo_abreviatura, l.nome) || ', ' || coalesce(p.numero, 's/n') from cad.logradouro l where l.id = p.logradouro_id) endereco,
            (select coalesce(json_agg(json_build_object('substancia', a.substancia, 'gravidade', a.gravidade)), '[]') from cad.pessoa_alergia a where a.pessoa_id = p.id) alergias
       from cad.pessoa p left join cad.municipio m on m.id = p.municipio_id where p.id = $1`,
    [pacienteId, unidadeId],
  );
}

async function atendimentoDetalhe(id: number) {
  const at = await consultarUm(
    `select a.*, u.nome unidade, u.cnes, pr.nome profissional, pr.conselho, pr.registro_conselho, pr.uf_conselho, e.nome especialidade,
            c.codigo cid_codigo, c.nome cid_nome, ci.codigo ciap_codigo, ci.nome ciap_nome, f.nome fila, f.tipo fila_tipo,
            (select cb.codigo || ' - ' || cb.nome from cad.vinculo v join cad.cbo cb on cb.id = v.cbo_id where v.profissional_id = a.profissional_id and v.ativo order by (v.unidade_id = a.unidade_id) desc limit 1) cbo
       from amb.atendimento a left join cad.unidade u on u.id = a.unidade_id left join cad.profissional pr on pr.id = a.profissional_id
       left join cad.especialidade e on e.id = a.especialidade_id left join cad.cid c on c.id = a.cid_id left join cad.ciap ci on ci.id = a.ciap_id
       left join amb.fila f on f.id = a.fila_id where a.id = $1`,
    [id],
  );
  if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
  return at;
}

/** Odontograma, evolução, índices e planos do paciente. */
async function odontogramaCompleto(pacienteId: number) {
  const marcacoes = await marcacoesPaciente((await import('../../db/pool.js')).pool, pacienteId);
  const estado = estadoOdontograma(marcacoes);
  const planos = await consultar(
    `select p.*, p.data_inicio::text inicio, p.data_conclusao::text conclusao, pr.nome profissional, u.nome unidade,
            (select coalesce(json_agg(e order by e.ordem), '[]') from (select e.*, e.concluida_em::text concluida,
               (select count(*) from odo.marcacao m where m.etapa_id = e.id and m.status = 'PLANEJADO')::int pendentes,
               (select count(*) from odo.marcacao m where m.etapa_id = e.id and m.status = 'EXECUTADO')::int executados
               from odo.plano_etapa e where e.plano_id = p.id) e) etapas
       from odo.plano_tratamento p left join cad.profissional pr on pr.id = p.profissional_id left join cad.unidade u on u.id = p.unidade_id
      where p.paciente_id = $1 order by p.data_inicio desc, p.id desc`,
    [pacienteId],
  );
  return { marcacoes, estado: Object.values(estado), indices: indicesCpo(estado), planos };
}

async function gravarAtendimentoOdonto(c: import('pg').PoolClient, atendimentoId: number, pacienteId: number, campos: Record<string, unknown>) {
  const nomes = Object.keys(campos).filter((k) => campos[k] !== undefined);
  await c.query(`insert into odo.atendimento_odonto (atendimento_id, paciente_id) values ($1,$2) on conflict (atendimento_id) do nothing`, [atendimentoId, pacienteId]);
  if (nomes.length)
    await c.query(`update odo.atendimento_odonto set ${nomes.map((n, i) => `${n} = $${i + 2}`).join(', ')} where atendimento_id = $1`, [atendimentoId, ...nomes.map((n) => campos[n])]);
}

export default async function rotasOdontologia(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // Tabelas de apoio do odontograma
  // ---------------------------------------------------------------------------
  app.get('/api/odontologia/configuracao', async (req) => {
    exigirUsuario(req);
    const [faces, situacoes, procedimentos, grupos] = await Promise.all([
      consultar(`select codigo, nome from odo.face where ativo order by ordem`),
      consultar(`select id, codigo, nome, abrangencia, cor, simbolo, componente_cpo, necessita_tratamento from odo.situacao where ativo order by ordem, nome`),
      consultar(
        `select p.id, p.nome, p.marcacao, p.denticao, p.cor, p.situacao_resultante_id,
                (select coalesce(json_agg(json_build_object('codigo', sp.codigo, 'nome', sp.nome, 'aplicaA', i.aplica_a, 'quantidade', i.quantidade, 'porElemento', i.por_elemento) order by i.id), '[]')
                   from odo.procedimento_item i join cad.procedimento sp on sp.id = i.procedimento_id where i.procedimento_odonto_id = p.id) itens
           from odo.procedimento p where p.ativo order by p.ordem, p.nome`,
      ),
      consultar(`select id, codigo, nome from odo.grupo_atendimento where ativo order by codigo`),
    ]);
    return {
      faces,
      situacoes,
      procedimentos,
      grupos,
      tiposConsulta: TIPOS_CONSULTA,
      tiposAtendimento: TIPOS_ATENDIMENTO_SIA,
      vigilancia: VIGILANCIA_SAUDE_BUCAL,
      materiais: MATERIAIS_ODONTO,
      condutas: CONDUTAS,
      atualizacaoFilaSegundos: await parametro<number>('odontologia.fila_atualizacao_segundos', 30),
    };
  });

  // ---------------------------------------------------------------------------
  // Fila odontológica (TR 1.2.34.2 a 1.2.34.11): a lista usa /api/atendimentos/fila (destaque < 2 e > 60 anos,
  // ordenação por data, hora ou idade, busca por nome, filtros atendidos/não atendidos), a chamada no painel e o não atendimento.
  // ---------------------------------------------------------------------------
  app.get('/api/odontologia/filas', async (req) => {
    const u = exigirUsuario(req);
    const unidadeId = Number((req.query as any).unidadeId ?? u.unidadeAtual);
    return consultar(`select id, nome, prefixo_senha from amb.fila where unidade_id = $1 and tipo = 'ODONTOLOGIA' and ativo order by nome`, [unidadeId]);
  });

  // Inclusão do paciente na fila odontológica com classificação de prioridade (TR 1.2.34.2).
  app.post('/api/odontologia/fila', async (req, reply) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const b = z.object({ pacienteId: z.number(), filaId: z.number(), prioridade: z.string().optional(), motivo: z.string().optional(), queixa: z.string().optional() }).parse(req.body);
    const unidadeId = u.unidadeAtual;
    if (!unidadeId) throw new ErroHttp(422, 'Selecione a unidade de trabalho.');
    const bloqueios = (await gerarAlertas(b.pacienteId, { usuario: u, unidadeId })).filter((a) => a.bloqueante);
    if (bloqueios.length) throw new ErroHttp(422, bloqueios.map((a) => a.mensagem).join(' '), { alertas: bloqueios });
    const at = await transacao(contextoDe(req, 'odontologia:fila'), async (c) => {
      const fila = (await c.query(`select * from amb.fila where id = $1 and unidade_id = $2`, [b.filaId, unidadeId])).rows[0];
      if (!fila) throw new ErroHttp(404, 'Fila não encontrada na unidade de trabalho.');
      const aberto = (
        await c.query(
          `select id from amb.atendimento where paciente_id = $1 and unidade_id = $2 and situacao in ('AGUARDANDO_TRIAGEM','AGUARDANDO','CHAMADO','EM_ATENDIMENTO') and entrada_em::date = current_date`,
          [b.pacienteId, unidadeId],
        )
      ).rows[0];
      if (aberto) throw new ErroHttp(409, 'O paciente já está em uma fila de atendimento desta unidade.', { atendimentoId: aberto.id });
      const senha = await proximaSenha(c, unidadeId, fila.prefixo_senha ?? 'O');
      const esp = (
        await c.query(
          `select e.id from cad.vinculo v join cad.especialidade e on e.cbo_id = v.cbo_id where v.profissional_id = $1 and v.ativo and e.tipo = 'ODONTOLOGICA' order by (v.unidade_id = $2) desc limit 1`,
          [u.profissionalId ?? -1, unidadeId],
        )
      ).rows[0];
      return (
        await c.query(
          `insert into amb.atendimento (paciente_id, unidade_id, fila_id, senha, entrada_em, situacao, especialidade_id, recepcionista_id, motivo, queixa, pre_classificacao, prioridade, tipo_unidade, tipo_atendimento_sia)
           values ($1,$2,$3,$4,now(),'AGUARDANDO',$5,$6,$7,$8,$9,$10,'ODONTOLOGIA','02') returning *`,
          [b.pacienteId, unidadeId, fila.id, senha, esp?.id ?? null, u.id, b.motivo ?? null, b.queixa ?? null, b.prioridade ?? null, PRIORIDADE_RISCO[b.prioridade ?? ''] ?? 9],
        )
      ).rows[0];
    });
    return reply.status(201).send(at);
  });

  // Registro do atendimento odontológico a partir de um paciente da lista (TR 1.2.34.11).
  app.post('/api/odontologia/fila/:id/iniciar', async (req) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const id = Number((req.params as any).id);
    await transacao(contextoDe(req, 'odontologia:iniciar'), async (c) => {
      const at = (await c.query(`select * from amb.atendimento where id = $1 for update`, [id])).rows[0];
      if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
      if (['FINALIZADO', 'CANCELADO', 'NAO_ATENDIDO', 'EVADIDO'].includes(at.situacao)) throw new ErroHttp(409, 'Atendimento já encerrado.');
      await c.query(
        `update amb.atendimento set situacao = 'EM_ATENDIMENTO', inicio_em = coalesce(inicio_em, now()), profissional_id = coalesce(profissional_id, $2), tipo_unidade = 'ODONTOLOGIA' where id = $1`,
        [id, u.profissionalId],
      );
      await gravarAtendimentoOdonto(c, id, at.paciente_id, {});
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Odontograma (TR 1.2.34.26 a 1.2.34.30)
  // ---------------------------------------------------------------------------
  app.get('/api/odontologia/pacientes/:id/odontograma', async (req) => {
    exigirPermissao(req, 'odontologia:consultar');
    const id = Number((req.params as any).id);
    await registrarRotina(req, 'odontologia', 'odontograma', { paciente: id });
    return odontogramaCompleto(id);
  });

  // Prévia dos procedimentos SIGTAP gerados pelo procedimento odontológico no dente (TR 1.2.34.29, 1.2.34.30).
  app.get('/api/odontologia/procedimentos/:id/sigtap', async (req) => {
    const u = exigirUsuario(req);
    const q = req.query as any;
    const dentes: number[] = q.dentes ? String(q.dentes).split(',').map(Number).filter(Boolean) : [];
    const { pool } = await import('../../db/pool.js');
    const elementos = Number(q.elementos ?? 1);
    const itens = dentes.length
      ? (await Promise.all(dentes.map((d) => itensSigtap(pool, Number((req.params as any).id), { dente: d, elementos: 1 })))).flat()
      : await itensSigtap(pool, Number((req.params as any).id), { dente: null, elementos });
    const agrupados = new Map<string, (typeof itens)[number]>();
    for (const i of itens) {
      const a = agrupados.get(i.codigo);
      agrupados.set(i.codigo, a ? { ...a, quantidade: a.quantidade + i.quantidade } : { ...i });
    }
    const lista = [...agrupados.values()];
    const criticas = q.pacienteId ? await validarItens(pool, lista, Number(q.pacienteId), u.profissionalId, u.unidadeAtual) : [];
    return { itens: lista, criticas };
  });

  app.post('/api/odontologia/marcacoes', async (req) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const b = z
      .object({
        pacienteId: z.number(),
        atendimentoId: z.number().nullish(),
        planoId: z.number().nullish(),
        etapaId: z.number().nullish(),
        marcacao: z.enum(['DENTE', 'FACE', 'ARCADA', 'QUADRANTE', 'SEXTANTE', 'BOCA']),
        dentes: z.array(z.number()).optional(),
        faces: z.array(z.enum(['M', 'D', 'O', 'V', 'L'])).optional(),
        arcada: z.string().nullish(),
        quadrante: z.number().nullish(),
        sextante: z.number().nullish(),
        denticao: z.string().optional(),
        situacaoId: z.number().nullish(),
        procedimentoOdontoId: z.number().nullish(),
        status: z.enum(['EXISTENTE', 'PLANEJADO', 'EXECUTADO']),
        observacao: z.string().nullish(),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'odontologia:marcacao'), (c) => registrarMarcacoes(c, b, u));
  });

  app.post('/api/odontologia/marcacoes/:id/executar', async (req) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const { atendimentoId } = z.object({ atendimentoId: z.number() }).parse(req.body);
    return transacao(contextoDe(req, 'odontologia:executar'), (c) => executarMarcacao(c, Number((req.params as any).id), atendimentoId, u));
  });

  app.post('/api/odontologia/marcacoes/:id/cancelar', async (req) => {
    exigirPermissao(req, 'odontologia:executar');
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    return transacao(contextoDe(req, 'odontologia:cancelar'), (c) => cancelarMarcacao(c, Number((req.params as any).id), motivo));
  });

  // ---------------------------------------------------------------------------
  // Plano de tratamento e tratamento concluído
  // ---------------------------------------------------------------------------
  app.post('/api/odontologia/planos', async (req, reply) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const b = z
      .object({ pacienteId: z.number(), atendimentoId: z.number().nullish(), primeiraConsulta: z.boolean().default(false), observacao: z.string().nullish(), etapas: z.array(z.string().min(1)).default([]) })
      .parse(req.body);
    const plano = await transacao(contextoDe(req, 'odontologia:plano'), async (c) => {
      const aberto = (await c.query(`select id from odo.plano_tratamento where paciente_id = $1 and situacao = 'EM_ANDAMENTO'`, [b.pacienteId])).rows[0];
      if (aberto) throw new ErroHttp(409, 'O paciente já possui um plano de tratamento em andamento. Conclua ou interrompa o plano atual.', { planoId: aberto.id });
      const at = b.atendimentoId ? (await c.query(`select * from amb.atendimento where id = $1`, [b.atendimentoId])).rows[0] : null;
      const p = (
        await c.query(
          `insert into odo.plano_tratamento (paciente_id, unidade_id, profissional_id, atendimento_id, data_inicio, primeira_consulta, situacao, observacao)
           values ($1,$2,$3,$4,current_date,$5,'EM_ANDAMENTO',$6) returning *`,
          [b.pacienteId, at?.unidade_id ?? u.unidadeAtual, u.profissionalId, at?.id ?? null, b.primeiraConsulta, b.observacao ?? null],
        )
      ).rows[0];
      for (const [i, d] of b.etapas.entries()) await c.query(`insert into odo.plano_etapa (plano_id, ordem, descricao, situacao) values ($1,$2,$3,'PENDENTE')`, [p.id, i + 1, d]);
      // Primeira consulta odontológica programática registrada na FAO do atendimento.
      if (at && b.primeiraConsulta) await gravarAtendimentoOdonto(c, at.id, at.paciente_id, { tipo_consulta: 'PRIMEIRA_PROGRAMATICA' });
      return p;
    });
    return reply.status(201).send(plano);
  });

  app.post('/api/odontologia/planos/:id/etapas', async (req) => {
    exigirPermissao(req, 'odontologia:executar');
    const { descricao } = z.object({ descricao: z.string().min(1) }).parse(req.body);
    const id = Number((req.params as any).id);
    return transacao(contextoDe(req, 'odontologia:plano'), async (c) => {
      const p = (await c.query(`select situacao from odo.plano_tratamento where id = $1`, [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'Plano não encontrado.');
      if (p.situacao !== 'EM_ANDAMENTO') throw new ErroHttp(409, 'O plano de tratamento não está em andamento.');
      return (
        await c.query(
          `insert into odo.plano_etapa (plano_id, ordem, descricao, situacao) values ($1, (select coalesce(max(ordem), 0) + 1 from odo.plano_etapa where plano_id = $1), $2, 'PENDENTE') returning *`,
          [id, descricao],
        )
      ).rows[0];
    });
  });

  app.post('/api/odontologia/etapas/:id/concluir', async (req) => {
    exigirPermissao(req, 'odontologia:executar');
    const id = Number((req.params as any).id);
    await transacao(contextoDe(req, 'odontologia:plano'), async (c) => {
      const pend = (await c.query(`select count(*)::int n from odo.marcacao where etapa_id = $1 and status = 'PLANEJADO'`, [id])).rows[0].n;
      if (pend) throw new ErroHttp(409, `A etapa possui ${pend} procedimento(s) planejado(s) ainda não executado(s).`);
      await c.query(`update odo.plano_etapa set situacao = 'CONCLUIDA', concluida_em = current_date where id = $1`, [id]);
    });
    return { ok: true };
  });

  // Tratamento concluído: encerra o plano e registra a conduta na FAO do atendimento.
  app.post('/api/odontologia/planos/:id/concluir', async (req) => {
    exigirPermissao(req, 'odontologia:executar');
    const id = Number((req.params as any).id);
    const b = z.object({ atendimentoId: z.number().nullish(), cancelarPendentes: z.boolean().default(false) }).parse(req.body ?? {});
    return transacao(contextoDe(req, 'odontologia:concluir-tratamento'), async (c) => {
      const p = (await c.query(`select * from odo.plano_tratamento where id = $1 for update`, [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'Plano não encontrado.');
      if (p.situacao !== 'EM_ANDAMENTO') throw new ErroHttp(409, 'O plano já foi encerrado.');
      const pend = (await c.query(`select count(*)::int n from odo.marcacao where plano_id = $1 and status = 'PLANEJADO'`, [id])).rows[0].n;
      if (pend && !b.cancelarPendentes)
        throw new ErroHttp(409, `O plano possui ${pend} procedimento(s) planejado(s) não executado(s). Ao concluir, eles serão cancelados.`, { exigeConfirmacao: true });
      if (pend) await c.query(`update odo.marcacao set status = 'CANCELADO', motivo_cancelamento = 'Tratamento concluído' where plano_id = $1 and status = 'PLANEJADO'`, [id]);
      await c.query(`update odo.plano_etapa set situacao = 'CONCLUIDA', concluida_em = coalesce(concluida_em, current_date) where plano_id = $1`, [id]);
      await c.query(`update odo.plano_tratamento set situacao = 'CONCLUIDO', data_conclusao = current_date, atendimento_conclusao_id = $2 where id = $1`, [id, b.atendimentoId ?? null]);
      if (b.atendimentoId) {
        const at = (await c.query(`select paciente_id from amb.atendimento where id = $1`, [b.atendimentoId])).rows[0];
        if (at) {
          await gravarAtendimentoOdonto(c, b.atendimentoId, at.paciente_id, {});
          await c.query(
            `update odo.atendimento_odonto set condutas = (select array(select distinct x from unnest(coalesce(condutas, '{}') || array['TRATAMENTO_CONCLUIDO']) x)) where atendimento_id = $1`,
            [b.atendimentoId],
          );
        }
      }
      return { ok: true };
    });
  });

  app.post('/api/odontologia/planos/:id/interromper', async (req) => {
    exigirPermissao(req, 'odontologia:executar');
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    const id = Number((req.params as any).id);
    await transacao(contextoDe(req, 'odontologia:plano'), async (c) => {
      const r = await c.query(`update odo.plano_tratamento set situacao = 'INTERROMPIDO', motivo_interrupcao = $2, data_conclusao = current_date where id = $1 and situacao = 'EM_ANDAMENTO'`, [id, motivo]);
      if (!r.rowCount) throw new ErroHttp(409, 'Plano inexistente ou já encerrado.');
      await c.query(`update odo.marcacao set status = 'CANCELADO', motivo_cancelamento = $2 where plano_id = $1 and status = 'PLANEJADO'`, [id, `Plano interrompido: ${motivo}`]);
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Registro do atendimento odontológico: FAO e-SUS, CID/CIAP, SIA, vigilância (TR 1.2.34.31 a 1.2.34.35)
  // ---------------------------------------------------------------------------
  app.get('/api/odontologia/atendimentos/:id', async (req) => {
    exigirPermissao(req, 'odontologia:consultar');
    const id = Number((req.params as any).id);
    const at = await atendimentoDetalhe(id);
    const odonto = await consultarUm(`select o.*, g.nome grupo_atendimento from odo.atendimento_odonto o left join odo.grupo_atendimento g on g.id = o.grupo_atendimento_id where o.atendimento_id = $1`, [id]);
    const cidsSecundarios = at.cids_secundarios?.length
      ? await consultar(`select id, codigo, nome from cad.cid where id = any($1::bigint[])`, [at.cids_secundarios])
      : [];
    const executados = await consultar(
      `select m.id, m.dente, m.faces, m.marcacao, m.arcada, m.quadrante, m.sextante, po.nome procedimento,
              (select coalesce(json_agg(pc.codigo || ' - ' || pc.nome || ' (' || fp.quantidade || ')'), '[]') from fat.producao fp join cad.procedimento pc on pc.id = fp.procedimento_id
                where fp.id in (select jsonb_array_elements_text(coalesce(m.producao, '[]'))::bigint)) sigtap
         from odo.marcacao m join odo.procedimento po on po.id = m.procedimento_odonto_id where m.executado_atendimento_id = $1 and m.status = 'EXECUTADO' order by m.id`,
      [id],
    );
    const prescricoes = await consultar(`select id, numero, tipo_receita, data::text data, situacao from amb.prescricao where atendimento_id = $1 order by id`, [id]);
    const notificacoes = await consultar(
      `select n.id, n.data_hora, n.situacao, c.codigo || ' - ' || c.nome agravo from amb.notificacao_agravo n join cad.cid c on c.id = n.cid_id where n.atendimento_id = $1 order by n.id`,
      [id],
    );
    return { atendimento: at, odonto, cidsSecundarios, executados, prescricoes, notificacoes };
  });

  app.put('/api/odontologia/atendimentos/:id', async (req) => {
    exigirPermissao(req, 'odontologia:executar');
    const id = Number((req.params as any).id);
    const b = z
      .object({
        tipoConsulta: z.string().nullish(),
        tipoAtendimentoSia: z.string().nullish(),
        grupoAtendimentoId: z.number().nullish(),
        denticao: z.string().nullish(),
        gestante: z.boolean().optional(),
        necessidadesEspeciais: z.boolean().optional(),
        condutas: z.array(z.string()).optional(),
        observacao: z.string().nullish(),
        cidId: z.number().nullish(),
        cidsSecundarios: z.array(z.number()).optional(),
        ciapId: z.number().nullish(),
        vigilancia: z.array(z.string()).optional(),
      })
      .parse(req.body);
    const vigInvalida = (b.vigilancia ?? []).filter((v) => !VIGILANCIA_SAUDE_BUCAL.some(([k]) => k === v));
    if (vigInvalida.length) throw new ErroHttp(422, `Opção de vigilância em saúde bucal inválida: ${vigInvalida.join(', ')}.`);
    if (b.tipoConsulta && !TIPOS_CONSULTA.some(([k]) => k === b.tipoConsulta)) throw new ErroHttp(422, 'Tipo de consulta inválido.');
    if (b.tipoAtendimentoSia && !TIPOS_ATENDIMENTO_SIA.some(([k]) => k === b.tipoAtendimentoSia)) throw new ErroHttp(422, 'Tipo de atendimento inválido.');
    await transacao(contextoDe(req, 'odontologia:fao'), async (c) => {
      const at = (await c.query(`select * from amb.atendimento where id = $1 for update`, [id])).rows[0];
      if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
      if (['FINALIZADO', 'CANCELADO', 'NAO_ATENDIDO', 'EVADIDO'].includes(at.situacao)) throw new ErroHttp(409, 'O atendimento já foi encerrado.');
      if (b.cidId && b.cidsSecundarios?.includes(b.cidId)) throw new ErroHttp(422, 'O CID principal não pode ser repetido como secundário.');
      // CID principal e secundários, CIAP, tipo de atendimento SIA e vigilância em saúde bucal (TR 1.2.34.31 a 1.2.34.35).
      const sets: string[] = [];
      const vals: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        if (v === undefined) return;
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      set('cid_id', b.cidId);
      set('ciap_id', b.ciapId);
      set('cids_secundarios', b.cidsSecundarios === undefined ? undefined : JSON.stringify(b.cidsSecundarios));
      set('tipo_atendimento_sia', b.tipoAtendimentoSia);
      set('saude_bucal', b.vigilancia);
      set('tipo_unidade', 'ODONTOLOGIA');
      // Fotografia do odontograma no atendimento (estado e índices na data do registro).
      const od = estadoOdontograma(await marcacoesPaciente(c, at.paciente_id));
      set('odontograma', JSON.stringify({ data: new Date().toISOString(), estado: Object.values(od), indices: indicesCpo(od) }));
      await c.query(`update amb.atendimento set ${sets.join(', ')} where id = $1`, vals);
      await gravarAtendimentoOdonto(c, id, at.paciente_id, {
        tipo_consulta: b.tipoConsulta,
        grupo_atendimento_id: b.grupoAtendimentoId,
        denticao: b.denticao,
        gestante: b.gestante,
        necessidades_especiais: b.necessidadesEspeciais,
        condutas: b.condutas,
        observacao: b.observacao,
      });
    });
    return { ok: true };
  });

  // Fornecimento de material odontológico com baixa no estoque da unidade (TR 1.2.34.36, 1.2.34.37).
  app.post('/api/odontologia/atendimentos/:id/materiais', async (req) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const id = Number((req.params as any).id);
    const b = z.object({ ESCOVA: z.number().int().min(0).default(0), CREME: z.number().int().min(0).default(0), FIO: z.number().int().min(0).default(0) }).parse(req.body);
    if (!b.ESCOVA && !b.CREME && !b.FIO) throw new ErroHttp(422, 'Informe a quantidade de ao menos um material.');
    const produtos = await parametro<Record<string, number | null>>('odontologia.materiais_produtos', {});
    const baixar = await parametro<boolean>('odontologia.baixar_estoque_materiais', true);
    return transacao(contextoDe(req, 'odontologia:materiais'), async (c) => {
      const at = (await c.query(`select * from amb.atendimento where id = $1 for update`, [id])).rows[0];
      if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
      if (['FINALIZADO', 'CANCELADO', 'NAO_ATENDIDO', 'EVADIDO'].includes(at.situacao)) throw new ErroHttp(409, 'O atendimento já foi encerrado.');
      const atual: Record<string, number> = at.material_odonto ?? {};
      const avisos: string[] = [];
      const baixas: any[] = [];
      for (const [k, rotulo] of MATERIAIS_ODONTO) {
        const qtd = (b as any)[k] as number;
        if (!qtd) continue;
        atual[k] = (atual[k] ?? 0) + qtd;
        const produtoId = produtos?.[k];
        if (!baixar || !produtoId) continue;
        try {
          await c.query('savepoint baixa_material');
          const usados = await baixarFefo(c, { unidadeId: at.unidade_id, produtoId, quantidade: qtd, tipo: 'DISPENSACAO', pacienteId: at.paciente_id, documento: `ATENDIMENTO ${at.id}`, operadorId: u.id });
          baixas.push({ material: k, produtoId, quantidade: qtd, lotes: usados, em: new Date().toISOString() });
          await c.query('release savepoint baixa_material');
        } catch (e) {
          await c.query('rollback to savepoint baixa_material');
          avisos.push(`${rotulo}: registrado sem baixa de estoque (${(e as Error).message})`);
        }
      }
      await c.query(`update amb.atendimento set material_odonto = $2 where id = $1`, [id, JSON.stringify(atual)]);
      await gravarAtendimentoOdonto(c, id, at.paciente_id, {});
      if (baixas.length)
        await c.query(`update odo.atendimento_odonto set materiais_baixados = coalesce(materiais_baixados, '[]') || $2::jsonb where atendimento_id = $1`, [id, JSON.stringify(baixas)]);
      return { materiais: atual, baixas, avisos };
    });
  });

  // Agendamento do retorno do paciente ao término do atendimento odontológico (TR 1.2.34.66).
  app.get('/api/odontologia/atendimentos/:id/retorno', async (req) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const at = await atendimentoDetalhe(Number((req.params as any).id));
    const dias = Math.max(0, Number((req.query as any).dias ?? 7));
    const horarios = await consultar(
      `select h.id, h.data::text data, to_char(h.hora, 'HH24:MI') hora, a.id agenda_id, a.nome agenda, p.nome profissional
         from age.horario h join age.agenda a on a.id = h.agenda_id left join cad.profissional p on p.id = a.profissional_id
        where h.situacao = 'LIVRE' and h.tipo_vaga = 'ELETIVA' and a.ativo and h.data >= current_date + $1::int and a.unidade_id = $2
          and (a.profissional_id = $3 or a.especialidade_id in (select id from cad.especialidade where tipo = 'ODONTOLOGICA'))
        order by (a.profissional_id = $3) desc, h.data, h.hora limit 40`,
      [dias, at.unidade_id, at.profissional_id ?? u.profissionalId ?? -1],
    );
    const agendados = await consultar(
      `select g.id, g.data::text data, to_char(h.hora, 'HH24:MI') hora, g.situacao, a.nome agenda from age.agendamento g join age.agenda a on a.id = g.agenda_id
         left join age.horario h on h.id = g.horario_id where g.paciente_id = $1 and g.data >= current_date and g.situacao not in ('CANCELADO','TRANSFERIDO')
          and a.especialidade_id in (select id from cad.especialidade where tipo = 'ODONTOLOGICA') order by g.data`,
      [at.paciente_id],
    );
    return { horarios, agendados };
  });

  app.post('/api/odontologia/atendimentos/:id/retorno', async (req, reply) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const id = Number((req.params as any).id);
    const b = z.object({ horarioId: z.number(), observacao: z.string().nullish(), confirmarAvisos: z.boolean().optional() }).parse(req.body);
    const ag = await transacao(contextoDe(req, 'odontologia:retorno'), async (c) => {
      const at = (await c.query(`select * from amb.atendimento where id = $1`, [id])).rows[0];
      if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
      const r = await agendar(
        c,
        { horarioId: b.horarioId, pacienteId: at.paciente_id, tipo: 'RETORNO', origem: 'RETORNO', unidadeSolicitanteId: at.unidade_id, profissionalSolicitanteId: u.profissionalId ?? undefined, observacao: b.observacao ?? 'Retorno odontológico', confirmarAvisos: b.confirmarAvisos },
        u,
      );
      await gravarAtendimentoOdonto(c, id, at.paciente_id, {});
      await c.query(
        `update odo.atendimento_odonto set condutas = (select array(select distinct x from unnest(coalesce(condutas, '{}') || array['RETORNO_AGENDADO']) x)) where atendimento_id = $1`,
        [id],
      );
      return r;
    });
    return reply.status(201).send(ag);
  });

  // Saldo do medicamento na unidade e na rede, sem restringir a prescrição (TR 1.2.34.53).
  app.get('/api/odontologia/medicamentos/:produtoId/saldo', async (req) => {
    const u = exigirUsuario(req);
    const produtoId = Number((req.params as any).produtoId);
    const unidades = await consultar(
      `select u.id unidade_id, u.nome unidade, sum(l.quantidade - l.reservado)::numeric(15,2) disponivel
         from far.estoque_lote l join cad.unidade u on u.id = l.unidade_id
        where l.produto_id = $1 and not l.bloqueado and l.validade >= current_date and l.quantidade - l.reservado > 0 group by u.id, u.nome order by (u.id = $2) desc, u.nome`,
      [produtoId, u.unidadeAtual],
    );
    const reservado = await consultarUm(
      `select coalesce(sum(i.quantidade - coalesce(i.quantidade_dispensada, 0)), 0)::numeric(15,2) q from amb.prescricao_item i join amb.prescricao r on r.id = i.prescricao_id
        where i.produto_id = $1 and r.situacao not in ('CANCELADA','DISPENSADA') and r.validade >= current_date and coalesce(i.quantidade_dispensada, 0) < coalesce(i.quantidade, 0)`,
      [produtoId],
    );
    const naUnidade = unidades.find((x) => Number(x.unidade_id) === u.unidadeAtual);
    return {
      unidade: Number(naUnidade?.disponivel ?? 0),
      rede: unidades.reduce((t, x) => t + Number(x.disponivel), 0),
      reservadoReceitas: Number(reservado?.q ?? 0),
      unidades,
    };
  });

  // Medicamentos prescritos no atendimento: saldo e reserva na rede de farmácia básica enquanto a receita
  // estiver válida e não dispensada (TR 1.2.34.53, 1.2.34.54).
  app.get('/api/odontologia/atendimentos/:id/medicamentos', async (req) => {
    exigirPermissao(req, 'odontologia:consultar');
    const id = Number((req.params as any).id);
    const at = await atendimentoDetalhe(id);
    return consultar(
      `select i.id, r.numero, r.tipo_receita, r.validade::text validade, r.situacao, i.descricao, i.quantidade, coalesce(i.quantidade_dispensada, 0) dispensada, i.produto_id,
              (select coalesce(sum(l.quantidade - l.reservado), 0) from far.estoque_lote l where l.produto_id = i.produto_id and l.unidade_id = $2 and not l.bloqueado and l.validade >= current_date) saldo_unidade,
              (select coalesce(sum(l.quantidade - l.reservado), 0) from far.estoque_lote l where l.produto_id = i.produto_id and not l.bloqueado and l.validade >= current_date) saldo_rede,
              (i.produto_id is not null and r.situacao not in ('CANCELADA','DISPENSADA') and r.validade >= current_date and coalesce(i.quantidade_dispensada, 0) < coalesce(i.quantidade, 0)) reserva_ativa
         from amb.prescricao_item i join amb.prescricao r on r.id = i.prescricao_id where r.atendimento_id = $1 order by r.id, i.id`,
      [id, at.unidade_id],
    );
  });

  // Ficha de notificação de agravo (e-SUS / SINAN) a partir do atendimento (TR 1.2.34.39).
  app.post('/api/odontologia/atendimentos/:id/notificacao', async (req) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const id = Number((req.params as any).id);
    const b = z
      .object({
        cidId: z.number(),
        dataPrimeirosSintomas: z.string().nullish(),
        caso: z.enum(['SUSPEITO', 'CONFIRMADO']).default('SUSPEITO'),
        gestante: z.string().nullish(),
        ocupacao: z.string().nullish(),
        sinais: z.string().nullish(),
        observacao: z.string().nullish(),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'odontologia:notificacao'), async (c) => {
      const at = (await c.query(`select * from amb.atendimento where id = $1`, [id])).rows[0];
      if (!at) throw new ErroHttp(404, 'Atendimento não encontrado.');
      const p = (await c.query(`select nome, data_nascimento::text nasc, sexo, cns, nome_mae from cad.pessoa where id = $1`, [at.paciente_id])).rows[0];
      const ficha = {
        tipoNotificacao: 'INDIVIDUAL',
        dataNotificacao: new Date().toISOString().slice(0, 10),
        dataPrimeirosSintomas: b.dataPrimeirosSintomas ?? null,
        classificacaoCaso: b.caso,
        paciente: { nome: p.nome, nascimento: p.nasc, sexo: p.sexo, cns: p.cns, mae: p.nome_mae },
        gestante: b.gestante ?? null,
        ocupacao: b.ocupacao ?? null,
        sinaisSintomas: b.sinais ?? null,
        origem: 'ODONTOLOGIA',
      };
      return (
        await c.query(
          `insert into amb.notificacao_agravo (paciente_id, atendimento_id, cid_id, unidade_id, profissional_id, data_hora, situacao, ficha, observacao)
           values ($1,$2,$3,$4,$5,now(),'PENDENTE',$6,$7) returning *`,
          [at.paciente_id, id, b.cidId, at.unidade_id, u.profissionalId ?? at.profissional_id, JSON.stringify(ficha), b.observacao ?? null],
        )
      ).rows[0];
    });
  });

  // ---------------------------------------------------------------------------
  // Anamnese odontológica: nova anamnese ou histórico (TR 1.2.34.13, 1.2.34.14)
  // ---------------------------------------------------------------------------
  app.get('/api/odontologia/anamneses/modelos', async (req) => {
    exigirUsuario(req);
    return consultar(
      `select a.id, a.nome,
              (select coalesce(json_agg(json_build_object('id', p.id, 'ordem', p.ordem, 'texto', p.texto, 'tipo', p.tipo_resposta, 'tipoObservacao', p.tipo_observacao,
                       'dependeOpcaoId', p.depende_opcao_id, 'obrigatoria', p.obrigatoria,
                       'opcoes', (select coalesce(json_agg(json_build_object('id', o.id, 'texto', o.texto, 'condicao', o.condicao_saude, 'acao', o.acao_condicao) order by o.ordem), '[]')
                                    from cad.anamnese_opcao o where o.pergunta_id = p.id)) order by p.ordem), '[]')
                 from cad.anamnese_pergunta p where p.anamnese_id = a.id) perguntas
         from cad.anamnese a where a.ativo and a.tipo = 'ODONTOLOGICO' order by a.nome`,
    );
  });

  app.get('/api/odontologia/pacientes/:id/anamneses', async (req) => {
    exigirPermissao(req, 'odontologia:consultar');
    return consultar(
      `select ap.id, ap.data_hora, ap.respostas, a.nome modelo, a.id anamnese_id, pr.nome profissional, u.nome unidade
         from cad.anamnese_aplicada ap join cad.anamnese a on a.id = ap.anamnese_id left join cad.profissional pr on pr.id = ap.profissional_id
         left join cad.unidade u on u.id = ap.unidade_id where ap.pessoa_id = $1 and a.tipo = 'ODONTOLOGICO' order by ap.data_hora desc`,
      [Number((req.params as any).id)],
    );
  });

  app.post('/api/odontologia/pacientes/:id/anamneses', async (req, reply) => {
    const u = exigirPermissao(req, 'odontologia:executar');
    const pacienteId = Number((req.params as any).id);
    const b = z
      .object({
        anamneseId: z.number(),
        respostas: z.record(z.object({ opcoes: z.array(z.number()).default([]), texto: z.string().nullish(), observacao: z.string().nullish() })),
      })
      .parse(req.body);
    const perguntas = await consultar(
      `select p.id, p.texto, p.tipo_resposta, p.depende_opcao_id, p.obrigatoria from cad.anamnese_pergunta p where p.anamnese_id = $1 order by p.ordem`,
      [b.anamneseId],
    );
    if (!perguntas.length) throw new ErroHttp(422, 'Modelo de anamnese sem perguntas.');
    const marcadas = new Set(Object.values(b.respostas).flatMap((r) => r.opcoes));
    for (const p of perguntas) {
      if (p.depende_opcao_id && !marcadas.has(Number(p.depende_opcao_id))) continue;
      const r = b.respostas[p.id];
      const respondida = !!r && (r.opcoes.length > 0 || !!r.texto?.trim());
      if (p.obrigatoria && !respondida) throw new ErroHttp(422, `Responda a pergunta obrigatória: "${p.texto}".`);
    }
    const opcoes = marcadas.size
      ? await consultar(`select id, condicao_saude, acao_condicao from cad.anamnese_opcao where id = any($1::bigint[]) and condicao_saude is not null`, [[...marcadas]])
      : [];
    const atribuir = opcoes.filter((o) => o.acao_condicao !== 'REMOVER').map((o) => o.condicao_saude);
    const remover = opcoes.filter((o) => o.acao_condicao === 'REMOVER').map((o) => o.condicao_saude);
    const r = await transacao(contextoDe(req, 'odontologia:anamnese'), async (c) => {
      const ap = (
        await c.query(
          `insert into cad.anamnese_aplicada (pessoa_id, anamnese_id, profissional_id, unidade_id, data_hora, concluida, respostas) values ($1,$2,$3,$4,now(),true,$5) returning *`,
          [pacienteId, b.anamneseId, u.profissionalId, u.unidadeAtual, JSON.stringify(b.respostas)],
        )
      ).rows[0];
      // Doenças e agravantes do paciente conforme as fichas da atenção básica/e-SUS (TR 1.2.34.14).
      if (atribuir.length || remover.length)
        await c.query(
          `update cad.pessoa set condicoes_saude = array(select distinct x from unnest(coalesce(condicoes_saude, '{}') || $2::text[]) x where not (x = any($3::text[]))) where id = $1`,
          [pacienteId, atribuir, remover],
        );
      return ap;
    });
    return reply.status(201).send({ ...r, condicoesAtribuidas: atribuir, condicoesRemovidas: remover });
  });

  // ---------------------------------------------------------------------------
  // Prontuário odontológico do paciente: família, prontuário médico, exames, medicamentos retirados, uso contínuo,
  // vacinas, sigilosos e alertas (TR 1.2.34.15 a 1.2.34.25, 1.2.34.25.1 a 1.2.34.25.7, 1.2.34.40, 1.2.34.68, 1.2.34.73)
  // ---------------------------------------------------------------------------
  app.get('/api/odontologia/pacientes/:id/prontuario', async (req) => {
    const u = exigirPermissao(req, 'odontologia:consultar');
    const id = Number((req.params as any).id);
    const paciente = await pacienteCabecalho(id, u.unidadeAtual);
    if (!paciente) throw new ErroHttp(404, 'Paciente não encontrado.');
    const [atendimentos, medicamentos, usoContinuo, exames, canceladas, familia, condicoes] = await Promise.all([
      consultar(
        `select a.id, a.entrada_em, a.fim_em, a.situacao, u.nome unidade, pr.nome profissional, pr.conselho || ' ' || coalesce(pr.registro_conselho, '') registro, e.nome especialidade,
                a.subjetivo, a.objetivo, a.avaliacao, a.plano, c.codigo || ' - ' || c.nome cid, ci.codigo || ' - ' || ci.nome ciap, a.saude_bucal, a.material_odonto,
                o.tipo_consulta, o.condutas,
                (select json_agg(po.nome || coalesce(' - dente ' || m.dente, ' - ' || lower(m.marcacao)) order by m.id) from odo.marcacao m join odo.procedimento po on po.id = m.procedimento_odonto_id
                  where m.executado_atendimento_id = a.id and m.status = 'EXECUTADO') procedimentos,
                (select json_agg(pc.codigo || ' - ' || pc.nome) from fat.producao fp join cad.procedimento pc on pc.id = fp.procedimento_id where fp.referencia = 'atendimento:' || a.id) producao,
                (select json_agg(i.descricao || coalesce(' - ' || i.posologia, '')) from amb.prescricao_item i join amb.prescricao r on r.id = i.prescricao_id where r.atendimento_id = a.id) prescricoes,
                (select json_agg(pc.nome) from amb.solicitacao_exame_item si join amb.solicitacao_exame s on s.id = si.solicitacao_id join cad.procedimento pc on pc.id = si.procedimento_id where s.atendimento_id = a.id) exames,
                (select json_agg(d.tipo || ' (' || to_char(d.data, 'DD/MM/YYYY') || ')') from amb.documento_clinico d where d.atendimento_id = a.id) documentos
           from amb.atendimento a left join cad.unidade u on u.id = a.unidade_id left join cad.profissional pr on pr.id = a.profissional_id
           left join cad.especialidade e on e.id = a.especialidade_id left join cad.cid c on c.id = a.cid_id left join cad.ciap ci on ci.id = a.ciap_id
           left join odo.atendimento_odonto o on o.atendimento_id = a.id
          where a.paciente_id = $1 and (a.tipo_unidade = 'ODONTOLOGIA' or o.id is not null) order by a.entrada_em desc limit 200`,
        [id],
      ),
      consultar(
        `select d.data_hora, u.nome unidade, pr.nome || coalesce(' ' || pr.concentracao, '') produto, di.quantidade, d.prescritor
           from far.dispensacao_item di join far.dispensacao d on d.id = di.dispensacao_id join far.produto pr on pr.id = di.produto_id
           join cad.unidade u on u.id = d.unidade_id where d.paciente_id = $1 and d.situacao = 'EFETIVADA' order by d.data_hora desc limit 200`,
        [id],
      ).catch(() => []),
      consultar(
        `select distinct on (coalesce(i.produto_id::text, i.descricao)) i.descricao, i.posologia, r.data::text data_receita, r.tipo_receita
           from amb.prescricao_item i join amb.prescricao r on r.id = i.prescricao_id
          where r.paciente_id = $1 and i.uso_continuo and r.situacao <> 'CANCELADA' order by coalesce(i.produto_id::text, i.descricao), r.data desc`,
        [id],
      ),
      consultar(
        `select i.id, s.id solicitacao_id, s.numero, s.data::text data, pr.codigo || ' - ' || pr.nome exame, i.situacao, i.resultado_liberado_em, i.resultado_texto, i.resultado_arquivo_id, p.nome solicitante
           from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id join cad.procedimento pr on pr.id = i.procedimento_id
           left join cad.profissional p on p.id = s.profissional_id where s.paciente_id = $1 and s.situacao <> 'CANCELADO' order by s.data desc limit 200`,
        [id],
      ),
      // Histórico de cancelamentos de requisições de exames para auditoria (TR 1.2.34.73).
      consultar(
        `select s.numero, s.data::text data, s.motivo_cancelamento, s.atualizado_em cancelado_em, p.nome solicitante, o.nome operador,
                (select string_agg(pr.nome, '; ') from amb.solicitacao_exame_item i join cad.procedimento pr on pr.id = i.procedimento_id where i.solicitacao_id = s.id) exames
           from amb.solicitacao_exame s left join cad.profissional p on p.id = s.profissional_id left join seg.operador o on o.id = s.atualizado_por
          where s.paciente_id = $1 and s.situacao = 'CANCELADO' order by s.atualizado_em desc nulls last`,
        [id],
      ).catch(() => []),
      consultar(
        `select p.id, p.nome, p.parentesco, p.data_nascimento::text nascimento, p.situacao from cad.pessoa p
          where p.familia_id = (select familia_id from cad.pessoa where id = $1) and p.familia_id is not null and p.id <> $1 order by p.data_nascimento`,
        [id],
      ).catch(() => []),
      consultar(
        `select a.entrada_em data, c.codigo || ' - ' || c.nome cid, c.notificavel from amb.atendimento a join cad.cid c on c.id = a.cid_id where a.paciente_id = $1 order by a.entrada_em desc limit 100`,
        [id],
      ),
    ]);
    await registrarRotina(req, 'odontologia', 'prontuario', { paciente: id });
    return {
      paciente: { ...paciente, idade: paciente.nascimento ? idadeDetalhada(paciente.nascimento) : null },
      alertas: await gerarAlertas(id, { usuario: u, unidadeId: u.unidadeAtual, rotina: 'atendimento' }),
      atendimentos,
      medicamentos,
      usoContinuo,
      exames,
      requisicoesCanceladas: canceladas,
      familia,
      doencas: condicoes,
      podeVerClinico: temPermissao(u, 'odontologia:executar'),
    };
  });

  // Impressão do resultado de exame liberado (TR 1.2.34.17, 1.2.34.49).
  app.get('/api/odontologia/exames/:itemId/resultado', async (req, reply) => {
    const u = exigirPermissao(req, 'odontologia:consultar');
    const i = await consultarUm(
      `select i.*, i.resultado_liberado_em, s.numero, s.data::text data, pr.codigo, pr.nome exame, p.nome paciente, p.cns, p.data_nascimento::text nasc, sol.nome solicitante
         from amb.solicitacao_exame_item i join amb.solicitacao_exame s on s.id = i.solicitacao_id join cad.procedimento pr on pr.id = i.procedimento_id
         join cad.pessoa p on p.id = s.paciente_id left join cad.profissional sol on sol.id = s.profissional_id where i.id = $1`,
      [Number((req.params as any).itemId)],
    );
    if (!i) throw new ErroHttp(404, 'Exame não encontrado.');
    if (!i.resultado_texto && !i.resultado_liberado_em) throw new ErroHttp(422, 'O resultado deste exame ainda não foi liberado.');
    const doc = await emitirDocumento(
      { relatorio: 'documento:resultado-exame', titulo: 'Resultado de exame', filtros: { item: i.id } },
      [
        { text: `${i.codigo} - ${i.exame}`, bold: true, fontSize: 12 },
        { text: `Paciente: ${i.paciente}   CNS: ${i.cns ?? '-'}   Idade: ${idadeTexto(i.nasc)}`, margin: [0, 6, 0, 0] },
        { text: `Requisição ${i.numero} de ${fmtData(i.data)} - solicitante: ${i.solicitante ?? '-'}   Liberado em: ${fmt(i.resultado_liberado_em)}`, fontSize: 8, margin: [0, 0, 0, 10] },
        { text: i.resultado_texto ?? 'Resultado disponível em arquivo anexo ao exame.', fontSize: 10 },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // ---------------------------------------------------------------------------
  // Documentos odontológicos
  // ---------------------------------------------------------------------------
  // FAO (Ficha de Atendimento Odontológico) preenchida com os dados do paciente e do atendimento (TR 1.2.34.61).
  app.get('/api/odontologia/documentos/fao', async (req, reply) => {
    const u = exigirPermissao(req, 'odontologia:consultar');
    const atendimentoId = Number((req.query as any).atendimentoId);
    if (!atendimentoId) throw new ErroHttp(422, 'Informe o atendimento.');
    const at = await atendimentoDetalhe(atendimentoId);
    const p = await pacienteCabecalho(at.paciente_id, at.unidade_id);
    const o = await consultarUm(`select o.*, g.codigo || ' - ' || g.nome grupo from odo.atendimento_odonto o left join odo.grupo_atendimento g on g.id = o.grupo_atendimento_id where o.atendimento_id = $1`, [atendimentoId]);
    const procs = await consultar(
      `select pc.codigo, pc.nome, sum(fp.quantidade)::int quantidade from fat.producao fp join cad.procedimento pc on pc.id = fp.procedimento_id
        where fp.referencia = 'atendimento:' || $1 group by 1,2 order by 1`,
      [atendimentoId],
    );
    const marcas = await consultar(
      `select m.dente, m.faces, m.marcacao, m.arcada, m.quadrante, m.sextante, po.nome procedimento from odo.marcacao m join odo.procedimento po on po.id = m.procedimento_odonto_id
        where m.executado_atendimento_id = $1 and m.status = 'EXECUTADO' order by m.id`,
      [atendimentoId],
    );
    const sec = at.cids_secundarios?.length ? await consultar(`select codigo from cad.cid where id = any($1::bigint[])`, [at.cids_secundarios]) : [];
    const od = estadoOdontograma(await marcacoesPaciente((await import('../../db/pool.js')).pool, at.paciente_id));
    const ind = indicesCpo(od);
    const caixa = (marcado: boolean, texto: string) => ({ text: `${marcado ? '[X]' : '[  ]'} ${texto}`, fontSize: 8 });
    const vig: string[] = at.saude_bucal ?? [];
    const cond: string[] = o?.condutas ?? [];
    const mat: Record<string, number> = at.material_odonto ?? {};
    const linha = (rot: string, val: unknown) => [{ text: rot, bold: true, fontSize: 8 }, { text: val == null || val === '' ? '-' : String(val), fontSize: 9 }];
    const regiao = (m: any) =>
      m.dente ? `Dente ${m.dente}${m.faces?.length ? ` (${m.faces.join('')})` : ''}` : m.marcacao === 'ARCADA' ? `Arcada ${String(m.arcada).toLowerCase()}` : m.marcacao === 'QUADRANTE' ? `Quadrante ${m.quadrante}` : m.marcacao === 'SEXTANTE' ? `Sextante ${m.sextante}` : 'Boca';
    const doc = await emitirDocumento(
      { relatorio: 'documento:fao', titulo: 'Ficha de Atendimento Odontológico - FAO', filtros: { atendimento: atendimentoId } },
      [
        {
          table: {
            widths: [80, '*', 70, '*'],
            body: [
              [...linha('Paciente', p?.nome), ...linha('Prontuário', p?.prontuario)],
              [...linha('Nascimento', `${fmtData(p?.nascimento)} (${idadeTexto(p?.nascimento)})`), ...linha('Sexo', p?.sexo)],
              [...linha('CNS', p?.cns), ...linha('CPF', p?.cpf)],
              [...linha('Mãe', p?.nome_mae), ...linha('Município', p?.municipio)],
              [...linha('Unidade', `${at.unidade ?? ''}${at.cnes ? ` (CNES ${at.cnes})` : ''}`), ...linha('Data', fmt(at.inicio_em ?? at.entrada_em))],
              [...linha('Profissional', `${at.profissional ?? '-'} ${at.conselho ?? ''} ${at.registro_conselho ?? ''}`), ...linha('CBO', at.cbo)],
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { text: 'Atendimento', style: 'h2' },
        {
          columns: [
            { stack: [{ text: 'Tipo de atendimento', bold: true, fontSize: 8 }, ...TIPOS_ATENDIMENTO_SIA.map(([k, v]) => caixa(at.tipo_atendimento_sia === k, v))] },
            { stack: [{ text: 'Tipo de consulta', bold: true, fontSize: 8 }, ...TIPOS_CONSULTA.map(([k, v]) => caixa(o?.tipo_consulta === k, v))] },
          ],
        },
        { text: `Grupo de atendimento (SIA): ${o?.grupo ?? '-'}    Gestante: ${o?.gestante ? 'sim' : 'não'}    Paciente com necessidades especiais: ${o?.necessidades_especiais ? 'sim' : 'não'}`, fontSize: 8, margin: [0, 4, 0, 0] },
        { text: `CID-10: ${at.cid_codigo ? `${at.cid_codigo} - ${at.cid_nome}` : '-'}${sec.length ? `   Secundários: ${sec.map((x) => x.codigo).join(', ')}` : ''}   CIAP-2: ${at.ciap_codigo ? `${at.ciap_codigo} - ${at.ciap_nome}` : '-'}`, fontSize: 8 },
        { text: 'Vigilância em saúde bucal', style: 'h2' },
        { columns: [VIGILANCIA_SAUDE_BUCAL.slice(0, 4), VIGILANCIA_SAUDE_BUCAL.slice(4)].map((l) => ({ stack: l.map(([k, v]) => caixa(vig.includes(k), v)) })) },
        { text: 'Procedimentos realizados', style: 'h2' },
        procs.length
          ? { table: { widths: [70, '*', 40], body: [[{ text: 'Código', style: 'th' }, { text: 'Procedimento SIGTAP', style: 'th' }, { text: 'Qtd', style: 'th' }], ...procs.map((x) => [x.codigo, x.nome, String(x.quantidade)])] } }
          : { text: 'Nenhum procedimento lançado.', fontSize: 8 },
        ...(marcas.length ? [{ text: marcas.map((m) => `${regiao(m)}: ${m.procedimento}`).join('; '), fontSize: 8, margin: [0, 4, 0, 0] }] : []),
        { text: `Índices: CPO-D ${ind.cpod.total} (C ${ind.cpod.C} / P ${ind.cpod.P} / O ${ind.cpod.O})   ceo-d ${ind.ceod.total} (c ${ind.ceod.c} / e ${ind.ceod.e} / o ${ind.ceod.o})`, fontSize: 8, margin: [0, 4, 0, 0] },
        { text: 'Fornecimento de material odontológico', style: 'h2' },
        { text: MATERIAIS_ODONTO.map(([k, v]) => `${v}: ${mat[k] ?? 0}`).join('    '), fontSize: 9 },
        { text: 'Conduta / desfecho', style: 'h2' },
        { columns: [CONDUTAS.slice(0, 8), CONDUTAS.slice(8)].map((l) => ({ stack: l.map(([k, v]) => caixa(cond.includes(k), v)) })) },
        ...(at.avaliacao || at.plano ? [{ text: 'Evolução', style: 'h2' }, { text: [at.subjetivo, at.objetivo, at.avaliacao, at.plano].filter(Boolean).join('\n'), fontSize: 8 }] : []),
        { text: '_______________________________________', alignment: 'center', margin: [0, 30, 0, 0] },
        { text: `${at.profissional ?? ''} - ${at.conselho ?? ''} ${at.registro_conselho ?? ''}`, alignment: 'center', fontSize: 8 },
        { text: 'Carimbo e assinatura do cirurgião-dentista', alignment: 'center', fontSize: 7, color: '#777' },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // Plano de tratamento impresso (orientação ao paciente).
  app.get('/api/odontologia/documentos/plano/:id', async (req, reply) => {
    const u = exigirPermissao(req, 'odontologia:consultar');
    const id = Number((req.params as any).id);
    const pl = await consultarUm(
      `select p.*, p.data_inicio::text inicio, p.data_conclusao::text conclusao, pr.nome profissional, pr.conselho, pr.registro_conselho, u.nome unidade
         from odo.plano_tratamento p left join cad.profissional pr on pr.id = p.profissional_id left join cad.unidade u on u.id = p.unidade_id where p.id = $1`,
      [id],
    );
    if (!pl) throw new ErroHttp(404, 'Plano não encontrado.');
    const p = await pacienteCabecalho(pl.paciente_id, pl.unidade_id);
    const etapas = await consultar(`select * from odo.plano_etapa where plano_id = $1 order by ordem`, [id]);
    const marcas = await consultar(
      `select m.*, po.nome procedimento from odo.marcacao m join odo.procedimento po on po.id = m.procedimento_odonto_id where m.plano_id = $1 and m.status <> 'CANCELADO' order by m.etapa_id nulls last, m.id`,
      [id],
    );
    const desc = (m: any) => `${m.dente ? `Dente ${m.dente}${m.faces?.length ? ` (${m.faces.join('')})` : ''}` : m.marcacao.toLowerCase()} - ${m.procedimento} - ${m.status === 'EXECUTADO' ? 'executado' : 'planejado'}`;
    const doc = await emitirDocumento(
      { relatorio: 'documento:plano-odontologico', titulo: 'Plano de tratamento odontológico', filtros: { plano: id } },
      [
        { text: `Paciente: ${p?.nome}   CNS: ${p?.cns ?? '-'}   Idade: ${idadeTexto(p?.nascimento)}`, bold: true },
        { text: `Unidade: ${pl.unidade ?? '-'}   Início: ${fmtData(pl.inicio)}   Situação: ${pl.situacao.replace('_', ' ').toLowerCase()}${pl.conclusao ? ` em ${fmtData(pl.conclusao)}` : ''}`, fontSize: 8, margin: [0, 2, 0, 8] },
        ...etapas.flatMap((e) => [
          { text: `Etapa ${e.ordem}: ${e.descricao} (${e.situacao === 'CONCLUIDA' ? 'concluída' : 'pendente'})`, style: 'h2' },
          { ul: marcas.filter((m) => m.etapa_id === e.id).map(desc), fontSize: 9 },
        ]),
        ...(marcas.some((m) => !m.etapa_id) ? [{ text: 'Outros procedimentos', style: 'h2' }, { ul: marcas.filter((m) => !m.etapa_id).map(desc), fontSize: 9 }] : []),
        ...(pl.observacao ? [{ text: 'Observações', style: 'h2' }, { text: pl.observacao }] : []),
        { text: '_______________________________________', alignment: 'center', margin: [0, 30, 0, 0] },
        { text: `${pl.profissional ?? ''} - ${pl.conselho ?? ''} ${pl.registro_conselho ?? ''}`, alignment: 'center', fontSize: 8 },
      ] as any,
      {},
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });

  // Configuração da impressão das receitas odontológicas, restrita a administradores e técnicos (TR 1.2.34.1, 1.2.34.1.1 a 1.2.34.1.7).
  app.get('/api/odontologia/configuracao/receita', async (req) => {
    exigirPermissao(req, 'odontologia_receita:alterar');
    return { ...CONFIG_RECEITA_PADRAO, ...(await parametro<Partial<ConfigReceitaOdonto>>('odontologia.receita.impressao', {})) };
  });

  app.put('/api/odontologia/configuracao/receita', async (req) => {
    exigirPermissao(req, 'odontologia_receita:alterar');
    const b = z
      .object({
        cabecalho: z.boolean(),
        rodape: z.boolean(),
        logoSus: z.boolean(),
        duasViasMesmaPagina: z.boolean(),
        duasViasSimples: z.boolean(),
        duasViasOutros: z.boolean(),
        textoCabecalho: z.string().max(500).default(''),
      })
      .parse(req.body);
    await transacao(contextoDe(req, 'odontologia:configuracao-receita'), (c) =>
      c.query(
        `insert into sis.parametro (chave, valor, descricao, modulo) values ('odontologia.receita.impressao', $1, 'Configuração da impressão das receitas odontológicas', 'ODO')
         on conflict (chave) do update set valor = excluded.valor`,
        [JSON.stringify(b)],
      ),
    );
    return b;
  });

  // Receita odontológica com código de barras e configuração de impressão (TR 1.2.34.1, 1.2.34.65).
  app.get('/api/odontologia/documentos/receita/:id', async (req, reply) => {
    const u = exigirUsuario(req);
    const id = Number((req.params as any).id);
    const r = await consultarUm(
      `select r.*, r.data::text dt, r.validade::text val, p.nome paciente, p.cns, p.data_nascimento::text nasc, p.sexo,
              (select concat_ws(' ', l.tipo_abreviatura, l.nome) || ', ' || coalesce(p.numero, 's/n') from cad.logradouro l where l.id = p.logradouro_id) endereco,
              pr.nome profissional, pr.conselho, pr.registro_conselho, pr.uf_conselho, un.nome unidade, un.telefone
         from amb.prescricao r join cad.pessoa p on p.id = r.paciente_id left join cad.profissional pr on pr.id = r.profissional_id
         left join cad.unidade un on un.id = r.unidade_id where r.id = $1`,
      [id],
    );
    if (!r) throw new ErroHttp(404, 'Receita não encontrada.');
    const itens = await consultar(`select * from amb.prescricao_item where prescricao_id = $1 order by id`, [id]);
    const cfg = { ...CONFIG_RECEITA_PADRAO, ...(await parametro<Partial<ConfigReceitaOdonto>>('odontologia.receita.impressao', {})) };
    const barras = await codigoBarras(r.numero);
    const especial = ['BRANCA_C', 'AZUL_B', 'AMARELA_A', 'ANTIMICROBIANO'].includes(r.tipo_receita);
    const titulo =
      {
        BASICA: 'RECEITUÁRIO ODONTOLÓGICO',
        BRANCA_C: 'RECEITUÁRIO DE CONTROLE ESPECIAL - ODONTOLOGIA',
        AZUL_B: 'NOTIFICAÇÃO DE RECEITA B - ODONTOLOGIA',
        AMARELA_A: 'NOTIFICAÇÃO DE RECEITA A - ODONTOLOGIA',
        ANTIMICROBIANO: 'RECEITA DE ANTIMICROBIANO - ODONTOLOGIA',
        OUTROS: 'OUTROS MEDICAMENTOS E RECOMENDAÇÕES - ODONTOLOGIA',
      }[r.tipo_receita as string] ?? 'RECEITUÁRIO ODONTOLÓGICO';
    // Duas vias: obrigatórias nas receitas de controle; opcionais nas simples e de outros medicamentos (TR 1.2.34.1.4 a 1.2.34.1.6).
    const duasVias = especial || (r.tipo_receita === 'BASICA' && cfg.duasViasSimples) || (r.tipo_receita === 'OUTROS' && cfg.duasViasOutros);
    const via = (nome: string): any[] => [
      {
        columns: [
          ...(cfg.logoSus ? [{ svg: LOGO_SUS, width: 70 }] : []),
          { stack: [{ text: titulo, bold: true, fontSize: 11 }, ...(cfg.textoCabecalho ? [{ text: cfg.textoCabecalho, fontSize: 8 }] : []), { text: r.unidade ?? '', fontSize: 7 }], margin: [6, 0, 0, 0] },
          { image: barras, width: 120, alignment: 'right' },
        ],
      },
      { text: nome, fontSize: 7, alignment: 'right', color: '#777' },
      { text: `Paciente: ${r.paciente}`, bold: true, margin: [0, 6, 0, 0] },
      { text: `CNS: ${r.cns ?? '-'}   Idade: ${idadeTexto(r.nasc)}${especial ? `   Endereço: ${r.endereco ?? '-'}` : ''}`, fontSize: 8 },
      { text: r.uso_interno ? 'USO INTERNO' : 'USO EXTERNO', bold: true, margin: [0, 8, 0, 4] },
      {
        ol: itens.map((i) => ({
          stack: [{ text: `${i.descricao}${i.quantidade ? ` ........ ${Number(i.quantidade).toLocaleString('pt-BR')}` : ''}`, bold: true }, { text: [i.posologia, i.dose ? `Dose: ${i.dose}` : '', i.uso_continuo ? '(uso contínuo)' : ''].filter(Boolean).join(' - ') }],
          margin: [0, 2, 0, 4],
        })),
      },
      ...(r.orientacoes ? [{ text: 'Orientações:', bold: true, margin: [0, 6, 0, 0] }, { text: r.orientacoes }] : []),
      { text: `Data: ${fmtData(r.dt)}   Validade: ${fmtData(r.val)}   Receita nº ${r.numero}`, margin: [0, 14, 0, 0], fontSize: 8 },
      { text: '_______________________________________', alignment: 'center', margin: [0, 22, 0, 0] },
      { text: `${r.profissional ?? ''} - ${r.conselho ?? 'CRO'} ${r.registro_conselho ?? ''}/${r.uf_conselho ?? ''}`, alignment: 'center', fontSize: 8 },
      { text: 'Carimbo e assinatura do cirurgião-dentista', alignment: 'center', fontSize: 7, color: '#777' },
    ];
    const mesmaPagina = duasVias && cfg.duasViasMesmaPagina;
    const conteudo: any[] = !duasVias
      ? via('')
      : mesmaPagina
        ? [{ columns: [{ stack: via('1ª via - farmácia') }, { width: 20, text: '' }, { stack: via('2ª via - paciente') }] }]
        : [...via('1ª via - farmácia'), { text: '', pageBreak: 'after' }, ...via('2ª via - paciente')];
    const doc = await emitirDocumento(
      { relatorio: 'documento:receita-odontologica', titulo, filtros: { receita: id } },
      conteudo,
      { semCabecalho: !cfg.cabecalho, semRodape: !cfg.rodape, tamanho: mesmaPagina ? 'A4' : ('A5' as any), orientacao: mesmaPagina ? 'landscape' : 'portrait' },
      u,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${doc.nome}"`).send(doc.conteudo);
  });
}
