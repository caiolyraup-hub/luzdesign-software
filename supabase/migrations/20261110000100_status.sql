-- Mudança de status do orçamento (acompanhamento e follow-up), pela dona ou pela gerência.
--
-- Fluxo: gerado -> enviado -> follow-up D+5 -> follow-up D+10 -> fechado | perdido.
-- Dá para fechar ou perder de qualquer etapa depois de gerado, voltar uma etapa para corrigir um
-- engano e reabrir um fechado/perdido (volta para enviado). Rascunho só sai de rascunho gerando o PDF.
-- security invoker: a RLS vale (dona e gerência podem atualizar; outra vendedora não).
-- Cada mudança vira uma linha em eventos pelo gatilho existente (com quem mudou, via auth.uid()).

create function mudar_status_orcamento(
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

  -- As datas de etapa são limpas aqui e o gatilho carimba de novo a que for alcançada agora.
  update orcamentos
     set status = p_para,
         valor_fechado = case when p_para = 'fechado' then v_valor else null end,
         motivo_perda = case when p_para = 'perdido' then p_motivo else null end,
         fechado_em = null,
         perdido_em = null,
         enviado_em = case when p_para = 'gerado' then null else enviado_em end
   where id = p_orcamento;

  return jsonb_build_object('status', p_para, 'valor_fechado', v_valor);
end;
$$;
revoke all on function mudar_status_orcamento(uuid, status_orcamento, numeric, motivo_perda) from public, anon;
grant execute on function mudar_status_orcamento(uuid, status_orcamento, numeric, motivo_perda)
  to authenticated, service_role;

-- Quando o status entrou na etapa de follow-up (para saber quando o próximo vence).
alter table orcamentos add column status_em timestamptz;
update orcamentos set status_em = atualizado_em where status_em is null;

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
      when 'enviado' then new.enviado_em = coalesce(new.enviado_em, now());
      when 'fechado' then new.fechado_em = coalesce(new.fechado_em, now());
      when 'perdido' then new.perdido_em = coalesce(new.perdido_em, now());
      else null;
    end case;
  end if;
  return new;
end;
$$;
