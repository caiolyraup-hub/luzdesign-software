-- Dia 12D: "Relatar problema" do piloto. Cada pessoa lê os próprios relatos; a gerência e o dono leem
-- todos e marcam como resolvidos. A foto da tela é opcional e fica em bucket privado, na pasta de quem
-- enviou ({usuario}/{arquivo}).
create table relatos_piloto (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  usuario_id uuid not null references usuarios (id),
  tela text check (tela is null or char_length(tela) <= 200),
  mensagem text not null check (char_length(btrim(mensagem)) between 5 and 2000),
  foto_path text,
  status text not null default 'aberto' check (status in ('aberto', 'resolvido')),
  resolvido_em timestamptz,
  resolvido_por uuid references usuarios (id)
);
create index relatos_piloto_status on relatos_piloto (status, criado_em desc);
create index relatos_piloto_usuario on relatos_piloto (usuario_id, criado_em desc);

revoke all on relatos_piloto from anon;
alter table relatos_piloto enable row level security;
create policy relatos_enviar on relatos_piloto for insert to authenticated
  with check ((select eh_usuario()) and usuario_id = (select auth.uid()) and status = 'aberto');
create policy relatos_ler on relatos_piloto for select to authenticated
  using (usuario_id = (select auth.uid()) or (select eh_gerente()));
create policy relatos_resolver on relatos_piloto for update to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatos', 'relatos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy relatos_storage_enviar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'relatos' and (select public.eh_usuario())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy relatos_storage_ler on storage.objects for select to authenticated
  using (
    bucket_id = 'relatos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.eh_gerente()))
  );
