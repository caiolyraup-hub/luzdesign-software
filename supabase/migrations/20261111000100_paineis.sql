-- Dia 9A: painéis da vendedora e da gerência. Definições em docs/metricas.md.
--
-- Tudo aqui é security invoker: a RLS de orcamentos, itens, indicações e uso_ia vale. A vendedora
-- recebe só os próprios números (mesmo passando o id de outra); a gerente recebe todos.

-- ---------------------------------------------------------------- câmbio (estimativa do custo de IA)
alter table configuracoes_loja
  add column cambio_usd_brl numeric(8,4) not null default 5.5 check (cambio_usd_brl > 0 and cambio_usd_brl < 100);

-- ---------------------------------------------------------------- o que é "teste" (um lugar só)
create function orcamento_eh_teste(p_respostas jsonb, p_cliente uuid) returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(p_respostas ->> 'teste', '') = 'true'
      or coalesce(p_respostas ->> 'teste_rls', '') = 'true'
      or exists (
        select 1 from clientes c
         where c.id = p_cliente and c.nome ~* '^teste([^[:alpha:]]|$)'
      )
$$;

-- Orçamentos que entram nos números. security_invoker: a view lê como quem consulta (RLS vale).
create view orcamentos_reais with (security_invoker = true) as
  select o.* from orcamentos o where not orcamento_eh_teste(o.respostas, o.cliente_id);

