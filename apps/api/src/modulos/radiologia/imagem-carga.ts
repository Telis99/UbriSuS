// Carga inicial e de demonstração comum aos módulos de Radiologia e Ecografia.
import type pg from 'pg';
import type { ContextoDemonstracao } from '../../db/carga/modulos.js';
import { gerarCns, gerarCpf, SENHA_DEMO } from '../../db/carga/demonstracao.js';
import { gerarHashSenha } from '../../seguranca/senha.js';
import type { Usuario } from '../../seguranca/usuario.js';
import { salvarArquivo } from '../../servicos/arquivos.js';
import { proximoNumero } from '../atendimento/servico.js';
import { gerarHorarios } from '../agendamento/servico.js';
import type { ConfigImagem } from './imagem.js';
import { executar, importarSigtap, liberarNoProntuario, salvarLaudo, sincronizarAgenda } from './imagem-servico.js';

export interface ModeloCarga {
  /** Código SIGTAP do exame (null = modelo geral). */
  codigo: string | null;
  nome: string;
  texto: string;
  conclusao?: string;
  padrao?: boolean;
}

export interface DadosCargaImagem {
  estruturas: [string, string | null, boolean?][];
  modelos: ModeloCarga[];
  cabecalho: string;
  perfil: { nome: string; descricao: string; permissoes: string[] };
}

/** Carga inicial idempotente: exames do SIGTAP, estruturas, modelos de resultado, cabeçalho e perfil de acesso. */
export async function cargaBaseImagem(c: pg.PoolClient, cfg: ConfigImagem, d: DadosCargaImagem) {
  const s = cfg.esquema;
  await importarSigtap(c, cfg);
  const exameDe = async (codigo: string | null) =>
    codigo ? ((await c.query(`select e.id from ${s}.exame e join cad.procedimento p on p.id = e.procedimento_id where p.codigo = $1`, [codigo])).rows[0]?.id ?? undefined) : null;
  for (const [nome, codigo, lateral] of d.estruturas) {
    const ex = await exameDe(codigo);
    if (ex === undefined) continue;
    await c.query(
      `insert into ${s}.estrutura (nome, exame_id, exige_lateralidade, ativo) select $1::varchar, $2::bigint, $3::boolean, true
        where not exists (select 1 from ${s}.estrutura where nome = $1::varchar and exame_id is not distinct from $2::bigint)`,
      [nome, ex, !!lateral],
    );
  }
  for (const m of d.modelos) {
    const ex = await exameDe(m.codigo);
    if (ex === undefined) continue;
    await c.query(
      `insert into ${s}.modelo_laudo (nome, exame_id, texto, conclusao, padrao, ativo) select $1::varchar, $2::bigint, $3::text, $4::text, $5::boolean, true
        where not exists (select 1 from ${s}.modelo_laudo where nome = $1::varchar)`,
      [m.nome, ex, m.texto, m.conclusao ?? null, !!m.padrao],
    );
  }
  await c.query(`insert into ${s}.cabecalho (titulo, ativo) select $1, true where not exists (select 1 from ${s}.cabecalho where unidade_id is null)`, [d.cabecalho]);
  await c.query(
    `insert into seg.perfil (nome, descricao, categoria, grupo_profissional, permissoes, ativo) select $1::varchar, $2::varchar, 'OPERACIONAL', 'MULTIPROFISSIONAL', $3::jsonb, true
      where not exists (select 1 from seg.perfil where nome = $1::varchar)`,
    [d.perfil.nome, d.perfil.descricao, JSON.stringify(d.perfil.permissoes)],
  );
}

