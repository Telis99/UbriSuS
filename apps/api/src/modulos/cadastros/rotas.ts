// Processos do módulo de agendamento e cadastros nacionais (TR 1.2.1 a 1.2.6).
import type { FastifyInstance } from 'fastify';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { idadeDetalhada, normalizarNome, somenteDigitos, validarCpf } from '../../compartilhado/validacao.js';
import { consultar, consultarUm, pool, transacao } from '../../db/pool.js';
import { alterar, registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { obterEntidade } from '../../meta/registro.js';
import { contextoDe, ErroHttp, exigirPermissao, registrarRotina } from '../../seguranca/usuario.js';
import { gerarAlertas, parametro } from './alertas.js';
import { consultarCadsus } from './integracao-cadsus.js';

registrarPermissao('paciente_unificacao', 'Unificação de cadastros em duplicidade', 'AGE', ['executar']);
registrarPermissao('importacao_cnes', 'Importação SCNES / CADSUS', 'AGE', ['executar']);

const OBRIGATORIOS_CADASTRO_COMPLETO = ['nome', 'data_nascimento', 'sexo', 'raca_cor', 'nome_mae', 'municipio_id'];

// ---------------------------------------------------------------------------
// Regras do cadastro de pacientes
// ---------------------------------------------------------------------------
registrarGanchos('paciente', {
  async antesSalvar(d, { cliente, id, atual }) {
    const final = { ...(atual ?? {}), ...d };
    if (final.raca_cor === '05' && !final.etnia_id) throw new ErroHttp(422, 'Informe a etnia para raça/cor indígena.', { etnia_id: 'Obrigatório para indígenas.' });
    if (final.mae_desconhecida) d.nome_mae = null;
    if (final.pai_desconhecido) d.nome_pai = null;
    if (final.situacao === 'FALECIDO' && !final.data_obito) throw new ErroHttp(422, 'Informe a data do óbito.', { data_obito: 'Obrigatória para falecidos.' });

    // Campos obrigatórios parametrizados, exceto em pré-cadastro (TR 1.2.6.9, 1.2.6.4).
    if (final.situacao !== 'PRE_CADASTRO') {
      const extra = await parametro<string[]>('paciente.campos_obrigatorios', []);
      const estrangeiro = final.nacionalidade === '3';
      const exigidos = [...OBRIGATORIOS_CADASTRO_COMPLETO.filter((c) => !(estrangeiro && c === 'municipio_id')), ...extra];
      if (estrangeiro && !final.pais_id) exigidos.push('pais_id');
      const faltando = exigidos.filter((c) => {
        if (c === 'nome_mae' && final.mae_desconhecida) return false;
        return final[c] === null || final[c] === undefined || final[c] === '';
      });
      if (faltando.length) {
        const e = obterEntidade('paciente')!;
        throw new ErroHttp(
          422,
          atual?.situacao === 'PRE_CADASTRO'
            ? 'Para ativar o cadastro preencha os dados obrigatórios do cadastro completo.'
            : 'Preencha os campos obrigatórios do cadastro.',
          Object.fromEntries(faltando.map((c) => [c, `${e.campos.find((x) => x.nome === c)?.rotulo ?? c} é obrigatório.`])),
        );
      }
    }

    // Duplicidade por nome + nascimento + mãe (CPF e CNS já são únicos no banco) (TR 1.2.6.17).
    if (final.nome && final.data_nascimento) {
      const dup = await consultarUm(
        `select id, nome from cad.pessoa
          where nome_busca = $1 and data_nascimento = $2 and coalesce(nome_mae_busca, '') = coalesce($3, '') and id <> coalesce($4, 0)`,
        [normalizarNome(final.nome), final.data_nascimento, final.nome_mae ? normalizarNome(final.nome_mae) : null, id ?? null],
        cliente,
      );
      if (dup) throw new ErroHttp(409, `Já existe um cadastro com o mesmo nome, data de nascimento e nome da mãe (código ${dup.id}).`, { duplicadoId: dup.id });
    }
    if (final.data_nascimento && new Date(final.data_nascimento) > new Date()) throw new ErroHttp(422, 'Data de nascimento no futuro.', { data_nascimento: 'Data inválida.' });
  },
});

export async function rotasCadastros(app: FastifyInstance) {
  // Pesquisa de pacientes pelos campos exigidos, com total de registros (TR 1.2.6.7, 1.2.12.17).
  app.get('/api/pacientes/busca', async (req) => {
    const u = exigirPermissao(req, 'paciente:consultar');
    const q = req.query as Record<string, string>;
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (q.nome) add(`(p.nome_busca like ? or cad.fn_normalizar(p.nome_social) like ?)`, normalizarNome(q.nome) + '%');
    if (q.nome_contem) add(`p.nome_busca like ?`, '%' + normalizarNome(q.nome_contem) + '%');
    if (q.mae) add(`p.nome_mae_busca like ?`, '%' + normalizarNome(q.mae) + '%');
    if (q.nascimento) add(`p.data_nascimento = ?::date`, q.nascimento);
    if (q.situacao) add(`p.situacao = ?`, q.situacao);
    if (q.cpf) add(`p.cpf = ?`, somenteDigitos(q.cpf));
    if (q.rg) add(`p.rg_numero = ?`, q.rg.trim());
    if (q.cns) add(`p.cns = ?`, somenteDigitos(q.cns));
    if (q.prontuario) add(`(p.prontuario = ? or exists (select 1 from cad.pessoa_prontuario pp where pp.pessoa_id = p.id and pp.numero = ?))`, q.prontuario.trim());
    if (q.id) add(`p.id = ?`, Number(q.id));
    if (q.q) {
      const d = somenteDigitos(q.q);
      if (d.length === 11) add(`p.cpf = ?`, d);
      else if (d.length === 15) add(`p.cns = ?`, d);
      else add(`p.nome_busca like ?`, normalizarNome(q.q) + '%');
    }
    if (!where.length) throw new ErroHttp(400, 'Informe ao menos um critério de pesquisa.');
    const linhas = await consultar(
      `select p.id as codigo, p.nome, p.nome_social, p.nome_mae, p.data_nascimento, extract(year from age(p.data_nascimento))::int as idade,
              p.cpf, p.rg_numero as rg, p.cns, p.situacao, p.sexo, p.foto_id, p.celular,
              (select numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id and pp.unidade_id = $${params.length + 1}) as prontuario_unidade,
              count(*) over() as total
         from cad.pessoa p where ${where.join(' and ')}
        order by p.nome limit 200`,
      [...params, u.unidadeAtual],
    );
    return { total: Number(linhas[0]?.total ?? 0), linhas: linhas.map(({ total, ...l }) => l) };
  });

  // Cabeçalho do paciente com alertas para as telas de atendimento (TR 1.2.10.17, 1.2.16.12).
  app.get('/api/pacientes/:id/resumo', async (req) => {
    const u = exigirPermissao(req, 'paciente:consultar');
    const id = Number((req.params as any).id);
    const p = await consultarUm(
      `select p.id, p.nome, p.nome_social, p.data_nascimento, p.sexo, p.foto_id, p.nome_mae, p.nome_pai, p.cns, p.cpf, p.celular,
              p.telefone, p.situacao, p.tipo_sanguineo, p.condicoes_saude, p.dum, m.nome as municipio, m.uf_sigla as uf,
              coalesce((select numero from cad.pessoa_prontuario pp where pp.pessoa_id = p.id and pp.unidade_id = $2), p.prontuario) as prontuario,
              (select coalesce(json_agg(json_build_object('substancia', a.substancia, 'gravidade', a.gravidade, 'tipo', a.tipo)), '[]')
                 from cad.pessoa_alergia a where a.pessoa_id = p.id) as alergias
         from cad.pessoa p left join cad.municipio m on m.id = p.municipio_id where p.id = $1`,
      [id, u.unidadeAtual],
    );
    if (!p) throw new ErroHttp(404, 'Paciente não encontrado.');
    const idade = idadeDetalhada(p.data_nascimento);
    const alertas = await gerarAlertas(id, { usuario: u, unidadeId: u.unidadeAtual, rotina: (req.query as any).rotina });
    await registrarRotina(req, 'paciente', 'resumo', { id });
    return { ...p, idade, alertas };
  });

  app.get('/api/pacientes/:id/alertas', async (req) => {
    const u = exigirPermissao(req, 'paciente:consultar');
    return gerarAlertas(Number((req.params as any).id), { usuario: u, unidadeId: u.unidadeAtual, rotina: (req.query as any).rotina });
  });

  // Atualização rápida do CNS e telefone sem sair da tela de agendamento (TR 1.2.10.18).
  app.patch('/api/pacientes/:id/rapido', async (req) => {
    const u = exigirPermissao(req, 'paciente:alterar');
    const corpo = z.object({ cns: z.string().optional(), celular: z.string().optional(), telefone: z.string().optional() }).parse(req.body);
    return alterar(obterEntidade('paciente')!, Number((req.params as any).id), corpo, contextoDe(req, 'paciente:atualizacao-rapida'), u);
  });

  app.post('/api/pacientes/avisos/:id/avisado', async (req) => {
    exigirPermissao(req, 'paciente:consultar');
    await transacao(contextoDe(req, 'paciente_aviso'), (c) =>
      c.query(`update cad.pessoa_aviso set avisado = true, avisado_em = now() where id = $1`, [(req.params as any).id]),
    );
    return { ok: true };
  });

  // Unificação de cadastros em duplicidade (TR 1.2.6.61, 1.2.6.62).
  app.post('/api/unificacao/:tipo', async (req) => {
    exigirPermissao(req, 'paciente_unificacao:executar');
    const tabelas: Record<string, string> = { paciente: 'cad.pessoa', familia: 'cad.familia', bairro: 'cad.bairro', logradouro: 'cad.logradouro' };
    const tabela = tabelas[(req.params as any).tipo];
    if (!tabela) throw new ErroHttp(404, 'Tipo de unificação inexistente.');
    const { manterId, removerIds } = z.object({ manterId: z.number().int(), removerIds: z.array(z.number().int()).min(1) }).parse(req.body);
    if (removerIds.includes(manterId)) throw new ErroHttp(400, 'O cadastro mantido não pode estar na lista de remoção.');
    const [esquema, nome] = tabela.split('.');
    const resultado = await transacao(contextoDe(req, `unificacao:${nome}`), async (c) => {
      const fks = (
        await c.query(
          `select n.nspname as esquema, cl.relname as tabela, a.attname as coluna
             from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace
             join pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
            where co.contype = 'f' and co.confrelid = $1::regclass`,
          [tabela],
        )
      ).rows;
      const movidos: Record<string, number> = {};
      for (const fk of fks) {
        // Linhas que violariam índices únicos após a troca são removidas (ex.: prontuário duplicado na mesma unidade).
        const r = await c
          .query(`update "${fk.esquema}"."${fk.tabela}" set "${fk.coluna}" = $1 where "${fk.coluna}" = any($2)`, [manterId, removerIds])
          .catch(async (e) => {
            if (e.code !== '23505') throw e;
            await c.query(`delete from "${fk.esquema}"."${fk.tabela}" where "${fk.coluna}" = any($1)`, [removerIds]);
            return { rowCount: 0 };
          });
        if (r.rowCount) movidos[`${fk.esquema}.${fk.tabela}.${fk.coluna}`] = r.rowCount;
      }
      if (nome === 'pessoa') {
        // Mantém CPF/CNS do cadastro removido quando o mantido não os possui.
        const rem = (await c.query(`select cpf, cns from cad.pessoa where id = any($1)`, [removerIds])).rows;
        await c.query(`update cad.pessoa set cpf = null, cns = null where id = any($1)`, [removerIds]);
        const cpf = rem.find((x) => x.cpf)?.cpf;
        const cns = rem.find((x) => x.cns)?.cns;
        await c.query(`update cad.pessoa set cpf = coalesce(cpf, $2), cns = coalesce(cns, $3) where id = $1`, [manterId, cpf ?? null, cns ?? null]);
      }
      await c.query(`delete from "${esquema}"."${nome}" where id = any($1)`, [removerIds]);
      return movidos;
    });
    await registrarRotina(req, `unificacao:${nome}`, 'executar', { manterId, removerIds, resultado });
    return { ok: true, registrosMovidos: resultado };
  });

  // Consulta de endereço pelo CEP na base DNE (TR 1.1.1.40).
  app.get('/api/cep/:cep', async (req) => {
    const cep = somenteDigitos((req.params as any).cep);
    if (cep.length !== 8) throw new ErroHttp(400, 'CEP inválido.');
    const r = await consultarUm(`select * from cad.cep where cep = $1`, [cep]);
    const logr = await consultarUm(
      `select l.id, l.nome, l.tipo_abreviatura, l.bairro_id, b.nome as bairro, l.municipio_id, m.nome as municipio, m.uf_sigla
         from cad.logradouro l left join cad.bairro b on b.id = l.bairro_id join cad.municipio m on m.id = l.municipio_id
        where l.cep = $1 and l.ativo limit 1`,
      [cep],
    );
    const municipio = r?.codigo_ibge
      ? await consultarUm(`select id, nome, uf_sigla from cad.municipio where codigo_ibge = $1`, [r.codigo_ibge])
      : logr
        ? { id: logr.municipio_id, nome: logr.municipio, uf_sigla: logr.uf_sigla }
        : null;
    if (!r && !logr) throw new ErroHttp(404, 'CEP não encontrado na base de endereços.');
    return { cep, dne: r ?? null, logradouro: logr ?? null, municipio };
  });

  // Busca ativa no CADSUS/Cadweb por CPF ou CNS, com log de rastreabilidade (TR 1.2.6.6).
  app.post('/api/cadsus/consultar', async (req) => {
    const u = exigirPermissao(req, 'paciente:consultar');
    const { cpf, cns } = z.object({ cpf: z.string().optional(), cns: z.string().optional() }).parse(req.body);
    const chave = somenteDigitos(cpf ?? cns ?? '');
    if (cpf && !validarCpf(cpf)) throw new ErroHttp(422, 'CPF inválido.');
    try {
      const dados = await consultarCadsus({ cpf: cpf ? somenteDigitos(cpf) : undefined, cns: cns ? somenteDigitos(cns) : undefined }, u);
      await pool.query(`insert into aud.log_integracao (operador_id, servico, operacao, chave, sucesso) values ($1,'CADSUS','consulta',$2,true)`, [u.id, chave]);
      return dados;
    } catch (e) {
      await pool.query(`insert into aud.log_integracao (operador_id, servico, operacao, chave, sucesso, detalhe) values ($1,'CADSUS','consulta',$2,false,$3)`, [
        u.id,
        chave,
        (e as Error).message,
      ]);
      throw e;
    }
  });

  // Importação de unidades e profissionais do SCNES por arquivo XML (TR 1.2.3.1, 1.2.4.1, 1.2.4.4).
  app.post('/api/importacao/scnes', async (req) => {
    const u = exigirPermissao(req, 'importacao_cnes:executar');
    const arq = await req.file();
    if (!arq) throw new ErroHttp(400, 'Envie o arquivo XML exportado pelo SCNES.');
    const xml = (await arq.toBuffer()).toString(/encoding="ISO-8859-1"/i.test(arq.filename) ? 'latin1' : 'utf8');
    const resumo = await importarScnes(xml, contextoDe(req, 'importacao:scnes'));
    await registrarRotina(req, 'importacao_cnes', 'scnes', resumo);
    void u;
    return resumo;
  });

  // Atualização de pacientes por arquivo XML do CADSUS (TR 1.2.6.13).
  app.post('/api/importacao/cadsus', async (req) => {
    exigirPermissao(req, 'importacao_cnes:executar');
    const arq = await req.file();
    if (!arq) throw new ErroHttp(400, 'Envie o arquivo XML do CADSUS.');
    const resumo = await importarCadsusXml((await arq.toBuffer()).toString('utf8'), contextoDe(req, 'importacao:cadsus'));
    await registrarRotina(req, 'importacao_cnes', 'cadsus', resumo);
    return resumo;
  });
}

// ---------------------------------------------------------------------------
// Importadores
// ---------------------------------------------------------------------------
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', allowBooleanAttributes: true, parseAttributeValue: false });

/** Lê um atributo/elemento aceitando variações de nome usadas nas versões do SCNES. */
function campo(o: any, ...nomes: string[]): string | undefined {
  for (const n of nomes) {
    for (const k of Object.keys(o ?? {})) if (k.toUpperCase() === n.toUpperCase() && o[k] !== '' && o[k] != null) return String(o[k]).trim();
  }
  return undefined;
}

function listaDe(o: any, ...caminho: string[]): any[] {
  let atual = o;
  for (const c of caminho) {
    if (atual == null) return [];
    const k = Object.keys(atual).find((x) => x.toUpperCase() === c.toUpperCase());
    atual = k ? atual[k] : undefined;
  }
  if (atual == null) return [];
  return Array.isArray(atual) ? atual : [atual];
}

/** Procura recursivamente todos os nós com um dos nomes informados. */
function nos(o: any, nomes: string[], acc: any[] = []): any[] {
  if (!o || typeof o !== 'object') return acc;
  for (const [k, v] of Object.entries(o)) {
    if (nomes.includes(k.toUpperCase())) acc.push(...(Array.isArray(v) ? v : [v]));
    else if (typeof v === 'object') nos(v, nomes, acc);
  }
  return acc;
}

function dataScnes(v?: string) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = /^(\d{2})\/?(\d{2})\/?(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export async function importarScnes(xml: string, ctx: Parameters<typeof transacao>[0]) {
  const doc = parser.parse(xml);
  const estabelecimentos = nos(doc, ['DADOS_GERAIS_ESTABELECIMENTOS', 'ESTABELECIMENTO']);
  const resumo = { unidades: 0, profissionais: 0, vinculos: 0, horarios: 0, avisos: [] as string[] };
  await transacao(ctx, async (c) => {
    for (const est of estabelecimentos) {
      const cnes = campo(est, 'CNES', 'CO_CNES');
      if (!cnes) continue;
      const nome = campo(est, 'NOME_FANTA', 'NOME_FANTASIA', 'NO_FANTASIA') ?? `ESTABELECIMENTO ${cnes}`;
      const un = (
        await c.query(
          `insert into cad.unidade (cnes, nome, razao_social, cpf_cnpj, tipo_estabelecimento, telefone, email, ativo)
           values ($1,$2,$3,$4,$5,$6,$7,true)
           on conflict (cnes) do update set nome = excluded.nome, razao_social = coalesce(excluded.razao_social, cad.unidade.razao_social),
             cpf_cnpj = coalesce(excluded.cpf_cnpj, cad.unidade.cpf_cnpj), tipo_estabelecimento = coalesce(excluded.tipo_estabelecimento, cad.unidade.tipo_estabelecimento)
           returning id`,
          [
            cnes.padStart(7, '0'),
            nome.slice(0, 120),
            campo(est, 'R_SOCIAL', 'RAZAO_SOCIAL', 'NO_RAZAO_SOCIAL')?.slice(0, 120) ?? null,
            somenteDigitos(campo(est, 'CNPJ', 'NU_CNPJ', 'CPF_CNPJ')) || null,
            campo(est, 'TP_UNID_ID', 'TP_UNIDADE', 'TIPO_UNIDADE')?.padStart(2, '0') ?? null,
            somenteDigitos(campo(est, 'TELEFONE', 'NU_TELEFONE')).slice(0, 11) || null,
            campo(est, 'E_MAIL', 'EMAIL')?.toLowerCase() ?? null,
          ],
        )
      ).rows[0];
      resumo.unidades++;

      for (const prof of nos(est, ['DADOS_PROFISSIONAIS', 'PROFISSIONAL'])) {
        const cpf = somenteDigitos(campo(prof, 'CPF_PROF', 'CPF', 'NU_CPF'));
        const cns = somenteDigitos(campo(prof, 'CNS_PROF', 'CNS', 'CO_CNS'));
        const nomeProf = campo(prof, 'NOME_PROF', 'NOME', 'NO_PROFISSIONAL');
        if (!nomeProf || (!cpf && !cns)) continue;
        let pessoa = (await c.query(`select id from cad.pessoa where (cpf = $1 and $1 <> '') or (cns = $2 and $2 <> '') limit 1`, [cpf, cns])).rows[0];
        if (!pessoa) {
          pessoa = (
            await c.query(
              `insert into cad.pessoa (nome, data_nascimento, sexo, raca_cor, cpf, cns, nome_mae, situacao)
               values ($1, coalesce($2::date, '1900-01-01'), coalesce($3,'I'), '99', nullif($4,''), nullif($5,''), $6, 'ATIVO') returning id`,
              [nomeProf, dataScnes(campo(prof, 'DATA_NASC', 'DT_NASCIMENTO')), campo(prof, 'SEXO', 'TP_SEXO'), cpf, cns, campo(prof, 'NOME_MAE', 'NO_MAE') ?? null],
            )
          ).rows[0];
        }
        const profissional = (
          await c.query(
            `insert into cad.profissional (pessoa_id, ativo) values ($1, true)
             on conflict (pessoa_id) do update set ativo = true returning id`,
            [pessoa.id],
          )
        ).rows[0];
        resumo.profissionais++;
        for (const lot of nos(prof, ['DADOS_LOTACOES', 'LOTACAO', 'VINCULO'])) {
          const codCbo = campo(lot, 'CO_CBO', 'CBO', 'COD_CBO');
          if (!codCbo) continue;
          let cbo = (await c.query(`select id from cad.cbo where codigo = $1`, [codCbo])).rows[0];
          if (!cbo) {
            cbo = (await c.query(`insert into cad.cbo (codigo, nome, area_saude) values ($1, $2, true) returning id`, [codCbo, campo(lot, 'DS_CBO', 'NO_CBO') ?? `CBO ${codCbo}`])).rows[0];
            resumo.avisos.push(`CBO ${codCbo} incluído automaticamente.`);
          }
          const ch =
            Number(campo(lot, 'CARGA_HORARIA_AMB', 'CG_HORAAMB', 'CARGA_HORARIA') ?? 0) +
            Number(campo(lot, 'CARGA_HORARIA_HOSP', 'CGHORAHOSP') ?? 0) +
            Number(campo(lot, 'CARGA_HORARIA_OUTROS', 'CGHORAOUTR') ?? 0);
          const existe = (
            await c.query(`select id from cad.vinculo where profissional_id = $1 and unidade_id = $2 and cbo_id = $3`, [profissional.id, un.id, cbo.id])
          ).rows[0];
          const registro = campo(lot, 'NU_REGISTRO', 'REGISTRO', 'CONSELHO_NUM');
          if (existe) {
            await c.query(`update cad.vinculo set carga_horaria = $2, registro_conselho = coalesce($3, registro_conselho), ativo = true where id = $1`, [existe.id, ch || null, registro ?? null]);
          } else {
            await c.query(
              `insert into cad.vinculo (profissional_id, unidade_id, cbo_id, carga_horaria, registro_conselho, ine, ativo) values ($1,$2,$3,$4,$5,$6,true)`,
              [profissional.id, un.id, cbo.id, ch || null, registro ?? null, campo(lot, 'INE', 'CO_INE') ?? null],
            );
          }
          resumo.vinculos++;
          // Horário de expediente gerado automaticamente a partir da carga horária (TR 1.2.4.4).
          const temHorario = (await c.query(`select 1 from cad.horario_expediente where profissional_id = $1 and unidade_id = $2 limit 1`, [profissional.id, un.id])).rowCount;
          if (!temHorario && ch > 0) {
            const horasDia = Math.min(Math.ceil(ch / 5), 12);
            const fim = `${String(7 + horasDia).padStart(2, '0')}:00`;
            for (const dia of ['1', '2', '3', '4', '5']) {
              await c.query(`insert into cad.horario_expediente (profissional_id, unidade_id, dia_semana, hora_entrada, hora_saida) values ($1,$2,$3,'07:00',$4)`, [
                profissional.id,
                un.id,
                dia,
                fim,
              ]);
              resumo.horarios++;
            }
          }
        }
      }
    }
  });
  if (!estabelecimentos.length) resumo.avisos.push('Nenhum estabelecimento encontrado no arquivo. Verifique se é o XML de exportação do SCNES.');
  return resumo;
}

export async function importarCadsusXml(xml: string, ctx: Parameters<typeof transacao>[0]) {
  const doc = parser.parse(xml);
  const registros = nos(doc, ['USUARIO', 'CIDADAO', 'PACIENTE', 'PATIENT']);
  const resumo = { lidos: registros.length, incluidos: 0, atualizados: 0, ignorados: 0 };
  await transacao(ctx, async (c) => {
    for (const r of registros) {
      const cns = somenteDigitos(campo(r, 'CNS', 'NU_CNS', 'NUMERO_CNS'));
      const cpf = somenteDigitos(campo(r, 'CPF', 'NU_CPF'));
      const nome = campo(r, 'NOME', 'NO_USUARIO', 'NOME_COMPLETO');
      const nasc = dataScnes(campo(r, 'DATA_NASCIMENTO', 'DT_NASCIMENTO'));
      if (!nome || !nasc || (!cns && !cpf)) {
        resumo.ignorados++;
        continue;
      }
      const atual = (await c.query(`select id from cad.pessoa where (cns = $1 and $1 <> '') or (cpf = $2 and $2 <> '') limit 1`, [cns, cpf])).rows[0];
      const valores = [
        nome,
        nasc,
        campo(r, 'SEXO', 'TP_SEXO') ?? 'I',
        (campo(r, 'RACA_COR', 'CO_RACA') ?? '99').padStart(2, '0'),
        campo(r, 'NOME_MAE', 'NO_MAE') ?? null,
        campo(r, 'NOME_PAI', 'NO_PAI') ?? null,
        cns || null,
        cpf || null,
      ];
      if (atual) {
        await c.query(
          `update cad.pessoa set nome = $2, data_nascimento = $3, sexo = $4, raca_cor = $5, nome_mae = coalesce($6, nome_mae), nome_pai = coalesce($7, nome_pai),
                  cns = coalesce($8, cns), cpf = coalesce($9, cpf) where id = $1`,
          [atual.id, ...valores],
        );
        resumo.atualizados++;
      } else {
        await c.query(`insert into cad.pessoa (nome, data_nascimento, sexo, raca_cor, nome_mae, nome_pai, cns, cpf, situacao) values ($1,$2,$3,$4,$5,$6,$7,$8,'ATIVO')`, valores);
        resumo.incluidos++;
      }
    }
  });
  return resumo;
}

export { listaDe };
