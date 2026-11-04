-- Conector de estoque v1 (dia 3): código com 1 a 5 dígitos, mapeamentos salvos e busca.

-- Os orçamentos reais usam códigos de 4 e 5 dígitos (ex.: 9520, 12389). Sem zeros à esquerda.
alter table produtos drop constraint produtos_codigo_check;
alter table produtos add constraint produtos_codigo_check check (codigo ~ '^[0-9]{1,5}$');

-- Mapeamentos de colunas da planilha: só a gerente lê e escreve.
create table estoque_mapeamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  colunas jsonb not null,
  criado_em timestamptz not null default now()
);
create index estoque_mapeamentos_criado_em on estoque_mapeamentos (criado_em desc);

revoke all on estoque_mapeamentos from anon;
alter table estoque_mapeamentos enable row level security;
create policy estoque_mapeamentos_gerente on estoque_mapeamentos for all to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));

-- Busca de produtos ativos por código, descrição, marca, categoria e apelidos.
-- security invoker: a RLS de quem chama vale normalmente (produtos é legível a qualquer logada).
-- Parâmetros com prefixo p_ para não colidir com nomes de colunas.
create function buscar_produtos(
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
      p.*,
      lower(
        p.codigo || ' ' || p.descricao || ' ' || coalesce(p.marca, '') || ' ' || coalesce(p.categoria, '')
        || ' ' || coalesce((select string_agg(a.texto, ' ') from produto_apelidos a where a.codigo = p.codigo), '')
      ) as palheiro,
      coalesce((
        select max(word_similarity((select texto from entrada), a.texto))
        from produto_apelidos a where a.codigo = p.codigo
      ), 0) as sim_apelido
    from produtos p
    where p.ativo
      and (p_categoria is null or p.categoria = p_categoria)
      and (p_marca is null or p.marca = p_marca)
  )
  select
    b.codigo, b.categoria, b.marca, b.descricao, b.unidade, b.preco_unitario,
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
     -- todas as palavras digitadas aparecem em algum campo
     or not exists (
       select 1 from unnest((select tokens from entrada)) t
       where strpos(b.palheiro, t) = 0
     )
     -- ou é parecido o bastante (tolera erro de digitação)
     or word_similarity((select texto from entrada), lower(b.descricao)) >= 0.5
     or b.sim_apelido >= 0.5
  order by similaridade desc, length(b.codigo), b.codigo
  limit least(greatest(coalesce(p_limite, 20), 1), 100);
$$;

revoke all on function buscar_produtos(text, text, text, integer) from public, anon;
grant execute on function buscar_produtos(text, text, text, integer) to authenticated, service_role;
