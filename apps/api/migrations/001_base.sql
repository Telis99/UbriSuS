-- Estrutura base: esquemas, auditoria, sessões, relatórios, parâmetros e arquivos.

create extension if not exists unaccent;
create extension if not exists pg_trgm;

create schema if not exists seg;  -- segurança: operadores, perfis, sessões
create schema if not exists cad;  -- cadastro único compartilhado entre os módulos (TR 1.1.1.57)
create schema if not exists aud;  -- auditoria (TR 1.1.1.11, 1.1.1.36, 1.1.1.37)
create schema if not exists sis;  -- serviços do sistema: relatórios, preferências, arquivos, parâmetros

-- unaccent não é IMMUTABLE; este invólucro permite uso em índices de busca.
create or replace function public.f_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ---------------------------------------------------------------------------
-- Auditoria de dados: inclusões, alterações e exclusões com antes/depois.
-- Executada por gatilho, portanto registra também operações feitas por acesso
-- direto ao banco (identificadas pelo usuário do SGBD).
-- ---------------------------------------------------------------------------
create table if not exists aud.log_dados (
  id            bigint generated always as identity primary key,
  data_hora     timestamptz not null default clock_timestamp(),
  tabela        text not null,
  operacao      char(1) not null check (operacao in ('I', 'A', 'E')),
  registro_id   bigint,
  operador_id   bigint,
  ip            text,
  rotina        text,
  usuario_banco text not null default current_user,
  antes         jsonb,
  depois        jsonb
);
create index if not exists ix_log_dados_tabela on aud.log_dados (tabela, registro_id);
create index if not exists ix_log_dados_operador on aud.log_dados (operador_id, data_hora);
create index if not exists ix_log_dados_data on aud.log_dados (data_hora);

create or replace function aud.fn_auditar() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_antes jsonb;
  v_depois jsonb;
  v_operador text := nullif(current_setting('app.usuario_id', true), '');
begin
  if tg_op = 'INSERT' then
    v_depois := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_antes := to_jsonb(old);
    v_depois := to_jsonb(new);
    if v_antes = v_depois then return new; end if;
  else
    v_antes := to_jsonb(old);
  end if;
  -- Campos sigilosos nunca vão para o log.
  v_antes := v_antes - 'senha_hash';
  v_depois := v_depois - 'senha_hash';
  insert into aud.log_dados (tabela, operacao, registro_id, operador_id, ip, rotina, antes, depois)
  values (
    tg_table_schema || '.' || tg_table_name,
    case tg_op when 'INSERT' then 'I' when 'UPDATE' then 'A' else 'E' end,
    coalesce((v_depois ->> 'id')::bigint, (v_antes ->> 'id')::bigint),
    v_operador::bigint,
    nullif(current_setting('app.ip', true), ''),
    nullif(current_setting('app.rotina', true), ''),
    v_antes,
    v_depois
  );
  return coalesce(new, old);
end $$;

-- Preenche autoria e data das alterações (TR 1.1.2.1.9, 1.2.6.5).
create or replace function sis.fn_carimbo() returns trigger
language plpgsql as $$
declare
  v_operador bigint := nullif(current_setting('app.usuario_id', true), '')::bigint;
begin
  if tg_op = 'INSERT' then
    new.criado_em := coalesce(new.criado_em, now());
    new.criado_por := coalesce(new.criado_por, v_operador);
  else
    new.criado_em := old.criado_em;
    new.criado_por := old.criado_por;
    new.atualizado_em := now();
    new.atualizado_por := v_operador;
  end if;
  return new;
end $$;

-- Os registros de auditoria são somente inclusão.
create or replace function aud.fn_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'Registros de auditoria não podem ser alterados ou excluídos';
end $$;

drop trigger if exists tg_imutavel on aud.log_dados;
create trigger tg_imutavel before update or delete on aud.log_dados
  for each row execute function aud.fn_imutavel();

-- Autenticação de operadores: login, logout e tentativas inválidas (TR 1.1.1.11.2).
create table if not exists aud.log_acesso (
  id          bigint generated always as identity primary key,
  data_hora   timestamptz not null default now(),
  operador_id bigint,
  login       text,
  evento      text not null, -- login, logout, falha, bloqueio, sessao_encerrada, expirada
  ip          text,
  agente      text,
  detalhe     text
);
create index if not exists ix_log_acesso_operador on aud.log_acesso (operador_id, data_hora);

-- Histórico de acessos por operador, rotina e ação (TR 1.1.1.36, 1.1.2.1.50).
create table if not exists aud.log_rotina (
  id          bigint generated always as identity primary key,
  data_hora   timestamptz not null default now(),
  operador_id bigint,
  rotina      text not null,
  acao        text not null,
  ip          text,
  detalhe     jsonb
);
create index if not exists ix_log_rotina_operador on aud.log_rotina (operador_id, data_hora);

-- Uso de certificados digitais (TR 1.1.1.49).
create table if not exists aud.log_certificado (
  id             bigint generated always as identity primary key,
  data_hora      timestamptz not null default now(),
  operador_id    bigint not null,
  certificado_id bigint,
  modulo         text,
  documento      text,
  ip             text
);

-- Consultas a bases externas (CADSUS/Cadweb, CPF) (TR 1.2.6.6.3).
create table if not exists aud.log_integracao (
  id          bigint generated always as identity primary key,
  data_hora   timestamptz not null default now(),
  operador_id bigint,
  servico     text not null,
  operacao    text not null,
  chave       text,
  sucesso     boolean not null,
  detalhe     text
);

