-- Correção do dia 6: só a DONA do orçamento gera o PDF e recalcula o total.
-- A gerente pode reatribuir orçamentos (política de update), então a RLS sozinha não impedia que
-- ela rodasse gerar_orcamento no orçamento de uma vendedora. Agora a função confere o dono.

create or replace function recalcular_total_orcamento(p_orcamento uuid) returns numeric
language sql
security invoker
set search_path = public
as $$
  update orcamentos o
     set valor_total = coalesce((
           select sum(round(i.preco_unitario_congelado * i.quantidade, 2))
             from orcamento_itens i where i.orcamento_id = o.id
         ), 0)
   where o.id = p_orcamento
     and o.vendedora_id = (select auth.uid())
     and o.status in ('rascunho', 'gerado')
  returning o.valor_total;
$$;

create or replace function gerar_orcamento(
  p_orcamento uuid,
  p_pdf_caminho text,
  p_versao integer,
  p_total_esperado numeric,
  p_validade date
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_orc orcamentos%rowtype;
  v_total numeric(12,2);
begin
  select * into v_orc from orcamentos where id = p_orcamento for update;
  if not found
     or v_orc.vendedora_id <> (select auth.uid())
     or v_orc.status not in ('rascunho', 'gerado') then
    raise exception 'ORCAMENTO_NAO_EDITAVEL' using errcode = 'P0001';
  end if;
  if v_orc.pdf_versao + 1 <> p_versao then
    raise exception 'VERSAO_DIVERGENTE' using errcode = 'P0001';
  end if;
  if p_pdf_caminho not like v_orc.vendedora_id::text || '/' || p_orcamento::text || '/%' then
    raise exception 'CAMINHO_INVALIDO' using errcode = 'P0001';
  end if;
  if not exists (select 1 from orcamento_itens where orcamento_id = p_orcamento) then
    raise exception 'SEM_ITENS' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from orcamento_itens
     where orcamento_id = p_orcamento and avulso and preco_unitario_congelado <= 0
  ) then
    raise exception 'AVULSO_SEM_PRECO' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from orcamento_itens i join produtos p on p.codigo = i.codigo
     where i.orcamento_id = p_orcamento and not i.avulso and not p.ativo
  ) then
    raise exception 'PRODUTO_INATIVO' using errcode = 'P0001';
  end if;

  update orcamento_itens i
     set descricao_congelada = p.descricao,
         preco_unitario_congelado = p.preco_unitario
    from produtos p
   where i.orcamento_id = p_orcamento and i.codigo = p.codigo and not i.avulso;

  select coalesce(sum(round(preco_unitario_congelado * quantidade, 2)), 0)
    into v_total from orcamento_itens where orcamento_id = p_orcamento;
  if v_total <> p_total_esperado then
    raise exception 'TOTAL_DIVERGENTE' using errcode = 'P0001';
  end if;

  update orcamentos
     set valor_total = v_total,
         status = 'gerado',
         gerado_em = now(),
         validade = p_validade,
         pdf_caminho = p_pdf_caminho,
         pdf_versao = p_versao,
         pdf_versoes = pdf_versoes || jsonb_build_object(
           'versao', p_versao, 'caminho', p_pdf_caminho, 'gerado_em', now(), 'valor_total', v_total
         )
   where id = p_orcamento;

  return jsonb_build_object('valor_total', v_total, 'pdf_versao', p_versao);
end;
$$;
