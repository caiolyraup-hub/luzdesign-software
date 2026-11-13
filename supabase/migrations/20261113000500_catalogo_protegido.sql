-- Dia 11C: catálogo protegido. Fabricante, referência e modelo saem de `produtos` (que todos leem)
-- e vão para `produtos_dados_fornecedor`, que SÓ a gerência lê, no banco.
--
-- Por que não criptografia: o servidor precisa mostrar esses dados à gerência, então a chave estaria
-- sempre à mão, e a busca pararia de funcionar. A proteção é separar e controlar quem lê (RLS) e nunca
-- imprimir esses dados nos documentos do cliente.

create table produtos_dados_fornecedor (
  codigo text primary key references produtos (codigo) on delete cascade,
  fabricante text,
  referencia_fabricante text,
  -- cada referência (separadas por " / ") normalizada: maiúsculas, sem espaço, hífen, barra ou ponto
  referencias_normalizadas text[] not null default '{}',
  modelo text,
  descricao_fornecedor text,
  atributos_fornecedor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
create index produtos_fornecedor_refs on produtos_dados_fornecedor using gin (referencias_normalizadas);
create index produtos_fornecedor_fabricante on produtos_dados_fornecedor (fabricante);

create function normalizar_referencia(p text) returns text
language sql immutable set search_path = ''
as $$ select upper(regexp_replace(coalesce(p, ''), '[\s\-/.]+', '', 'g')); $$;

create function fornecedor_normalizar() returns trigger
language plpgsql set search_path = public
as $$
begin
  new.referencias_normalizadas := coalesce((
    select array_agg(distinct normalizar_referencia(x))
      from unnest(string_to_array(coalesce(new.referencia_fabricante, ''), ' / ')) x
     where char_length(normalizar_referencia(x)) >= 3
  ), '{}');
  new.atualizado_em := now();
  return new;
end;
$$;
create trigger produtos_fornecedor_normalizar before insert or update on produtos_dados_fornecedor
  for each row execute function fornecedor_normalizar();

revoke all on produtos_dados_fornecedor from anon;
alter table produtos_dados_fornecedor enable row level security;
-- Só a gerência (e o dono, quando existir, pois eh_gerente() passará a incluí-lo) lê e escreve.
create policy produtos_fornecedor_gerencia on produtos_dados_fornecedor for all to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));

-- Copia o que existe (o script `pnpm catalogo:proteger` extrai referência e modelo e limpa a descrição).
insert into produtos_dados_fornecedor (codigo, fabricante, descricao_fornecedor, atributos_fornecedor)
select p.codigo, p.marca, p.descricao,
       coalesce((
         select jsonb_build_object('apelidos_originais', jsonb_agg(a.texto))
           from produto_apelidos a where a.codigo = p.codigo
       ), '{}'::jsonb)
  from produtos p;

-- ---------------------------------------------------------------- busca
-- Mesma assinatura. Para a vendedora o fabricante/referência/modelo não existem (a RLS da tabela
-- do fornecedor devolve nada); a gerência busca também por eles.
create or replace function buscar_produtos(
  p_texto text default '',
  p_categoria text default null,
  p_marca text default null,
  p_limite integer default 20
)
returns table (
  codigo text,
  categoria text,
  marca text,
  descricao text,
  unidade unidade,
  preco_unitario numeric,
  estoque_disponivel numeric,
  atributos jsonb,
  similaridade real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with entrada as (
    select
      lower(btrim(coalesce(p_texto, ''))) as texto,
      array_remove(string_to_array(lower(btrim(coalesce(p_texto, ''))), ' '), '') as tokens
  ),
  base as (
    select
      p.codigo, p.categoria, p.descricao, p.unidade, p.preco_unitario, p.estoque_disponivel,
      p.atributos,
      d.fabricante,
      lower(
        p.codigo || ' ' || p.descricao || ' ' || coalesce(p.categoria, '')
        || ' ' || coalesce(d.fabricante, '') || ' ' || coalesce(d.referencia_fabricante, '')
        || ' ' || coalesce(d.modelo, '')
        || ' ' || coalesce((select string_agg(a.texto, ' ') from produto_apelidos a where a.codigo = p.codigo), '')
      ) as palheiro,
      coalesce((
        select max(word_similarity((select texto from entrada), a.texto))
        from produto_apelidos a where a.codigo = p.codigo
      ), 0) as sim_apelido
    from produtos p
    left join produtos_dados_fornecedor d on d.codigo = p.codigo
    where p.ativo
      and (p_categoria is null or p.categoria = p_categoria)
      -- filtro por fabricante: só quem pode ler o cadastro do fornecedor
      and (p_marca is null or not (select eh_gerente()) or d.fabricante = p_marca)
  )
  select
    b.codigo, b.categoria, b.fabricante as marca, b.descricao, b.unidade, b.preco_unitario,
    b.estoque_disponivel, b.atributos,
    case
      when (select texto from entrada) = '' then 0::real
      when b.codigo = (select texto from entrada) then 1::real
      else greatest(
        word_similarity((select texto from entrada), lower(b.descricao)),
        b.sim_apelido
      )::real
    end as similaridade
  from base b
  where (select texto from entrada) = ''
     or b.codigo = (select texto from entrada)
     or not exists (
       select 1 from unnest((select tokens from entrada)) t
       where strpos(b.palheiro, t) = 0
     )
     or word_similarity((select texto from entrada), lower(b.descricao)) >= 0.5
     or b.sim_apelido >= 0.5
  order by similaridade desc, length(b.codigo), b.codigo
  limit least(greatest(coalesce(p_limite, 20), 1), 100);
$$;

-- ---------------------------------------------------------------- referência do arquiteto
-- A vendedora digita a referência INTEIRA e recebe só o código interno e a descrição comercial.
-- Igualdade exata (sem busca parcial), sem devolver a referência, 30 consultas por minuto por usuário.
create table consultas_referencia (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  criado_em timestamptz not null default now()
);
create index consultas_referencia_usuario on consultas_referencia (usuario_id, criado_em desc);
revoke all on consultas_referencia from anon, authenticated;
alter table consultas_referencia enable row level security;

create function buscar_por_referencia(p_texto text)
returns table (codigo text, descricao text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_norm text := normalizar_referencia(p_texto);
begin
  if v_usuario is null then
    raise exception 'Sem sessão.' using errcode = '42501';
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
revoke all on function buscar_por_referencia(text) from public, anon;
grant execute on function buscar_por_referencia(text) to authenticated;

-- ---------------------------------------------------------------- fim: a vendedora não lê mais a marca
alter table produtos drop column marca;