-- Erros da aplicação disponíveis para consulta (TR 1.1.2.1.10).
create table if not exists aud.log_erro (
  id          bigint generated always as identity primary key,
  data_hora   timestamptz not null default now(),
  operador_id bigint,
  rota        text,
  mensagem    text,
  pilha       text
);

-- ---------------------------------------------------------------------------
-- Sessões de operadores (TR 1.1.1.9, 1.1.1.10).
-- ---------------------------------------------------------------------------
create table if not exists seg.sessao (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null unique,
  operador_id    bigint not null,
  inicio         timestamptz not null default now(),
  ultimo_acesso  timestamptz not null default now(),
  ip             text,
  agente         text,
  unidade_id     bigint,
  encerrada_em   timestamptz,
  motivo_encerramento text
);
create index if not exists ix_sessao_ativa on seg.sessao (operador_id) where encerrada_em is null;

-- ---------------------------------------------------------------------------
-- Serviços do sistema
-- ---------------------------------------------------------------------------
create table if not exists sis.parametro (
  chave       text primary key,
  valor       jsonb not null,
  descricao   text,
  modulo      text,
  atualizado_em timestamptz default now(),
  atualizado_por bigint
);

-- Preferências do operador: consultas salvas, colunas, filtros (TR 1.1.1.63, 1.1.2.1.45, 1.1.2.1.64).
create table if not exists sis.preferencia (
  id           bigint generated always as identity primary key,
  operador_id  bigint not null,
  chave        text not null,
  nome         text not null default 'padrao',
  valor        jsonb not null,
  compartilhada boolean not null default false,
  criado_em    timestamptz not null default now(),
  unique (operador_id, chave, nome)
);

-- Arquivos (documentos digitalizados, fotos, anexos).
create table if not exists sis.arquivo (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  tipo_mime   text not null,
  tamanho     bigint not null,
  sha256      text not null,
  conteudo    bytea not null,
  criado_em   timestamptz not null default now(),
  criado_por  bigint
);

-- Relatórios emitidos: cópia armazenada com código único, filtros, operador e data (TR 1.1.1.64.17).
create table if not exists sis.relatorio_emitido (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique,
  relatorio    text not null,
  titulo       text not null,
  filtros      jsonb not null default '{}',
  formato      text not null,
  operador_id  bigint,
  situacao     text not null default 'gerando', -- gerando, concluido, erro
  emitido_em   timestamptz not null default now(),
  concluido_em timestamptz,
  arquivo_id   uuid references sis.arquivo (id),
  assinado     boolean not null default false,
  erro         text,
  chave_execucao text
);
create index if not exists ix_relatorio_operador on sis.relatorio_emitido (operador_id, emitido_em desc);
create unique index if not exists ux_relatorio_em_execucao on sis.relatorio_emitido (chave_execucao)
  where situacao = 'gerando';

-- Verificação de consistência da base (TR 1.1.1.14).
create table if not exists sis.consistencia_execucao (
  id           bigint generated always as identity primary key,
  iniciada_em  timestamptz not null default now(),
  concluida_em timestamptz,
  operador_id  bigint,
  situacao     text not null default 'executando',
  resultado    jsonb
);

-- Aceite de política de cookies e termos de uso (TR 1.1.1.35, 1.1.1.66).
create table if not exists sis.aceite (
  id          bigint generated always as identity primary key,
  tipo        text not null, -- cookies, termos_uso
  versao      text not null,
  operador_id bigint,
  cidadao_id  bigint,
  ip          text,
  agente      text,
  data_hora   timestamptz not null default now()
);

-- Notificações entre operadores, com anexos (TR 1.1.2.1.47, 1.1.2.1.48).
create table if not exists sis.notificacao_operador (
  id            bigint generated always as identity primary key,
  remetente_id  bigint,
  destinatario_id bigint not null,
  titulo        text not null,
  mensagem      text not null,
  anexo_id      uuid references sis.arquivo (id),
  lida_em       timestamptz,
  excluida_em   timestamptz,
  criado_em     timestamptz not null default now()
);
create index if not exists ix_notificacao_destinatario on sis.notificacao_operador (destinatario_id) where excluida_em is null;

-- Mensagens enviadas a pacientes por e-mail, SMS ou aplicativo (TR 1.2.2.11).
create table if not exists sis.mensagem (
  id              bigint generated always as identity primary key,
  paciente_id     bigint,
  meio            text not null check (meio in ('email', 'sms', 'push')),
  destinatario    text not null,
  assunto         text,
  texto           text not null,
  evento          text, -- agendamento, lista_espera, transferencia, cancelamento, lembrete, avulsa
  situacao        text not null default 'aguardando', -- agendada, aguardando, enviada, recebida, falha
  agendada_para   timestamptz,
  gerada_em       timestamptz not null default now(),
  processada_em   timestamptz,
  erro            text,
  operador_id     bigint,
  referencia      text
);
create index if not exists ix_mensagem_situacao on sis.mensagem (situacao, agendada_para);

create table if not exists sis.mensagem_resposta (
  id           bigint generated always as identity primary key,
  mensagem_id  bigint not null references sis.mensagem (id),
  texto        text not null,
  recebida_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Papéis do banco: a aplicação nunca opera como DBA (TR 1.1.1.20, 1.1.1.21).
-- Criados apenas quando o usuário da migração tem privilégio para tanto.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ubrisus_aplicacao') then
    create role ubrisus_aplicacao nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'ubrisus_consulta') then
    create role ubrisus_consulta nologin;
  end if;
exception when insufficient_privilege then
  raise notice 'Sem privilégio para criar papéis; configure-os manualmente (docs/infraestrutura.md).';
end $$;
