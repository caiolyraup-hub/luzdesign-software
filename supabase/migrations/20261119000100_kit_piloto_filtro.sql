-- Dia 14: (1) origem "kit" para os itens adicionados pelo atalho de kit de fita; (2) filtro "Piloto" na
-- lista de orçamentos (só gerência e dono usam: a tela só oferece para eles); (3) resumo do piloto
-- separa o kit. Os itens já gravados continuam como estão (manual).

do $$
declare
  v_nome text;
begin
  for v_nome in
    select conname from pg_constraint
     where conrelid = 'public.orcamento_itens'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%origem%'
  loop
    execute format('alter table public.orcamento_itens drop constraint %I', v_nome);
  end loop;
end;
$$;
alter table orcamento_itens
  add constraint orcamento_itens_origem_check
  check (origem in ('manual', 'lista_colada', 'indicacao_ia', 'montagem_ia', 'kit'));

-- listar_orcamentos: acrescenta o filtro p ->> 'piloto' = '1' (troca exata do texto da função atual).
do $$
declare
  v_def text;
  v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.proname = 'listar_orcamentos';
  v_novo := replace(
    v_def,
    '  if coalesce((p ->> ''incluir_teste'')::boolean, true) = false then',
    E'  if p ->> ''piloto'' = ''1'' then
    v_base := v_base || '' and o.piloto'';
  end if;
  if coalesce((p ->> ''incluir_teste'')::boolean, true) = false then'
  );
  if v_novo = v_def then
    raise exception 'não achei o ponto de troca em listar_orcamentos';
  end if;
  execute v_novo;
end;
$$;

create or replace function resumo_piloto(p_dia date) returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_ini timestamptz := (p_dia::text || ' 00:00:00-03')::timestamptz;
  v_fim timestamptz := ((p_dia + 1)::text || ' 00:00:00-03')::timestamptz;
  v_vend jsonb;
  v_relatos jsonb;
  v_erros jsonb;
  v_custo numeric;
begin
  if auth.uid() is not null and not public.eh_gerente() then
    raise exception 'Só a gerência e o dono veem o resumo do piloto.';
  end if;

  select coalesce(jsonb_agg(x order by x.nome), '[]'::jsonb) into v_vend
  from (
    select u.nome,
           count(o.id) filter (where o.criado_em >= v_ini and o.criado_em < v_fim) as criados,
           count(o.id) filter (where o.gerado_em >= v_ini and o.gerado_em < v_fim) as gerados,
           count(o.id) filter (where o.enviado_em >= v_ini and o.enviado_em < v_fim) as enviados,
           round((percentile_cont(0.5) within group (order by extract(epoch from (o.gerado_em - o.criado_em)) / 60)
                  filter (where o.gerado_em >= v_ini and o.gerado_em < v_fim))::numeric, 1) as mediana_ate_gerar_min,
           jsonb_build_object(
             'manual', coalesce((select sum(1) from orcamento_itens i join orcamentos o2 on o2.id = i.orcamento_id
                 where o2.vendedora_id = u.id and i.origem = 'manual'
                   and not orcamento_eh_teste(o2.respostas, o2.cliente_id, o2.piloto)
                   and ((o2.criado_em >= v_ini and o2.criado_em < v_fim) or (o2.gerado_em >= v_ini and o2.gerado_em < v_fim))), 0),
             'kit', coalesce((select sum(1) from orcamento_itens i join orcamentos o2 on o2.id = i.orcamento_id
                 where o2.vendedora_id = u.id and i.origem = 'kit'
                   and not orcamento_eh_teste(o2.respostas, o2.cliente_id, o2.piloto)
                   and ((o2.criado_em >= v_ini and o2.criado_em < v_fim) or (o2.gerado_em >= v_ini and o2.gerado_em < v_fim))), 0),
             'lista_colada', coalesce((select sum(1) from orcamento_itens i join orcamentos o2 on o2.id = i.orcamento_id
                 where o2.vendedora_id = u.id and i.origem = 'lista_colada'
                   and not orcamento_eh_teste(o2.respostas, o2.cliente_id, o2.piloto)
                   and ((o2.criado_em >= v_ini and o2.criado_em < v_fim) or (o2.gerado_em >= v_ini and o2.gerado_em < v_fim))), 0),
             'indicacao_ia', coalesce((select sum(1) from orcamento_itens i join orcamentos o2 on o2.id = i.orcamento_id
                 where o2.vendedora_id = u.id and i.origem = 'indicacao_ia'
                   and not orcamento_eh_teste(o2.respostas, o2.cliente_id, o2.piloto)
                   and ((o2.criado_em >= v_ini and o2.criado_em < v_fim) or (o2.gerado_em >= v_ini and o2.gerado_em < v_fim))), 0),
             'montagem_ia', coalesce((select sum(1) from orcamento_itens i join orcamentos o2 on o2.id = i.orcamento_id
                 where o2.vendedora_id = u.id and i.origem = 'montagem_ia'
                   and not orcamento_eh_teste(o2.respostas, o2.cliente_id, o2.piloto)
                   and ((o2.criado_em >= v_ini and o2.criado_em < v_fim) or (o2.gerado_em >= v_ini and o2.gerado_em < v_fim))), 0)
           ) as itens
      from usuarios u
      left join orcamentos o
        on o.vendedora_id = u.id
       and not orcamento_eh_teste(o.respostas, o.cliente_id, o.piloto)
     where u.perfil = 'vendedora'
     group by u.id, u.nome
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'criado_em', r.criado_em, 'quem', u.nome, 'tela', r.tela, 'mensagem', r.mensagem
         ) order by r.criado_em), '[]'::jsonb) into v_relatos
    from relatos_piloto r join usuarios u on u.id = r.usuario_id
   where r.status = 'aberto';

  select coalesce(jsonb_agg(jsonb_build_object(
           'criado_em', e.criado_em, 'origem', e.origem, 'rota', e.rota, 'mensagem', e.mensagem
         ) order by e.criado_em), '[]'::jsonb) into v_erros
    from erros_app e
   where e.criado_em >= v_ini and e.criado_em < v_fim;

  select coalesce(sum(custo_estimado), 0) into v_custo
    from uso_ia where criado_em >= v_ini and criado_em < v_fim;

  return jsonb_build_object(
    'dia', p_dia,
    'vendedoras', v_vend,
    'relatos_abertos', v_relatos,
    'erros', v_erros,
    'custo_ia_usd', v_custo
  );
end;
$$;

revoke all on function resumo_piloto(date) from public, anon;
grant execute on function resumo_piloto(date) to authenticated, service_role;
