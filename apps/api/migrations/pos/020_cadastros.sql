-- Regras de integridade do cadastro único executadas no banco, valendo também para
-- cargas e integrações (TR 1.1.1.57, 1.1.2.1.17: informação alimentada uma única vez).

create or replace function cad.fn_normalizar(t text) returns text language sql immutable as $$
  select nullif(regexp_replace(upper(f_unaccent(coalesce(t, ''))), '\s+', ' ', 'g'), '')
$$;

create or replace function cad.fn_pessoa_antes() returns trigger language plpgsql as $$
begin
  new.nome := regexp_replace(upper(trim(new.nome)), '\s+', ' ', 'g');
  new.nome_mae := nullif(regexp_replace(upper(trim(coalesce(new.nome_mae, ''))), '\s+', ' ', 'g'), '');
  new.nome_pai := nullif(regexp_replace(upper(trim(coalesce(new.nome_pai, ''))), '\s+', ' ', 'g'), '');
  new.nome_busca := cad.fn_normalizar(new.nome);
  new.nome_mae_busca := cad.fn_normalizar(new.nome_mae);
  if tg_op = 'INSERT' or new is distinct from old then
    new.cadastro_atualizado_em := current_date;
  end if;
  if new.situacao = 'FALECIDO' then
    -- Óbito: a pessoa deixa de receber comunicações automáticas.
    new.notificar_sms := false;
    new.notificar_email := false;
    new.notificar_app := false;
  end if;
  if new.situacao = 'PRE_CADASTRO' and new.pre_cadastro_valido_ate is null then
    new.pre_cadastro_valido_ate := current_date + coalesce(
      (select (valor #>> '{}')::int from sis.parametro where chave = 'paciente.validade_pre_cadastro_dias'), 30);
  elsif new.situacao <> 'PRE_CADASTRO' then
    new.pre_cadastro_valido_ate := null;
  end if;
  return new;
end $$;

drop trigger if exists tg_pessoa_antes on cad.pessoa;
create trigger tg_pessoa_antes before insert or update on cad.pessoa for each row execute function cad.fn_pessoa_antes();

create index if not exists ix_pessoa_duplicidade on cad.pessoa (nome_busca, data_nascimento, nome_mae_busca);

-- Nome do profissional e do operador vêm sempre da pessoa (sem redigitação).
create or replace function cad.fn_copiar_nome_pessoa() returns trigger language plpgsql as $$
begin
  select p.nome into new.nome from cad.pessoa p where p.id = new.pessoa_id;
  return new;
end $$;

drop trigger if exists tg_nome_pessoa on cad.profissional;
create trigger tg_nome_pessoa before insert or update of pessoa_id on cad.profissional for each row execute function cad.fn_copiar_nome_pessoa();

create or replace function seg.fn_operador_pessoa() returns trigger language plpgsql as $$
begin
  select p.nome, p.email into new.nome, new.email from cad.pessoa p where p.id = new.pessoa_id;
  return new;
end $$;

drop trigger if exists tg_operador_pessoa on seg.operador;
create trigger tg_operador_pessoa before insert or update of pessoa_id on seg.operador for each row execute function seg.fn_operador_pessoa();

create or replace function cad.fn_propagar_pessoa() returns trigger language plpgsql as $$
begin
  if new.nome is distinct from old.nome or new.email is distinct from old.email then
    update cad.profissional set nome = new.nome where pessoa_id = new.id and nome is distinct from new.nome;
    update seg.operador set nome = new.nome, email = new.email where pessoa_id = new.id;
    update cad.familia set responsavel_nome = new.nome where responsavel_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists tg_propagar_pessoa on cad.pessoa;
create trigger tg_propagar_pessoa after update on cad.pessoa for each row execute function cad.fn_propagar_pessoa();

create or replace function cad.fn_familia_responsavel() returns trigger language plpgsql as $$
begin
  select p.nome into new.responsavel_nome from cad.pessoa p where p.id = new.responsavel_id;
  if new.codigo is null then new.codigo := lpad(coalesce(new.id, nextval(pg_get_serial_sequence('cad.familia', 'id')))::text, 8, '0'); end if;
  return new;
end $$;

drop trigger if exists tg_familia_responsavel on cad.familia;
create trigger tg_familia_responsavel before insert or update of responsavel_id on cad.familia for each row execute function cad.fn_familia_responsavel();

create or replace function cad.fn_logradouro_tipo() returns trigger language plpgsql as $$
begin
  select coalesce(t.abreviatura, t.nome) into new.tipo_abreviatura from cad.tipo_logradouro t where t.id = new.tipo_logradouro_id;
  return new;
end $$;

drop trigger if exists tg_logradouro_tipo on cad.logradouro;
create trigger tg_logradouro_tipo before insert or update of tipo_logradouro_id on cad.logradouro for each row execute function cad.fn_logradouro_tipo();

create or replace function cad.fn_municipio_uf() returns trigger language plpgsql as $$
begin
  select u.sigla into new.uf_sigla from cad.uf u where u.id = new.uf_id;
  return new;
end $$;

drop trigger if exists tg_municipio_uf on cad.municipio;
create trigger tg_municipio_uf before insert or update of uf_id on cad.municipio for each row execute function cad.fn_municipio_uf();
