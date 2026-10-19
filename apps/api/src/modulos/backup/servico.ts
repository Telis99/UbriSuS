// Execução das cópias de segurança (pg_dump) no diretório do servidor local da contratante, validação
// periódica de integridade e pacote de portabilidade em formatos abertos (TR 1.1.1.23, 1.1.1.70).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.js';
import { consultar, consultarUm, pool } from '../../db/pool.js';
import { listarEntidades } from '../../meta/registro.js';
import { parametro } from '../cadastros/alertas.js';

export interface ConfigBackup {
  ativo: boolean;
  /** Diretório montado do servidor local da contratante (NFS/SMB). */
  diretorio: string;
  /** Hora do dia (0 a 23) a partir da qual a cópia diária é feita. */
  hora: number;
  retencaoDias: number;
  /** Quantas cópias recentes têm a integridade revalidada todo dia. */
  validarUltimas: number;
}

export const PADRAO_BACKUP: ConfigBackup = { ativo: false, diretorio: '/mnt/backup-contratante/ubrisus', hora: 2, retencaoDias: 30, validarUltimas: 7 };

/** Credenciais por variável de ambiente, para não expor a senha na lista de processos. */
function conexao() {
  const u = new URL(config.databaseUrlMigrador);
  return {
    args: ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.slice(1)],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) },
  };
}

function executar(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { env });
    let saida = '';
    let erro = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (erro += d));
    p.on('error', falha);
    p.on('close', (cod) => (cod === 0 ? ok(saida) : falha(new Error(`${cmd} terminou com código ${cod}: ${erro.slice(-500)}`))));
  });
}

function sha256(arquivo: string): Promise<string> {
  return new Promise((ok, falha) => {
    const h = createHash('sha256');
    createReadStream(arquivo).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', falha);
  });
}

const carimbo = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

async function registrar(tipo: string, origem: string, operadorId: number | null) {
  return (await consultarUm<{ id: number }>(
    `insert into sis.copia_seguranca (tipo, origem, situacao, iniciado_em, operador_id) values ($1, $2, 'EXECUTANDO', now(), $3) returning id`,
    [tipo, origem, operadorId],
  ))!.id;
}

async function concluir(id: number, arquivo: string, integro: boolean, mensagem: string) {
  const tamanho = statSync(arquivo).size;
  await pool.query(
    `update sis.copia_seguranca set situacao = 'CONCLUIDO', concluido_em = now(), arquivo = $2, tamanho = $3, sha256 = $4, validado_em = now(), integro = $5, mensagem = $6 where id = $1`,
    [id, arquivo, tamanho, await sha256(arquivo), integro, mensagem],
  );
}

async function falhar(id: number, e: unknown) {
  await pool.query(`update sis.copia_seguranca set situacao = 'FALHA', concluido_em = now(), mensagem = $2 where id = $1`, [id, (e as Error).message]);
}

/** Confere se o arquivo de cópia pode ser lido pelo pg_restore (catálogo completo e sem corrupção). */
async function conferirDump(arquivo: string) {
  const lista = await executar('pg_restore', ['--list', arquivo]);
  const objetos = lista.split('\n').filter((l) => l && !l.startsWith(';')).length;
  if (objetos < 10) throw new Error(`Catálogo da cópia com apenas ${objetos} objetos.`);
  return objetos;
}

let emExecucao = false;

/** Cópia completa do banco (formato custom do PostgreSQL, compactado) com validação imediata. */
export async function executarBackup(origem: 'AGENDADA' | 'MANUAL', operadorId: number | null = null) {
  if (emExecucao) throw new Error('Já existe uma cópia de segurança em execução.');
  emExecucao = true;
  const cfg = { ...PADRAO_BACKUP, ...(await parametro<Partial<ConfigBackup>>('backup.configuracao', {})) };
  const id = await registrar('BACKUP', origem, operadorId);
  try {
    mkdirSync(cfg.diretorio, { recursive: true });
    const arquivo = join(cfg.diretorio, `ubrisus-${carimbo()}.dump`);
    const { args, env } = conexao();
    await executar('pg_dump', [...args, '-Fc', '-Z', '6', '-f', arquivo], env);
    const objetos = await conferirDump(arquivo);
    await concluir(id, arquivo, true, `Cópia íntegra: ${objetos} objetos no catálogo.`);
    await aplicarRetencao(cfg);
    return id;
  } catch (e) {
    await falhar(id, e);
    throw e;
  } finally {
    emExecucao = false;
  }
}

