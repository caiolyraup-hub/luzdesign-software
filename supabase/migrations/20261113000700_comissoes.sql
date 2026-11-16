-- Dia 11D (2/2): comissões de arquitetos e vendedoras, visíveis SÓ para o dono.
--
-- Perfis: vendedora, gerente e dono. `eh_gerente()` passa a valer para gerente OU dono, então todas as
-- políticas existentes (que testam eh_gerente) aceitam o dono sem mudança. `eh_gerencia()` é o mesmo
-- nome, mais claro, para código novo. `eh_dono()` é só o dono: comissões, percentuais e ajustes.

create or replace function eh_gerente() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u
     where u.id = (select auth.uid()) and u.perfil in ('gerente', 'dono')
  );
$$;

create function eh_gerencia() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.eh_gerente(); $$;

create function eh_dono() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u where u.id = (select auth.uid()) and u.perfil = 'dono'
  );
$$;
revoke all on function eh_gerencia() from public, anon;
revoke all on function eh_dono() from public, anon;
grant execute on function eh_gerencia() to authenticated, service_role;
grant execute on function eh_dono() to authenticated, service_role;

-- ---------------------------------------------------------------- configuração (tudo começa vazio)
create table configuracoes_comissao (
  id boolean primary key default true check (id),
  -- Só `valor_fechado` existe hoje: a loja não marca frete e serviços como itens à parte.
  base text not null default 'valor_fechado' check (base in ('valor_fechado')),
  percentual_arquiteto_padrao numeric(5,2) check (percentual_arquiteto_padrao between 0 and 30),
  percentual_vendedora_padrao numeric(5,2) check (percentual_vendedora_padrao between 0 and 30),
  -- nulo = usa o padrão da vendedora
  percentual_vendedora_com_arquiteto numeric(5,2) check (percentual_vendedora_com_arquiteto between 0 and 30),
  atualizado_em timestamptz not null default now()
);
insert into configuracoes_comissao (id) values (true);
create trigger configuracoes_comissao_atualizado_em before update on configuracoes_comissao
  for each row execute function definir_atualizado_em();

create table comissoes_arquiteto_percentual (
  arquiteto_id uuid primary key references arquitetos (id) on delete cascade,
  percentual numeric(5,2) not null check (percentual between 0 and 30),
  vigente_desde date not null default current_date
);
create table comissoes_vendedora_percentual (
  vendedora_id uuid primary key references usuarios (id) on delete cascade,
  percentual numeric(5,2) not null check (percentual between 0 and 30),
  vigente_desde date not null default current_date
);

-- ---------------------------------------------------------------- lançamentos
create table comissoes (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references orcamentos (id) on delete cascade,
  tipo text not null check (tipo in ('arquiteto', 'vendedora')),
  beneficiario_id uuid not null,
  base numeric(12,2) not null,
  -- percentual CONGELADO no momento do cálculo
  percentual numeric(5,2) not null,
  valor numeric(12,2) not null,
  competencia date not null,
  status text not null default 'a_pagar' check (status in ('a_pagar', 'paga', 'cancelada')),
  paga_em date,
  observacao text check (observacao is null or char_length(observacao) <= 500),
  -- orçamento reaberto depois do pagamento: o dono precisa revisar
  revisar boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (orcamento_id, tipo)
);
create index comissoes_competencia on comissoes (competencia, status);
create index comissoes_beneficiario on comissoes (tipo, beneficiario_id);
create trigger comissoes_atualizado_em before update on comissoes
  for each row execute function definir_atualizado_em();

-- RLS: SÓ o dono (nem a gerente) lê e escreve. Quem grava ao fechar é o gatilho (security definer).
do $$
declare t text;
begin
  foreach t in array array['configuracoes_comissao', 'comissoes_arquiteto_percentual',
                           'comissoes_vendedora_percentual', 'comissoes']
  loop
    execute format('revoke all on %I from anon', t);
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated using ((select eh_dono())) with check ((select eh_dono()))',
      t || '_dono', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- cálculo
