// Rotas do aplicativo/portal do cidadão (/api/cidadao/*, sessão própria) e das telas de
// operadores que liberam acessos e configuram o aplicativo (/api/portal/*) (TR 1.2.41).
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { somenteDigitos, senhaAtendePolitica, validarCns, validarCpf } from '../../compartilhado/validacao.js';
import { inserir } from '../../meta/crud.js';
import { obterEntidade } from '../../meta/registro.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { conferirSenha, gerarHashSenha, gerarSenhaTemporaria } from '../../seguranca/senha.js';
import { contextoDe, ErroHttp, exigirPermissao, type Usuario } from '../../seguranca/usuario.js';
import { lerArquivo } from '../../servicos/arquivos.js';
import { enfileirarMensagem } from '../../servicos/mensageria.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { parametro } from '../cadastros/alertas.js';
import { agendar, cancelar, notificarEvento, transferir } from '../agendamento/servico.js';
import { carteira } from '../imunizacao/servico.js';
import {
  COOKIE_CIDADAO,
  encerrarSessaoCidadao,
  exigirCidadao,
  iniciarSessaoCidadao,
  membrosDaConta,
  pessoaPermitida,
  rotaCidadao,
} from './auth.js';
import {
  avisarCidadao,
  campanhasAbertas,
  detalheAtendimento,
  exames,
  exigirFuncionalidade,
  filaPublica,
  funcionalidades,
  FUNCIONALIDADES,
  historicoAtendimentos,
  horariosLivres,
  listasAgendamentos,
  medicamentos,
  medicamentosDisponiveis,
  modoAgendamento,
  ofertas,
  reaproveitarVaga,
  registrarEvento,
  unidades,
  usuarioAplicativo,
  validarAntecedenciaCancelamento,
  antecedencias,
} from './servico.js';
import { registrarDestinoGovbr } from '../govbr/rotas.js';
import './relatorios.js';

registrarPermissao('portal_configuracao', 'Configurar o aplicativo do cidadão', 'APP', ['executar']);
registrarPermissao('portal_agendamento', 'Confirmar agendamentos solicitados pelo aplicativo', 'APP', ['executar']);

export const VERSAO_TERMOS_APP = '2026.1';
const TERMOS_PADRAO =
  'Ao utilizar o aplicativo de saúde do município, você declara que: (1) as informações de acesso (Cartão Nacional de Saúde e senha) são pessoais e intransferíveis; ' +
  '(2) seus dados pessoais e de saúde e os de seus dependentes são tratados pela Secretaria Municipal de Saúde exclusivamente para a prestação dos serviços do SUS, ' +
  'nos termos da Lei 13.709/2018 (LGPD), podendo ser consultados pelos profissionais que o atendem; (3) os acessos são registrados com data, hora e endereço IP; ' +
  '(4) você pode solicitar a qualquer momento, na unidade de saúde ou pela ouvidoria, a correção dos seus dados ou a revogação do acesso ao aplicativo; ' +
  '(5) as notificações de agendamentos podem ser enviadas por SMS, e-mail e pelo aplicativo conforme suas preferências.';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const n = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
const fmt = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

async function logAcesso(req: FastifyRequest, evento: string, login: string, detalhe?: string) {
  await pool.query(`insert into aud.log_acesso (operador_id, login, evento, ip, agente, detalhe) values (null,$1,$2,$3,$4,$5)`, [
    `cidadao:${login}`,
    evento,
    req.ip,
    req.headers['user-agent'] ?? null,
    detalhe ?? null,
  ]);
}

/** Localiza a conta pelo CNS (login) ou, alternativamente, pelo CPF. */
async function contaPorLogin(login: string) {
  const d = somenteDigitos(login);
  return consultarUm(
    `select c.*, p.nome, p.data_nascimento::text nascimento, p.celular pessoa_celular, p.email pessoa_email, u.nome unidade
       from portal.conta c left join cad.pessoa p on p.id = c.pessoa_id left join cad.unidade u on u.id = c.unidade_id
      where c.cns = $1 or (length($1) = 11 and (c.cpf = $1 or p.cpf = $1)) order by c.id desc limit 1`,
    [d],
  );
}

async function enviarAoCidadao(c: { pessoaId: number | null; celular?: string | null; email?: string | null }, assunto: string, texto: string, evento: string) {
  if (c.celular) await enfileirarMensagem({ pacienteId: c.pessoaId, meio: 'sms', destinatario: c.celular, texto, evento });
  if (c.email) await enfileirarMensagem({ pacienteId: c.pessoaId, meio: 'email', destinatario: c.email, assunto, texto, evento });
}

function unidadeDoOperador(u: Usuario, unidadeId: number | null) {
  // Liberação somente por operador responsável pela unidade de saúde da conta (TR 1.2.41.3).
  if (unidadeId && !u.administrador && !u.unidades.includes(unidadeId)) throw new ErroHttp(403, 'A liberação deve ser feita por operador da unidade de saúde responsável pela solicitação.');
}

// Entrada com a conta gov.br: identidade validada pelo governo federal dispensa a solicitação e a
// liberação pela unidade (TR 1.1.1.29.5.1). Os dados de nascimento/sexo não vêm do gov.br, por isso a
// pessoa precisa existir no cadastro único (localizada pelo CPF).
registrarDestinoGovbr('cidadao', async (req, reply, d) => {
  const erro = (m: string) => '/cidadao?erro=' + encodeURIComponent(m);
  const cpf = somenteDigitos(d.cpf);
  const pessoa = await consultarUm(`select id, nome, cns, cpf, data_nascimento::text nascimento, nome_mae, celular, email, unidade_referencia_id, situacao from cad.pessoa where cpf = $1`, [cpf]);
  if (!pessoa) return erro('CPF da conta gov.br não encontrado no cadastro do SUS municipal. Procure uma unidade de saúde para se cadastrar.');
  if (pessoa.situacao === 'FALECIDO') return erro('Cadastro indisponível. Procure uma unidade de saúde.');
  let conta = await consultarUm(`select * from portal.conta where pessoa_id = $1 or (cns is not null and cns = $2) order by id desc limit 1`, [pessoa.id, pessoa.cns]);
  if (conta?.situacao === 'INATIVA') return erro('Acesso ao aplicativo inativado. Procure a unidade de saúde.');
  const versao = await parametro<string>('portal.versao_termos', VERSAO_TERMOS_APP);
  await transacao({ ip: req.ip, rotina: 'portal:govbr' }, async (c) => {
    if (conta) {
      // Conta pendente, recusada ou bloqueada por tentativas é liberada pela autenticação gov.br.
      await c.query(
        `update portal.conta set pessoa_id = $2, situacao = 'ATIVA', liberado_em = coalesce(liberado_em, now()), motivo = case when situacao = 'ATIVA' then motivo else 'Liberada pela autenticação gov.br (nível ' || $3 || ')' end,
                tentativas_invalidas = 0, bloqueado_em = null, email = coalesce(email, $4), celular = coalesce(celular, $5) where id = $1`,
        [conta.id, pessoa.id, d.nivel, d.email ?? null, somenteDigitos(d.telefone) || null],
      );
    } else {
      if (!pessoa.cns) throw new ErroHttp(422, 'sem-cns');
      conta = (
        await c.query(
          `insert into portal.conta (pessoa_id, cns, cpf, nome_informado, nascimento_informado, mae_informada, email, celular, unidade_id, situacao, solicitado_em, liberado_em, motivo,
                                     tentativas_invalidas, termos_versao, termos_aceitos_em)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ATIVA',now(),now(),'Criada pela autenticação gov.br (nível ' || $10 || ')',0,$11,now()) returning *`,
          [pessoa.id, pessoa.cns, cpf, pessoa.nome, pessoa.nascimento, pessoa.nome_mae, d.email ?? pessoa.email, somenteDigitos(d.telefone) || pessoa.celular, pessoa.unidade_referencia_id, d.nivel, versao],
        )
      ).rows[0];
      await c.query(`insert into sis.aceite (tipo, versao, cidadao_id, ip, agente) values ('termos_app', $1, $2, $3, $4)`, [versao, pessoa.id, req.ip, req.headers['user-agent'] ?? null]);
    }
  }).catch((e) => {
    if (e instanceof ErroHttp && e.message === 'sem-cns') conta = null;
    else throw e;
  });
  if (!conta) return erro('Cadastro sem Cartão Nacional de Saúde. Procure uma unidade de saúde para regularizar o cadastro.');
  await iniciarSessaoCidadao(req, reply, conta.id);
  await logAcesso(req, 'login_govbr', pessoa.cns ?? cpf, `nível ${d.nivel}`);
  return '/cidadao';
});

