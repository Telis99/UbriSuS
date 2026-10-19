import { randomBytes } from 'node:crypto';

function env(nome: string, padrao?: string): string {
  const v = process.env[nome] ?? padrao;
  if (v === undefined) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  return v;
}

export const config = {
  ambiente: env('NODE_ENV', 'development'),
  porta: Number(env('PORT', '3333')),
  host: env('HOST', '0.0.0.0'),
  // Conexão usada pela aplicação: papel sem privilégio de DBA (TR 1.1.1.21).
  databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/ubrisus'),
  // Conexão usada somente para atualização do sistema (migrações).
  databaseUrlMigrador: env('DATABASE_URL_MIGRADOR', process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ubrisus'),
  segredoCookie: env('COOKIE_SECRET', randomBytes(32).toString('hex')),
  urlPublica: env('APP_URL', 'http://localhost:5173'),
  nomeEntidade: env('NOME_ENTIDADE', 'Prefeitura Municipal de Cabreúva'),
  nomeSecretaria: env('NOME_SECRETARIA', 'Secretaria Municipal de Saúde'),
  codigoIbgeMunicipio: env('IBGE_MUNICIPIO', '3508405'),
  ufMunicipio: env('UF_MUNICIPIO', 'SP'),
  diretorioArquivos: env('STORAGE_DIR', new URL('../storage', import.meta.url).pathname),
  diretorioWeb: env('WEB_DIST', new URL('../../web/dist', import.meta.url).pathname),
  smtp: {
    host: process.env.SMTP_HOST,
    porta: Number(process.env.SMTP_PORT ?? 587),
    usuario: process.env.SMTP_USER,
    senha: process.env.SMTP_PASS,
    remetente: process.env.SMTP_FROM ?? 'nao-responda@saude.local',
  },
  sms: {
    provedor: process.env.SMS_PROVIDER ?? 'log',
    url: process.env.SMS_URL,
    token: process.env.SMS_TOKEN,
  },
  sessao: {
    // Inatividade máxima antes de encerrar a sessão automaticamente.
    inatividadeMinutos: Number(env('SESSAO_INATIVIDADE_MIN', '60')),
  },
};

export const emProducao = config.ambiente === 'production';
