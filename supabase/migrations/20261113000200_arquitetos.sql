-- Dia 11B: cadastro compartilhado de arquitetos (com foto e aniversário opcionais).
--
-- Todo usuário logado lê os arquitetos ativos e cria um novo; editar, desativar e juntar duplicados é
-- da gerência. NENHUMA coluna de comissão fica nesta tabela (as comissões do dia 11D vivem em tabelas
-- que só o dono lê). A foto fica em bucket privado, entregue por URL assinada de curta duração gerada
-- no servidor; não há política de storage para o cliente.

create table arquitetos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 2 and 120),
  escritorio text check (escritorio is null or char_length(escritorio) <= 120),
  whatsapp text,
  email text check (email is null or char_length(email) <= 160),
  aniversario_dia smallint check (aniversario_dia between 1 and 31),
  aniversario_mes smallint check (aniversario_mes between 1 and 12),
  aniversario_ano smallint check (aniversario_ano is null or aniversario_ano between 1900 and 2100),
  foto_path text,
  observacoes text check (observacoes is null or char_length(observacoes) <= 1000),
  ativo boolean not null default true,
  criado_por uuid references usuarios (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- dia e mês andam juntos; o ano é sempre opcional
  constraint arquitetos_aniversario_junto check (
    (aniversario_dia is null) = (aniversario_mes is null)
    and (aniversario_ano is null or aniversario_dia is not null)
  ),
  -- dia possível no mês (29/02 vale; 31/04 não)
  constraint arquitetos_aniversario_valido check (
    aniversario_dia is null
    or aniversario_dia <= (array[31,29,31,30,31,30,31,31,30,31,30,31])[aniversario_mes]
  )
);
create index arquitetos_nome_trgm on arquitetos using gin (nome extensions.gin_trgm_ops);
create index arquitetos_escritorio_trgm on arquitetos using gin (escritorio extensions.gin_trgm_ops);
create index arquitetos_aniversario on arquitetos (aniversario_mes, aniversario_dia) where ativo;
create trigger arquitetos_atualizado_em before update on arquitetos
  for each row execute function definir_atualizado_em();

revoke all on arquitetos from anon;
alter table arquitetos enable row level security;
create policy arquitetos_ler on arquitetos for select to authenticated
  using (ativo or (select eh_gerente()));
create policy arquitetos_criar on arquitetos for insert to authenticated
  with check (criado_por = (select auth.uid()));
create policy arquitetos_editar on arquitetos for update to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));
create policy arquitetos_apagar on arquitetos for delete to authenticated
  using ((select eh_gerente()));

-- Auditoria de fusões e desativações.
create table eventos_arquiteto (
  id bigint generated always as identity primary key,
  arquiteto_id uuid,
  tipo text not null,
  detalhes jsonb not null default '{}'::jsonb,
  usuario_id uuid references usuarios (id),
  criado_em timestamptz not null default now()
);
revoke all on eventos_arquiteto from anon;
alter table eventos_arquiteto enable row level security;
create policy eventos_arquiteto_ler on eventos_arquiteto for select to authenticated
  using ((select eh_gerente()));

-- Bucket privado das fotos (sem política para o cliente: só o servidor assina URLs).
insert into storage.buckets (id, name, public, file_size_limit)
values ('arquitetos', 'arquitetos', false, 2097152)
on conflict (id) do nothing;

-- Ligações com o cadastro; o texto digitado antes fica só para conferência.
alter table clientes
  add column arquiteto_id uuid references arquitetos (id) on delete set null,
  add column arquiteto_texto_legado text;
alter table orcamentos
  add column arquiteto_id uuid references arquitetos (id) on delete set null;
create index clientes_arquiteto on clientes (arquiteto_id);
create index orcamentos_arquiteto on orcamentos (arquiteto_id);

-- O texto simples do cliente continua existindo para telas e exportações: o nome do cadastro é
-- copiado para clientes.arquiteto_indicador sempre que arquiteto_id muda.
create function sincronizar_nome_arquiteto_cliente() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.arquiteto_id is not null
     and (tg_op = 'INSERT' or new.arquiteto_id is distinct from old.arquiteto_id) then
    select a.nome into new.arquiteto_indicador from arquitetos a where a.id = new.arquiteto_id;
  end if;
  return new;
end;
$$;
create trigger clientes_nome_arquiteto before insert or update of arquiteto_id on clientes
  for each row execute function sincronizar_nome_arquiteto_cliente();

-- Quando a gerência renomeia o arquiteto, os clientes ligados acompanham.
create function propagar_nome_arquiteto() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nome is distinct from old.nome then
    update clientes set arquiteto_indicador = new.nome where arquiteto_id = new.id;
  end if;
  return new;
end;
$$;
create trigger arquitetos_propagar_nome after update of nome on arquitetos
  for each row execute function propagar_nome_arquiteto();