export const ASSINATURA_DEMO_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAABaCAQAAACoeKOWAAAEMklEQVR42u2daY7kIAyFE1RXyP0P2IdI/yihLCyBYIwr+V5r1Br1dAz2wxtOzbxOAMjDoQIAsQDEAhALAIgFIBaAWABALACxAMQCAGIBiAUgFgAQC0AsALEAgFgAYgGIBQDEAhALQCwAIBaAWOA1+IwRu6zTNE1/MwbAYwFgn1hfX7Xwfj/EAgBigXcl7z70/c3T9DcTCJ+MeVWnlaeWTmW4JzN4fCjU8labHE3/uKzfL4j1UBxNC5kfSSwf+LaQFGs5LOuvNyHeRGZjHivdw/K0klXOnsxvgA1qOc3NegPHDb1XiIRy9jK1G7JvI7OpHGtZ9+Z+Rqo7hsxhmvFaYp1VsDUFeiknF4CfUMON8cyDiZXqWMUVIKOc0i5Zz7RXx4PYPBJu7Ak7+ytNLylvlDiZdQ1vxWd97HBc63xvcsapf5Pcumurk23OIm2kTt1ZZmoNPrPrFQzPz5Wuf+toqCPRaZ7OnJllz1xOef5nxwAsJX+879DuE5prN/gphzFKj+d1LSrPlSLxClg3Guj6SWfhdOmfe+3sKqw9t0MlT+b2HfsWzP21mb6EbjN/CTn3/6ZvnqV5gHI7KZEo4ducDjmulStp0NyzQirp7PN4v1ATgCUauC1+8p5kQ+2GZ7U1jhKPKXPNCvZBNN4hiz3tOJ97L6trm/F1mP93ZNYaOl+Pp3660bVFH650iT1v064CiC5J8q2KnCbKZLbcAJTr46r+bc/WDHis+nLYZsWXvle8knkeb6zN3NJkvHpeLa3OT71LLdf3/D9p7rttNvRv/n7dPZb+N2U0Wk+XWrnOLk1+Lcu6+7v5Tnn4/PPbTnr1b439jSTvpcoNs514UGpTZL5dERp4hF8ukem9ZLk2Ytrb77d8p+43PY/+NW44G9pbcmjkTW778akJhrERJzFi3dmE/jsq2kdkO8U6RtZID+J9sdoVOAkTStyYx5Sb2kS6Vupl5PPftWa6wp3crS8lUoCaoOpkltNzGCN356UTlEb4jvSO7teXrZVht6qwLtvpNduYrpX6SsyNDbbKtDBQLKs913ZGaxuFUj6g5/x6+Trqq64xRh7hdV2bv5BfYswf5WvAPupJZ1VPQ2lfTDEUhsMY58HfnvNGfYLSqJozPEL9qHyes+iRIX9kaPX97meONFRyNsuyfv/IGHmsv+p51aIVeis/eG2/gPB6s90csQ2eZWoYeZOp+XrVPZLI3TJI7vLTuqBjGNLoResEpraBE/lX1/ruVB7VHxV51cJsOwHX7xJrKVym4WvDe1zLlUsjuhGr9fWmdDCUdvz2vMeTPjH1I38qbfuU2pt+XSM/p6lx41OT5RVu3Y8AFWL1JolW5QfMhsJ+nqRnLwxowFmkFYBYAPwKsfgv5yAWAFpVIQB4LACxAMQCAGIBiAUgFoBYAEAsALEAxAIAYgGIBSAWAKL4B9qOMwO9EW/wAAAAAElFTkSuQmCC';

