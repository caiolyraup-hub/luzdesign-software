-- Dia 12A: a rota pública /api/saude mostra a última migration aplicada. A função devolve só a versão
-- (um número de data/hora), sem nenhum dado do negócio. plpgsql (e não sql) porque a tabela de
-- migrations só existe no Supabase, não no banco local dos testes.
create function ultima_migration() returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select max(version) from supabase_migrations.schema_migrations);
exception when undefined_table then
  return null;
end;
$$;
revoke all on function ultima_migration() from public;
grant execute on function ultima_migration() to anon, authenticated, service_role;
