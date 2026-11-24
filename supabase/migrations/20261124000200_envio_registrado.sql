-- Dia 16 (parte B): a data de envio fica sempre registrada. Fechar ou perder um orçamento que ainda está
-- "gerado" (sem envio registrado) exige a data do envio (p_data_envio); e o banco nunca deixa um
-- orçamento fechado ou perdido sem enviado_em (rede de segurança para caminhos do servidor).
--
-- Mudou a assinatura (5º argumento com padrão): a função antiga sai para não ficar ambígua.
drop function mudar_status_orcamento(uuid, status_orcamento, numeric, motivo_perda);

create function mudar_status_orcamento(
  p_orcamento uuid,
  p_para status_orcamento,
  p_valor_fechado numeric default null,
  p_motivo motivo_perda default null,
  p_data_envio date default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v orcamentos%rowtype;
  v_valor numeric(12,2);
  v_ok boolean;
  v_hoje date := (now() at time zone 'America/Maceio')::date;
  v_instante timestamptz;
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

  -- Fechar ou perder sem envio registrado: a data do envio é obrigatória (mesmas regras de marcar_enviado).
  if p_para in ('fechado', 'perdido') and v.enviado_em is null then
    if p_data_envio is null then
      raise exception 'ENVIO_OBRIGATORIO' using errcode = 'P0001';
    end if;
    if p_data_envio > v_hoje then
      raise exception 'DATA_FUTURA' using errcode = 'P0001';
    end if;
    if v.gerado_em is not null and p_data_envio < (v.gerado_em at time zone 'America/Maceio')::date then
      raise exception 'DATA_ANTES_DE_GERADO' using errcode = 'P0001';
    end if;
    v_instante := case
      when p_data_envio = v_hoje then now()
      else greatest((p_data_envio::timestamp + time '12:00') at time zone 'America/Maceio', coalesce(v.gerado_em, '-infinity'))
    end;
  end if;

  update orcamentos
     set status = p_para,
         valor_fechado = case when p_para = 'fechado' then v_valor else null end,
         motivo_perda = case when p_para = 'perdido' then p_motivo else null end,
         fechado_em = null,
         perdido_em = null,
         enviado_em = case when p_para = 'gerado' then null else coalesce(v_instante, enviado_em) end,
         ultimo_envio_em = case when p_para = 'gerado' then null else coalesce(v_instante, ultimo_envio_em) end
   where id = p_orcamento;

  return jsonb_build_object('status', p_para, 'valor_fechado', v_valor);
end;
$$;
revoke all on function mudar_status_orcamento(uuid, status_orcamento, numeric, motivo_perda, date) from public, anon;
grant execute on function mudar_status_orcamento(uuid, status_orcamento, numeric, motivo_perda, date)
  to authenticated, service_role;

-- Rede de segurança: por qualquer caminho (inclusive o servidor), fechado ou perdido nunca fica com
-- enviado_em vazio. Pelo app a data real vem de mudar_status_orcamento; aqui só se evita o vazio.
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
      when 'fechado' then
        new.fechado_em = coalesce(new.fechado_em, now());
        new.enviado_em = coalesce(new.enviado_em, new.fechado_em);
        new.ultimo_envio_em = coalesce(new.ultimo_envio_em, new.enviado_em);
      when 'perdido' then
        new.perdido_em = coalesce(new.perdido_em, now());
        new.enviado_em = coalesce(new.enviado_em, new.perdido_em);
        new.ultimo_envio_em = coalesce(new.ultimo_envio_em, new.enviado_em);
      else null;
    end case;
  end if;
  return new;
end;
$$;
