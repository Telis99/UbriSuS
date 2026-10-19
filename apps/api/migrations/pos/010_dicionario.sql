-- Dicionário de dados de todas as tabelas, com formatos, chaves, relacionamentos e valores
-- enumerados (comentários gerados a partir dos metadados) (TR 1.1.2.1.13.1).
create or replace view sis.vw_dicionario_dados as
select
  c.table_schema as esquema,
  c.table_name as tabela,
  c.table_schema || '.' || c.table_name as tabela_completa,
  obj_description((quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass, 'pg_class') as descricao_tabela,
  c.ordinal_position as posicao,
  c.column_name as coluna,
  case
    when c.character_maximum_length is not null then c.data_type || '(' || c.character_maximum_length || ')'
    when c.numeric_precision is not null and c.data_type = 'numeric' then 'numeric(' || c.numeric_precision || ',' || c.numeric_scale || ')'
    else c.data_type
  end as tipo,
  c.is_nullable = 'NO' as obrigatorio,
  (select string_agg(case tc.constraint_type when 'PRIMARY KEY' then 'PK' when 'FOREIGN KEY' then 'FK' when 'UNIQUE' then 'UK' end, ',')
     from information_schema.key_column_usage k
     join information_schema.table_constraints tc on tc.constraint_name = k.constraint_name and tc.table_schema = k.table_schema
    where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = c.column_name) as chave,
  (select ccu.table_schema || '.' || ccu.table_name || '(' || ccu.column_name || ')'
     from information_schema.key_column_usage k
     join information_schema.table_constraints tc on tc.constraint_name = k.constraint_name and tc.table_schema = k.table_schema and tc.constraint_type = 'FOREIGN KEY'
     join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
    where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = c.column_name limit 1) as referencia,
  col_description((quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass, c.ordinal_position) as descricao
from information_schema.columns c
join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
where c.table_schema not in ('pg_catalog', 'information_schema');
