-- Dia 10D: lista de clientes, ficha, observações e fusão de duplicados.
--
-- A RLS de clientes e orcamentos vale em tudo: a vendedora só enxerga os próprios clientes; a gerência
-- vê todos. As observações do cliente nunca vão à OpenAI (nada no código da IA lê esta coluna).

alter table clientes
  add column observacoes text check (observacoes is null or char_length(observacoes) <= 1000);

-- ---------------------------------------------------------------- lista de clientes
-- Entrada (jsonb, tudo opcional): q (nome, WhatsApp em dígitos ou arquiteto), vendedora (uuid), limite
-- (1 a 100, padrão 30), cursor ('nome em minúsculas|id'). Saída: total do filtro, a página (com
-- quantidade de orçamentos, fechados, valor vendido e data do último) e o cursor da próxima.
create function listar_clientes(p jsonb) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_limite integer := least(greatest(coalesce((p ->> 'limite')::integer, 30), 1), 100);
  v_q text := nullif(btrim(coalesce(p ->> 'q', '')), '');
  v_like text;
  v_digitos text;
  v_cursor text := nullif(p ->> 'cursor', '');
  v_cursor_k text;
  v_cursor_id uuid;
  v_vendedora uuid := nullif(p ->> 'vendedora', '')::uuid;
  v_rows jsonb;
  v_total bigint;
  v_proximo text;
begin
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digitos := regexp_replace(v_q, '\D', '', 'g');
    v_digitos := case when length(v_digitos) >= 3 then '%' || v_digitos || '%' end;
  end if;
  if v_cursor is not null and position('|' in v_cursor) > 0 then
    v_cursor_id := right(v_cursor, 36)::uuid;
    v_cursor_k := left(v_cursor, length(v_cursor) - 37);
  end if;

  select count(*) into v_total
    from clientes c
   where (v_vendedora is null or c.vendedora_id = v_vendedora)
     and (v_q is null or c.nome ilike v_like or c.arquiteto_indicador ilike v_like
          or (v_digitos is not null and c.whatsapp_digitos like v_digitos));

  select coalesce(jsonb_agg(to_jsonb(t) order by t.rn), '[]'::jsonb)
    into v_rows
    from (
      select row_number() over (order by lower(c.nome), c.id) as rn,
             c.id, c.nome, c.whatsapp, c.tipo, c.arquiteto_indicador, c.vendedora_id,
             u.nome as vendedora_nome,
             coalesce(s.orcamentos, 0) as orcamentos,
             coalesce(s.fechados, 0) as fechados,
             coalesce(s.vendido, 0) as vendido,
             s.ultimo_em,
             lower(c.nome) as k
        from clientes c
        left join usuarios u on u.id = c.vendedora_id
        left join lateral (
          select count(*) as orcamentos,
                 count(*) filter (where o.status = 'fechado') as fechados,
                 coalesce(sum(coalesce(o.valor_fechado, o.valor_total)) filter (where o.status = 'fechado'), 0) as vendido,
                 max(o.criado_em) as ultimo_em
            from orcamentos o where o.cliente_id = c.id
        ) s on true
       where (v_vendedora is null or c.vendedora_id = v_vendedora)
         and (v_q is null or c.nome ilike v_like or c.arquiteto_indicador ilike v_like
              or (v_digitos is not null and c.whatsapp_digitos like v_digitos))
         and (v_cursor_id is null or (lower(c.nome), c.id) > (v_cursor_k, v_cursor_id))
       order by lower(c.nome), c.id
       limit v_limite + 1
    ) t;

  if jsonb_array_length(v_rows) > v_limite then
    v_proximo := (v_rows -> (v_limite - 1)) ->> 'k' || '|' || ((v_rows -> (v_limite - 1)) ->> 'id');
    v_rows := v_rows - v_limite;
  end if;
  return jsonb_build_object('total', v_total, 'itens', v_rows, 'proximo', v_proximo);
end;
$$;