revoke all on orcamentos_reais from anon;
revoke all on function orcamento_eh_teste(jsonb, uuid) from public, anon;
grant execute on function orcamento_eh_teste(jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- índices por data de etapa
create index orcamentos_criado on orcamentos (vendedora_id, criado_em);
create index orcamentos_gerado on orcamentos (vendedora_id, gerado_em) where gerado_em is not null;
create index orcamentos_enviado on orcamentos (vendedora_id, enviado_em) where enviado_em is not null;
create index orcamentos_fechado on orcamentos (vendedora_id, fechado_em) where fechado_em is not null;
create index orcamentos_perdido on orcamentos (vendedora_id, perdido_em) where perdido_em is not null;
create index indicacoes_ia_vendedora_data on indicacoes_ia (vendedora_id, criado_em);
create index uso_ia_criado on uso_ia (criado_em);

-- ---------------------------------------------------------------- métricas do período
create function metricas_orcamentos(p_inicio date, p_fim date, p_vendedora uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  t0 timestamptz;
  t1 timestamptz;
  v_res jsonb;
begin
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'PERIODO_INVALIDO' using errcode = 'P0001';
  end if;
  -- Início e fim inclusivos, em dias de Maceió.
  t0 := p_inicio::timestamp at time zone 'America/Maceio';
  t1 := (p_fim + 1)::timestamp at time zone 'America/Maceio';

  with base as (
    select o.*
      from orcamentos_reais o
     where (p_vendedora is null or o.vendedora_id = p_vendedora)
       and (   (o.criado_em  >= t0 and o.criado_em  < t1)
            or (o.gerado_em  >= t0 and o.gerado_em  < t1)
            or (o.enviado_em >= t0 and o.enviado_em < t1)
            or (o.fechado_em >= t0 and o.fechado_em < t1)
            or (o.perdido_em >= t0 and o.perdido_em < t1)
            or o.status in ('enviado', 'followup_d5', 'followup_d10'))
  ),
  num as (
    select vendedora_id,
      count(*) filter (where criado_em >= t0 and criado_em < t1) as criados,
      count(*) filter (where gerado_em >= t0 and gerado_em < t1) as gerados,
      count(*) filter (where enviado_em >= t0 and enviado_em < t1) as enviados,
      count(*) filter (where status = 'fechado' and fechado_em >= t0 and fechado_em < t1) as fechados,
      coalesce(sum(coalesce(valor_fechado, valor_total))
        filter (where status = 'fechado' and fechado_em >= t0 and fechado_em < t1), 0) as valor_vendido,
      count(*) filter (where status = 'perdido' and perdido_em >= t0 and perdido_em < t1) as perdidos,
      coalesce(sum(valor_total)
        filter (where status = 'perdido' and perdido_em >= t0 and perdido_em < t1), 0) as valor_perdido,
      -- safra: enviados no período, pelo status de hoje
      count(*) filter (where status = 'fechado' and enviado_em >= t0 and enviado_em < t1) as safra_fechados,
      count(*) filter (where status = 'perdido' and enviado_em >= t0 and enviado_em < t1) as safra_perdidos,
      count(*) filter (where status not in ('fechado', 'perdido') and enviado_em >= t0 and enviado_em < t1) as safra_andamento,
      coalesce(sum(coalesce(valor_fechado, valor_total))
        filter (where status = 'fechado' and enviado_em >= t0 and enviado_em < t1), 0) as safra_valor_fechado,
      coalesce(sum(valor_total)
        filter (where status in ('fechado', 'perdido') and enviado_em >= t0 and enviado_em < t1), 0) as safra_valor_resolvidos,
      count(*) filter (where status in ('enviado', 'followup_d5', 'followup_d10')) as aberto_qtd,
      coalesce(sum(valor_total) filter (where status in ('enviado', 'followup_d5', 'followup_d10')), 0) as aberto_valor,
      percentile_cont(0.5) within group (
        order by ((fechado_em at time zone 'America/Maceio')::date - (enviado_em at time zone 'America/Maceio')::date)
      ) filter (
        where status = 'fechado' and enviado_em is not null and fechado_em >= t0 and fechado_em < t1
      ) as mediana_dias
    from base
    group by grouping sets ((vendedora_id), ())
  ),
  mot as (
    select vendedora_id,
           jsonb_agg(jsonb_build_object('motivo', motivo_perda, 'quantidade', qtd, 'valor', valor)
                     order by qtd desc, valor desc) as perdas
      from (
        select vendedora_id, motivo_perda, count(*) as qtd, sum(valor_total) as valor
          from base
         where status = 'perdido' and perdido_em >= t0 and perdido_em < t1
         group by grouping sets ((vendedora_id, motivo_perda), (motivo_perda))
      ) m
     group by vendedora_id
  ),
  ind as (
    select i.vendedora_id, count(*) as pedidas
      from indicacoes_ia i
      join orcamentos_reais o on o.id = i.orcamento_id
     where i.criado_em >= t0 and i.criado_em < t1
       and (p_vendedora is null or i.vendedora_id = p_vendedora)
     group by grouping sets ((i.vendedora_id), ())
  ),
  itn as (
    select o.vendedora_id,
           count(*) as total,
           count(*) filter (where it.origem = 'indicacao_ia') as indicacao_ia,
           count(*) filter (where it.origem = 'lista_colada') as lista_colada
      from base o
      join orcamento_itens it on it.orcamento_id = o.id
     where o.gerado_em >= t0 and o.gerado_em < t1
     group by grouping sets ((o.vendedora_id), ())
  ),
  chaves as (
    select u.id as vendedora_id, u.nome
      from usuarios u
     where u.perfil = 'vendedora' and (p_vendedora is null or u.id = p_vendedora)
    union all
    select null::uuid, 'Total'
  ),
  linhas as (
    select c.vendedora_id, c.nome,
      jsonb_build_object(
        'vendedora_id', c.vendedora_id,
        'nome', c.nome,
        'criados', coalesce(n.criados, 0),
        'gerados', coalesce(n.gerados, 0),
        'enviados', coalesce(n.enviados, 0),
        'fechados', coalesce(n.fechados, 0),
        'valor_vendido', coalesce(n.valor_vendido, 0),
        'perdidos', coalesce(n.perdidos, 0),
        'valor_perdido', coalesce(n.valor_perdido, 0),
        'perdas', coalesce(m.perdas, '[]'::jsonb),
        'safra', jsonb_build_object(
          'enviados', coalesce(n.enviados, 0),
          'fechados', coalesce(n.safra_fechados, 0),
          'perdidos', coalesce(n.safra_perdidos, 0),
          'em_andamento', coalesce(n.safra_andamento, 0),
          'valor_fechado', coalesce(n.safra_valor_fechado, 0),
          'valor_resolvidos', coalesce(n.safra_valor_resolvidos, 0)),
        'conversao_qtd', case when coalesce(n.safra_fechados, 0) + coalesce(n.safra_perdidos, 0) > 0
          then round(n.safra_fechados::numeric / (n.safra_fechados + n.safra_perdidos), 4) end,
        'conversao_valor', case when coalesce(n.safra_valor_resolvidos, 0) > 0
          then round(n.safra_valor_fechado / n.safra_valor_resolvidos, 4) end,
        'em_aberto_qtd', coalesce(n.aberto_qtd, 0),
        'em_aberto_valor', coalesce(n.aberto_valor, 0),
        'ticket_medio', case when coalesce(n.fechados, 0) > 0 then round(n.valor_vendido / n.fechados, 2) end,
        'mediana_dias', n.mediana_dias,
        'indicacoes_pedidas', coalesce(i.pedidas, 0),
        'itens_total', coalesce(t.total, 0),
        'itens_indicacao_ia', coalesce(t.indicacao_ia, 0),
        'itens_lista_colada', coalesce(t.lista_colada, 0)
      ) as j
    from chaves c
    left join num n on n.vendedora_id is not distinct from c.vendedora_id
    left join mot m on m.vendedora_id is not distinct from c.vendedora_id
    left join ind i on i.vendedora_id is not distinct from c.vendedora_id
    left join itn t on t.vendedora_id is not distinct from c.vendedora_id
  )
  select jsonb_build_object(
           'inicio', p_inicio,
           'fim', p_fim,
           'vendedoras', coalesce((select jsonb_agg(j order by nome) from linhas where vendedora_id is not null), '[]'::jsonb),
           'total', (select j from linhas where vendedora_id is null))
    into v_res;
  return v_res;
end;
$$;

revoke all on function metricas_orcamentos(date, date, uuid) from public, anon;
grant execute on function metricas_orcamentos(date, date, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- série semanal (13 semanas)
-- Semanas de segunda a domingo (Maceió), terminando na semana de p_fim. Uma linha por vendedora e semana.
create function serie_semanal_orcamentos(p_fim date, p_vendedora uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  s0 date := date_trunc('week', p_fim::timestamp)::date - 12 * 7;
  t0 timestamptz;
  t1 timestamptz;
  v_res jsonb;
begin
  if p_fim is null then
    raise exception 'PERIODO_INVALIDO' using errcode = 'P0001';
  end if;
  t0 := s0::timestamp at time zone 'America/Maceio';
  t1 := (s0 + 13 * 7)::timestamp at time zone 'America/Maceio';

  with sem as (
    select generate_series(s0, s0 + 12 * 7, interval '7 days')::date as semana
  ),
  v as (
    select u.id, u.nome from usuarios u
     where u.perfil = 'vendedora' and (p_vendedora is null or u.id = p_vendedora)
  ),
  env as (
    select vendedora_id, date_trunc('week', enviado_em at time zone 'America/Maceio')::date as semana, count(*) as qtd
      from orcamentos_reais
     where enviado_em >= t0 and enviado_em < t1 and (p_vendedora is null or vendedora_id = p_vendedora)
     group by 1, 2
  ),
  fec as (
    select vendedora_id, date_trunc('week', fechado_em at time zone 'America/Maceio')::date as semana,
           count(*) as qtd, sum(coalesce(valor_fechado, valor_total)) as valor
      from orcamentos_reais
     where status = 'fechado' and fechado_em >= t0 and fechado_em < t1
       and (p_vendedora is null or vendedora_id = p_vendedora)
     group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'semana', s.semana,
           'vendedora_id', v.id,
           'nome', v.nome,
           'enviados', coalesce(e.qtd, 0),
           'fechados', coalesce(f.qtd, 0),
           'valor_vendido', coalesce(f.valor, 0)) order by s.semana, v.nome), '[]'::jsonb)
    into v_res
    from sem s
    cross join v
    left join env e on e.vendedora_id = v.id and e.semana = s.semana
    left join fec f on f.vendedora_id = v.id and f.semana = s.semana;
  return v_res;
end;
$$;

revoke all on function serie_semanal_orcamentos(date, uuid) from public, anon;
grant execute on function serie_semanal_orcamentos(date, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- custo de IA (só a gerente)
-- Além da trava explícita, a RLS de uso_ia já esconde as linhas de quem não é gerente.
create function custo_ia_orcamentos(p_inicio date, p_fim date) returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  t0 timestamptz;
  t1 timestamptz;
  v_res jsonb;
begin
  if not (select eh_gerente()) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'PERIODO_INVALIDO' using errcode = 'P0001';
  end if;
  t0 := p_inicio::timestamp at time zone 'America/Maceio';
  t1 := (p_fim + 1)::timestamp at time zone 'America/Maceio';

  with uso as (
    select u.tipo, u.custo_estimado
      from uso_ia u
      left join orcamentos o on o.id = u.orcamento_id
     where u.status = 'ok' and u.criado_em >= t0 and u.criado_em < t1
       and (u.orcamento_id is null or o.id is null or not orcamento_eh_teste(o.respostas, o.cliente_id))
  ),
  por_tipo as (
    select tipo, count(*) as chamadas, sum(custo_estimado) as usd from uso group by tipo
  )
  select jsonb_build_object(
           'usd_total', coalesce((select sum(usd) from por_tipo), 0),
           'chamadas', coalesce((select sum(chamadas) from por_tipo), 0),
           'por_tipo', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'chamadas', chamadas, 'usd', usd) order by usd desc) from por_tipo), '[]'::jsonb),
           'gerados', (select count(*) from orcamentos_reais where gerado_em >= t0 and gerado_em < t1))
    into v_res;
  return v_res;
end;
$$;

revoke all on function custo_ia_orcamentos(date, date) from public, anon;
grant execute on function custo_ia_orcamentos(date, date) to authenticated, service_role;
