// Rotas do aplicativo do agente comunitário de saúde (/api/acs/*) e da gestão das cargas pela
// unidade. O ACS usa a mesma sessão de operador do sistema web (CPF e senha) (TR 1.2.49).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { emProducao } from '../../config.js';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { senhaAtendePolitica, somenteDigitos } from '../../compartilhado/validacao.js';
import { alterar, registrarGanchos } from '../../meta/crud.js';
import { obterEntidade } from '../../meta/registro.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { conferirSenha, gerarHashSenha, gerarToken, hashToken } from '../../seguranca/senha.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario, limparCacheSessao, NOME_COOKIE, temPermissao } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { registrarTarefaDiaria } from '../rotas.js';
import { lancarProducao } from '../faturamento/producao.js';
import { acessoDoOperador, PROCEDIMENTO_VISITA_ACS, bloqueioFamilia, cargaAtiva, exigirAcessoAcs, montarCarga, processarLote, sha256, type LoteAcs } from './servico.js';
import './relatorios.js';

registrarPermissao('acs_aplicativo', 'Utilizar o aplicativo do agente comunitário de saúde', 'ACS', ['executar']);

const fmt = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

// Bloqueio do cadastro das famílias e integrantes enviados ao dispositivo até o retorno da carga
// ou o fim da validade, quando a liberação é automática (TR 1.2.49.9).
// Transações autorizadas a gravar sobre famílias em campo (resolução de conflitos pela unidade).
const transacoesLiberadas = new WeakSet<object>();
async function verificarBloqueio(cliente: any, familiaId: number | null | undefined, usuarioId?: number) {
  if (transacoesLiberadas.has(cliente)) return;
  const b = await bloqueioFamilia(cliente, familiaId);
  if (b && b.operador_id !== usuarioId) {
    throw new ErroHttp(423, `Cadastro em campo com o ACS ${b.responsavel ?? ''} (carga ${b.carga_id}, validade ${fmt(b.validade)}). As alterações serão liberadas no retorno da carga ou após a validade.`);
  }
}
registrarGanchos('familia', {
  async antesSalvar(_d, { cliente, id, usuario }) {
    if (id) await verificarBloqueio(cliente, id, usuario?.id);
  },
  async antesExcluir(r, { cliente, usuario }) {
    await verificarBloqueio(cliente, r.id, usuario?.id);
  },
});
registrarGanchos('paciente', {
  async antesSalvar(d, { cliente, atual, usuario }) {
    if (atual?.familia_id) await verificarBloqueio(cliente, atual.familia_id, usuario?.id);
    if (d.familia_id && d.familia_id !== atual?.familia_id) await verificarBloqueio(cliente, d.familia_id, usuario?.id);
  },
});

// Liberação do acesso pelo operador da unidade (TR 1.2.49.5).
registrarGanchos('acs_acesso', {
  async antesSalvar(d, { usuario, atual }) {
    const unidade = d.unidade_id ?? atual?.unidade_id;
    if (usuario && !usuario.administrador && unidade && !usuario.unidades.includes(Number(unidade))) {
      throw new ErroHttp(403, 'A liberação do ACS deve ser feita por operador da unidade de saúde.');
    }
    if ((d.situacao ?? atual?.situacao ?? 'LIBERADO') === 'LIBERADO' && (!atual || atual.situacao !== 'LIBERADO')) {
      d.liberado_por = usuario?.id ?? null;
      d.liberado_em = new Date().toISOString();
    }
    if (d.microarea) d.microarea = String(d.microarea).padStart(2, '0');
  },
});

// Visitas registradas pelo sistema web também geram a produção BPA automaticamente (TR 1.2.49.11).
registrarGanchos('acs_visita', {
  async antesSalvar(d, { atual }) {
    if (!atual) {
      d.uuid ??= randomUUID();
      d.origem ??= 'WEB';
    }
  },
  async depoisSalvar(r, { cliente }) {
    if (r.desfecho !== 'REALIZADA' || r.producao_id) return;
    const prod = await lancarProducao(cliente, { data: new Date(r.data_hora).toISOString().slice(0, 10), unidadeId: Number(r.unidade_id), profissionalId: Number(r.profissional_id), pacienteId: r.pessoa_id ? Number(r.pessoa_id) : null, procedimentoCodigo: PROCEDIMENTO_VISITA_ACS, origem: 'VISITA_ACS', referencia: `visita:${r.id}` });
    if (prod) await cliente.query(`update acs.visita set producao_id = $2 where id = $1`, [r.id, prod.id]);
  },
});

