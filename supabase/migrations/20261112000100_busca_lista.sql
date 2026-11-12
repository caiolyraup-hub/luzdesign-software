-- Dia 10A: busca e filtros na lista de orçamentos (e a regra de vencimento, que a parte B usa).
--
-- Tudo security invoker: a RLS de orcamentos, clientes, itens e usuarios vale. A vendedora nunca recebe
-- orçamento de outra, mesmo com o mesmo nome de cliente.

-- ---------------------------------------------------------------- hoje em Maceió e vencimento (UMA regra)
create function hoje_maceio() returns date
language sql
stable
as $$ select (now() at time zone 'America/Maceio')::date $$;

-- Dias até a validade vencer: 0 = vence hoje, 1 = amanhã, negativo = vencido há N dias.
-- Só orçamentos gerados e enviados (gerado, enviado e follow-ups) vencem; rascunho, fechado e perdido
-- nunca (nulo), e sem validade também não. A mesma regra está em src/lib/orcamento/validade.ts.
create function orcamento_dias_para_vencer(
  p_status status_orcamento,
  p_validade date,
  p_hoje date default hoje_maceio()
) returns integer
language sql
stable
as $$
  select case
    when p_validade is not null and p_status in ('gerado', 'enviado', 'followup_d5', 'followup_d10')
      then p_validade - p_hoje
  end
$$;

-- ---------------------------------------------------------------- índices da busca
create index orcamentos_numero_trgm on orcamentos using gin (numero extensions.gin_trgm_ops);
create index orcamentos_vendedora_atualizado on orcamentos (vendedora_id, atualizado_em desc, id desc);
create index orcamentos_vendedora_validade on orcamentos (vendedora_id, validade) where validade is not null;
create index clientes_nome_trgm on clientes using gin (nome extensions.gin_trgm_ops);
create index clientes_arquiteto_trgm on clientes using gin (arquiteto_indicador extensions.gin_trgm_ops);
-- Só os dígitos do WhatsApp (coluna gerada), para achar por pedaço do número com ou sem máscara.
alter table clientes add column whatsapp_digitos text
  generated always as (regexp_replace(whatsapp, '\D', '', 'g')) stored;
create index clientes_whatsapp_digitos_trgm on clientes using gin (whatsapp_digitos extensions.gin_trgm_ops);
create index orcamento_itens_codigo on orcamento_itens (codigo) where codigo is not null;
create index orcamento_itens_descricao_trgm on orcamento_itens using gin (descricao_congelada extensions.gin_trgm_ops);

-- ---------------------------------------------------------------- listar_orcamentos
-- Entrada (jsonb, tudo opcional): q, status[], campo (criado|gerado|enviado|fechado|perdido) com de/ate
-- (AAAA-MM-DD, Maceió), valor_min, valor_max, tipo, arquiteto ('1'), motivo, validade
-- (vigente|vence_2d|vencida), vendedora (uuid), incluir_teste (boolean, padrão true), ordem
-- (recentes|valor|validade|cliente), cursor ('chave|id'), limite (1 a 100, padrão 20).
-- Saída: total do filtro, contagem por status (sem o filtro de status, para os chips), a página e o
-- cursor da próxima (paginação por cursor, não por offset).
create function listar_orcamentos(p jsonb) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_limite integer := least(greatest(coalesce((p ->> 'limite')::integer, 20), 1), 100);
  v_ordem text := coalesce(p ->> 'ordem', 'recentes');
  v_chave text;
  v_dir text;
  v_tipo_chave text;
  v_hoje date := hoje_maceio();
  v_q text := nullif(btrim(coalesce(p ->> 'q', '')), '');
  v_like text;
  v_digitos text;
  v_campo text := p ->> 'campo';
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_cursor text := nullif(p ->> 'cursor', '');
  v_cursor_k text;
  v_cursor_id uuid;
  v_status text[];
  v_base text;
  v_filtros text;
  v_keyset text := '';
  v_from text := 'from orcamentos o join clientes c on c.id = o.cliente_id left join usuarios u on u.id = o.vendedora_id';
  v_rows jsonb;
  v_total bigint;
  v_por_status jsonb;
  v_proximo text;
