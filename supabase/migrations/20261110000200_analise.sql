-- Análise do ambiente e motivo de cada produto para o cliente (dia 7).

-- Um bloco de análise por ambiente (texto para o cliente) e quais anexos o embasaram.
create table orcamento_ambientes (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references orcamentos (id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  analise text,
  anexos_usados uuid[] not null default '{}',
  atualizado_em timestamptz not null default now()
);
create unique index orcamento_ambientes_nome on orcamento_ambientes (orcamento_id, lower(nome));
create trigger orcamento_ambientes_atualizado_em before update on orcamento_ambientes
  for each row execute function definir_atualizado_em();

revoke all on orcamento_ambientes from anon;
alter table orcamento_ambientes enable row level security;
-- Mesma regra de orcamento_itens: a dona lê e escreve; a gerente só lê.
create policy ambientes_ler on orcamento_ambientes for select to authenticated
  using ((select eh_gerente()) or exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));
create policy ambientes_escrever on orcamento_ambientes for all to authenticated
  using (exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())))
  with check (exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));

-- Motivo curto da indicação, para o cliente (a justificativa continua interna, da vendedora).
alter table orcamento_itens add column motivo_cliente text;

-- Liga e desliga análise e motivos no PDF (ligado por padrão).
alter table orcamentos add column mostrar_analise_pdf boolean not null default true;

-- Reescrever a análise com IA conta no limite diário, mas não gasta as montagens do orçamento.
alter table uso_ia
  add column tipo text not null default 'montagem'
    check (tipo in ('montagem', 'reescrever_analise'));

-- Montagem atômica agora também grava as análises dos ambientes.
drop function substituir_itens_orcamento(uuid, jsonb, numeric, jsonb);
create function substituir_itens_orcamento(
  p_orcamento uuid,
  p_itens jsonb,
  p_valor_total numeric,
  p_montagem jsonb,
  p_ambientes jsonb default '[]'::jsonb
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
  delete from orcamento_ambientes where orcamento_id = p_orcamento;

  insert into orcamento_itens (
    orcamento_id, codigo, descricao_congelada, preco_unitario_congelado,
    quantidade, ambiente, avulso, justificativa, motivo_cliente, ordem
  )
  select p_orcamento, i.codigo, i.descricao_congelada, i.preco_unitario_congelado,
         i.quantidade, i.ambiente, i.avulso, i.justificativa, i.motivo_cliente, i.ordem
    from jsonb_to_recordset(p_itens) as i(
      codigo text, descricao_congelada text, preco_unitario_congelado numeric,
      quantidade numeric, ambiente text, avulso boolean, justificativa text,
      motivo_cliente text, ordem integer
    );

  insert into orcamento_ambientes (orcamento_id, nome, ordem, analise, anexos_usados)
  select p_orcamento, a.nome, a.ordem, a.analise,
         coalesce(array(select jsonb_array_elements_text(a.anexos_usados)::uuid), '{}')
    from jsonb_to_recordset(p_ambientes) as a(nome text, ordem integer, analise text, anexos_usados jsonb);
end;
$$;
revoke all on function substituir_itens_orcamento(uuid, jsonb, numeric, jsonb, jsonb) from public, anon;
grant execute on function substituir_itens_orcamento(uuid, jsonb, numeric, jsonb, jsonb)
  to authenticated, service_role;
