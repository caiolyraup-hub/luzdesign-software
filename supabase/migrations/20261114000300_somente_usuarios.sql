-- Dia 12C: achado da matriz de permissões. O cadastro público do Supabase Auth está LIGADO
-- (disable_signup = false), então qualquer pessoa pode criar uma conta (com e-mail confirmado) e ficar
-- "logada sem papel": sem linha em `usuarios`. Várias políticas liberavam leitura a QUALQUER logado
-- (produtos e preços, arquitetos com WhatsApp e aniversário, configurações da loja). Agora todas exigem
-- uma linha em `usuarios`. (Desligar o cadastro público no painel do Supabase continua recomendado.)

create function eh_usuario() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.usuarios u where u.id = (select auth.uid()));
$$;
revoke all on function eh_usuario() from public, anon;
grant execute on function eh_usuario() to authenticated, service_role;

drop policy produtos_ler on produtos;
create policy produtos_ler on produtos for select to authenticated using ((select eh_usuario()));
drop policy apelidos_ler on produto_apelidos;
create policy apelidos_ler on produto_apelidos for select to authenticated using ((select eh_usuario()));
drop policy descricao_formatada_ler on produtos_descricao_formatada;
create policy descricao_formatada_ler on produtos_descricao_formatada
  for select to authenticated using ((select eh_usuario()));
drop policy configuracoes_loja_ler on configuracoes_loja;
create policy configuracoes_loja_ler on configuracoes_loja for select to authenticated
  using ((select eh_usuario()));
drop policy arquitetos_ler on arquitetos;
create policy arquitetos_ler on arquitetos for select to authenticated
  using ((select eh_usuario()) and (ativo or (select eh_gerente())));
drop policy arquitetos_criar on arquitetos;
create policy arquitetos_criar on arquitetos for insert to authenticated
  with check ((select eh_usuario()) and criado_por = (select auth.uid()));

-- Tradução de referência do arquiteto: só para quem tem papel.
create or replace function buscar_por_referencia(p_texto text)
returns table (codigo text, descricao text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_norm text := normalizar_referencia(p_texto);
begin
  if v_usuario is null or not exists (select 1 from usuarios u where u.id = v_usuario) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  delete from consultas_referencia where criado_em < now() - interval '1 hour';
  if (select count(*) from consultas_referencia
       where usuario_id = v_usuario and criado_em > now() - interval '1 minute') >= 30 then
    raise exception 'LIMITE_CONSULTAS' using errcode = 'P0001';
  end if;
  insert into consultas_referencia (usuario_id) values (v_usuario);
  if char_length(v_norm) < 3 then
    return;
  end if;
  return query
    select p.codigo, p.descricao
      from produtos_dados_fornecedor d
      join produtos p on p.codigo = d.codigo
     where p.ativo and v_norm = any (d.referencias_normalizadas)
     order by p.codigo;
end;
$$;