/** Profissional e operador de demonstração do serviço de imagem (criados uma única vez). */
export async function profissionalDemo(
  c: pg.PoolClient,
  d: { login: string; nome: string; sexo: string; nascimento: string; cbo: string; conselho: string | null; registro: string | null; unidades: number[]; perfis: string[]; assinatura?: boolean },
) {
  const existente = (await c.query(`select id, profissional_id from seg.operador where login = $1`, [d.login])).rows[0];
  if (existente) {
    for (const nome of d.perfis)
      await c.query(
        `insert into seg.operador_perfil (operador_id, perfil_id) select $1, p.id from seg.perfil p where p.nome = $2
          and not exists (select 1 from seg.operador_perfil x where x.operador_id = $1 and x.perfil_id = p.id)`,
        [existente.id, nome],
      );
    return { operadorId: existente.id as number, profissionalId: existente.profissional_id as number };
  }
  const mun = (await c.query(`select municipio_id from cad.unidade where id = $1`, [d.unidades[0]])).rows[0]?.municipio_id ?? null;
  const pessoa = (
    await c.query(
      `insert into cad.pessoa (nome, sexo, data_nascimento, raca_cor, cpf, cns, municipio_id, situacao, email) values ($1,$2,$3,'03',$4,$5,$6,'ATIVO',$7) returning id`,
      [d.nome, d.sexo, d.nascimento, gerarCpf(), gerarCns(), mun, `${d.login}@saude.exemplo.gov.br`],
    )
  ).rows[0].id;
  const grafica = d.assinatura ? await salvarArquivo(`assinatura_${d.login}.png`, 'image/png', Buffer.from(ASSINATURA_DEMO_PNG, 'base64'), null, c) : null;
  const prof = (
    await c.query(
      `insert into cad.profissional (pessoa_id, conselho, registro_conselho, uf_conselho, liberador_laudo, solicitante_exames, assinatura_grafica_id, ativo)
       values ($1,$2,$3,'SP',$4,true,$5,true) returning id`,
      [pessoa, d.conselho, d.registro, !!d.assinatura, grafica],
    )
  ).rows[0].id;
  const cbo = (await c.query(`select id from cad.cbo where codigo = $1`, [d.cbo])).rows[0]?.id;
  for (const un of d.unidades) {
    if (cbo)
      await c.query(
        `insert into cad.vinculo (profissional_id, unidade_id, cbo_id, conselho, registro_conselho, uf_conselho, carga_horaria, ativo, data_inicio) values ($1,$2,$3,$4,$5,'SP',30,true,'2024-01-01')`,
        [prof, un, cbo, d.conselho, d.registro],
      );
  }
  const op = (
    await c.query(
      `insert into seg.operador (pessoa_id, login, senha_hash, senha_alterada_em, profissional_id, termos_aceitos_em, unidade_padrao_id, ativo, validar_vinculo)
       values ($1,$2,$3,now(),$4,now(),$5,true,true) returning id`,
      [pessoa, d.login, await gerarHashSenha(SENHA_DEMO), prof, d.unidades[0]],
    )
  ).rows[0].id;
  for (const nome of d.perfis) await c.query(`insert into seg.operador_perfil (operador_id, perfil_id) select $1, id from seg.perfil where nome = $2`, [op, nome]);
  for (const un of d.unidades) await c.query(`insert into seg.operador_unidade (operador_id, unidade_id) values ($1,$2) on conflict do nothing`, [op, un]);
  return { operadorId: op as number, profissionalId: prof as number };
}

/** Insere procedimentos SIGTAP de demonstração ausentes na tabela (a carga oficial do SIGTAP os substitui). */
export async function procedimentosDemo(c: pg.PoolClient, procs: [string, string, string, number, string[]][]) {
  for (const [codigo, nome, sexo, valor, cbos] of procs) {
    await c.query(
      `insert into cad.procedimento (codigo, nome, grupo, subgrupo, forma_organizacao, complexidade, sexo, instrumentos, valor_sa, competencia, ativo)
       select $1::varchar, $2::varchar, substr($1::varchar, 1, 2), substr($1::varchar, 1, 4), substr($1::varchar, 1, 6), '2', $3::varchar, '{01,02}', $4::numeric, '202610', true
        where not exists (select 1 from cad.procedimento where codigo = $1::varchar)`,
      [codigo, nome, sexo, valor],
    );
    for (const cbo of cbos)
      await c.query(
        `insert into cad.procedimento_cbo (procedimento_id, cbo_id) select p.id, b.id from cad.procedimento p, cad.cbo b where p.codigo = $1 and b.codigo = $2
          and not exists (select 1 from cad.procedimento_cbo x where x.procedimento_id = p.id and x.cbo_id = b.id)`,
        [codigo, cbo],
      );
  }
}