/** Revalida o resumo SHA-256 e a leitura das cópias recentes (validação periódica de integridade). */
export async function validarCopias(limite?: number) {
  const cfg = { ...PADRAO_BACKUP, ...(await parametro<Partial<ConfigBackup>>('backup.configuracao', {})) };
  const copias = await consultar(
    `select id, tipo, arquivo, sha256 from sis.copia_seguranca where situacao = 'CONCLUIDO' and not excluido order by id desc limit $1`,
    [limite ?? cfg.validarUltimas],
  );
  const resultado = [];
  for (const k of copias) {
    let integro = false;
    let mensagem: string;
    try {
      if (!existsSync(k.arquivo)) throw new Error('Arquivo não encontrado no diretório de cópias.');
      if ((await sha256(k.arquivo)) !== k.sha256) throw new Error('Resumo SHA-256 divergente: arquivo alterado ou corrompido.');
      if (k.tipo === 'BACKUP') await conferirDump(k.arquivo);
      else await executar('tar', ['-tzf', k.arquivo]);
      integro = true;
      mensagem = 'Integridade confirmada.';
    } catch (e) {
      mensagem = (e as Error).message;
    }
    await pool.query(`update sis.copia_seguranca set validado_em = now(), integro = $2, mensagem = $3 where id = $1`, [k.id, integro, mensagem]);
    resultado.push({ id: k.id, integro, mensagem });
  }
  return resultado;
}

async function aplicarRetencao(cfg: ConfigBackup) {
  const antigos = await consultar(
    `select id, arquivo from sis.copia_seguranca where tipo = 'BACKUP' and situacao = 'CONCLUIDO' and not excluido and concluido_em < now() - make_interval(days => $1::int)
       and id not in (select id from sis.copia_seguranca where tipo = 'BACKUP' and situacao = 'CONCLUIDO' and integro and not excluido order by id desc limit 3)`,
    [cfg.retencaoDias],
  );
  for (const a of antigos) {
    rmSync(a.arquivo, { force: true });
    await pool.query(`update sis.copia_seguranca set excluido = true where id = $1`, [a.id]);
  }
}

/** Tarefa periódica: cópia diária após a hora configurada e validação das últimas cópias. */
export async function tarefaBackup() {
  const cfg = { ...PADRAO_BACKUP, ...(await parametro<Partial<ConfigBackup>>('backup.configuracao', {})) };
  if (!cfg.ativo) return;
  const ultima = await consultarUm(`select max(iniciado_em) m from sis.copia_seguranca where tipo = 'BACKUP' and origem = 'AGENDADA' and situacao <> 'FALHA'`);
  const hoje = new Date();
  const feitaHoje = ultima?.m && new Date(ultima.m).toDateString() === hoje.toDateString();
  if (!feitaHoje && hoje.getHours() >= cfg.hora) {
    await executarBackup('AGENDADA').catch((e) => console.error('cópia de segurança:', e.message));
    await validarCopias();
  }
}

// Colunas nunca exportadas no pacote de portabilidade (credenciais e segredos).
const SIGILOSAS = /senha|token|segredo|secret|conteudo_cifrado|pfx|chave_privada/i;
const EXCLUIR_TABELAS = new Set(['seg.sessao', 'portal.sessao', 'sis.certificado_digital', 'sis.parametro']);

/**
 * Pacote de portabilidade: um CSV (UTF-8, cabeçalho) por tabela, dicionário de dados em JSON com títulos
 * e descrições dos campos, esquema SQL e instruções, compactados em .tar.gz (TR 1.1.1.70).
 */
