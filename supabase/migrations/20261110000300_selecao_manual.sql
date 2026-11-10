-- Dia 8A: a vendedora escolhe os produtos; a IA só sugere (Indicação) e padroniza texto.
--
-- Não apaga nada do dia 7: orcamento_ambientes.analise, orcamento_itens.motivo_cliente e
-- justificativa continuam no banco, só deixam de ser usados.

-- ---------------------------------------------------------------- origem do item
-- Como o item entrou no orçamento (alimenta o painel de uso da Indicação da IA).
alter table orcamento_itens
  add column origem text not null default 'manual'
    check (origem in ('manual', 'lista_colada', 'indicacao_ia', 'montagem_ia'));
update orcamento_itens set origem = 'montagem_ia' where coalesce(justificativa, '') <> '';

-- A vendedora pode escrever a descrição do item à mão; essa não é padronizada pela IA.
alter table orcamento_itens add column descricao_manual boolean not null default false;

-- ---------------------------------------------------------------- uso_ia: novos tipos
alter table uso_ia drop constraint uso_ia_tipo_check;
alter table uso_ia
  add constraint uso_ia_tipo_check
    check (tipo in ('montagem', 'reescrever_analise', 'indicacao', 'formatacao'));

-- ---------------------------------------------------------------- Indicação da IA (histórico)
create table indicacoes_ia (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references orcamentos (id) on delete cascade,
  vendedora_id uuid not null references usuarios (id),
  ambiente text not null,
  pedido_cliente text,
  pedido_arquiteto text,
  descricao_ambiente text,
  usou_anexos boolean not null default false,
  resposta jsonb not null,
  criado_em timestamptz not null default now()
);
create index indicacoes_ia_orcamento on indicacoes_ia (orcamento_id, criado_em desc);

revoke all on indicacoes_ia from anon;
alter table indicacoes_ia enable row level security;
-- Mesma regra de orcamento_itens: a dona lê e escreve; a gerente só lê.
create policy indicacoes_ler on indicacoes_ia for select to authenticated
  using ((select eh_gerente()) or exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));
create policy indicacoes_escrever on indicacoes_ia for all to authenticated
  using (exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())))
  with check (vendedora_id = (select auth.uid()) and exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));

-- ---------------------------------------------------------------- descrição padronizada (cache)
-- Uma descrição comercial por produto, escrita pela IA e validada no servidor. Só o servidor
-- (service role) grava; todas as logadas leem.
create table produtos_descricao_formatada (
  codigo text primary key references produtos (codigo) on delete cascade,
  descricao_formatada text not null,
  -- A descrição do catálogo de onde a formatação saiu: se mudar, a formatação é refeita.
  descricao_origem text not null,
  origem_atualizado_em timestamptz not null,
  criado_em timestamptz not null default now()
);
revoke all on produtos_descricao_formatada from anon;
alter table produtos_descricao_formatada enable row level security;
create policy descricao_formatada_ler on produtos_descricao_formatada
  for select to authenticated using (true);
revoke insert, update, delete on produtos_descricao_formatada from authenticated;

-- ---------------------------------------------------------------- XLSX junto do PDF
alter table orcamentos add column xlsx_caminho text;

update storage.buckets
   set allowed_mime_types = array[
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ]
 where id = 'pdfs';

-- gerar_orcamento agora também guarda o caminho da planilha e NÃO reescreve a descrição: o
-- servidor já gravou a descrição final (padronizada ou escrita pela vendedora). O preço continua
-- sempre vindo do catálogo.
drop function gerar_orcamento(uuid, text, integer, numeric, date);
create function gerar_orcamento(
  p_orcamento uuid,
  p_pdf_caminho text,
  p_versao integer,
  p_total_esperado numeric,
  p_validade date,
  p_xlsx_caminho text default null
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
  -- Só a DONA gera (a gerente pode atualizar orçamentos, mas não gera o de outra pessoa).
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
  if p_xlsx_caminho is not null
     and p_xlsx_caminho not like v_orc.vendedora_id::text || '/' || p_orcamento::text || '/%' then
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

  -- Congela o preço: item com código sempre leva o preço do catálogo.
  update orcamento_itens i
     set preco_unitario_congelado = p.preco_unitario
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
         xlsx_caminho = p_xlsx_caminho,
         pdf_versao = p_versao,
         pdf_versoes = pdf_versoes || jsonb_build_object(
           'versao', p_versao, 'caminho', p_pdf_caminho, 'xlsx_caminho', p_xlsx_caminho,
           'gerado_em', now(), 'valor_total', v_total
         )
   where id = p_orcamento;

  return jsonb_build_object('valor_total', v_total, 'pdf_versao', p_versao);
end;
$$;
revoke all on function gerar_orcamento(uuid, text, integer, numeric, date, text) from public, anon;
grant execute on function gerar_orcamento(uuid, text, integer, numeric, date, text)
  to authenticated, service_role;
