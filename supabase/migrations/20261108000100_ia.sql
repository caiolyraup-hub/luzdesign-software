-- Motor de IA (dia 5): colunas de apoio e gravação atômica dos itens.

-- Orçamento: quando a IA montou e o resultado da última montagem (avisos, pendências, tentativas).
alter table orcamentos
  add column montado_em timestamptz,
  add column montagem jsonb;

-- Itens: justificativa da IA e ordem de exibição (ambientes e itens na ordem montada).
alter table orcamento_itens
  add column justificativa text,
  add column ordem integer not null default 0;

-- uso_ia: quem, qual modelo, como terminou. Só o service role escreve (sem política de escrita).
alter table uso_ia
  add column vendedora_id uuid references usuarios (id) on delete set null,
  add column modelo text,
  add column chamadas_ferramenta integer not null default 0,
  add column status text not null default 'ok'
    check (status in ('em_andamento', 'ok', 'erro')),
  add column erro text,
  add column detalhes jsonb not null default '{}'::jsonb;

-- Limites diário e por orçamento contam por aqui.
create index uso_ia_vendedora_dia on uso_ia (vendedora_id, criado_em desc);
create index uso_ia_orcamento_status on uso_ia (orcamento_id, status);

-- Substitui os itens do orçamento de uma vez (uma transação): apaga os antigos, grava os novos,
-- atualiza total e resultado. security invoker: a RLS vale; só mexe em rascunho próprio.
create function substituir_itens_orcamento(
  p_orcamento uuid,
  p_itens jsonb,
  p_valor_total numeric,
  p_montagem jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_atualizados integer;
begin
  update orcamentos
     set valor_total = p_valor_total,
         montado_em = now(),
         montagem = p_montagem
   where id = p_orcamento and status = 'rascunho';
  get diagnostics v_atualizados = row_count;
  if v_atualizados = 0 then
    raise exception 'Orçamento não encontrado ou não está em rascunho.' using errcode = 'P0002';
  end if;

  delete from orcamento_itens where orcamento_id = p_orcamento;

  insert into orcamento_itens (
    orcamento_id, codigo, descricao_congelada, preco_unitario_congelado,
    quantidade, ambiente, avulso, justificativa, ordem
  )
  select p_orcamento, i.codigo, i.descricao_congelada, i.preco_unitario_congelado,
         i.quantidade, i.ambiente, i.avulso, i.justificativa, i.ordem
    from jsonb_to_recordset(p_itens) as i(
      codigo text, descricao_congelada text, preco_unitario_congelado numeric,
      quantidade numeric, ambiente text, avulso boolean, justificativa text, ordem integer
    );
end;
$$;
revoke all on function substituir_itens_orcamento(uuid, jsonb, numeric, jsonb) from public, anon;
grant execute on function substituir_itens_orcamento(uuid, jsonb, numeric, jsonb)
  to authenticated, service_role;