export default async function rotasPortal(app: FastifyInstance) {
  // ---------------------------------------------------------------- acesso público do aplicativo

  rotaCidadao(
    app,
    'GET',
    '/api/cidadao/publico/info',
    async () => ({
      termos: await parametro<string>('portal.termos_uso', TERMOS_PADRAO),
      versaoTermos: await parametro<string>('portal.versao_termos', VERSAO_TERMOS_APP),
      maxTentativas: await parametro<number>('portal.max_tentativas', 3),
      funcionalidades: await funcionalidades(),
      municipio: await parametro<string>('entidade.nome', 'Prefeitura Municipal'),
      secretaria: await parametro<string>('entidade.secretaria', 'Secretaria Municipal de Saúde'),
    }),
    { anonima: true },
  );

  // Solicitação de acesso pelo próprio aplicativo; liberação pelo operador da unidade (TR 1.2.41.3, 1.2.41.4).
  rotaCidadao(
    app,
    'POST',
    '/api/cidadao/solicitar-acesso',
    async (req, reply) => {
      const b = z
        .object({
          cns: z.string(),
          cpf: z.string().optional().nullable(),
          nome: z.string().min(5).max(70),
          nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          nomeMae: z.string().max(70).optional().nullable(),
          email: z.string().email().optional().nullable().or(z.literal('')),
          celular: z.string().optional().nullable(),
          senha: z.string(),
          aceiteTermos: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar os termos de uso e a política de privacidade.' }) }),
        })
        .parse(req.body);
      const cns = somenteDigitos(b.cns);
      const cpf = somenteDigitos(b.cpf) || null;
      if (!validarCns(cns)) throw new ErroHttp(422, 'Cartão Nacional de Saúde inválido.', { cns: 'CNS inválido.' });
      if (cpf && !validarCpf(cpf)) throw new ErroHttp(422, 'CPF inválido.', { cpf: 'CPF inválido.' });
      const problema = senhaAtendePolitica(b.senha);
      if (problema) throw new ErroHttp(422, problema, { senha: problema });
      const celular = somenteDigitos(b.celular) || null;
      if (!celular && !b.email) throw new ErroHttp(422, 'Informe um celular ou e-mail para receber avisos e recuperar a senha.');

      const pessoa = await consultarUm(
        `select id, data_nascimento::text nascimento, unidade_referencia_id, situacao from cad.pessoa where cns = $1 or ($2::text is not null and cpf = $2) order by (cns = $1) desc limit 1`,
        [cns, cpf],
      );
      // Conferência de identidade: data de nascimento do cadastro único.
      if (pessoa && pessoa.nascimento !== b.nascimento) throw new ErroHttp(422, 'Os dados informados não conferem com o cadastro do Cartão SUS. Procure a unidade de saúde.');
      const existente = await consultarUm(`select id, situacao from portal.conta where cns = $1`, [cns]);
      if (existente && !['RECUSADA', 'INATIVA'].includes(existente.situacao)) {
        throw new ErroHttp(409, existente.situacao === 'SOLICITADA' ? 'Já existe uma solicitação de acesso para este Cartão SUS aguardando liberação.' : 'Este Cartão SUS já possui acesso ao aplicativo. Use "Esqueci minha senha" se necessário.');
      }
      const unidadePadrao = await parametro<number | null>('portal.unidade_liberacao_padrao', null);
      const senhaHash = await gerarHashSenha(b.senha);
      const versao = await parametro<string>('portal.versao_termos', VERSAO_TERMOS_APP);
      const dados = [
        pessoa?.id ?? null, cns, cpf, b.nome.toUpperCase(), b.nascimento, b.nomeMae?.toUpperCase() || null, b.email || null, celular,
        pessoa?.unidade_referencia_id ?? unidadePadrao, senhaHash, versao,
      ];
      const id = await transacao({ ip: req.ip, rotina: 'portal:solicitar-acesso' }, async (c) => {
        const r = existente
          ? await c.query(
              `update portal.conta set pessoa_id=$2, cns=$3, cpf=$4, nome_informado=$5, nascimento_informado=$6, mae_informada=$7, email=$8, celular=$9, unidade_id=$10,
                      senha_hash=$11, termos_versao=$12, termos_aceitos_em=now(), situacao='SOLICITADA', solicitado_em=now(), motivo=null, tentativas_invalidas=0,
                      senha_alterada_em=now(), liberado_em=null, liberado_por=null where id=$1 returning id`,
              [existente.id, ...dados],
            )
          : await c.query(
              `insert into portal.conta (pessoa_id, cns, cpf, nome_informado, nascimento_informado, mae_informada, email, celular, unidade_id, senha_hash, termos_versao,
                                         termos_aceitos_em, situacao, solicitado_em, senha_alterada_em, tentativas_invalidas)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),'SOLICITADA',now(),now(),0) returning id`,
              dados,
            );
        // Consentimento LGPD registrado com data, hora, IP e dispositivo.
        await c.query(`insert into sis.aceite (tipo, versao, cidadao_id, ip, agente) values ('termos_app', $1, $2, $3, $4)`, [versao, pessoa?.id ?? null, req.ip, req.headers['user-agent'] ?? null]);
        return r.rows[0].id as number;
      });
      await logAcesso(req, 'solicitacao_acesso', cns);
      return reply.status(201).send({ ok: true, id, mensagem: 'Solicitação enviada. Você será avisado quando a unidade de saúde liberar o acesso.' });
    },
    { anonima: true, limite: 10 },
  );

  // Login pelo CNS e senha; bloqueio após tentativas inválidas (TR 1.2.41.4, 1.2.41.5).
  rotaCidadao(
    app,
    'POST',
    '/api/cidadao/login',
    async (req, reply) => {
      const b = z.object({ login: z.string().min(11), senha: z.string().min(1) }).parse(req.body);
      const conta = await contaPorLogin(b.login);
      const login = somenteDigitos(b.login);
      if (!conta) {
        await logAcesso(req, 'falha', login, 'conta inexistente');
        throw new ErroHttp(401, 'Cartão SUS ou senha inválidos.');
      }
      if (conta.situacao === 'SOLICITADA') throw new ErroHttp(403, `Sua solicitação de acesso aguarda liberação${conta.unidade ? ` pela unidade ${conta.unidade}` : ' pela unidade de saúde'}.`);
      if (conta.situacao === 'RECUSADA') throw new ErroHttp(403, `Solicitação de acesso recusada${conta.motivo ? `: ${conta.motivo}` : ''}. Procure a unidade de saúde.`);
      if (conta.situacao === 'INATIVA') throw new ErroHttp(403, 'Acesso inativado. Procure a unidade de saúde.');
      if (conta.situacao === 'BLOQUEADA') throw new ErroHttp(423, 'Acesso bloqueado após tentativas inválidas. Use "Esqueci minha senha" ou procure a unidade de saúde.', { bloqueado: true });
      const max = await parametro<number>('portal.max_tentativas', 3);
      if (!(await conferirSenha(b.senha, conta.senha_hash))) {
        const tentativas = (conta.tentativas_invalidas ?? 0) + 1;
        const bloquear = tentativas >= max;
        await transacao({ ip: req.ip, rotina: 'portal:login' }, (c) =>
          c.query(`update portal.conta set tentativas_invalidas = $2, situacao = case when $3 then 'BLOQUEADA' else situacao end, bloqueado_em = case when $3 then now() else bloqueado_em end, motivo = case when $3 then 'Bloqueio automático após tentativas inválidas' else motivo end where id = $1`, [conta.id, tentativas, bloquear]),
        );
        await logAcesso(req, bloquear ? 'bloqueio' : 'falha', login, `tentativa ${tentativas}`);
        throw new ErroHttp(401, bloquear ? `Acesso bloqueado após ${max} tentativas inválidas. Use "Esqueci minha senha" para desbloquear.` : `Cartão SUS ou senha inválidos. Restam ${max - tentativas} tentativa(s) antes do bloqueio.`, { bloqueado: bloquear });
      }
      if (!conta.pessoa_id) throw new ErroHttp(403, 'Conta sem vínculo com o cadastro do paciente. Procure a unidade de saúde.');
      await iniciarSessaoCidadao(req, reply, conta.id);
      await logAcesso(req, 'login', login);
      return { ok: true };
    },
    { anonima: true, limite: 30 },
  );

  rotaCidadao(app, 'POST', '/api/cidadao/sair', async (req, reply) => {
    await encerrarSessaoCidadao(req, reply);
    return { ok: true };
  }, { anonima: true });

  // Recuperação de senha: código enviado por SMS/e-mail; também desbloqueia o acesso.
  rotaCidadao(
    app,
    'POST',
    '/api/cidadao/recuperar-senha',
    async (req) => {
      const b = z.object({ login: z.string(), nascimento: z.string() }).parse(req.body);
      const conta = await contaPorLogin(b.login);
      const ok = conta && ['ATIVA', 'BLOQUEADA'].includes(conta.situacao) && (conta.nascimento ?? conta.nascimento_informado?.toString?.().slice(0, 10)) === b.nascimento;
      if (ok) {
        const codigo = String(randomInt(100000, 999999));
        const celular = conta.celular ?? conta.pessoa_celular;
        const email = conta.email ?? conta.pessoa_email;
        await pool.query(`update portal.recuperacao_senha set usado_em = now() where conta_id = $1 and usado_em is null`, [conta.id]);
        await pool.query(`insert into portal.recuperacao_senha (conta_id, codigo_hash, meio, expira_em, tentativas) values ($1,$2,$3, now() + interval '15 minutes', 0)`, [
          conta.id,
          hash(`${conta.id}:${codigo}`),
          [celular && 'SMS', email && 'EMAIL'].filter(Boolean).join('/'),
        ]);
        await enviarAoCidadao({ pessoaId: conta.pessoa_id, celular, email }, 'Recuperação de senha - Aplicativo da Saúde', `Seu código para redefinir a senha do aplicativo da saúde é ${codigo}. Válido por 15 minutos. Não compartilhe este código.`, 'recuperacao_senha');
        await logAcesso(req, 'recuperacao_senha', somenteDigitos(b.login));
      }
      return { ok: true, mensagem: 'Se os dados conferirem com uma conta liberada, enviaremos um código por SMS e/ou e-mail cadastrados.' };
    },
    { anonima: true, limite: 5 },
  );

  rotaCidadao(
    app,
    'POST',
    '/api/cidadao/redefinir-senha',
    async (req) => {
      const b = z.object({ login: z.string(), codigo: z.string().length(6), novaSenha: z.string() }).parse(req.body);
      const problema = senhaAtendePolitica(b.novaSenha);
      if (problema) throw new ErroHttp(422, problema, { novaSenha: problema });
      const conta = await contaPorLogin(b.login);
      const rec = conta && (await consultarUm(`select * from portal.recuperacao_senha where conta_id = $1 and usado_em is null and expira_em > now() order by id desc limit 1`, [conta.id]));
      if (!conta || !rec) throw new ErroHttp(422, 'Código inválido ou expirado. Solicite um novo código.');
      if (rec.tentativas >= 5 || rec.codigo_hash !== hash(`${conta.id}:${b.codigo}`)) {
        await pool.query(`update portal.recuperacao_senha set tentativas = tentativas + 1, usado_em = case when tentativas + 1 >= 5 then now() end where id = $1`, [rec.id]);
        throw new ErroHttp(422, 'Código inválido.');
      }
      const senhaHash = await gerarHashSenha(b.novaSenha);
      await transacao({ ip: req.ip, rotina: 'portal:redefinir-senha' }, async (c) => {
        await c.query(`update portal.recuperacao_senha set usado_em = now() where id = $1`, [rec.id]);
        await c.query(
          `update portal.conta set senha_hash = $2, senha_alterada_em = now(), tentativas_invalidas = 0, bloqueado_em = null,
                  situacao = case when situacao = 'BLOQUEADA' then 'ATIVA' else situacao end where id = $1`,
          [conta.id, senhaHash],
        );
        await c.query(`update portal.sessao set encerrada_em = now() where conta_id = $1 and encerrada_em is null`, [conta.id]);
      });
      await logAcesso(req, 'senha_redefinida', somenteDigitos(b.login));
      return { ok: true };
    },
    { anonima: true, limite: 10 },
  );

  // Consultas públicas: unidades, fila de espera e medicamentos disponíveis.
  rotaCidadao(app, 'GET', '/api/cidadao/unidades', async () => unidades(), { anonima: true });
  rotaCidadao(
    app,
    'GET',
    '/api/cidadao/fila-publica',
    async (req) => {
      await exigirFuncionalidade('fila');
      const q = req.query as any;
      const pessoas = req.cidadao ? (await membrosDaConta(req.cidadao)).map((m) => m.id) : [];
      return filaPublica({ especialidadeId: n(q.especialidadeId), procedimentoId: n(q.procedimentoId) }, pessoas, q.somenteMeus === 'true' && !!req.cidadao);
    },
    { anonima: true },
  );
  rotaCidadao(
    app,
    'GET',
    '/api/cidadao/medicamentos-disponiveis',
    async (req) => {
      await exigirFuncionalidade('medicamentos');
      return medicamentosDisponiveis(((req.query as any).q as string) ?? null);
    },
    { anonima: true },
  );

  // ---------------------------------------------------------------- área autenticada

  rotaCidadao(app, 'GET', '/api/cidadao/eu', async (req) => {
    const c = exigirCidadao(req);
    const conta = await consultarUm(
      `select c.id, c.cns, c.email, c.celular, c.termos_versao, c.senha_alterada_em, p.nome, p.nome_social, p.cpf, p.sexo, p.data_nascimento::text nascimento,
              p.celular pessoa_celular, p.email pessoa_email, p.notificar_sms, p.notificar_email, p.notificar_app, p.familia_id,
              (select f.responsavel_id = p.id from cad.familia f where f.id = p.familia_id) responsavel_familiar, u.nome unidade_referencia
         from portal.conta c join cad.pessoa p on p.id = c.pessoa_id left join cad.unidade u on u.id = p.unidade_referencia_id where c.id = $1`,
      [c.contaId],
    );
    const membros = await membrosDaConta(c);
    const naoLidas = await consultarUm(
      `select count(*)::int n from sis.mensagem m where m.meio = 'push' and m.paciente_id = any($1)
          and not exists (select 1 from portal.mensagem_lida l where l.conta_id = $2 and l.mensagem_id = m.id)`,
      [membros.map((m) => m.id), c.contaId],
    );
    return { conta, membros, funcionalidades: await funcionalidades(), naoLidas: naoLidas?.n ?? 0 };
  });

  rotaCidadao(app, 'POST', '/api/cidadao/trocar-senha', async (req) => {
    const c = exigirCidadao(req);
    const b = z.object({ senhaAtual: z.string(), novaSenha: z.string() }).parse(req.body);
    const problema = senhaAtendePolitica(b.novaSenha);
    if (problema) throw new ErroHttp(422, problema, { novaSenha: problema });
    const conta = await consultarUm(`select senha_hash from portal.conta where id = $1`, [c.contaId]);
    if (!(await conferirSenha(b.senhaAtual, conta?.senha_hash))) throw new ErroHttp(422, 'Senha atual incorreta.');
    await pool.query(`update portal.conta set senha_hash = $2, senha_alterada_em = now() where id = $1`, [c.contaId, await gerarHashSenha(b.novaSenha)]);
    return { ok: true };
  });

  // Preferências de contato e de recebimento de avisos (SMS, e-mail, aplicativo) (TR 1.2.41.7.4).
  rotaCidadao(app, 'PUT', '/api/cidadao/contato', async (req) => {
    const c = exigirCidadao(req);
    const b = z
      .object({ celular: z.string().optional().nullable(), email: z.string().email().optional().nullable().or(z.literal('')), notificarSms: z.boolean(), notificarEmail: z.boolean(), notificarApp: z.boolean() })
      .parse(req.body);
    await transacao({ ip: req.ip, rotina: 'portal:contato' }, async (cl) => {
      await cl.query(`update cad.pessoa set celular = $2, email = $3, notificar_sms = $4, notificar_email = $5, notificar_app = $6 where id = $1`, [
        c.pessoaId,
        somenteDigitos(b.celular) || null,
        b.email || null,
        b.notificarSms,
        b.notificarEmail,
        b.notificarApp,
      ]);
      await cl.query(`update portal.conta set celular = $2, email = $3 where id = $1`, [c.contaId, somenteDigitos(b.celular) || null, b.email || null]);
    });
    return { ok: true };
  });

  // Dependentes incluídos pelo responsável familiar ficam em pré-cadastro até a validação (TR 1.2.41.6.1 a 1.2.41.6.3).
  rotaCidadao(app, 'GET', '/api/cidadao/dependentes', async (req) => {
    const c = exigirCidadao(req);
    await exigirFuncionalidade('dependentes');
    const fam = await consultarUm(`select f.id, f.codigo, f.responsavel_id = p.id responsavel from cad.pessoa p left join cad.familia f on f.id = p.familia_id where p.id = $1`, [c.pessoaId]);
    return { familia: fam?.id ? fam : null, membros: await membrosDaConta(c) };
  });

  rotaCidadao(app, 'POST', '/api/cidadao/dependentes', async (req, reply) => {
    const c = exigirCidadao(req);
    await exigirFuncionalidade('dependentes');
    const b = z
      .object({
        nome: z.string().min(5).max(70),
        sexo: z.enum(['M', 'F']),
        nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        nomeMae: z.string().min(5).max(70),
        racaCor: z.enum(['01', '02', '03', '04', '05', '99']),
        etniaId: z.number().optional().nullable(),
        parentesco: z.enum(['CONJUGE', 'FILHO', 'ENTEADO', 'NETO', 'PAI_MAE', 'SOGRO', 'IRMAO', 'GENRO_NORA', 'OUTRO_PARENTE', 'NAO_PARENTE']),
      })
      .parse(req.body);
    const fam = await consultarUm(
      `select f.* from cad.pessoa p join cad.familia f on f.id = p.familia_id where p.id = $1 and f.responsavel_id = p.id and f.ativo is not false`,
      [c.pessoaId],
    );
    if (!fam) throw new ErroHttp(422, 'Somente o responsável por uma família cadastrada pode incluir dependentes. Procure a unidade de saúde para cadastrar sua família.');
    if (b.nascimento > new Date().toISOString().slice(0, 10)) throw new ErroHttp(422, 'Data de nascimento no futuro.');
    const validade = await parametro<number>('paciente.validade_pre_cadastro_dias', 30);
    const novo = await transacao({ ip: req.ip, rotina: 'portal:dependente' }, (cl) =>
      inserir(
        obterEntidade('paciente')!,
        {
          nome: b.nome,
          sexo: b.sexo,
          data_nascimento: b.nascimento,
          nome_mae: b.nomeMae,
          raca_cor: b.racaCor,
          etnia_id: b.etniaId ?? null,
          parentesco: b.parentesco,
          situacao: 'PRE_CADASTRO',
          familia_id: fam.id,
          unidade_referencia_id: fam.unidade_id,
          municipio_id: fam.municipio_id,
          logradouro_id: fam.logradouro_id,
          numero: fam.numero,
          complemento: fam.complemento,
          bairro_id: fam.bairro_id,
          cep: fam.cep,
          microarea: fam.microarea,
        },
        { ip: req.ip, rotina: 'portal:dependente' },
        undefined,
        cl,
      ),
    );
    await pool.query(`update cad.pessoa set pre_cadastro_valido_ate = current_date + $2::int where id = $1`, [novo!.id, validade]);
    return reply.status(201).send({ id: novo!.id, mensagem: 'Dependente incluído em pré-cadastro. Compareça a uma unidade de saúde com um documento do integrante para validar o cadastro.' });
  });

  // Agendamento de consultas e exames (TR 1.2.41.7).
  rotaCidadao(app, 'GET', '/api/cidadao/agendamentos', async (req) => {
    const m = await pessoaPermitida(req, (req.query as any).pessoaId);
    await exigirFuncionalidade('agendamento');
    return listasAgendamentos([m.id]);
  });

  rotaCidadao(app, 'GET', '/api/cidadao/ofertas', async (req) => {
    await pessoaPermitida(req, (req.query as any).pessoaId);
    await exigirFuncionalidade('agendamento');
    const q = req.query as any;
    return ofertas({ especialidadeId: n(q.especialidadeId), profissionalId: n(q.profissionalId), unidadeId: n(q.unidadeId), tipo: q.tipo || null });
  });

  rotaCidadao(app, 'GET', '/api/cidadao/horarios', async (req) => {
    exigirCidadao(req);
    const q = req.query as any;
    const hoje = new Date().toISOString().slice(0, 10);
    const ate = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    return horariosLivres(Number(q.agendaId), q.de ?? hoje, q.ate ?? ate);
  });

  rotaCidadao(app, 'POST', '/api/cidadao/agendamentos', async (req, reply) => {
    const c = exigirCidadao(req);
    await exigirFuncionalidade('agendamento');
    const b = z.object({ pessoaId: z.number().optional(), horarioId: z.number(), confirmarAvisos: z.boolean().optional(), observacao: z.string().max(250).optional() }).parse(req.body);
    const m = await pessoaPermitida(req, b.pessoaId);
    const h = await consultarUm(
      `select h.*, a.disponivel_web, a.ativo, a.web_modo, a.antecedencia_agendar_horas, a.antecedencia_cancelar_horas, a.unidade_id, e.regulada, a.tipo tipo_agenda,
              (h.data + h.hora) at time zone 'America/Sao_Paulo' inicio
         from age.horario h join age.agenda a on a.id = h.agenda_id left join cad.especialidade e on e.id = a.especialidade_id where h.id = $1`,
      [b.horarioId],
    );
    if (!h || !h.disponivel_web || !h.ativo || h.regulada || h.tipo_vaga !== 'ELETIVA') throw new ErroHttp(422, 'Horário não disponível para marcação pelo aplicativo.');
    const { agendarHoras } = await antecedencias(h);
    if (new Date(h.inicio).getTime() - Date.now() < agendarHoras * 3_600_000) throw new ErroHttp(422, `A marcação pelo aplicativo exige antecedência mínima de ${agendarHoras} horas.`);
    const modo = await modoAgendamento(h);
    const pessoaUnidade = await consultarUm(`select unidade_referencia_id from cad.pessoa where id = $1`, [m.id]);
    const ag = await transacao({ ip: req.ip, rotina: 'portal:agendar' }, async (cl) => {
      const novo = await agendar(
        cl,
        {
          horarioId: b.horarioId,
          pacienteId: m.id,
          origem: 'APLICATIVO',
          confirmarAvisos: b.confirmarAvisos,
          situacaoInicial: modo === 'SOLICITACAO' ? 'SOLICITADO' : 'AGENDADO',
          unidadeSolicitanteId: pessoaUnidade?.unidade_referencia_id ?? h.unidade_id,
          observacao: b.observacao ? `Aplicativo: ${b.observacao}` : 'Agendado pelo aplicativo do cidadão',
        },
        usuarioAplicativo(pessoaUnidade?.unidade_referencia_id ?? null),
      );
      await registrarEvento(cl, { agendamentoId: novo.id, contaId: c.contaId, pessoaId: m.id, evento: modo === 'SOLICITACAO' ? 'SOLICITACAO' : 'AGENDAMENTO', responsavel: `${c.nome} (aplicativo)` });
      const quando = `${fmt(novo.data instanceof Date ? novo.data.toISOString() : String(novo.data))} às ${String(novo.hora ?? '').slice(0, 5)}`;
      await avisarCidadao(
        cl,
        m.id,
        modo === 'SOLICITACAO' ? 'Solicitação de agendamento recebida' : 'Agendamento confirmado',
        modo === 'SOLICITACAO'
          ? `Recebemos a solicitação de consulta para ${m.nome} em ${quando}. Você será avisado quando a unidade confirmar. Protocolo ${novo.senha}.`
          : `Consulta de ${m.nome} confirmada para ${quando}. Protocolo ${novo.senha}.`,
        `agendamento:${novo.id}`,
        'agendamento',
        modo === 'SOLICITACAO' ? undefined : 'AGENDAMENTO',
      );
      return novo;
    });
    return reply.status(201).send({ id: ag.id, senha: ag.senha, situacao: ag.situacao, modo });
  });

  async function agendamentoDoCidadao(req: FastifyRequest) {
    const id = Number((req.params as any).id);
    const ag = await consultarUm(`select a.*, a.data::text data_txt, to_char(a.hora,'HH24:MI') hora_txt from age.agendamento a where a.id = $1`, [id]);
    if (!ag) throw new ErroHttp(404, 'Agendamento não encontrado.');
    const m = await pessoaPermitida(req, ag.paciente_id);
    return { ag, m };
  }

  // Cancelamento pelo aplicativo com motivo, antecedência mínima e liberação da vaga (TR 1.2.41.7.9, 1.2.41.7.10).
  rotaCidadao(app, 'POST', '/api/cidadao/agendamentos/:id/cancelar', async (req) => {
    const c = exigirCidadao(req);
    const { motivo } = z.object({ motivo: z.string().min(3).max(200) }).parse(req.body);
    const { ag, m } = await agendamentoDoCidadao(req);
    if (ag.situacao !== 'SOLICITADO') await validarAntecedenciaCancelamento(ag);
    return transacao({ ip: req.ip, rotina: 'portal:cancelar' }, async (cl) => {
      await cancelar(cl, ag.id, `Cancelado pelo aplicativo: ${motivo}`, false);
      await registrarEvento(cl, { agendamentoId: ag.id, contaId: c.contaId, pessoaId: m.id, evento: 'CANCELAMENTO', motivo, responsavel: `${c.nome} (aplicativo)` });
      const reaproveitado = await reaproveitarVaga(cl, ag.horario_id);
      return { ok: true, vagaReaproveitada: !!reaproveitado };
    });
  });

  // Transferência pelo responsável familiar, respeitando a antecedência e liberando a vaga anterior (TR 1.2.41.7.16).
  rotaCidadao(app, 'POST', '/api/cidadao/agendamentos/:id/transferir', async (req) => {
    const c = exigirCidadao(req);
    const b = z.object({ horarioId: z.number(), motivo: z.string().min(3).max(200) }).parse(req.body);
    const { ag, m } = await agendamentoDoCidadao(req);
    if (!['AGENDADO', 'CONFIRMADO', 'SOLICITADO'].includes(ag.situacao)) throw new ErroHttp(409, 'Somente consultas pendentes podem ser transferidas.');
    await validarAntecedenciaCancelamento(ag);
    const h = await consultarUm(
      `select h.*, a.disponivel_web, a.especialidade_id, a.antecedencia_agendar_horas, (h.data + h.hora) at time zone 'America/Sao_Paulo' inicio
         from age.horario h join age.agenda a on a.id = h.agenda_id where h.id = $1`,
      [b.horarioId],
    );
    if (!h || !h.disponivel_web || h.situacao !== 'LIVRE' || h.tipo_vaga !== 'ELETIVA') throw new ErroHttp(422, 'Novo horário não disponível.');
    if (ag.especialidade_id && h.especialidade_id !== ag.especialidade_id) throw new ErroHttp(422, 'A transferência deve ser para a mesma especialidade.');
    const { agendarHoras } = await antecedencias(h);
    if (new Date(h.inicio).getTime() - Date.now() < agendarHoras * 3_600_000) throw new ErroHttp(422, `O novo horário exige antecedência mínima de ${agendarHoras} horas.`);
    return transacao({ ip: req.ip, rotina: 'portal:transferir' }, async (cl) => {
      const novo = await transferir(cl, ag.id, { horarioId: b.horarioId }, `Transferido pelo aplicativo: ${b.motivo}`, usuarioAplicativo(ag.unidade_solicitante_id));
      await registrarEvento(cl, { agendamentoId: ag.id, contaId: c.contaId, pessoaId: m.id, evento: 'TRANSFERENCIA', motivo: b.motivo, responsavel: `${c.nome} (aplicativo)` });
      await registrarEvento(cl, { agendamentoId: novo.id, contaId: c.contaId, pessoaId: m.id, evento: 'AGENDAMENTO', motivo: `Transferência do protocolo ${ag.senha}`, responsavel: `${c.nome} (aplicativo)` });
      await avisarCidadao(cl, m.id, 'Consulta transferida', `A consulta de ${m.nome} foi transferida para ${fmt(String(h.data instanceof Date ? h.data.toISOString() : h.data))} às ${String(h.hora).slice(0, 5)}. Protocolo ${novo.senha}.`, `agendamento:${novo.id}`, 'transferencia', 'TRANSFERENCIA');
      await reaproveitarVaga(cl, ag.horario_id);
      return { ok: true, id: novo.id, senha: novo.senha };
    });
  });

  // Vacinas: histórico, próximas doses, aprazamentos e campanhas em aberto (TR 1.2.41.8.1, 1.2.41.8.3, 1.2.41.8.4).
  rotaCidadao(app, 'GET', '/api/cidadao/vacinas', async (req) => {
    const m = await pessoaPermitida(req, (req.query as any).pessoaId);
    await exigirFuncionalidade('vacinas');
    const cart = await carteira(m.id);
    const proximas = cart.itens
      .filter((i) => ['APRAZADA', 'NO_PRAZO', 'ATRASADA', 'INDICADA'].includes(i.situacao))
      .sort((a, b) => String((a.registro as any)?.data_aprazada ?? a.previstoPara).localeCompare(String((b.registro as any)?.data_aprazada ?? b.previstoPara)));
    const aprazamentos = cart.registros.filter((r) => r.tipo === 'APRAZAMENTO');
    const aplicadas = cart.registros.filter((r) => r.tipo === 'APLICACAO' || r.tipo === 'RESGATE');
    return { pessoa: m, itens: cart.itens, aplicadas, proximas, aprazamentos, campanhas: await campanhasAbertas(m.id) };
  });

  // Impressão da carteira de vacinação do titular e dependentes (TR 1.2.41.8.2).
  rotaCidadao(app, 'GET', '/api/cidadao/vacinas/carteira', async (req, reply) => {
    const c = exigirCidadao(req);
    const m = await pessoaPermitida(req, (req.query as any).pessoaId);
    const cart = await carteira(m.id);
    const aplicadas = cart.registros.filter((r) => r.tipo === 'APLICACAO' || r.tipo === 'RESGATE');
    const proximas = cart.itens.filter((i) => ['APRAZADA', 'NO_PRAZO', 'ATRASADA'].includes(i.situacao));
    const r = await emitirDocumento(
      { relatorio: 'portal:carteira-vacinacao', titulo: 'Carteira de vacinação', filtros: { pessoa: m.id, conta: c.contaId, momento: Date.now() } },
      [
        { text: `${m.nome} — nascimento ${fmt(m.nascimento)} — CNS ${m.cns ?? '-'}`, bold: true, margin: [0, 0, 0, 6] },
        { text: 'Vacinas aplicadas', style: 'h2' },
        {
          table: {
            headerRows: 1,
            widths: [55, '*', 45, 60, '*', 70],
            body: [
              ['Data', 'Imunobiológico', 'Dose', 'Lote', 'Unidade', 'Profissional'].map((t) => ({ text: t, style: 'th' })),
              ...aplicadas.map((a) => [fmt(a.data), a.imunobiologico, a.dose ?? '-', a.lote ?? '-', a.unidade ?? '-', a.profissional ?? '-'].map((t) => ({ text: String(t), fontSize: 8 }))),
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { text: 'Próximas doses e aprazamentos', style: 'h2' },
        proximas.length
          ? { ul: proximas.map((p) => ({ text: `${p.imunobiologico} - ${p.dose}: ${p.situacao === 'ATRASADA' ? 'em atraso' : p.situacao === 'APRAZADA' ? `aprazada para ${fmt((p.registro as any)?.data_aprazada)}` : `a partir de ${fmt(p.previstoPara)}`}`, fontSize: 9 })) }
          : { text: 'Nenhuma dose pendente no calendário.', fontSize: 9 },
      ] as any,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
  });

  // Medicamentos em uso e histórico (TR 1.2.41.9.1, 1.2.41.9.2).
  rotaCidadao(app, 'GET', '/api/cidadao/medicamentos', async (req) => {
    const m = await pessoaPermitida(req, (req.query as any).pessoaId);
    await exigirFuncionalidade('medicamentos');
    return medicamentos(m.id);
  });

  // Exames: pedidos, agendados com orientações de coleta, realizados e resultados (TR 1.2.41.10.1 a 1.2.41.10.5).
  rotaCidadao(app, 'GET', '/api/cidadao/exames', async (req) => {
    const m = await pessoaPermitida(req, (req.query as any).pessoaId);
    await exigirFuncionalidade('exames');
    return exames([m.id]);
  });

  async function itemExameLiberado(req: FastifyRequest) {
    const id = Number((req.params as any).id);
    const it = await consultarUm(
      `select it.*, s.paciente_id, s.numero, s.data::text data, pc.codigo, pc.nome exame, p.nome paciente, p.cns, p.data_nascimento::text nascimento,
              pr.nome profissional, u.nome unidade, pres.nome prestador
         from amb.solicitacao_exame_item it join amb.solicitacao_exame s on s.id = it.solicitacao_id join cad.procedimento pc on pc.id = it.procedimento_id
         join cad.pessoa p on p.id = s.paciente_id left join cad.profissional pr on pr.id = s.profissional_id left join cad.unidade u on u.id = s.unidade_id
         left join cad.unidade pres on pres.id = it.prestador_id
        where it.id = $1 and not coalesce(s.uso_interno, false)`,
      [id],
    );
    if (!it) throw new ErroHttp(404, 'Exame não encontrado.');
    await pessoaPermitida(req, it.paciente_id);
    if (!it.resultado_liberado_em) throw new ErroHttp(422, 'Resultado ainda não liberado pelo laboratório/prestador.');
    return it;
  }

  rotaCidadao(app, 'GET', '/api/cidadao/exames/:id/resultado', async (req) => {
    const it = await itemExameLiberado(req);
    return { id: it.id, exame: it.exame, codigo: it.codigo, material: it.material, resultado: it.resultado_texto, liberadoEm: it.resultado_liberado_em, temLaudo: !!it.resultado_arquivo_id, prestador: it.prestador, profissional: it.profissional, numero: it.numero };
  });

  rotaCidadao(app, 'GET', '/api/cidadao/exames/:id/laudo', async (req, reply) => {
    const it = await itemExameLiberado(req);
    if (!it.resultado_arquivo_id) throw new ErroHttp(404, 'Laudo digitalizado não disponível.');
    const a = await lerArquivo(it.resultado_arquivo_id);
    return reply.header('content-type', a.tipo_mime).header('content-disposition', `inline; filename="${encodeURIComponent(a.nome)}"`).send(a.conteudo);
  });

  // Impressão do resultado do exame (TR 1.2.41.10.6).
  rotaCidadao(app, 'GET', '/api/cidadao/exames/:id/impressao', async (req, reply) => {
    const c = exigirCidadao(req);
    const it = await itemExameLiberado(req);
    const r = await emitirDocumento(
      { relatorio: 'portal:resultado-exame', titulo: 'Resultado de exame', filtros: { item: it.id, conta: c.contaId, momento: Date.now() } },
      [
        {
          table: {
            widths: [110, '*'],
            body: [
              ['Paciente', `${it.paciente} — CNS ${it.cns ?? '-'}`],
              ['Nascimento', fmt(it.nascimento)],
              ['Requisição', `${it.numero ?? '-'} de ${fmt(it.data)}`],
              ['Solicitante', [it.profissional, it.unidade].filter(Boolean).join(' - ')],
              ['Exame', `${it.codigo} - ${it.exame}${it.material ? ` (${it.material})` : ''}`],
              ['Prestador', it.prestador ?? '-'],
              ['Liberado em', new Date(it.resultado_liberado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })],
            ].map(([a, b]) => [{ text: a, bold: true, fontSize: 9 }, { text: b, fontSize: 9 }]),
          },
          layout: 'lightHorizontalLines',
        },
        { text: 'Resultado', style: 'h2' },
        { text: it.resultado_texto ?? (it.resultado_arquivo_id ? 'Laudo digitalizado disponível no aplicativo.' : '-'), fontSize: 10 },
      ] as any,
    );
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
  });

  // Históricos de atendimentos médicos, odontológicos e de enfermagem (TR 1.2.41.11 a 1.2.41.13).
  rotaCidadao(app, 'GET', '/api/cidadao/atendimentos', async (req) => {
    const m = await pessoaPermitida(req, (req.query as any).pessoaId);
    await exigirFuncionalidade('historico');
    return historicoAtendimentos(m.id);
  });
  rotaCidadao(app, 'GET', '/api/cidadao/atendimentos/:id', async (req) => {
    const m = await pessoaPermitida(req, (req.query as any).pessoaId);
    await exigirFuncionalidade('historico');
    return detalheAtendimento(m.id, Number((req.params as any).id));
  });

  // Caixa de mensagens: avisos de agendamento, confirmação e lembretes enviados ao cidadão (TR 1.2.41.7.4).
  rotaCidadao(app, 'GET', '/api/cidadao/mensagens', async (req) => {
    const c = exigirCidadao(req);
    const membros = await membrosDaConta(c);
    return consultar(
      `select m.id, m.assunto, m.texto, m.evento, m.gerada_em, m.referencia, p.nome paciente,
              exists (select 1 from portal.mensagem_lida l where l.conta_id = $2 and l.mensagem_id = m.id) lida
         from sis.mensagem m left join cad.pessoa p on p.id = m.paciente_id
        where m.meio = 'push' and m.paciente_id = any($1) order by m.id desc limit 100`,
      [membros.map((x) => x.id), c.contaId],
    );
  });
  rotaCidadao(app, 'POST', '/api/cidadao/mensagens/lidas', async (req) => {
    const c = exigirCidadao(req);
    const { ids } = z.object({ ids: z.array(z.number()).max(200) }).parse(req.body);
    const membros = await membrosDaConta(c);
    await pool.query(
      `insert into portal.mensagem_lida (conta_id, mensagem_id, lida_em)
       select $1, m.id, now() from sis.mensagem m where m.id = any($2) and m.paciente_id = any($3) on conflict do nothing`,
      [c.contaId, ids, membros.map((x) => x.id)],
    );
    return { ok: true };
  });

  // Atendimento remoto: sala virtual e conversa com o profissional da teleconsulta agendada.
  async function teleDoCidadao(req: FastifyRequest) {
    const agId = Number((req.params as any).agendamentoId);
    const ag = await consultarUm(
      `select a.*, a.data::text data_txt, to_char(a.hora,'HH24:MI') hora_txt, pr.nome profissional, e.nome especialidade from age.agendamento a
         join age.agenda g on g.id = a.agenda_id left join cad.profissional pr on pr.id = a.profissional_id left join cad.especialidade e on e.id = a.especialidade_id
        where a.id = $1 and (a.tipo = 'TELECONSULTA' or g.tipo = 'TELECONSULTA')`,
      [agId],
    );
    if (!ag) throw new ErroHttp(404, 'Teleconsulta não encontrada.');
    await pessoaPermitida(req, ag.paciente_id);
    return ag;
  }
  rotaCidadao(app, 'GET', '/api/cidadao/teleatendimentos', async (req) => {
    const c = exigirCidadao(req);
    await exigirFuncionalidade('teleatendimento');
    const membros = (await membrosDaConta(c)).filter((m) => m.situacao !== 'PRE_CADASTRO');
    return consultar(
      `select a.id, a.data::text data, to_char(a.hora,'HH24:MI') hora, a.situacao, a.senha, p.nome paciente, pr.nome profissional, e.nome especialidade, t.situacao situacao_sala
         from age.agendamento a join age.agenda g on g.id = a.agenda_id join cad.pessoa p on p.id = a.paciente_id left join cad.profissional pr on pr.id = a.profissional_id
         left join cad.especialidade e on e.id = a.especialidade_id left join portal.teleatendimento t on t.agendamento_id = a.id
        where a.paciente_id = any($1) and (a.tipo = 'TELECONSULTA' or g.tipo = 'TELECONSULTA') and a.situacao not in ('CANCELADO','TRANSFERIDO')
          and a.data >= current_date - 30 order by a.data desc, a.hora desc`,
      [membros.map((m) => m.id)],
    );
  });
  rotaCidadao(app, 'GET', '/api/cidadao/teleatendimentos/:agendamentoId', async (req) => {
    const ag = await teleDoCidadao(req);
    const sala = await salaTeleatendimento(ag.id);
    if (!sala.paciente_entrou_em && ag.data_txt === new Date().toISOString().slice(0, 10)) await pool.query(`update portal.teleatendimento set paciente_entrou_em = now() where id = $1`, [sala.id]);
    const mensagens = await consultar(`select id, autor, texto, data_hora from portal.teleatendimento_mensagem where teleatendimento_id = $1 order by id`, [sala.id]);
    return { agendamento: { id: ag.id, data: ag.data_txt, hora: ag.hora_txt, profissional: ag.profissional, especialidade: ag.especialidade, situacao: ag.situacao }, sala, mensagens };
  });
  rotaCidadao(app, 'POST', '/api/cidadao/teleatendimentos/:agendamentoId/mensagens', async (req) => {
    const ag = await teleDoCidadao(req);
    const { texto } = z.object({ texto: z.string().min(1).max(2000) }).parse(req.body);
    const sala = await salaTeleatendimento(ag.id);
    if (sala.situacao === 'ENCERRADO') throw new ErroHttp(409, 'Teleatendimento encerrado.');
    await pool.query(`insert into portal.teleatendimento_mensagem (teleatendimento_id, autor, texto, data_hora) values ($1,'PACIENTE',$2,now())`, [sala.id, texto]);
    return { ok: true };
  });

  // Avaliações e manifestações (ouvidoria) com protocolo.
  rotaCidadao(app, 'GET', '/api/cidadao/manifestacoes', async (req) => {
    const c = exigirCidadao(req);
    return consultar(
      `select m.id, m.protocolo, m.tipo, m.nota, m.texto, m.situacao, m.resposta, m.respondido_em, m.criado_em, u.nome unidade
         from portal.manifestacao m left join cad.unidade u on u.id = m.unidade_id where m.pessoa_id = $1 order by m.id desc`,
      [c.pessoaId],
    );
  });
  rotaCidadao(app, 'POST', '/api/cidadao/manifestacoes', async (req, reply) => {
    const c = exigirCidadao(req);
    await exigirFuncionalidade('manifestacoes');
    const b = z
      .object({ tipo: z.enum(['AVALIACAO', 'ELOGIO', 'SUGESTAO', 'RECLAMACAO', 'SOLICITACAO', 'DENUNCIA']), unidadeId: z.number().optional().nullable(), agendamentoId: z.number().optional().nullable(), nota: z.number().int().min(1).max(5).optional().nullable(), texto: z.string().min(3).max(4000) })
      .parse(req.body);
    if (b.agendamentoId) {
      const ag = await consultarUm(`select paciente_id from age.agendamento where id = $1`, [b.agendamentoId]);
      if (!ag) throw new ErroHttp(404, 'Agendamento não encontrado.');
      await pessoaPermitida(req, ag.paciente_id);
    }
    const protocolo = `${new Date().getFullYear()}${String(randomInt(0, 99999999)).padStart(8, '0')}`;
    await pool.query(
      `insert into portal.manifestacao (protocolo, pessoa_id, tipo, unidade_id, agendamento_id, nota, texto, situacao) values ($1,$2,$3,$4,$5,$6,$7,'ABERTA')`,
      [protocolo, c.pessoaId, b.tipo, b.unidadeId ?? null, b.agendamentoId ?? null, b.nota ?? null, b.texto],
    );
    return reply.status(201).send({ protocolo });
  });

  // ---------------------------------------------------------------- telas de operadores

  // Solicitações de acesso e contas do aplicativo (TR 1.2.41.3).
  app.get('/api/portal/contas', async (req) => {
    const u = exigirPermissao(req, 'portal_conta:consultar');
    const q = req.query as any;
    return consultar(
      `select c.id, c.cns, c.cpf, c.nome_informado, c.nascimento_informado::text nascimento_informado, c.mae_informada, c.email, c.celular, c.situacao, c.motivo,
              c.solicitado_em, c.liberado_em, c.ultimo_acesso_em, c.tentativas_invalidas, c.unidade_id, u.nome unidade, o.nome liberado_por,
              c.pessoa_id, p.nome pessoa_nome, p.data_nascimento::text pessoa_nascimento, p.nome_mae pessoa_mae, p.situacao pessoa_situacao,
              (select json_agg(json_build_object('id', s.id, 'nome', s.nome, 'nascimento', s.data_nascimento::text, 'mae', s.nome_mae, 'cns', s.cns))
                 from (select x.id, x.nome, x.data_nascimento, x.nome_mae, x.cns from cad.pessoa x
                        where c.pessoa_id is null and (x.cns = c.cns or x.cpf = c.cpf or (x.nome_busca = cad.fn_normalizar(c.nome_informado) and x.data_nascimento = c.nascimento_informado)) limit 5) s) sugestoes
         from portal.conta c left join cad.unidade u on u.id = c.unidade_id left join seg.operador o on o.id = c.liberado_por left join cad.pessoa p on p.id = c.pessoa_id
        where ($1::text is null or c.situacao = $1) and ($2::boolean or c.unidade_id is null or c.unidade_id = any($3))
          and ($4::text is null or c.cns like $4 || '%' or c.cpf like $4 || '%' or c.nome_informado ilike '%' || $4 || '%')
        order by c.solicitado_em desc limit 300`,
      [q.situacao || null, u.administrador || q.todas === 'true', u.unidades, q.q || null],
    );
  });

  async function contaParaOperador(req: FastifyRequest) {
    const u = exigirPermissao(req, 'portal_conta:alterar');
    const id = Number((req.params as any).id);
    const conta = await consultarUm(`select * from portal.conta where id = $1`, [id]);
    if (!conta) throw new ErroHttp(404, 'Conta não encontrada.');
    unidadeDoOperador(u, conta.unidade_id);
    return { u, conta };
  }

  app.post('/api/portal/contas/:id/liberar', async (req) => {
    const { u, conta } = await contaParaOperador(req);
    const b = z.object({ pessoaId: z.number().optional() }).parse(req.body ?? {});
    const pessoaId = b.pessoaId ?? conta.pessoa_id;
    if (!pessoaId) throw new ErroHttp(422, 'Vincule a solicitação a um cadastro de paciente (pesquise pelo CNS/nome ou cadastre o paciente) antes de liberar.');
    const p = await consultarUm(`select id, nome, situacao, cns, celular, email from cad.pessoa where id = $1`, [pessoaId]);
    if (!p) throw new ErroHttp(404, 'Paciente não encontrado.');
    if (p.situacao === 'FALECIDO') throw new ErroHttp(422, 'Paciente registrado como falecido.');
    const outra = await consultarUm(`select id from portal.conta where pessoa_id = $1 and id <> $2 and situacao in ('ATIVA','BLOQUEADA','SOLICITADA')`, [pessoaId, conta.id]);
    if (outra) throw new ErroHttp(409, 'Este paciente já possui outra conta no aplicativo.');
    await transacao(contextoDe(req, 'portal_conta:liberar'), async (c) => {
      await c.query(`update portal.conta set pessoa_id = $2, situacao = 'ATIVA', liberado_em = now(), liberado_por = $3, motivo = null, tentativas_invalidas = 0, bloqueado_em = null, unidade_id = coalesce(unidade_id, $4) where id = $1`, [
        conta.id,
        pessoaId,
        u.id,
        u.unidadeAtual,
      ]);
      if (!p.cns && conta.cns) await c.query(`update cad.pessoa set cns = $2 where id = $1 and cns is null`, [pessoaId, conta.cns]);
    });
    await enviarAoCidadao({ pessoaId, celular: conta.celular ?? p.celular, email: conta.email ?? p.email }, 'Acesso liberado - Aplicativo da Saúde', `Olá, ${p.nome.split(' ')[0]}. Seu acesso ao aplicativo da saúde foi liberado. Entre com o número do seu Cartão SUS e a senha cadastrada.`, 'acesso_liberado');
    return { ok: true };
  });

  app.post('/api/portal/contas/:id/recusar', async (req) => {
    const { conta } = await contaParaOperador(req);
    const { motivo } = z.object({ motivo: z.string().min(3).max(250) }).parse(req.body);
    await transacao(contextoDe(req, 'portal_conta:recusar'), (c) => c.query(`update portal.conta set situacao = 'RECUSADA', motivo = $2 where id = $1`, [conta.id, motivo]));
    await enviarAoCidadao({ pessoaId: conta.pessoa_id, celular: conta.celular, email: conta.email }, 'Solicitação de acesso - Aplicativo da Saúde', `Sua solicitação de acesso ao aplicativo da saúde não foi liberada: ${motivo}. Procure sua unidade de saúde.`, 'acesso_recusado');
    return { ok: true };
  });

  app.post('/api/portal/contas/:id/bloquear', async (req) => {
    const { conta } = await contaParaOperador(req);
    const { motivo } = z.object({ motivo: z.string().min(3).max(250) }).parse(req.body);
    await transacao(contextoDe(req, 'portal_conta:bloquear'), async (c) => {
      await c.query(`update portal.conta set situacao = 'BLOQUEADA', motivo = $2, bloqueado_em = now() where id = $1`, [conta.id, motivo]);
      await c.query(`update portal.sessao set encerrada_em = now() where conta_id = $1 and encerrada_em is null`, [conta.id]);
    });
    return { ok: true };
  });

  app.post('/api/portal/contas/:id/desbloquear', async (req) => {
    const { conta } = await contaParaOperador(req);
    if (!conta.pessoa_id) throw new ErroHttp(422, 'Conta sem vínculo com paciente: use "Liberar".');
    await transacao(contextoDe(req, 'portal_conta:desbloquear'), (c) =>
      c.query(`update portal.conta set situacao = 'ATIVA', tentativas_invalidas = 0, bloqueado_em = null, motivo = null where id = $1`, [conta.id]),
    );
    return { ok: true };
  });

  app.post('/api/portal/contas/:id/inativar', async (req) => {
    const { conta } = await contaParaOperador(req);
    await transacao(contextoDe(req, 'portal_conta:inativar'), async (c) => {
      await c.query(`update portal.conta set situacao = 'INATIVA' where id = $1`, [conta.id]);
      await c.query(`update portal.sessao set encerrada_em = now() where conta_id = $1 and encerrada_em is null`, [conta.id]);
    });
    return { ok: true };
  });

  // Senha temporária gerada na unidade (cidadão sem acesso ao celular/e-mail cadastrado).
  app.post('/api/portal/contas/:id/senha-temporaria', async (req) => {
    const { conta } = await contaParaOperador(req);
    const temporaria = gerarSenhaTemporaria();
    const senhaHash = await gerarHashSenha(temporaria);
    await transacao(contextoDe(req, 'portal_conta:senha'), (c) =>
      c.query(
        `update portal.conta set senha_hash = $2, senha_alterada_em = now(), tentativas_invalidas = 0, bloqueado_em = null,
                situacao = case when situacao = 'BLOQUEADA' then 'ATIVA' else situacao end where id = $1`,
        [conta.id, senhaHash],
      ),
    );
    await enviarAoCidadao({ pessoaId: conta.pessoa_id, celular: conta.celular, email: conta.email }, 'Senha temporária - Aplicativo da Saúde', `Sua senha temporária do aplicativo da saúde é ${temporaria}. Altere-a no menu "Meus dados" após entrar.`, 'senha_temporaria');
    return { ok: true, senhaTemporaria: temporaria };
  });

  // Dependentes incluídos pelo aplicativo aguardando validação de documentos na unidade (TR 1.2.41.6.2).
  app.get('/api/portal/pre-cadastros', async (req) => {
    exigirPermissao(req, 'paciente:consultar');
    return consultar(
      `select p.id, p.nome, p.data_nascimento::text nascimento, p.sexo, p.nome_mae, p.parentesco, p.criado_em, p.pre_cadastro_valido_ate::text valido_ate,
              f.codigo familia, r.nome responsavel, u.nome unidade
         from cad.pessoa p join cad.familia f on f.id = p.familia_id left join cad.pessoa r on r.id = f.responsavel_id left join cad.unidade u on u.id = p.unidade_referencia_id
        where p.situacao = 'PRE_CADASTRO' and exists (select 1 from aud.log_dados l where l.tabela = 'cad.pessoa' and l.registro_id = p.id and l.operacao = 'I' and l.rotina = 'portal:dependente')
        order by p.criado_em desc limit 200`,
    );
  });

  // Configuração do aplicativo: funcionalidades, modo e antecedências do agendamento, avisos, termos (TR 1.2.41.7.2, 1.2.41.7.3, 1.2.41.7.10).
  const CONFIG: [string, unknown, string][] = [
    ['portal.funcionalidades', Object.fromEntries(FUNCIONALIDADES.map((f) => [f, true])), 'Funcionalidades disponíveis no aplicativo do cidadão'],
    ['portal.agendamento_modo', 'AGENDA', 'Modo de agendamento pelo aplicativo: AGENDA (conforme cada agenda), DIRETO ou SOLICITACAO (confirmado por operador)'],
    ['portal.antecedencia_agendamento', { quantidade: 24, unidade: 'HORAS' }, 'Antecedência mínima para marcar consultas pelo aplicativo'],
    ['portal.antecedencia_cancelamento', { quantidade: 24, unidade: 'HORAS' }, 'Antecedência mínima para cancelar ou transferir consultas pelo aplicativo'],
    ['portal.vaga_para_lista_espera', true, 'Oferecer automaticamente a vaga cancelada ao primeiro da lista de espera'],
    ['portal.aviso_meios', { app: true, sms: true, email: true }, 'Meios de aviso da confirmação do agendamento'],
    ['portal.max_tentativas', 3, 'Tentativas de login inválidas antes do bloqueio'],
    ['portal.sessao_inatividade_min', 30, 'Minutos de inatividade para encerrar a sessão do cidadão'],
    ['portal.exibir_quantidade_estoque', false, 'Exibir a quantidade em estoque dos medicamentos no aplicativo'],
    ['portal.exibir_evolucao_clinica', false, 'Exibir a evolução clínica (SOAP) no histórico de atendimentos'],
    ['portal.unidade_liberacao_padrao', null, 'Unidade que libera solicitações de cidadãos sem cadastro na rede'],
    ['portal.video_url_base', 'https://meet.jit.si/', 'Endereço base das salas de videochamada do teleatendimento'],
    ['portal.versao_termos', VERSAO_TERMOS_APP, 'Versão vigente dos termos de uso do aplicativo'],
    ['portal.termos_uso', TERMOS_PADRAO, 'Termos de uso e política de privacidade (LGPD) do aplicativo'],
  ];
  app.get('/api/portal/configuracao', async (req) => {
    exigirPermissao(req, 'portal_configuracao:executar');
    const valores: Record<string, unknown> = {};
    for (const [chave, padrao, descricao] of CONFIG) valores[chave] = { valor: await parametro(chave, padrao), descricao };
    return valores;
  });
  app.put('/api/portal/configuracao', async (req) => {
    const u = exigirPermissao(req, 'portal_configuracao:executar');
    const b = z.record(z.unknown()).parse(req.body);
    await transacao(contextoDe(req, 'portal_configuracao'), async (c) => {
      for (const [chave, , descricao] of CONFIG) {
        if (!(chave in b)) continue;
        await c.query(
          `insert into sis.parametro (chave, valor, descricao, modulo, atualizado_em, atualizado_por) values ($1,$2,$3,'APP',now(),$4)
           on conflict (chave) do update set valor = excluded.valor, atualizado_em = now(), atualizado_por = $4`,
          [chave, JSON.stringify(b[chave]), descricao, u.id],
        );
      }
    });
    return { ok: true };
  });

  // Agendas liberadas para marcação pelo aplicativo (TR 1.2.41.7.1, 1.2.41.7.2, 1.2.41.7.3, 1.2.41.7.10).
  app.get('/api/portal/agendas', async (req) => {
    exigirPermissao(req, 'portal_configuracao:executar');
    return consultar(
      `select a.id, a.nome, a.tipo, u.nome unidade, pr.nome profissional, e.nome especialidade, coalesce(e.regulada, false) regulada, a.disponivel_web, a.web_modo,
              a.antecedencia_agendar_horas, a.antecedencia_cancelar_horas, a.ativo,
              (select count(*)::int from age.agendamento x where x.agenda_id = a.id and x.origem = 'APLICATIVO') agendamentos_app
         from age.agenda a join cad.unidade u on u.id = a.unidade_id left join cad.profissional pr on pr.id = a.profissional_id
         left join cad.especialidade e on e.id = a.especialidade_id where a.ativo order by e.nome, a.nome`,
    );
  });
  app.put('/api/portal/agendas/:id', async (req) => {
    exigirPermissao(req, 'portal_configuracao:executar');
    const b = z.object({ disponivelWeb: z.boolean(), webModo: z.enum(['DIRETO', 'SOLICITACAO']), antecedenciaAgendarHoras: z.number().int().min(0).max(8760), antecedenciaCancelarHoras: z.number().int().min(0).max(8760) }).parse(req.body);
    await transacao(contextoDe(req, 'portal:agenda'), (c) =>
      c.query(`update age.agenda set disponivel_web = $2, web_modo = $3, antecedencia_agendar_horas = $4, antecedencia_cancelar_horas = $5 where id = $1`, [
        (req.params as any).id,
        b.disponivelWeb,
        b.webModo,
        b.antecedenciaAgendarHoras,
        b.antecedenciaCancelarHoras,
      ]),
    );
    return { ok: true };
  });

  // Parametrização de cada medicamento exibido no aplicativo (TR 1.2.41.9.3).
  app.get('/api/portal/medicamentos', async (req) => {
    exigirPermissao(req, 'portal_configuracao:executar');
    const q = (req.query as any).q || null;
    return consultar(
      `select pd.id, pd.nome, pd.concentracao, pd.tipo, pd.disponivel_app,
              coalesce((select sum(l.quantidade - coalesce(l.reservado, 0)) from far.estoque_lote l where l.produto_id = pd.id and l.validade >= current_date and not coalesce(l.bloqueado, false)), 0)::numeric saldo
         from far.produto pd where pd.ativo and pd.tipo = 'MEDICAMENTO' and ($1::text is null or pd.nome ilike '%' || $1 || '%') order by pd.nome limit 300`,
      [q],
    );
  });
  app.put('/api/portal/medicamentos/:id', async (req) => {
    exigirPermissao(req, 'portal_configuracao:executar');
    const { disponivelApp } = z.object({ disponivelApp: z.boolean() }).parse(req.body);
    await transacao(contextoDe(req, 'portal:medicamento'), (c) => c.query(`update far.produto set disponivel_app = $2 where id = $1`, [(req.params as any).id, disponivelApp]));
    return { ok: true };
  });

  // Agendamentos feitos pelo aplicativo: confirmação pela unidade quando parametrizado (TR 1.2.41.7.2, 1.2.41.7.4, 1.2.41.7.15).
  app.get('/api/portal/agendamentos', async (req) => {
    const u = exigirPermissao(req, 'agendamento:consultar');
    const q = req.query as any;
    return consultar(
      `select a.id, a.senha, a.data::text data, to_char(a.hora,'HH24:MI') hora, a.situacao, a.tipo, a.criado_em, p.id paciente_id, p.nome paciente, p.cns, p.celular,
              un.nome unidade, pr.nome profissional, e.nome especialidade, a.agenda_id, a.especialidade_id, a.profissional_id, a.unidade_id
         from age.agendamento a join cad.pessoa p on p.id = a.paciente_id left join cad.unidade un on un.id = a.unidade_id
         left join cad.profissional pr on pr.id = a.profissional_id left join cad.especialidade e on e.id = a.especialidade_id
        where a.origem = 'APLICATIVO' and ($1::text is null or a.situacao = $1) and ($2::boolean or a.unidade_id = any($3))
          and a.data >= current_date - 30
        order by (a.situacao = 'SOLICITADO') desc, a.data, a.hora limit 300`,
      [q.situacao || null, u.administrador, u.unidades],
    );
  });
  app.post('/api/portal/agendamentos/:id/confirmar', async (req) => {
    const u = exigirPermissao(req, 'portal_agendamento:executar');
    const id = Number((req.params as any).id);
    return transacao(contextoDe(req, 'portal:confirmar-agendamento'), async (c) => {
      const ag = (await c.query(`select a.*, a.data::text dt, to_char(a.hora,'HH24:MI') hr, p.nome from age.agendamento a join cad.pessoa p on p.id = a.paciente_id where a.id = $1 for update of a`, [id])).rows[0];
      if (!ag || ag.situacao !== 'SOLICITADO') throw new ErroHttp(409, 'Somente agendamentos aguardando confirmação podem ser confirmados.');
      await c.query(`update age.agendamento set situacao = 'AGENDADO', autorizador_id = $2 where id = $1`, [id, u.id]);
      await registrarEvento(c, { agendamentoId: id, pessoaId: ag.paciente_id, evento: 'CONFIRMACAO', responsavel: u.nome });
      await notificarEvento(c, id, 'AGENDAMENTO');
      await avisarCidadao(c, ag.paciente_id, 'Agendamento confirmado', `A unidade confirmou a consulta de ${ag.nome} em ${fmt(ag.dt)} às ${ag.hr}. Protocolo ${ag.senha}.`, `agendamento:${id}`, 'agendamento', 'AGENDAMENTO');
      return { ok: true };
    });
  });
  app.post('/api/portal/agendamentos/:id/recusar', async (req) => {
    const u = exigirPermissao(req, 'portal_agendamento:executar');
    const id = Number((req.params as any).id);
    const { motivo } = z.object({ motivo: z.string().min(3).max(200) }).parse(req.body);
    return transacao(contextoDe(req, 'portal:recusar-agendamento'), async (c) => {
      const ag = (await c.query(`select a.*, a.data::text dt, p.nome from age.agendamento a join cad.pessoa p on p.id = a.paciente_id where a.id = $1`, [id])).rows[0];
      if (!ag || ag.situacao !== 'SOLICITADO') throw new ErroHttp(409, 'Somente agendamentos aguardando confirmação podem ser recusados.');
      await cancelar(c, id, `Solicitação recusada pela unidade: ${motivo}`, false);
      await registrarEvento(c, { agendamentoId: id, pessoaId: ag.paciente_id, evento: 'RECUSA', motivo, responsavel: u.nome });
      await avisarCidadao(c, ag.paciente_id, 'Solicitação de agendamento não confirmada', `A solicitação de consulta de ${ag.nome} em ${fmt(ag.dt)} não foi confirmada: ${motivo}.`, `agendamento:${id}`, 'cancelamento', 'CANCELAMENTO');
      return { ok: true };
    });
  });

  // Teleatendimento: o profissional acessa a sala, conversa com o paciente e encerra.
  app.get('/api/portal/teleatendimentos', async (req) => {
    const u = exigirPermissao(req, 'portal_teleatendimento:consultar');
    const data = ((req.query as any).data as string) || new Date().toISOString().slice(0, 10);
    return consultar(
      `select a.id, a.data::text data, to_char(a.hora,'HH24:MI') hora, a.situacao, p.nome paciente, p.celular, pr.nome profissional, e.nome especialidade,
              t.id sala_id, t.situacao situacao_sala, t.paciente_entrou_em,
              (select count(*)::int from portal.teleatendimento_mensagem m where m.teleatendimento_id = t.id and m.autor = 'PACIENTE') mensagens_paciente
         from age.agendamento a join age.agenda g on g.id = a.agenda_id join cad.pessoa p on p.id = a.paciente_id
         left join cad.profissional pr on pr.id = a.profissional_id left join cad.especialidade e on e.id = a.especialidade_id
         left join portal.teleatendimento t on t.agendamento_id = a.id
        where (a.tipo = 'TELECONSULTA' or g.tipo = 'TELECONSULTA') and a.data = $1 and a.situacao not in ('CANCELADO','TRANSFERIDO')
          and ($2::boolean or a.unidade_id = any($3) or a.profissional_id = $4)
        order by a.hora`,
      [data, u.administrador, u.unidades, u.profissionalId],
    );
  });
  app.get('/api/portal/teleatendimentos/:agendamentoId', async (req) => {
    exigirPermissao(req, 'portal_teleatendimento:consultar');
    const sala = await salaTeleatendimento(Number((req.params as any).agendamentoId));
    const mensagens = await consultar(
      `select m.id, m.autor, m.texto, m.data_hora, o.nome operador from portal.teleatendimento_mensagem m left join seg.operador o on o.id = m.operador_id where m.teleatendimento_id = $1 order by m.id`,
      [sala.id],
    );
    return { sala, mensagens };
  });
  app.post('/api/portal/teleatendimentos/:agendamentoId/mensagens', async (req) => {
    const u = exigirPermissao(req, 'portal_teleatendimento:alterar');
    const { texto } = z.object({ texto: z.string().min(1).max(2000) }).parse(req.body);
    const sala = await salaTeleatendimento(Number((req.params as any).agendamentoId));
    await transacao(contextoDe(req, 'portal:teleatendimento'), async (c) => {
      await c.query(`insert into portal.teleatendimento_mensagem (teleatendimento_id, autor, operador_id, texto, data_hora) values ($1,'PROFISSIONAL',$2,$3,now())`, [sala.id, u.id, texto]);
      await c.query(`update portal.teleatendimento set situacao = 'EM_ANDAMENTO' where id = $1 and situacao = 'AGUARDANDO'`, [sala.id]);
    });
    return { ok: true };
  });
  app.post('/api/portal/teleatendimentos/:agendamentoId/encerrar', async (req) => {
    exigirPermissao(req, 'portal_teleatendimento:alterar');
    const sala = await salaTeleatendimento(Number((req.params as any).agendamentoId));
    await transacao(contextoDe(req, 'portal:teleatendimento'), (c) => c.query(`update portal.teleatendimento set situacao = 'ENCERRADO', encerrado_em = now() where id = $1`, [sala.id]));
    return { ok: true };
  });

  // Painel do atendimento remoto.
  app.get('/api/portal/indicadores', async (req) => {
    const u = exigirPermissao(req, 'portal_conta:consultar');
    return consultarUm(
      `select (select count(*)::int from portal.conta where situacao = 'SOLICITADA' and ($1::boolean or unidade_id is null or unidade_id = any($2))) solicitacoes,
              (select count(*)::int from portal.conta where situacao = 'ATIVA') contas_ativas,
              (select count(*)::int from portal.conta where situacao = 'BLOQUEADA') contas_bloqueadas,
              (select count(*)::int from age.agendamento where origem = 'APLICATIVO' and situacao = 'SOLICITADO') agendamentos_pendentes,
              (select count(*)::int from age.agendamento where origem = 'APLICATIVO' and criado_em >= date_trunc('month', now())) agendamentos_mes,
              (select count(*)::int from portal.evento_agendamento where evento = 'CANCELAMENTO' and data_hora >= date_trunc('month', now())) cancelamentos_mes,
              (select count(*)::int from portal.manifestacao where situacao in ('ABERTA','EM_ANALISE')) manifestacoes_abertas,
              (select count(*)::int from portal.sessao where inicio >= now() - interval '30 days') acessos_30_dias`,
      [u.administrador, u.unidades],
    );
  });

  void COOKIE_CIDADAO;
}

/** Sala virtual da teleconsulta, criada no primeiro acesso. */
async function salaTeleatendimento(agendamentoId: number) {
  const existente = await consultarUm(`select * from portal.teleatendimento where agendamento_id = $1`, [agendamentoId]);
  if (existente) return existente;
  const sala = `ubrisus-${randomBytes(9).toString('hex')}`;
  const base = await parametro<string>('portal.video_url_base', 'https://meet.jit.si/');
  return (await consultarUm(
    `insert into portal.teleatendimento (agendamento_id, sala, link_video, situacao) values ($1,$2,$3,'AGUARDANDO')
     on conflict (agendamento_id) do update set agendamento_id = excluded.agendamento_id returning *`,
    [agendamentoId, sala, base.replace(/\/?$/, '/') + sala],
  ))!;
}
