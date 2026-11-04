-- Bucket privado de anexos. Caminho: {vendedora_id}/{orcamento_id}/{arquivo}
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 15728640)
on conflict (id) do nothing;

-- A vendedora só mexe em arquivos da própria pasta e de orçamento dela.
create policy anexos_storage_vendedora on storage.objects for all to authenticated
  using (
    bucket_id = 'anexos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.orcamentos o
      where o.id::text = (storage.foldername(name))[2] and o.vendedora_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'anexos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.orcamentos o
      where o.id::text = (storage.foldername(name))[2] and o.vendedora_id = (select auth.uid())
    )
  );

-- A gerente lê tudo.
create policy anexos_storage_gerente_ler on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and (select public.eh_gerente()));