revoke all on function listar_clientes(jsonb) from public, anon;
grant execute on function listar_clientes(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- possíveis duplicados (só a gerência)
-- Dois clientes da MESMA vendedora com o mesmo WhatsApp (só dígitos) ou com nome muito parecido.
create function possiveis_duplicados() returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
begin
  if not (select eh_gerente()) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.similaridade desc, x.a_nome)
      from (
        select a.id as a_id, a.nome as a_nome, a.whatsapp as a_whatsapp,
               b.id as b_id, b.nome as b_nome, b.whatsapp as b_whatsapp,
               u.nome as vendedora_nome, a.vendedora_id,
               case when coalesce(a.whatsapp_digitos, '') <> '' and a.whatsapp_digitos = b.whatsapp_digitos
                    then 'whatsapp' else 'nome' end as motivo,
               round(similarity(lower(a.nome), lower(b.nome))::numeric, 2) as similaridade,
               (select count(*) from orcamentos o where o.cliente_id = a.id) as a_orcamentos,
               (select count(*) from orcamentos o where o.cliente_id = b.id) as b_orcamentos
          from clientes a
          join clientes b on b.vendedora_id = a.vendedora_id and a.id < b.id
          left join usuarios u on u.id = a.vendedora_id
         where (coalesce(a.whatsapp_digitos, '') <> '' and a.whatsapp_digitos = b.whatsapp_digitos)
            or (a.nome % b.nome and similarity(lower(a.nome), lower(b.nome)) >= 0.6)
         limit 50
      ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function possiveis_duplicados() from public, anon;
grant execute on function possiveis_duplicados() to authenticated, service_role;

-- ---------------------------------------------------------------- fusão de clientes (registro)
create table clientes_fusoes (
  id bigint generated always as identity primary key,
  mantido_id uuid references clientes (id) on delete set null,
  removido jsonb not null,
  orcamentos_movidos integer not null default 0,
  por uuid references usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);
revoke all on clientes_fusoes from anon;
alter table clientes_fusoes enable row level security;
create policy clientes_fusoes_ler on clientes_fusoes for select to authenticated
  using ((select eh_gerente()));
-- Sem política de escrita: só a função juntar_clientes (security definer) grava.

-- Junta dois clientes da mesma vendedora: move os orçamentos do "removido" para o "mantido", junta as
-- observações, completa o que faltar no mantido, guarda o registro e apaga o removido. Só a gerência.
create function juntar_clientes(p_manter uuid, p_remover uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manter clientes%rowtype;
  v_remover clientes%rowtype;
  v_movidos integer;
  v_obs text;
begin
  if not (select eh_gerente()) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if p_manter = p_remover then
    raise exception 'MESMO_CLIENTE' using errcode = 'P0001';
  end if;
  select * into v_manter from clientes where id = p_manter for update;
  select * into v_remover from clientes where id = p_remover for update;
  if v_manter.id is null or v_remover.id is null then
    raise exception 'CLIENTE_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if v_manter.vendedora_id <> v_remover.vendedora_id then
    raise exception 'VENDEDORAS_DIFERENTES' using errcode = 'P0001';
  end if;

  update orcamentos set cliente_id = p_manter where cliente_id = p_remover;
  get diagnostics v_movidos = row_count;

  v_obs := nullif(btrim(concat_ws(E'\n', v_manter.observacoes, v_remover.observacoes)), '');

  insert into clientes_fusoes (mantido_id, removido, orcamentos_movidos, por)
    values (p_manter, to_jsonb(v_remover), v_movidos, (select auth.uid()));
  delete from clientes where id = p_remover;

  -- O WhatsApp só é copiado depois de apagar o outro (o par vendedora + WhatsApp é único).
  update clientes
     set observacoes = left(v_obs, 1000),
         whatsapp = coalesce(whatsapp, v_remover.whatsapp),
         arquiteto_indicador = coalesce(arquiteto_indicador, v_remover.arquiteto_indicador)
   where id = p_manter;

  return jsonb_build_object('movidos', v_movidos);
end;
$$;

revoke all on function juntar_clientes(uuid, uuid) from public, anon;
grant execute on function juntar_clientes(uuid, uuid) to authenticated, service_role;