export interface PedidoDemo {
  paciente: number;
  codigo: string;
  estrutura?: string;
  diasAtras?: number;
  hora: string;
  requisicao?: boolean;
  /** Estágio a que o exame de demonstração é levado. */
  estagio?: 'AGENDADO' | 'PRESENTE' | 'REALIZADO' | 'DIGITADO' | 'ASSINADO' | 'RETIRADO' | 'FALTOSO';
  laudo?: string;
  conclusao?: string;
}

/**
 * Agendamentos de demonstração (com requisição do médico da USF quando indicado) e avanço do fluxo até o
 * estágio pedido: presença, execução, laudo digitado, laudo assinado e resultado retirado.
 */
export async function agendamentosDemo(
  c: pg.PoolClient,
  cfg: ConfigImagem,
  ctx: ContextoDemonstracao,
  agendaId: number,
  pedidos: PedidoDemo[],
  equipe: { executante: number; operador: number; assinante: number; equipamento?: number | null },
) {
  const s = cfg.esquema;
  const agenda = (await c.query(`select * from age.agenda where id = $1`, [agendaId])).rows[0];
  const u = { id: equipe.operador, profissionalId: equipe.executante, nome: 'Demonstração' } as Usuario;
  for (const p of pedidos) {
    const proc = (await c.query(`select id from cad.procedimento where codigo = $1`, [p.codigo])).rows[0];
    if (!proc) continue;
    const data = (await c.query(`select (current_date - $1::int)::text d`, [p.diasAtras ?? 0])).rows[0].d;
    let requisicaoId: number | null = null;
    let itemId: number | null = null;
    if (p.requisicao) {
      const numero = await proximoNumero(c, 'amb.solicitacao_exame', 'X');
      requisicaoId = (
        await c.query(
          `insert into amb.solicitacao_exame (numero, paciente_id, profissional_id, unidade_id, data, dados_clinicos, situacao) values ($1,$2,$3,$4,($5::date - 7),$6,'AGENDADO') returning id`,
          [numero, p.paciente, ctx.profissionais.medico ?? null, ctx.unidades.usf, data, 'Investigação diagnóstica (demonstração).'],
        )
      ).rows[0].id;
      itemId = (
        await c.query(`insert into amb.solicitacao_exame_item (solicitacao_id, procedimento_id, estrutura, quantidade, situacao) values ($1,$2,$3,1,'AGENDADO') returning id`, [
          requisicaoId,
          proc.id,
          p.estrutura ?? null,
        ])
      ).rows[0].id;
    }
    const ag = (
      await c.query(
        `insert into age.agendamento (senha, data, hora, paciente_id, agenda_id, unidade_id, unidade_solicitante_id, profissional_solicitante_id, tipo, origem, situacao, requisicao_id, operador_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'EXAME','BALCAO','AGENDADO',$9,$10) returning id`,
        [
          `E${s.toUpperCase()}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`,
          data,
          p.hora,
          p.paciente,
          agendaId,
          agenda.unidade_id,
          ctx.unidades.usf,
          ctx.profissionais.medico ?? null,
          requisicaoId,
          equipe.operador,
        ],
      )
    ).rows[0].id;
    await c.query(`insert into age.agendamento_procedimento (agendamento_id, procedimento_id, quantidade, estrutura, solicitacao_item_id) values ($1,$2,1,$3,$4)`, [
      ag,
      proc.id,
      p.estrutura ?? null,
      itemId,
    ]);
    await sincronizarAgenda(c, cfg, data, data);
    const t = (await c.query(`select id from ${s}.atendimento where agendamento_id = $1`, [ag])).rows[0];
    if (!t) continue;
    const estagio = p.estagio ?? 'AGENDADO';
    if (estagio === 'AGENDADO') continue;
    if (estagio === 'FALTOSO') {
      await c.query(`update ${s}.atendimento set situacao = 'FALTOSO', falta_motivo = 'Não compareceu', falta_registrada_em = now() where id = $1`, [t.id]);
      await c.query(`update age.agendamento set situacao = 'FALTA' where id = $1`, [ag]);
      continue;
    }
    await c.query(`update ${s}.atendimento set situacao = 'PRESENTE', chegada_em = now() where id = $1`, [t.id]);
    await c.query(`update age.agendamento set situacao = 'PRESENTE' where id = $1`, [ag]);
    if (estagio === 'PRESENTE') continue;
    await executar(c, cfg, t.id, { tecnicoId: equipe.executante, equipamentoId: equipe.equipamento ?? null }, u);
    // Datas coerentes com o dia do exame (chegada, execução e produção).
    const r = (
      await c.query(
        `update ${s}.atendimento set chegada_em = (data + coalesce(hora, '08:00')) at time zone 'America/Sao_Paulo', executado_em = (data + coalesce(hora, '08:00') + interval '10 minutes') at time zone 'America/Sao_Paulo'
          where id = $1 returning producao_id, data::text`,
        [t.id],
      )
    ).rows[0];
    if (r?.producao_id) await c.query(`update fat.producao set data = $2 where id = $1`, [r.producao_id, r.data]);
    if (estagio === 'REALIZADO') continue;
    await salvarLaudo(c, cfg, t.id, { texto: p.laudo ?? 'Exame dentro dos limites da normalidade.', conclusao: p.conclusao ?? null, laudistaId: equipe.assinante }, u);
    if (estagio === 'DIGITADO') continue;
    const grafica = (await c.query(`select assinatura_grafica_id from cad.profissional where id = $1`, [equipe.assinante])).rows[0]?.assinatura_grafica_id ?? null;
    await c.query(
      `update ${s}.atendimento set situacao_laudo = 'ASSINADO', assinante_id = $2, assinado_em = now() - make_interval(days => $3::int), assinatura_grafica_id = $4 where id = $1`,
      [t.id, equipe.assinante, Math.max(0, (p.diasAtras ?? 0) - 1), grafica],
    );
    await liberarNoProntuario(c, cfg, (await c.query(`select * from ${s}.atendimento where id = $1`, [t.id])).rows[0], null);
    if (estagio === 'RETIRADO')
      await c.query(`update ${s}.atendimento set situacao_entrega = 'RETIRADO', retirado_em = now(), retirado_por = 'O próprio paciente', entrega_operador_id = $2 where id = $1`, [t.id, equipe.operador]);
  }
}

