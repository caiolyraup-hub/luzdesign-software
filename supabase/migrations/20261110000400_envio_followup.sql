-- Dia 8B: envio com data, edição bloqueada a partir de "enviado" e follow-up D+5/D+10 configurável.

-- ---------------------------------------------------------------- envio com data
-- enviado_em continua sendo o PRIMEIRO envio (métricas); ultimo_envio_em é o envio mais recente e
-- é dele que contam os follow-ups.
alter table orcamentos add column ultimo_envio_em timestamptz;
update orcamentos set ultimo_envio_em = enviado_em where enviado_em is not null;

-- "Corrigir: não foi enviado" (volta para gerado) limpa as duas datas.
create or replace function mudar_status_orcamento(
  p_orcamento uuid,
  p_para status_orcamento,
  p_valor_fechado numeric default null,
  p_motivo motivo_perda default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v orcamentos%rowtype;
  v_valor numeric(12,2);
  v_ok boolean;
begin
  select * into v from orcamentos where id = p_orcamento for update;
  if not found then
    raise exception 'ORCAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if v.vendedora_id <> (select auth.uid()) and not (select eh_gerente()) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if v.status = p_para then
    raise exception 'MESMO_STATUS' using errcode = 'P0001';
  end if;

  v_ok := case v.status
    when 'gerado' then p_para in ('enviado', 'fechado', 'perdido')
    when 'enviado' then p_para in ('gerado', 'followup_d5', 'followup_d10', 'fechado', 'perdido')
    when 'followup_d5' then p_para in ('enviado', 'followup_d10', 'fechado', 'perdido')
    when 'followup_d10' then p_para in ('enviado', 'followup_d5', 'fechado', 'perdido')
    when 'fechado' then p_para = 'enviado'
    when 'perdido' then p_para = 'enviado'
    else false
  end;
  if not v_ok then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  if p_para = 'perdido' and p_motivo is null then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001';
  end if;
  if p_para = 'fechado' then
    v_valor := coalesce(p_valor_fechado, v.valor_total);
    if v_valor is null or v_valor <= 0 then
      raise exception 'VALOR_INVALIDO' using errcode = 'P0001';
    end if;
  end if;

  update orcamentos
     set status = p_para,
         valor_fechado = case when p_para = 'fechado' then v_valor else null end,
         motivo_perda = case when p_para = 'perdido' then p_motivo else null end,
         fechado_em = null,
         perdido_em = null,
         enviado_em = case when p_para = 'gerado' then null else enviado_em end,
         ultimo_envio_em = case when p_para = 'gerado' then null else ultimo_envio_em end
   where id = p_orcamento;

  return jsonb_build_object('status', p_para, 'valor_fechado', v_valor);
end;
$$;
revoke all on function mudar_status_orcamento(uuid, status_orcamento, numeric, motivo_perda) from public, anon;
grant execute on function mudar_status_orcamento(uuid, status_orcamento, numeric, motivo_perda)
  to authenticated, service_role;

-- Quando o status vira "enviado" por outro caminho (reabrir fechado, por exemplo), o último envio
-- nunca fica vazio.
create or replace function carimbar_status_orcamento() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_em = now();
    case new.status
      when 'gerado' then new.gerado_em = coalesce(new.gerado_em, now());
      when 'enviado' then
        new.enviado_em = coalesce(new.enviado_em, now());
        new.ultimo_envio_em = coalesce(new.ultimo_envio_em, new.enviado_em);
      when 'fechado' then new.fechado_em = coalesce(new.fechado_em, now());
      when 'perdido' then new.perdido_em = coalesce(new.perdido_em, now());
      else null;
    end case;
  end if;
  return new;
end;
$$;

-- Marca como enviado numa data (padrão: hoje; aceita dias anteriores, não futuro nem antes de gerado).
-- O primeiro envio grava enviado_em; os seguintes só mudam ultimo_envio_em. Dona ou gerência.
create function marcar_enviado(p_orcamento uuid, p_data date default null) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v orcamentos%rowtype;
  v_hoje date := (now() at time zone 'America/Maceio')::date;
  v_data date;
  v_instante timestamptz;
begin
  select * into v from orcamentos where id = p_orcamento for update;
  if not found then
    raise exception 'ORCAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if v.vendedora_id <> (select auth.uid()) and not (select eh_gerente()) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if v.status <> 'gerado' then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  v_data := coalesce(p_data, v_hoje);
  if v_data > v_hoje then
    raise exception 'DATA_FUTURA' using errcode = 'P0001';
  end if;
  if v.gerado_em is not null and v_data < (v.gerado_em at time zone 'America/Maceio')::date then
    raise exception 'DATA_ANTES_DE_GERADO' using errcode = 'P0001';
  end if;

  -- Hoje vale o instante atual; um dia anterior vale o meio-dia daquele dia em Maceió.
  v_instante := case
    when v_data = v_hoje then now()
    else greatest((v_data::timestamp + time '12:00') at time zone 'America/Maceio', coalesce(v.gerado_em, '-infinity'))
  end;

  update orcamentos
     set status = 'enviado',
         enviado_em = coalesce(enviado_em, v_instante),
         ultimo_envio_em = v_instante
   where id = p_orcamento;

  return jsonb_build_object('status', 'enviado', 'ultimo_envio_em', v_instante);
end;
$$;
revoke all on function marcar_enviado(uuid, date) from public, anon;
grant execute on function marcar_enviado(uuid, date) to authenticated, service_role;

-- "Editar e enviar nova versão": volta para gerado SEM apagar enviado_em nem ultimo_envio_em; só a dona.
create function reabrir_para_edicao(p_orcamento uuid) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v orcamentos%rowtype;
begin
  select * into v from orcamentos where id = p_orcamento for update;
  if not found or v.vendedora_id <> (select auth.uid()) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if v.status not in ('enviado', 'followup_d5', 'followup_d10') then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;
  update orcamentos set status = 'gerado' where id = p_orcamento;
  return jsonb_build_object('status', 'gerado');
end;
$$;
revoke all on function reabrir_para_edicao(uuid) from public, anon;
grant execute on function reabrir_para_edicao(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- edição bloqueada a partir de enviado
-- Itens e ambientes só mudam em rascunho ou gerado (vale para a dona, a gerência e o service role).
-- Apagar o orçamento inteiro continua possível: o cascade roda quando o orçamento já saiu.
create function bloquear_edicao_itens() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.status_orcamento;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select status into v_status from public.orcamentos where id = new.orcamento_id;
    if found and v_status not in ('rascunho', 'gerado') then
      raise exception 'EDICAO_BLOQUEADA' using errcode = 'P0001';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select status into v_status from public.orcamentos where id = old.orcamento_id;
    if found and v_status not in ('rascunho', 'gerado') then
      raise exception 'EDICAO_BLOQUEADA' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function bloquear_edicao_itens() from public, anon, authenticated;

create trigger orcamento_itens_bloquear_edicao before insert or update or delete on orcamento_itens
  for each row execute function bloquear_edicao_itens();
create trigger orcamento_ambientes_bloquear_edicao before insert or update or delete on orcamento_ambientes
  for each row execute function bloquear_edicao_itens();

-- ---------------------------------------------------------------- follow-up configurável
alter table configuracoes_loja
  add column followup_d5_dias integer not null default 5 check (followup_d5_dias between 1 and 60),
  add column followup_d10_dias integer not null default 10 check (followup_d10_dias between 1 and 90),
  add column mensagem_d5 text not null default
    'Olá, {cliente}! Aqui é {vendedora}, da Luz Design. Passando para saber se você conseguiu ver o orçamento nº {numero}. Posso ajudar com alguma dúvida?',
  add column mensagem_d10 text not null default
    'Olá, {cliente}! Tudo bem? Aqui é {vendedora}, da Luz Design. Voltando ao orçamento nº {numero}: se quiser, posso ajustar alguma coisa para fecharmos. Fico à disposição!',
  add constraint followup_d10_depois_do_d5 check (followup_d10_dias > followup_d5_dias);
