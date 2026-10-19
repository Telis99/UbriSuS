-- Assinaturas eletrônicas de documentos e solicitações de assinatura (TR 1.1.1.47 a 1.1.1.56, Lei 14.063/2020).

create table if not exists sis.assinatura (
  id               bigint generated always as identity primary key,
  relatorio_codigo text not null,
  arquivo_original_id uuid references sis.arquivo (id),
  arquivo_assinado_id uuid references sis.arquivo (id),
  operador_id      bigint,
  cidadao_id       bigint,
  signatario       text not null,
  documento_signatario text,
  modalidade       text not null check (modalidade in ('BASICA', 'AVANCADA', 'QUALIFICADA')),
  certificado_id   bigint,
  certificado_serie text,
  hash_documento   text not null,
  assinado_em      timestamptz not null default now(),
  ip               text,
  modulo           text
);
create index if not exists ix_assinatura_codigo on sis.assinatura (relatorio_codigo);
create index if not exists ix_assinatura_operador on sis.assinatura (operador_id, assinado_em);

-- Solicitações de assinatura sequenciais ou simultâneas (TR 1.1.1.54).
create table if not exists sis.solicitacao_assinatura (
  id               bigint generated always as identity primary key,
  titulo           text not null,
  solicitante_id   bigint not null,
  modo             text not null check (modo in ('SEQUENCIAL', 'UNIFICADA')),
  notificar_conclusao boolean not null default true,
  situacao         text not null default 'PENDENTE' check (situacao in ('PENDENTE', 'CONCLUIDA', 'REJEITADA', 'CANCELADA')),
  criada_em        timestamptz not null default now(),
  concluida_em     timestamptz
);

create table if not exists sis.solicitacao_assinatura_documento (
  id              bigint generated always as identity primary key,
  solicitacao_id  bigint not null references sis.solicitacao_assinatura (id) on delete restrict,
  relatorio_codigo text not null,
  titulo          text not null
);

create table if not exists sis.solicitacao_assinatura_signatario (
  id              bigint generated always as identity primary key,
  solicitacao_id  bigint not null references sis.solicitacao_assinatura (id) on delete restrict,
  ordem           int not null default 1,
  operador_id     bigint,
  cidadao_id      bigint,
  modalidade      text not null default 'AVANCADA',
  situacao        text not null default 'PENDENTE' check (situacao in ('PENDENTE', 'ASSINADO', 'REJEITADO')),
  motivo_rejeicao text,
  respondido_em   timestamptz
);
create index if not exists ix_solic_sig_operador on sis.solicitacao_assinatura_signatario (operador_id, situacao);