-- Linhas que o orçamento geraria HOJE, com os percentuais de hoje. Nada é gravado aqui.
-- Percentual vazio (não definido) = não calcula aquela linha.
create function comissao_linhas(p_orcamento uuid)
returns table (tipo text, beneficiario_id uuid, base numeric, percentual numeric, valor numeric, competencia date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o orcamentos%rowtype;
  c configuracoes_comissao%rowtype;
  v_base numeric(12,2);
  v_comp date;
  v_pct numeric(5,2);
begin
  select * into o from orcamentos where id = p_orcamento;
  if not found or o.status <> 'fechado' or o.valor_fechado is null then
    return;
  end if;
  if orcamento_eh_teste(o.respostas, o.cliente_id) then
    return;
  end if;
  select * into c from configuracoes_comissao where id;
  v_base := o.valor_fechado;
  v_comp := date_trunc('month', coalesce(o.fechado_em, now()) at time zone 'America/Maceio')::date;

  if o.arquiteto_id is not null then
    select coalesce(
             (select p.percentual from comissoes_arquiteto_percentual p where p.arquiteto_id = o.arquiteto_id),
             c.percentual_arquiteto_padrao)
      into v_pct;
    if v_pct is not null then
      tipo := 'arquiteto'; beneficiario_id := o.arquiteto_id; base := v_base; percentual := v_pct;
      valor := round(v_base * v_pct / 100, 2); competencia := v_comp;
      return next;
    end if;
  end if;

  select case when o.arquiteto_id is not null and c.percentual_vendedora_com_arquiteto is not null
              then c.percentual_vendedora_com_arquiteto
              else coalesce(
                     (select p.percentual from comissoes_vendedora_percentual p where p.vendedora_id = o.vendedora_id),
                     c.percentual_vendedora_padrao)
         end
    into v_pct;
  if v_pct is not null then
    tipo := 'vendedora'; beneficiario_id := o.vendedora_id; base := v_base; percentual := v_pct;
    valor := round(v_base * v_pct / 100, 2); competencia := v_comp;
    return next;
  end if;
end;
$$;
revoke all on function comissao_linhas(uuid) from public, anon, authenticated;

-- Grava as linhas de um orçamento recém-fechado. Reaberto e fechado de novo: reaproveita a linha
-- cancelada; linha já paga não é tocada (o dono revisa).
create function comissao_gravar(p_orcamento uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  insert into comissoes (orcamento_id, tipo, beneficiario_id, base, percentual, valor, competencia)
  select p_orcamento, l.tipo, l.beneficiario_id, l.base, l.percentual, l.valor, l.competencia
    from comissao_linhas(p_orcamento) l
  on conflict (orcamento_id, tipo) do update
     set beneficiario_id = excluded.beneficiario_id, base = excluded.base,
         percentual = excluded.percentual, valor = excluded.valor,
         competencia = excluded.competencia, status = 'a_pagar', revisar = false
   where comissoes.status = 'cancelada';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function comissao_gravar(uuid) from public, anon, authenticated;

create function orcamentos_comissao_gatilho() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'fechado' and old.status is distinct from 'fechado' then
    perform comissao_gravar(new.id);
  elsif old.status = 'fechado' and new.status <> 'fechado' then
    -- Fechamento reaberto: as a pagar são canceladas; as pagas ficam e pedem revisão do dono.
    update comissoes set status = 'cancelada', atualizado_em = now()
     where orcamento_id = new.id and status = 'a_pagar';
    update comissoes set revisar = true, observacao = coalesce(observacao || E'\n', '') || 'Orçamento reaberto depois do pagamento.'
     where orcamento_id = new.id and status = 'paga' and not revisar;
  end if;
  return null;
end;
$$;
create trigger orcamentos_comissao after update of status on orcamentos
  for each row execute function orcamentos_comissao_gatilho();

-- Recalcular uma comissão a pagar com o percentual de hoje (só o dono, pela própria RLS da tabela).
create function recalcular_comissao(p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r comissoes%rowtype;
  l record;
begin
  if not (select eh_dono()) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  select * into r from comissoes where id = p_id for update;
  if not found then raise exception 'NAO_ENCONTRADA' using errcode = 'P0001'; end if;
  if r.status <> 'a_pagar' then raise exception 'SO_A_PAGAR' using errcode = 'P0001'; end if;
  select * into l from comissao_linhas(r.orcamento_id) x where x.tipo = r.tipo;
  if l.tipo is null then raise exception 'SEM_PERCENTUAL' using errcode = 'P0001'; end if;
  update comissoes set base = l.base, percentual = l.percentual, valor = l.valor,
         beneficiario_id = l.beneficiario_id where id = p_id;
  return jsonb_build_object('valor', l.valor, 'percentual', l.percentual);
end;
$$;
revoke all on function recalcular_comissao(uuid) from public, anon;
grant execute on function recalcular_comissao(uuid) to authenticated;

-- Fechamentos anteriores (sem teste) que ainda não têm linha. Prévia (p_gravar = false) ou grava.
create function calcular_fechamentos_anteriores(p_gravar boolean default false) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_itens jsonb := '[]'::jsonb;
  l record;
  v_n integer := 0;
begin
  if not (select eh_dono()) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  for o in
    select id, numero from orcamentos
     where status = 'fechado'
       and not exists (select 1 from comissoes c where c.orcamento_id = orcamentos.id)
     order by fechado_em
  loop
    for l in select * from comissao_linhas(o.id) loop
      v_itens := v_itens || jsonb_build_object('orcamento', o.numero, 'tipo', l.tipo,
                   'percentual', l.percentual, 'valor', l.valor, 'competencia', l.competencia);
      v_n := v_n + 1;
    end loop;
    if p_gravar then perform comissao_gravar(o.id); end if;
  end loop;
  return jsonb_build_object('gravado', p_gravar, 'linhas', v_n, 'itens', v_itens);
end;
$$;
revoke all on function calcular_fechamentos_anteriores(boolean) from public, anon;
grant execute on function calcular_fechamentos_anteriores(boolean) to authenticated;
