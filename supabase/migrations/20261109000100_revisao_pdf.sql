-- Revisão de itens e PDF do orçamento (dia 6).

-- Dados da loja: uma linha só. Todos os logados leem; só a gerente edita.
create table configuracoes_loja (
  id boolean primary key default true check (id),
  nome_fantasia text not null,
  razao_social text,
  cnpj text,
  endereco text,
  telefone text,
  whatsapp text,
  instagram text,
  site text,
  validade_dias integer not null default 7 check (validade_dias between 1 and 90),
  desconto_avista_pct numeric(5,2) not null default 10 check (desconto_avista_pct between 0 and 100),
  -- Uma condição por linha. Aceita {desconto} e {validade_dias}, trocados na hora de gerar o PDF.
  linhas_rodape text not null default '',
  atualizado_em timestamptz not null default now()
);
create trigger configuracoes_loja_atualizado_em before update on configuracoes_loja
  for each row execute function definir_atualizado_em();

revoke all on configuracoes_loja from anon;
alter table configuracoes_loja enable row level security;
create policy configuracoes_loja_ler on configuracoes_loja for select to authenticated using (true);
create policy configuracoes_loja_gerente_edita on configuracoes_loja for update to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));

-- Telefone, WhatsApp, Instagram e site ficam vazios: a gerente preenche.
insert into configuracoes_loja (id, nome_fantasia, razao_social, cnpj, endereco, linhas_rodape)
values (
  true,
  'Luz Design',
  'Luz Design LTDA',
  '04.487.554/0001-16',
  'Av. Dr. Júlio Marques Luz, 753-C, Jatiúca, Maceió-AL',
  E'À vista, desconto de 10%\nOrçamento válido por 7 dias\nPrazo de entrega: 30 a 45 dias úteis após o pagamento\nNão fazemos trocas de peças por encomenda\nMercadoria frágil'
);

-- Orçamento: PDF mais recente e histórico de versões (as anteriores ficam no Storage).
alter table orcamentos
  add column pdf_caminho text,
  add column pdf_versao integer not null default 0,
  add column pdf_versoes jsonb not null default '[]'::jsonb;

-- Total do orçamento a partir dos itens (preço x quantidade, arredondado por item em centavos).
create function recalcular_total_orcamento(p_orcamento uuid) returns numeric
language sql
security invoker
set search_path = public
as $$
  update orcamentos o
     set valor_total = coalesce((
           select sum(round(i.preco_unitario_congelado * i.quantidade, 2))
             from orcamento_itens i where i.orcamento_id = o.id
         ), 0)
   where o.id = p_orcamento and o.status in ('rascunho', 'gerado')
  returning o.valor_total;
$$;
revoke all on function recalcular_total_orcamento(uuid) from public, anon;
grant execute on function recalcular_total_orcamento(uuid) to authenticated, service_role;

-- Gera uma versão do orçamento numa transação: congela preço e descrição a partir de produtos,
-- recalcula o total, marca como gerado e guarda o caminho do PDF. O PDF já foi enviado ao Storage
-- pelo servidor; aqui conferimos que o total do PDF é o mesmo que o banco acabou de calcular.
-- security invoker: a RLS vale (só a dona, só rascunho ou gerado).
create function gerar_orcamento(
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
  if not found or v_orc.status not in ('rascunho', 'gerado') then
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

  -- Congela: item com código sempre leva o preço e a descrição do catálogo.
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
revoke all on function gerar_orcamento(uuid, text, integer, numeric, date) from public, anon;
grant execute on function gerar_orcamento(uuid, text, integer, numeric, date) to authenticated, service_role;

-- Bucket privado dos PDFs. Mesma regra de anexos: a vendedora só mexe na própria pasta e em
-- orçamento dela (sem apagar: as versões anteriores ficam); a gerente só lê.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy pdfs_vendedora_ler on storage.objects for select to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.orcamentos o
      where o.id::text = (storage.foldername(name))[2] and o.vendedora_id = (select auth.uid())
    )
  );
create policy pdfs_vendedora_gravar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.orcamentos o
      where o.id::text = (storage.foldername(name))[2] and o.vendedora_id = (select auth.uid())
    )
  );
-- Upsert (reenviar a mesma versão depois de uma falha) precisa de update.
create policy pdfs_vendedora_atualizar on storage.objects for update to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.orcamentos o
      where o.id::text = (storage.foldername(name))[2] and o.vendedora_id = (select auth.uid())
    )
  );
create policy pdfs_gerente_ler on storage.objects for select to authenticated
  using (bucket_id = 'pdfs' and (select public.eh_gerente()));
