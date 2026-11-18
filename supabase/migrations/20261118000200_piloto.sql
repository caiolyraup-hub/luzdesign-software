-- Dia 13B: marca do PILOTO. No piloto (a partir de 19/11/2026) a Aline e a Kely usam as contas de
-- teste delas com clientes de verdade. Esses orçamentos contam nos números e NÃO podem ser tratados
-- como lixo de teste pelo go-live. A marca é `orcamentos.piloto`:
--   * sai sozinha (gatilho) para orçamentos criados pelas contas +aline e +kely depois do início;
--   * a gerência marca e desmarca à mão (marcar_piloto);
--   * orçamento piloto nunca é "de teste" (orcamento_eh_teste, view orcamentos_reais, listas, comissões).

alter table configuracoes_loja
  add column piloto_inicio timestamptz not null default timestamptz '2026-11-19 00:00:00-03';

alter table orcamentos add column piloto boolean not null default false;
create index orcamentos_piloto on orcamentos (vendedora_id) where piloto;

-- ---------------------------------------------------------------- regra de teste com o piloto
create function orcamento_eh_teste(p_respostas jsonb, p_cliente uuid, p_piloto boolean)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select not coalesce(p_piloto, false) and public.orcamento_eh_teste(p_respostas, p_cliente)
$$;
revoke all on function orcamento_eh_teste(jsonb, uuid, boolean) from public, anon;
grant execute on function orcamento_eh_teste(jsonb, uuid, boolean) to authenticated, service_role;

-- As funções que filtram teste passam a usar a versão com a marca (troca exata do texto da chamada).
do $$
declare
  r record;
  v_def text;
  v_trocadas integer := 0;
begin
  for r in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.prosrc like '%orcamento_eh_teste(o.respostas, o.cliente_id)%'
  loop
    v_def := replace(
      pg_get_functiondef(r.oid),
      'orcamento_eh_teste(o.respostas, o.cliente_id)',
      'orcamento_eh_teste(o.respostas, o.cliente_id, o.piloto)'
    );
    execute v_def;
    v_trocadas := v_trocadas + 1;
  end loop;
  if v_trocadas < 1 then
    raise exception 'nenhuma função trocada; a regra de teste mudou de texto?';
  end if;
  -- nenhuma função (fora os dois invólucros) pode continuar chamando a versão de 2 argumentos
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.proname <> 'orcamento_eh_teste'
       and p.prosrc ~ 'orcamento_eh_teste\([^,()]+,[^,()]+\)'
  ) then
    raise exception 'ainda há função chamando orcamento_eh_teste com 2 argumentos';
  end if;
end;
$$;

drop view orcamentos_reais;
create view orcamentos_reais with (security_invoker = true) as
  select o.* from orcamentos o where not orcamento_eh_teste(o.respostas, o.cliente_id, o.piloto);
revoke all on orcamentos_reais from anon;

-- ---------------------------------------------------------------- marcação
create function marcar_orcamento_piloto() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not new.piloto
       and now() >= (select piloto_inicio from public.configuracoes_loja where id)
       and exists (
         select 1 from public.usuarios u
          where u.id = new.vendedora_id and u.perfil = 'vendedora'
            and u.email ~* '\+(aline|kely)@'
       ) then
      new.piloto := true;
    end if;
  elsif new.piloto is distinct from old.piloto then
    -- só a gerência (ou o servidor, sem login) muda a marca
    if auth.uid() is not null and not public.eh_gerente() then
      raise exception 'Só a gerência marca ou desmarca orçamento do piloto.';
    end if;
  end if;
  return new;
end;
$$;
create trigger orcamentos_piloto before insert or update on orcamentos
  for each row execute function marcar_orcamento_piloto();

