// Rotas das cópias de segurança e da exportação para portabilidade (TR 1.1.1.23, 1.1.1.70).
import { createReadStream, existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, pool } from '../../db/pool.js';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { ErroHttp, exigirPermissao, registrarRotina } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { registrarTarefaDiaria } from '../rotas.js';
import { executarBackup, gerarPortabilidade, PADRAO_BACKUP, tarefaBackup, validarCopias, type ConfigBackup } from './servico.js';

registrarPermissao('backup', 'Cópias de segurança e portabilidade de dados', 'TEC', ['consultar', 'executar', 'alterar']);
registrarParametro('backup.configuracao', PADRAO_BACKUP, 'Cópias de segurança no servidor local da contratante', 'TEC');
registrarTarefaDiaria(tarefaBackup);

const esquema = z.object({
  ativo: z.boolean(),
  diretorio: z.string().min(2).max(300).refine((d) => d.startsWith('/'), 'Informe o caminho absoluto do diretório montado.'),
  hora: z.number().int().min(0).max(23),
  retencaoDias: z.number().int().min(1).max(3650),
  validarUltimas: z.number().int().min(1).max(60),
});

export default async function rotasBackup(app: FastifyInstance) {
  // A tarefa diária geral roda a cada 6 horas; a cópia confere a hora configurada a cada 15 minutos.
  const t = setInterval(() => tarefaBackup().catch((e) => console.error('cópia de segurança:', e)), 15 * 60_000);
  t.unref();

  app.get('/api/backup', async (req) => {
    exigirPermissao(req, 'backup:consultar');
    const configuracao = { ...PADRAO_BACKUP, ...(await parametro<Partial<ConfigBackup>>('backup.configuracao', {})) };
    const copias = await consultar(
      `select k.id, k.tipo, k.origem, k.situacao, k.iniciado_em, k.concluido_em, k.arquivo, k.tamanho, k.sha256, k.validado_em, k.integro, k.mensagem, k.excluido, o.nome operador
         from sis.copia_seguranca k left join seg.operador o on o.id = k.operador_id order by k.id desc limit 200`,
    );
    return { configuracao, copias };
  });

  app.put('/api/backup/configuracao', async (req) => {
    exigirPermissao(req, 'backup:alterar');
    const b = esquema.parse(req.body);
    await pool.query(
      `insert into sis.parametro (chave, valor, descricao, modulo) values ('backup.configuracao', $1, 'Cópias de segurança no servidor local da contratante', 'TEC')
       on conflict (chave) do update set valor = excluded.valor`,
      [JSON.stringify(b)],
    );
    await registrarRotina(req, 'backup', 'configurar', b);
    return { ok: true };
  });

  // Execução manual em segundo plano: o resultado aparece na lista ao terminar.
  app.post('/api/backup/executar', async (req) => {
    const u = exigirPermissao(req, 'backup:executar');
    const tipo = z.object({ tipo: z.enum(['BACKUP', 'PORTABILIDADE']).default('BACKUP') }).parse(req.body ?? {}).tipo;
    await registrarRotina(req, 'backup', tipo === 'BACKUP' ? 'executar' : 'portabilidade');
    const tarefa = tipo === 'BACKUP' ? executarBackup('MANUAL', u.id) : gerarPortabilidade(u.id);
    tarefa.catch((e) => console.error(`${tipo.toLowerCase()}:`, e.message));
    return { ok: true, mensagem: tipo === 'BACKUP' ? 'Cópia de segurança iniciada.' : 'Exportação para portabilidade iniciada.' };
  });

  app.post('/api/backup/validar', async (req) => {
    exigirPermissao(req, 'backup:executar');
    const { limite } = z.object({ limite: z.number().int().min(1).max(200).optional() }).parse(req.body ?? {});
    return validarCopias(limite);
  });

  // Download do pacote de portabilidade (as cópias do banco ficam somente no servidor da contratante).
  app.get('/api/backup/:id/download', async (req, reply) => {
    exigirPermissao(req, 'backup:executar');
    const k = await consultarUm(`select * from sis.copia_seguranca where id = $1`, [(req.params as any).id]);
    if (!k || k.tipo !== 'PORTABILIDADE' || k.situacao !== 'CONCLUIDO' || k.excluido) throw new ErroHttp(404, 'Pacote de portabilidade não disponível.');
    if (!existsSync(k.arquivo)) throw new ErroHttp(410, 'O arquivo não está mais no diretório de cópias.');
    await registrarRotina(req, 'backup', 'download-portabilidade', { id: k.id });
    return reply
      .header('content-type', 'application/gzip')
      .header('content-disposition', `attachment; filename="${basename(k.arquivo)}"`)
      .send(createReadStream(k.arquivo));
  });
}