begin
  case v_ordem
    when 'valor' then v_chave := 'o.valor_total'; v_dir := 'desc'; v_tipo_chave := 'numeric';
    when 'validade' then v_chave := 'coalesce(o.validade, date ''9999-12-31'')'; v_dir := 'asc'; v_tipo_chave := 'date';
    when 'cliente' then v_chave := 'lower(c.nome)'; v_dir := 'asc'; v_tipo_chave := 'text';
    else v_chave := 'o.atualizado_em'; v_dir := 'desc'; v_tipo_chave := 'timestamptz';
  end case;

  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digitos := regexp_replace(v_q, '\D', '', 'g');
    v_digitos := case when length(v_digitos) >= 3 then '%' || v_digitos || '%' end;
  end if;

  if v_campo is not null and v_campo not in ('criado', 'gerado', 'enviado', 'fechado', 'perdido') then
    v_campo := null;
  end if;
  v_t0 := case when nullif(p ->> 'de', '') is not null
    then (p ->> 'de')::date::timestamp at time zone 'America/Maceio' else '-infinity'::timestamptz end;
  v_t1 := case when nullif(p ->> 'ate', '') is not null
    then ((p ->> 'ate')::date + 1)::timestamp at time zone 'America/Maceio' else 'infinity'::timestamptz end;

  if p ? 'status' and jsonb_typeof(p -> 'status') = 'array' then
    select array_agg(x) into v_status from jsonb_array_elements_text(p -> 'status') x;
  end if;

  v_base := 'true';
  if v_q is not null then
    v_base := v_base || $f$ and (
         o.numero ilike $3
      or c.nome ilike $3
      or c.arquiteto_indicador ilike $3
      or ($5 is not null and c.whatsapp_digitos like $5)
      or exists (select 1 from orcamento_itens i
                  where i.orcamento_id = o.id and (i.codigo = $4 or i.descricao_congelada ilike $3)))$f$;
  end if;
  if v_campo is not null then
    v_base := v_base || format(' and o.%I >= $8 and o.%I < $9', v_campo || '_em', v_campo || '_em');
  end if;
  if nullif(p ->> 'valor_min', '') is not null then
    v_base := v_base || ' and o.valor_total >= ($1 ->> ''valor_min'')::numeric';
  end if;
  if nullif(p ->> 'valor_max', '') is not null then
    v_base := v_base || ' and o.valor_total <= ($1 ->> ''valor_max'')::numeric';
  end if;
  if nullif(p ->> 'tipo', '') is not null then
    v_base := v_base || ' and c.tipo::text = ($1 ->> ''tipo'')';
  end if;
  if p ->> 'arquiteto' = '1' then
    v_base := v_base || ' and coalesce(btrim(c.arquiteto_indicador), '''') <> ''''';
  end if;
  if nullif(p ->> 'motivo', '') is not null then
    v_base := v_base || ' and o.motivo_perda::text = ($1 ->> ''motivo'')';
  end if;
  v_base := v_base || case p ->> 'validade'
    when 'vigente' then ' and orcamento_dias_para_vencer(o.status, o.validade, $2) >= 0'
    when 'vence_2d' then ' and orcamento_dias_para_vencer(o.status, o.validade, $2) between 0 and 2'
    when 'vencida' then ' and orcamento_dias_para_vencer(o.status, o.validade, $2) < 0'
    else '' end;
  if nullif(p ->> 'vendedora', '') is not null then
    v_base := v_base || ' and o.vendedora_id = ($1 ->> ''vendedora'')::uuid';
  end if;
  if coalesce((p ->> 'incluir_teste')::boolean, true) = false then
    v_base := v_base || ' and not orcamento_eh_teste(o.respostas, o.cliente_id)';
  end if;

  v_filtros := v_base;
  if v_status is not null then
    v_filtros := v_filtros || ' and o.status::text = any ($10)';
  end if;

  if v_cursor is not null and position('|' in v_cursor) > 0 then
    v_cursor_id := right(v_cursor, 36)::uuid;
    v_cursor_k := left(v_cursor, length(v_cursor) - 37);
    v_keyset := format(' and ((%s), o.id) %s ($6::%s, $7)', v_chave, case v_dir when 'desc' then '<' else '>' end, v_tipo_chave);
  end if;

  -- Contagem por status (sem o filtro de status) e total (com ele).
  execute 'select coalesce(jsonb_object_agg(s, n), ''{}''::jsonb) from (select o.status::text s, count(*) n '
    || v_from || ' where ' || v_base || ' group by 1) t'
    into v_por_status using p, v_hoje, v_like, v_q, v_digitos, v_cursor_k, v_cursor_id, v_t0, v_t1, v_status;
  execute 'select count(*) ' || v_from || ' where ' || v_filtros
    into v_total using p, v_hoje, v_like, v_q, v_digitos, v_cursor_k, v_cursor_id, v_t0, v_t1, v_status;

  execute format($q$
    select coalesce(jsonb_agg(to_jsonb(t) order by t.rn), '[]'::jsonb) from (
      select row_number() over (order by %1$s %2$s, o.id %2$s) rn,
             o.id, o.numero, o.status, o.valor_total, o.valor_fechado, o.motivo_perda,
             o.atualizado_em, o.criado_em, o.gerado_em, o.enviado_em, o.fechado_em, o.perdido_em,
             o.ultimo_envio_em, o.validade, o.pdf_versao, o.vendedora_id, u.nome as vendedora_nome,
             c.id as cliente_id, c.nome as cliente_nome, c.whatsapp as cliente_whatsapp,
             c.tipo as cliente_tipo, c.arquiteto_indicador,
             (%1$s)::text as k
        %3$s
       where %4$s %5$s
       order by %1$s %2$s, o.id %2$s
       limit %6$s) t
  $q$, v_chave, v_dir, v_from, v_filtros, v_keyset, v_limite + 1)
    into v_rows using p, v_hoje, v_like, v_q, v_digitos, v_cursor_k, v_cursor_id, v_t0, v_t1, v_status;

  if jsonb_array_length(v_rows) > v_limite then
    v_proximo := (v_rows -> (v_limite - 1)) ->> 'k' || '|' || ((v_rows -> (v_limite - 1)) ->> 'id');
    v_rows := v_rows - v_limite;
  end if;

  return jsonb_build_object(
    'total', v_total,
    'por_status', v_por_status,
    'itens', v_rows,
    'proximo', v_proximo);
end;
$$;

revoke all on function listar_orcamentos(jsonb) from public, anon;
grant execute on function listar_orcamentos(jsonb) to authenticated, service_role;
revoke all on function hoje_maceio() from public, anon;
grant execute on function hoje_maceio() to authenticated, service_role;
revoke all on function orcamento_dias_para_vencer(status_orcamento, date, date) from public, anon;
grant execute on function orcamento_dias_para_vencer(status_orcamento, date, date) to authenticated, service_role;