/** Agenda de exames do prestador com cotas por procedimento. */
export async function agendaDemo(c: pg.PoolClient, d: { nome: string; unidadeId: number; local: string; cor: string; codigos: string[]; cotaDiaria: number; cotaMensal: number }) {
  let id = (await c.query(`select id from age.agenda where nome = $1`, [d.nome])).rows[0]?.id as number | undefined;
  if (!id) {
    id = (
      await c.query(
        `insert into age.agenda (nome, tipo, unidade_id, local, cor, vigencia_inicio, dias_semana, intervalo_semanas, hora_inicio, hora_fim, vagas, vagas_urgencia, vagas_regulacao, ativo)
         values ($1,'EXAME',$2,$3,$4,current_date,'{1,2,3,4,5}',1,'07:00','12:00',20,2,0,true) returning id`,
        [d.nome, d.unidadeId, d.local, d.cor],
      )
    ).rows[0].id as number;
    await gerarHorarios(c, id, 60);
  }
  for (const codigo of d.codigos)
    await c.query(
      `insert into age.agenda_procedimento (agenda_id, procedimento_id, cota_diaria, cota_mensal) select $1, id, $3, $4 from cad.procedimento where codigo = $2
        and not exists (select 1 from age.agenda_procedimento x where x.agenda_id = $1 and x.procedimento_id = cad.procedimento.id)`,
      [id, codigo, d.cotaDiaria, d.cotaMensal],
    );
  return id;
}