-- Mensagem de aniversário editável pela gerente (Ajustes).
alter table configuracoes_loja
  add column mensagem_aniversario text not null default
    'Oi, {arquiteto}! Aqui é {vendedora}, da Luz Design. Passando para desejar um feliz aniversário, com muita saúde, projetos incríveis e boa luz em tudo!';

-- ---------------------------------------------------------------- normalização para a migração
create function normalizar_nome_arquiteto(p text) returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '\s+', ' ', 'g'));
$$;

-- Cria um cadastro por nome normalizado e liga clientes e orçamentos. O nome exibido é o primeiro
-- digitado (o mais antigo) com os espaços limpos.
do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select normalizar_nome_arquiteto(arquiteto_indicador) as chave,
           (array_agg(btrim(regexp_replace(arquiteto_indicador, '\s+', ' ', 'g')) order by criado_em))[1] as nome
      from clientes
     where arquiteto_indicador is not null and btrim(arquiteto_indicador) <> ''
     group by 1
  loop
    if char_length(r.nome) < 2 then continue; end if;
    insert into arquitetos (nome) values (r.nome) returning id into v_id;
    update clientes
       set arquiteto_texto_legado = arquiteto_indicador,
           arquiteto_id = v_id
     where normalizar_nome_arquiteto(arquiteto_indicador) = r.chave;
  end loop;
  update orcamentos o set arquiteto_id = c.arquiteto_id
    from clientes c
   where c.id = o.cliente_id and c.arquiteto_id is not null;
end;
$$;

-- ---------------------------------------------------------------- listagem com números
-- security invoker: os números de orçamentos respeitam a RLS (vendedora vê só os dela).
create function listar_arquitetos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_q text := nullif(btrim(coalesce(p ->> 'q', '')), '');
  v_like text;
  v_inativos boolean := coalesce((p ->> 'inativos')::boolean, false);
begin
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by lower(t.nome), t.id)
      from (
        select a.id, a.nome, a.escritorio, a.whatsapp, a.email, a.aniversario_dia, a.aniversario_mes,
               a.aniversario_ano, a.foto_path, a.ativo,
               count(o.id) filter (where o.status <> 'rascunho') as indicados,
               count(o.id) filter (where o.status = 'fechado') as fechados,
               coalesce(sum(coalesce(o.valor_fechado, o.valor_total)) filter (where o.status = 'fechado'), 0) as vendido
          from arquitetos a
          left join orcamentos o on o.arquiteto_id = a.id and not orcamento_eh_teste(o.respostas, o.cliente_id)
         where (a.ativo or v_inativos)
           and (v_q is null or a.nome ilike v_like or a.escritorio ilike v_like)
         group by a.id
      ) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- juntar duplicados
-- Só a gerência. security definer porque move orçamentos e clientes de todas as vendedoras.
create function juntar_arquitetos(p_manter uuid, p_remover uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manter arquitetos;
  v_remover arquitetos;
  v_clientes integer;
  v_orcamentos integer;
begin
  if not (select eh_gerente()) then
    raise exception 'Só a gerência junta arquitetos.' using errcode = '42501';
  end if;
  if p_manter = p_remover then
    raise exception 'Escolha dois arquitetos diferentes.';
  end if;
  select * into v_manter from arquitetos where id = p_manter for update;
  select * into v_remover from arquitetos where id = p_remover for update;
  if v_manter.id is null or v_remover.id is null then
    raise exception 'Arquiteto não encontrado.';
  end if;

  update orcamentos set arquiteto_id = p_manter where arquiteto_id = p_remover;
  get diagnostics v_orcamentos = row_count;
  update clientes set arquiteto_id = p_manter where arquiteto_id = p_remover;
  get diagnostics v_clientes = row_count;

  -- O que faltava no cadastro mantido vem do removido.
  update arquitetos set
    escritorio = coalesce(escritorio, v_remover.escritorio),
    whatsapp = coalesce(whatsapp, v_remover.whatsapp),
    email = coalesce(email, v_remover.email),
    aniversario_dia = coalesce(aniversario_dia, v_remover.aniversario_dia),
    aniversario_mes = coalesce(aniversario_mes, v_remover.aniversario_mes),
    aniversario_ano = coalesce(aniversario_ano, v_remover.aniversario_ano),
    observacoes = coalesce(observacoes, v_remover.observacoes)
  where id = p_manter;

  delete from arquitetos where id = p_remover;
  insert into eventos_arquiteto (arquiteto_id, tipo, detalhes, usuario_id)
  values (p_manter, 'juntou', jsonb_build_object(
    'removido_id', p_remover, 'removido_nome', v_remover.nome, 'removido_foto', v_remover.foto_path,
    'orcamentos', v_orcamentos, 'clientes', v_clientes), (select auth.uid()));

  return jsonb_build_object('orcamentos', v_orcamentos, 'clientes', v_clientes,
                            'foto_removida', v_remover.foto_path);
end;
$$;
revoke all on function juntar_arquitetos(uuid, uuid) from public, anon;
grant execute on function juntar_arquitetos(uuid, uuid) to authenticated;