create function marcar_piloto(p_orcamento uuid, p_piloto boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.eh_gerente() then
    raise exception 'Só a gerência marca ou desmarca orçamento do piloto.';
  end if;
  update public.orcamentos set piloto = p_piloto where id = p_orcamento;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;
end;
$$;
revoke all on function marcar_piloto(uuid, boolean) from public, anon;
grant execute on function marcar_piloto(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- passagem para as contas reais
-- Move os orçamentos PILOTO de uma conta para outra e tudo que depende deles, numa transação só
-- (a função inteira é atômica). Só o servidor (service role) executa. p_executar = false só conta.
-- O Storage (arquivos em <vendedora>/<orçamento>/...) é movido pelo script, antes desta chamada.
create function transferir_piloto(p_de uuid, p_para uuid, p_executar boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_orcs uuid[];
  v_clientes uuid[];
  v_conflito text;
  v_antes jsonb;
  v_depois jsonb;
  v_prefixo_de text := p_de::text || '/';
  v_prefixo_para text := p_para::text || '/';
  v_arquivos jsonb;
begin
  if p_de = p_para then raise exception 'As contas de origem e destino são a mesma.'; end if;
  if not exists (select 1 from usuarios where id = p_de and perfil = 'vendedora') then
    raise exception 'Conta de origem não é de vendedora.';
  end if;
  if not exists (select 1 from usuarios where id = p_para and perfil = 'vendedora') then
    raise exception 'Conta de destino não existe ou não é de vendedora.';
  end if;

  select coalesce(array_agg(id), '{}') into v_orcs
    from orcamentos where vendedora_id = p_de and piloto;
  select coalesce(array_agg(distinct cliente_id), '{}') into v_clientes
    from orcamentos where id = any (v_orcs);

  -- cliente que também tem orçamento NÃO piloto da conta de origem não pode ir sozinho
  select string_agg(distinct c.nome, ', ') into v_conflito
    from clientes c
    join orcamentos o on o.cliente_id = c.id
   where c.id = any (v_clientes) and not (o.id = any (v_orcs)) and o.vendedora_id = p_de;
  if v_conflito is not null then
    raise exception 'Cliente(s) com orçamento de piloto e de teste ao mesmo tempo: %. Resolva antes (marque ou desmarque).', v_conflito;
  end if;

  select jsonb_agg(jsonb_build_object('de', x.caminho, 'para', v_prefixo_para || substr(x.caminho, length(v_prefixo_de) + 1)))
    into v_arquivos
    from (
      select caminho_storage as caminho from anexos where orcamento_id = any (v_orcs)
      union select pdf_caminho from orcamentos where id = any (v_orcs) and pdf_caminho is not null
      union select xlsx_caminho from orcamentos where id = any (v_orcs) and xlsx_caminho is not null
    ) x;

  v_antes := jsonb_build_object(
    'orcamentos', (select count(*) from orcamentos where id = any (v_orcs)),
    'clientes', (select count(*) from clientes where id = any (v_clientes)),
    'itens', (select count(*) from orcamento_itens where orcamento_id = any (v_orcs)),
    'anexos', (select count(*) from anexos where orcamento_id = any (v_orcs)),
    'eventos', (select count(*) from eventos where orcamento_id = any (v_orcs) and usuario_id = p_de),
    'indicacoes_ia', (select count(*) from indicacoes_ia where orcamento_id = any (v_orcs) and vendedora_id = p_de),
    'uso_ia', (select count(*) from uso_ia where orcamento_id = any (v_orcs) and vendedora_id = p_de),
    'comissoes', (select count(*) from comissoes where orcamento_id = any (v_orcs) and tipo = 'vendedora' and beneficiario_id = p_de),
    'origem_orcamentos_piloto', (select count(*) from orcamentos where vendedora_id = p_de and piloto),
    'destino_orcamentos', (select count(*) from orcamentos where vendedora_id = p_para)
  );

  if p_executar then
    update clientes set vendedora_id = p_para where id = any (v_clientes);
    update orcamentos
       set vendedora_id = p_para,
           pdf_caminho = case when pdf_caminho like v_prefixo_de || '%' then v_prefixo_para || substr(pdf_caminho, length(v_prefixo_de) + 1) else pdf_caminho end,
           xlsx_caminho = case when xlsx_caminho like v_prefixo_de || '%' then v_prefixo_para || substr(xlsx_caminho, length(v_prefixo_de) + 1) else xlsx_caminho end
     where id = any (v_orcs);
    update anexos
       set caminho_storage = v_prefixo_para || substr(caminho_storage, length(v_prefixo_de) + 1)
     where orcamento_id = any (v_orcs) and caminho_storage like v_prefixo_de || '%';
    update eventos set usuario_id = p_para where orcamento_id = any (v_orcs) and usuario_id = p_de;
    update indicacoes_ia set vendedora_id = p_para where orcamento_id = any (v_orcs) and vendedora_id = p_de;
    update uso_ia set vendedora_id = p_para where orcamento_id = any (v_orcs) and vendedora_id = p_de;
    update comissoes set beneficiario_id = p_para
     where orcamento_id = any (v_orcs) and tipo = 'vendedora' and beneficiario_id = p_de;
  end if;

  v_depois := jsonb_build_object(
    'orcamentos_na_conta_destino', (select count(*) from orcamentos where id = any (v_orcs) and vendedora_id = p_para),
    'clientes_na_conta_destino', (select count(*) from clientes where id = any (v_clientes) and vendedora_id = p_para),
    'anexos_no_caminho_destino', (select count(*) from anexos where orcamento_id = any (v_orcs) and caminho_storage like v_prefixo_para || '%'),
    'eventos_na_conta_destino', (select count(*) from eventos where orcamento_id = any (v_orcs) and usuario_id = p_para),
    'origem_orcamentos_piloto', (select count(*) from orcamentos where vendedora_id = p_de and piloto),
    'destino_orcamentos', (select count(*) from orcamentos where vendedora_id = p_para)
  );

  return jsonb_build_object('executado', p_executar, 'antes', v_antes, 'depois', v_depois, 'arquivos', coalesce(v_arquivos, '[]'::jsonb));
end;
$$;
revoke all on function transferir_piloto(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function transferir_piloto(uuid, uuid, boolean) to service_role;