export async function gerarPortabilidade(operadorId: number) {
  const cfg = { ...PADRAO_BACKUP, ...(await parametro<Partial<ConfigBackup>>('backup.configuracao', {})) };
  const id = await registrar('PORTABILIDADE', 'MANUAL', operadorId);
  const nome = `portabilidade-${carimbo()}`;
  const base = join(cfg.diretorio, nome);
  try {
    mkdirSync(join(base, 'dados'), { recursive: true });
    const { args, env } = conexao();
    const tabelas = await consultar<{ esquema: string; tabela: string }>(
      `select table_schema esquema, table_name tabela from information_schema.tables
        where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema', 'public') order by 1, 2`,
    );
    const colunas = await consultar<{ esquema: string; tabela: string; coluna: string; tipo: string }>(
      `select table_schema esquema, table_name tabela, column_name coluna, data_type tipo from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema', 'public') order by table_schema, table_name, ordinal_position`,
    );
    const metas = new Map(listarEntidades().map((e) => [e.tabela, e]));
    const dicionario = [];
    let total = 0;
    for (const t of tabelas) {
      const chave = `${t.esquema}.${t.tabela}`;
      if (EXCLUIR_TABELAS.has(chave)) continue;
      // O conteúdo dos anexos vai em arquivos próprios (pasta anexos/), não no CSV.
      const cols = colunas.filter((c) => c.esquema === t.esquema && c.tabela === t.tabela && !SIGILOSAS.test(c.coluna) && !(chave === 'sis.arquivo' && c.coluna === 'conteudo'));
      if (!cols.length) continue;
      const lista = cols.map((c) => `"${c.coluna}"`).join(', ');
      const arquivo = join(base, 'dados', `${chave}.csv`);
      await executar('psql', [...args, '-X', '-q', '-c', `\\copy (select ${lista} from "${t.esquema}"."${t.tabela}") to '${arquivo.replace(/'/g, "''")}' with (format csv, header, encoding 'UTF8')`], env);
      const m = metas.get(chave);
      const registros = (await consultarUm(`select count(*)::int n from "${t.esquema}"."${t.tabela}"`))!.n;
      total += registros;
      dicionario.push({
        tabela: chave,
        arquivo: `dados/${chave}.csv`,
        titulo: m?.titulo ?? null,
        registros,
        colunas: cols.map((c) => {
          const campo = m?.campos.find((x) => x.nome === c.coluna);
          return { nome: c.coluna, tipo: c.tipo, rotulo: campo?.rotulo ?? null, opcoes: campo?.opcoes ?? null, referencia: campo?.ref ? metas.get(campo.ref)?.tabela ?? campo.ref : null };
        }),
      });
    }
    mkdirSync(join(base, 'anexos'), { recursive: true });
    for (let ultimo = '00000000-0000-0000-0000-000000000000'; ; ) {
      const lote = await consultar(`select id, nome, conteudo from sis.arquivo where id > $1 order by id limit 200`, [ultimo]);
      if (!lote.length) break;
      for (const a of lote) writeFileSync(join(base, 'anexos', `${a.id}-${String(a.nome).replace(/[^\w.-]+/g, '_').slice(0, 80)}`), a.conteudo);
      ultimo = lote[lote.length - 1].id;
    }
    writeFileSync(join(base, 'dicionario-dados.json'), JSON.stringify({ geradoEm: new Date().toISOString(), sistema: 'UbriSUS', tabelas: dicionario }, null, 2));
    await executar('pg_dump', [...args, '--schema-only', '--no-owner', '--no-privileges', '-f', join(base, 'esquema.sql')], env);
    writeFileSync(
      join(base, 'LEIA-ME.txt'),
      [
        'Pacote de portabilidade dos dados do sistema de gestão da saúde.',
        '',
        'dados/<esquema>.<tabela>.csv  - registros de cada tabela (CSV, UTF-8, separador vírgula, primeira linha com os nomes das colunas)',
        'dicionario-dados.json         - descrição das tabelas e colunas, rótulos, listas de opções e referências entre tabelas',
        'esquema.sql                   - estrutura do banco de dados PostgreSQL (tabelas, chaves e índices)',
        '',
        'Credenciais, senhas, tokens de sessão e certificados digitais não são exportados.',
        'anexos/<id>-<nome>             - imagens e documentos anexados (o id corresponde à coluna id de dados/sis.arquivo.csv)',
      ].join('\n'),
    );
    const arquivo = `${base}.tar.gz`;
    await executar('tar', ['-czf', arquivo, '-C', cfg.diretorio, nome]);
    rmSync(base, { recursive: true, force: true });
    await concluir(id, arquivo, true, `${dicionario.length} tabelas, ${total} registros exportados.`);
    return id;
  } catch (e) {
    rmSync(base, { recursive: true, force: true });
    await falhar(id, e);
    throw e;
  }
}