// Cargas vencidas: liberação automática das famílias e registro da expiração (TR 1.2.49.9).
registrarTarefaDiaria(() => pool.query(`update acs.carga set situacao = 'EXPIRADA' where situacao = 'ATIVA' and validade < current_date`).catch(() => undefined));

async function logAcesso(req: FastifyRequest, evento: string, operadorId: number | null, login: string, detalhe?: string) {
  await pool.query(`insert into aud.log_acesso (operador_id, login, evento, ip, agente, detalhe) values ($1,$2,$3,$4,$5,$6)`, [
    operadorId,
    login,
    evento,
    req.ip,
    req.headers['user-agent'] ?? null,
    detalhe ? `app ACS: ${detalhe}` : 'app ACS',
  ]);
}

function exigirAcs(req: FastifyRequest) {
  return exigirUsuario(req);
}

export default async function rotasAcs(app: FastifyInstance) {
  // Identificação do ACS pelo CPF e senha (mín. 8, com número, letra e caractere especial) e bloqueio após tentativas (TR 1.2.49.6, 1.2.49.7).
  app.post('/api/acs/login', { config: { publica: true, rateLimit: { max: 20, timeWindow: '1 minute' } } as any }, async (req, reply) => {
    if (req.headers['x-requested-with'] !== 'ubrisus') throw new ErroHttp(403, 'Requisição não originada pela aplicação.');
    const b = z.object({ cpf: z.string().min(3), senha: z.string().min(1) }).parse(req.body);
    const cpf = somenteDigitos(b.cpf);
    const op = await consultarUm(
      `select o.*, p.cpf from seg.operador o join cad.pessoa p on p.id = o.pessoa_id
        where (length($1) = 11 and p.cpf = $1) or o.login = $2 order by (p.cpf = $1) desc limit 1`,
      [cpf, b.cpf.trim()],
    );
    if (!op) {
      await logAcesso(req, 'falha', null, cpf, 'CPF inexistente');
      throw new ErroHttp(401, 'CPF ou senha inválidos.');
    }
    const acesso = await acessoDoOperador(op.id);
    if (!acesso || acesso.situacao !== 'LIBERADO') {
      await logAcesso(req, 'falha', op.id, cpf, 'sem liberação para o aplicativo');
      throw new ErroHttp(403, 'Acesso ao aplicativo do ACS não liberado. Procure o responsável pela unidade de saúde.');
    }
    if (!op.ativo) throw new ErroHttp(403, 'Operador inativo.');
    if (op.bloqueado) throw new ErroHttp(423, 'Acesso bloqueado após tentativas inválidas. Solicite o desbloqueio ao responsável pela unidade.');
    const max = await parametro<number>('acs.max_tentativas', 3);
    if (!(await conferirSenha(b.senha, op.senha_hash))) {
      const tentativas = (op.tentativas_invalidas ?? 0) + 1;
      const bloquear = tentativas >= max;
      await transacao({ usuarioId: op.id, ip: req.ip, rotina: 'acs:login' }, (c) =>
        c.query(`update seg.operador set tentativas_invalidas = $2, bloqueado = $3 where id = $1`, [op.id, tentativas, bloquear]),
      );
      await logAcesso(req, bloquear ? 'bloqueio' : 'falha', op.id, cpf, `tentativa ${tentativas}`);
      throw new ErroHttp(401, bloquear ? `Acesso bloqueado após ${max} tentativas inválidas.` : `CPF ou senha inválidos. Restam ${max - tentativas} tentativa(s) antes do bloqueio.`);
    }
    await transacao({ usuarioId: op.id, ip: req.ip, rotina: 'acs:login' }, (c) => c.query(`update seg.operador set tentativas_invalidas = 0 where id = $1 and tentativas_invalidas <> 0`, [op.id]));
    const token = gerarToken();
    await pool.query(`insert into seg.sessao (token_hash, operador_id, ip, agente, unidade_id) values ($1,$2,$3,$4,$5)`, [
      hashToken(token),
      op.id,
      req.ip,
      req.headers['user-agent'] ?? null,
      acesso.unidade_id,
    ]);
    await logAcesso(req, 'login', op.id, cpf);
    reply.setCookie(NOME_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: emProducao });
    return { ok: true, precisaTrocarSenha: !!senhaAtendePolitica(b.senha) || !!op.senha_expirada };
  });

  app.post('/api/acs/sair', async (req, reply) => {
    const u = req.usuario;
    if (u) await pool.query(`update seg.sessao set encerrada_em = now(), motivo_encerramento = 'logout app ACS' where id = $1`, [u.sessaoId]);
    limparCacheSessao();
    reply.clearCookie(NOME_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/acs/trocar-senha', async (req) => {
    const u = exigirAcs(req);
    const b = z.object({ senhaAtual: z.string(), novaSenha: z.string() }).parse(req.body);
    const problema = senhaAtendePolitica(b.novaSenha);
    if (problema) throw new ErroHttp(422, problema);
    const op = await consultarUm(`select senha_hash from seg.operador where id = $1`, [u.id]);
    if (!(await conferirSenha(b.senhaAtual, op?.senha_hash))) throw new ErroHttp(422, 'Senha atual incorreta.');
    if (await conferirSenha(b.novaSenha, op?.senha_hash)) throw new ErroHttp(422, 'A nova senha deve ser diferente da atual.');
    await transacao(contextoDe(req, 'acs:trocar-senha'), async (c) =>
      c.query(`update seg.operador set senha_hash = $2, senha_expirada = false, senha_alterada_em = now() where id = $1`, [u.id, await gerarHashSenha(b.novaSenha)]),
    );
    limparCacheSessao();
    return { ok: true };
  });

  app.get('/api/acs/eu', async (req) => {
    const u = exigirAcs(req);
    const acesso = await exigirAcessoAcs(u);
    const carga = await cargaAtiva(u.id);
    return {
      operador: { id: u.id, nome: u.nome, login: u.login },
      acesso: { unidadeId: acesso.unidade_id, unidade: acesso.unidade, area: acesso.area, microarea: acesso.microarea, profissional: acesso.profissional, validadeDias: acesso.validade_carga_dias },
      carga: carga ? { id: carga.id, validade: carga.validade_txt, recebidaEm: carga.recebida_em, familias: carga.familias, pessoas: carga.pessoas } : null,
      versaoApp: '2026.10',
    };
  });

  // Recebimento da carga: famílias da microárea do ACS, bloqueadas para edição até o retorno (TR 1.2.49.12.1.1, 1.2.49.12.2).
  app.post('/api/acs/carga/receber', async (req) => {
    const u = exigirAcs(req);
    return transacao(contextoDe(req, 'acs:receber-carga'), async (c) => {
      const acesso = await exigirAcessoAcs(u, c);
      let carga = await cargaAtiva(u.id, c);
      if (carga && carga.validade_txt < new Date().toISOString().slice(0, 10)) {
        await c.query(`update acs.carga set situacao = 'EXPIRADA' where id = $1`, [carga.id]);
        carga = null;
      }
      if (!carga) {
        const familias = (
          await c.query(
            `select f.id, coalesce(f.atualizado_em, f.criado_em) versao from cad.familia f
              where f.ativo is not false and f.unidade_id = $1 and lpad(coalesce(f.microarea, ''), 2, '0') = $2
                and ($3::text is null or f.area is null or f.area = $3)
                and not exists (select 1 from acs.carga_familia cf join acs.carga k on k.id = cf.carga_id
                                 where cf.familia_id = f.id and k.situacao = 'ATIVA' and k.validade >= current_date and k.operador_id <> $4)`,
            [acesso.unidade_id, String(acesso.microarea).padStart(2, '0'), acesso.area || null, u.id],
          )
        ).rows;
        const pessoas = (await c.query(`select count(*)::int n from cad.pessoa where familia_id = any($1) and situacao <> 'FALECIDO'`, [familias.map((f) => f.id)])).rows[0].n;
        const nova = (
          await c.query(
            `insert into acs.carga (acesso_id, operador_id, profissional_id, unidade_id, area, microarea, recebida_em, validade, familias, pessoas, situacao, dispositivo)
             values ($1,$2,$3,$4,$5,$6,now(), current_date + $7::int, $8, $9, 'ATIVA', $10) returning id`,
            [acesso.id, u.id, acesso.profissional_id, acesso.unidade_id, acesso.area, acesso.microarea, acesso.validade_carga_dias ?? 30, familias.length, pessoas, String(req.headers['user-agent'] ?? '').slice(0, 300)],
          )
        ).rows[0];
        for (const f of familias) await c.query(`insert into acs.carga_familia (carga_id, familia_id, versao) values ($1,$2,$3)`, [nova.id, f.id, f.versao]);
        carga = await cargaAtiva(u.id, c);
      }
      const pacote = await montarCarga(c, carga, acesso);
      await c.query(`update acs.carga set hash_integridade = $2 where id = $1`, [carga.id, pacote.hash]);
      return pacote;
    });
  });

  // Envio da carga: lote com visitas e cadastros coletados off-line; idempotente pelo identificador do lote (TR 1.2.49.12.1.2, 1.2.49.13.8).
  app.post('/api/acs/carga/enviar', async (req) => {
    const u = exigirAcs(req);
    const b = z
      .object({ loteUuid: z.string().min(8).max(40), cargaId: z.number(), hash: z.string().length(64), finalizar: z.boolean().default(false), registros: z.record(z.any()) })
      .parse(req.body) as LoteAcs & { finalizar: boolean };
    // Integridade do lote: o hash SHA-256 calculado no dispositivo deve conferir (TR 1.2.49.10).
    if (sha256(JSON.stringify(b.registros)) !== b.hash) throw new ErroHttp(422, 'Falha de integridade: o conteúdo do lote não confere com o hash enviado pelo dispositivo.');
    const anterior = await consultarUm(`select resultado from acs.sincronizacao where lote_uuid = $1`, [b.loteUuid]);
    if (anterior) return { ...anterior.resultado, repetido: true };
    return transacao(contextoDe(req, 'acs:enviar-carga'), async (c) => {
      const acesso = await exigirAcessoAcs(u, c);
      const carga = (await c.query(`select * from acs.carga where id = $1 and operador_id = $2`, [b.cargaId, u.id])).rows[0];
      if (!carga) throw new ErroHttp(404, 'Carga não encontrada para este ACS.');
      if (carga.situacao === 'CANCELADA') throw new ErroHttp(409, 'Esta carga foi cancelada pela unidade de saúde. Receba uma nova carga.');
      if (carga.situacao === 'RETORNADA') throw new ErroHttp(409, 'Esta carga já foi retornada.');
      const r = await processarLote(c, b, u, acesso, carga);
      if (b.finalizar) await c.query(`update acs.carga set situacao = 'RETORNADA', retornada_em = now() where id = $1`, [carga.id]);
      return { ...r, finalizada: b.finalizar };
    });
  });

  // Cancelamento da carga pelo próprio ACS: descarta a carga do dispositivo e libera as famílias (TR 1.2.49.12.1.3).
  app.post('/api/acs/carga/cancelar', async (req) => {
    const u = exigirAcs(req);
    const { cargaId, motivo } = z.object({ cargaId: z.number(), motivo: z.string().min(3).max(250) }).parse(req.body);
    await transacao(contextoDe(req, 'acs:cancelar-carga'), async (c) => {
      const r = await c.query(`update acs.carga set situacao = 'CANCELADA', cancelada_em = now(), cancelada_por = $3, motivo = $4 where id = $1 and operador_id = $2 and situacao = 'ATIVA'`, [cargaId, u.id, u.id, `Cancelada pelo ACS: ${motivo}`]);
      if (!r.rowCount) throw new ErroHttp(409, 'Carga não está ativa.');
    });
    return { ok: true };
  });

  // Histórico de visitas do ACS e indicadores do território (consultados quando on-line).
  app.get('/api/acs/indicadores', async (req) => {
    const u = exigirAcs(req);
    const acesso = await exigirAcessoAcs(u);
    return consultarUm(
      `select count(*)::int visitas_mes, count(*) filter (where desfecho = 'REALIZADA')::int realizadas_mes, count(*) filter (where desfecho = 'AUSENTE')::int ausentes_mes,
              count(*) filter (where desfecho = 'RECUSADA')::int recusadas_mes, count(distinct familia_id)::int familias_visitadas_mes,
              (select count(*)::int from cad.familia f where f.unidade_id = $2 and lpad(coalesce(f.microarea,''),2,'0') = $3 and f.ativo is not false) familias_territorio,
              (select count(*)::int from age.lista_espera l where l.origem = 'ACS' and l.profissional_solicitante_id = $1 and l.situacao = 'AGUARDANDO') solicitacoes_aguardando
         from acs.visita where profissional_id = $1 and data_hora >= date_trunc('month', now())`,
      [acesso.profissional_id, acesso.unidade_id, String(acesso.microarea).padStart(2, '0')],
    );
  });

  // ---------------------------------------------------------------- gestão pela unidade

  // Gerenciamento das cargas pelo operador da unidade: cancelamento e redefinição da validade (TR 1.2.49.8, 1.2.49.8.1, 1.2.49.8.2).
  app.get('/api/acs/cargas', async (req) => {
    const u = exigirPermissao(req, 'acs_carga:consultar');
    const q = req.query as any;
    return consultar(
      `select k.id, k.situacao, k.recebida_em, k.validade::text validade, k.familias, k.pessoas, k.area, k.microarea, k.ultima_sincronizacao, k.retornada_em,
              k.cancelada_em, k.motivo, o.nome responsavel, u.nome unidade, k.validade < current_date and k.situacao = 'ATIVA' vencida,
              (select count(*)::int from acs.conflito x where x.carga_id = k.id and x.situacao = 'PENDENTE') conflitos_pendentes,
              (select count(*)::int from acs.visita v where v.carga_id = k.id) visitas
         from acs.carga k left join seg.operador o on o.id = k.operador_id left join cad.unidade u on u.id = k.unidade_id
        where ($1::text is null or k.situacao = $1) and ($2::boolean or k.unidade_id = any($3))
        order by (k.situacao = 'ATIVA') desc, k.recebida_em desc limit 300`,
      [q.situacao || null, u.administrador, u.unidades],
    );
  });

  async function cargaDaUnidade(req: FastifyRequest) {
    const u = exigirPermissao(req, 'acs_carga:alterar');
    const carga = await consultarUm(`select * from acs.carga where id = $1`, [(req.params as any).id]);
    if (!carga) throw new ErroHttp(404, 'Carga não encontrada.');
    if (!u.administrador && !u.unidades.includes(Number(carga.unidade_id))) throw new ErroHttp(403, 'Carga de outra unidade de saúde.');
    return { u, carga };
  }

  app.post('/api/acs/cargas/:id/cancelar', async (req) => {
    const { u, carga } = await cargaDaUnidade(req);
    const { motivo } = z.object({ motivo: z.string().min(3).max(250) }).parse(req.body);
    if (carga.situacao !== 'ATIVA') throw new ErroHttp(409, 'Somente cargas ativas podem ser canceladas.');
    await transacao(contextoDe(req, 'acs_carga:cancelar'), (c) =>
      c.query(`update acs.carga set situacao = 'CANCELADA', cancelada_em = now(), cancelada_por = $2, motivo = $3 where id = $1`, [carga.id, u.id, motivo]),
    );
    return { ok: true };
  });

  app.post('/api/acs/cargas/:id/validade', async (req) => {
    const { carga } = await cargaDaUnidade(req);
    const b = z.object({ validade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), motivo: z.string().min(3).max(250) }).parse(req.body);
    if (!['ATIVA', 'EXPIRADA'].includes(carga.situacao)) throw new ErroHttp(409, 'Somente cargas ativas ou expiradas podem ter a validade redefinida.');
    if (b.validade < new Date().toISOString().slice(0, 10)) throw new ErroHttp(422, 'A nova validade não pode ser anterior a hoje.');
    await transacao(contextoDe(req, 'acs_carga:validade'), (c) =>
      c.query(`update acs.carga set validade = $2, situacao = 'ATIVA', motivo = $3 where id = $1`, [carga.id, b.validade, `Validade redefinida: ${b.motivo}`]),
    );
    return { ok: true };
  });

  app.get('/api/acs/conflitos', async (req) => {
    exigirPermissao(req, 'acs_carga:consultar');
    const q = req.query as any;
    return consultar(
      `select x.id, x.carga_id, x.tabela, x.registro_id, x.descricao, x.dados_dispositivo, x.dados_servidor, x.situacao, x.resolvido_em, o.nome resolvido_por, s.data_hora, op.nome acs
         from acs.conflito x left join acs.sincronizacao s on s.id = x.sincronizacao_id left join seg.operador op on op.id = s.operador_id
         left join seg.operador o on o.id = x.resolvido_por where ($1::text is null or x.situacao = $1) order by x.id desc limit 200`,
      [q.situacao || null],
    );
  });

  app.post('/api/acs/conflitos/:id/resolver', async (req) => {
    const u = exigirPermissao(req, 'acs_carga:alterar');
    const { aplicar } = z.object({ aplicar: z.boolean() }).parse(req.body);
    return transacao(contextoDe(req, 'acs_conflito:resolver'), async (c) => {
      const x = (await c.query(`select * from acs.conflito where id = $1 for update`, [(req.params as any).id])).rows[0];
      if (!x || x.situacao !== 'PENDENTE') throw new ErroHttp(409, 'Conflito já resolvido.');
      if (aplicar) {
        if (!x.registro_id) throw new ErroHttp(422, 'Registro sem código: inclua o integrante pelo cadastro de pacientes.');
        const ent = obterEntidade(x.tabela === 'FAMILIA' ? 'familia' : 'paciente')!;
        transacoesLiberadas.add(c);
        try {
          await alterar(ent, Number(x.registro_id), x.dados_dispositivo, contextoDe(req, 'acs_conflito:resolver'), u, c);
        } finally {
          transacoesLiberadas.delete(c);
        }
      }
      await c.query(`update acs.conflito set situacao = $2, resolvido_por = $3, resolvido_em = now() where id = $1`, [x.id, aplicar ? 'APLICADO' : 'DESCARTADO', u.id]);
      return { ok: true };
    });
  });

  // Locais das visitas para o mapa interativo (satélite) e mapa de calor da cobertura (TR 1.2.49.2.1).
  app.get('/api/acs/mapa', async (req) => {
    const usuario = exigirUsuario(req);
    const acesso = await acessoDoOperador(usuario.id);
    const gestor = temPermissao(usuario, 'acs_visita:consultar');
    if (!acesso && !gestor) throw new ErroHttp(403, 'Operador sem permissão para esta ação.');
    const q = req.query as any;
    // O ACS visualiza somente as próprias visitas; a gestão visualiza todas.
    const proprio = acesso && !gestor ? acesso.profissional_id : null;
    const visitas = await consultar(
      `select v.id, v.latitude, v.longitude, v.data_hora, v.desfecho, v.motivos, v.microarea, pr.nome profissional, p.nome pessoa, f.codigo familia
         from acs.visita v left join cad.profissional pr on pr.id = v.profissional_id left join cad.pessoa p on p.id = v.pessoa_id
         left join cad.familia f on f.id = v.familia_id
        where v.latitude is not null and v.data_hora::date between coalesce($1::date, current_date - 90) and coalesce($2::date, current_date)
          and ($3::bigint is null or v.profissional_id = $3) and ($4::bigint is null or v.unidade_id = $4) and ($5::bigint is null or v.profissional_id = $5)
        order by v.data_hora desc limit 5000`,
      [q.de || null, q.ate || null, q.profissionalId ? Number(q.profissionalId) : null, q.unidadeId ? Number(q.unidadeId) : null, proprio],
    );
    const familias = await consultar(
      `select f.id, f.codigo, f.latitude, f.longitude, f.microarea, r.nome responsavel,
              (select max(v.data_hora) from acs.visita v where v.familia_id = f.id) ultima_visita
         from cad.familia f left join cad.pessoa r on r.id = f.responsavel_id
        where f.latitude is not null and f.ativo is not false and ($1::bigint is null or f.unidade_id = $1) limit 5000`,
      [q.unidadeId ? Number(q.unidadeId) : null],
    );
    return { visitas, familias };
  });
}
