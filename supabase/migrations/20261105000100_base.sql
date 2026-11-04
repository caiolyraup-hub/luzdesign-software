-- Luz Design Orçamentos: esquema base (dia 2)
-- Valores dos enums idênticos aos de src/lib/dominio.ts

create extension if not exists pg_trgm with schema extensions;

-- Enums ---------------------------------------------------------------------
create type perfil as enum ('vendedora', 'gerente');
create type status_orcamento as enum (
  'rascunho', 'gerado', 'enviado', 'followup_d5', 'followup_d10', 'fechado', 'perdido'
);
create type motivo_perda as enum (
  'preco', 'prazo_pronta_entrega', 'comprou_em_outra_loja', 'desistiu', 'sem_resposta'
);
create type tipo_cliente as enum ('final', 'arquiteto', 'eletricista', 'construtora', 'empresa');
create type unidade as enum ('un', 'm');

-- Gatilho genérico de atualizado_em ---------------------------------------------
create function definir_atualizado_em() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

-- usuarios --------------------------------------------------------------------
create table usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text not null unique,
  perfil perfil not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create trigger usuarios_atualizado_em before update on usuarios
  for each row execute function definir_atualizado_em();

-- Perfil do usuário logado. security definer evita recursão de RLS em usuarios.
create function eh_gerente() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u where u.id = (select auth.uid()) and u.perfil = 'gerente'
  );
$$;
revoke all on function eh_gerente() from public, anon;
grant execute on function eh_gerente() to authenticated, service_role;

-- produtos --------------------------------------------------------------------
create table produtos (
  codigo text primary key check (codigo ~ '^[0-9]{5}$'),
  categoria text,
  marca text,
  descricao text not null,
  unidade unidade not null default 'un',
  preco_unitario numeric(12,2) not null check (preco_unitario >= 0),
  estoque_disponivel numeric(10,2),
  atributos jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create trigger produtos_atualizado_em before update on produtos
  for each row execute function definir_atualizado_em();
create index produtos_descricao_trgm on produtos using gin (descricao extensions.gin_trgm_ops);

create table produto_apelidos (
  id bigint generated always as identity primary key,
  codigo text not null references produtos (codigo) on delete cascade,
  texto text not null,
  unique (codigo, texto)
);
create index produto_apelidos_texto_trgm on produto_apelidos using gin (texto extensions.gin_trgm_ops);
create index produto_apelidos_codigo on produto_apelidos (codigo);

create table sync_estoque (
  id uuid primary key default gen_random_uuid(),
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  origem text not null,
  linhas_lidas integer not null default 0,
  linhas_gravadas integer not null default 0,
  erros jsonb not null default '[]'::jsonb
);

-- clientes --------------------------------------------------------------------
create table clientes (
  id uuid primary key default gen_random_uuid(),
  vendedora_id uuid not null references usuarios (id),
  nome text not null,
  whatsapp text,
  tipo tipo_cliente not null default 'final',
  arquiteto_indicador text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index clientes_vendedora on clientes (vendedora_id);
create trigger clientes_atualizado_em before update on clientes
  for each row execute function definir_atualizado_em();

-- orcamentos ------------------------------------------------------------------
-- Numeração sequencial por ano, legível: 2026-0001
create table orcamento_contador (
  ano integer primary key,
  ultimo integer not null default 0
);
alter table orcamento_contador enable row level security;

create function atribuir_numero_orcamento() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ano integer := extract(year from (now() at time zone 'America/Maceio'))::integer;
  v_ultimo integer;
begin
  if new.numero is null then
    insert into public.orcamento_contador as c (ano, ultimo) values (v_ano, 1)
    on conflict (ano) do update set ultimo = c.ultimo + 1
    returning c.ultimo into v_ultimo;
    new.numero = v_ano::text || '-' || lpad(v_ultimo::text, 4, '0');
  end if;
  return new;
end;
$$;

create table orcamentos (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  vendedora_id uuid not null references usuarios (id),
  cliente_id uuid not null references clientes (id),
  respostas jsonb not null default '{}'::jsonb,
  status status_orcamento not null default 'rascunho',
  valor_total numeric(12,2) not null default 0 check (valor_total >= 0),
  valor_fechado numeric(12,2) check (valor_fechado >= 0),
  validade date,
  gerado_em timestamptz,
  enviado_em timestamptz,
  fechado_em timestamptz,
  perdido_em timestamptz,
  motivo_perda motivo_perda,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint motivo_perda_obrigatorio check (status <> 'perdido' or motivo_perda is not null)
);
create index orcamentos_vendedora_status on orcamentos (vendedora_id, status);
create index orcamentos_cliente on orcamentos (cliente_id);

-- numero é not null, mas o gatilho (before insert) preenche antes da checagem.
create trigger orcamentos_numero before insert on orcamentos
  for each row execute function atribuir_numero_orcamento();

-- Atualiza atualizado_em e carimba a data de cada etapa na primeira vez que ela é alcançada.
create function carimbar_status_orcamento() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    case new.status
      when 'gerado' then new.gerado_em = coalesce(new.gerado_em, now());
      when 'enviado' then new.enviado_em = coalesce(new.enviado_em, now());
      when 'fechado' then new.fechado_em = coalesce(new.fechado_em, now());
      when 'perdido' then new.perdido_em = coalesce(new.perdido_em, now());
      else null;
    end case;
  end if;
  return new;
end;
$$;
create trigger orcamentos_carimbo before insert or update on orcamentos
  for each row execute function carimbar_status_orcamento();

create table orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references orcamentos (id) on delete cascade,
  codigo text references produtos (codigo),
  descricao_congelada text not null,
  preco_unitario_congelado numeric(12,2) not null check (preco_unitario_congelado >= 0),
  quantidade numeric(10,2) not null check (quantidade > 0),
  ambiente text,
  avulso boolean not null default false,
  constraint codigo_ou_avulso check (avulso or codigo is not null)
);
create index orcamento_itens_orcamento on orcamento_itens (orcamento_id);

create table anexos (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references orcamentos (id) on delete cascade,
  caminho_storage text not null,
  tipo text,
  criado_em timestamptz not null default now()
);
create index anexos_orcamento on anexos (orcamento_id);

create table eventos (
  id bigint generated always as identity primary key,
  orcamento_id uuid not null references orcamentos (id) on delete cascade,
  usuario_id uuid references usuarios (id) on delete set null,
  de_status status_orcamento,
  para_status status_orcamento not null,
  criado_em timestamptz not null default now()
);
create index eventos_orcamento on eventos (orcamento_id, criado_em);

-- Toda mudança de status vira um evento (security definer: ninguém grava eventos direto).
create function registrar_evento_status() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.eventos (orcamento_id, usuario_id, de_status, para_status)
    values (new.id, (select auth.uid()), null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.eventos (orcamento_id, usuario_id, de_status, para_status)
    values (new.id, (select auth.uid()), old.status, new.status);
  end if;
  return null;
end;
$$;
create trigger orcamentos_evento_status after insert or update of status on orcamentos
  for each row execute function registrar_evento_status();

create table uso_ia (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid references orcamentos (id) on delete set null,
  tokens_entrada integer not null default 0,
  tokens_saida integer not null default 0,
  custo_estimado numeric(12,4) not null default 0,
  duracao_ms integer,
  criado_em timestamptz not null default now()
);
create index uso_ia_orcamento on uso_ia (orcamento_id);
