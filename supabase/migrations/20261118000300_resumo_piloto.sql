-- Dia 13B: resumo do dia do piloto, para a gerência/dono (tela /relatos, aba "Resumo do dia") e para o
-- `pnpm piloto:resumo`. Só leitura. O dia é o de Maceió (UTC-3). Orçamentos de TESTE ficam de fora
-- (o piloto não é teste, ver orcamento_eh_teste). Sem nada de comissão.
--   criados/gerados/enviados: orçamentos cuja data da etapa cai no dia;
--   mediana_ate_gerar_min: minutos do início do rascunho até gerar, dos gerados no dia;
--   itens: dos orçamentos criados OU gerados no dia, por origem (o kit de fita grava como 'manual').
create function resumo_piloto(p_dia date) returns jsonb
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
