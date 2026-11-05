-- Formulário das 10 perguntas e anexos (dia 4).

-- Um mesmo WhatsApp só pode ser um cliente por vendedora. Aline e Kely podem ter o mesmo
-- cliente cada uma (uma não vê a outra). Cliente sem WhatsApp (rascunho no começo) não conflita.
create unique index clientes_vendedora_whatsapp
  on clientes (vendedora_id, whatsapp)
  where whatsapp is not null;

-- Anexos: tipo escolhido pela vendedora e dados do arquivo para a tela.
alter table anexos
  add column nome_original text,
  add column mime_type text;
alter table anexos alter column tipo set not null;
alter table anexos add constraint anexos_tipo_check check (tipo in ('foto', 'pdf', 'planta', 'print'));

-- O limite de 4 anexos vale no banco. O lock evita que dois envios simultâneos passem juntos.
create function limitar_anexos() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.orcamento_id::text, 0));
  if (select count(*) from public.anexos where orcamento_id = new.orcamento_id) >= 4 then
    raise exception 'Limite de 4 anexos por orçamento.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger anexos_limite before insert on anexos
  for each row execute function limitar_anexos();

-- Mescla respostas parciais em orcamentos.respostas de forma atômica (sem ler e regravar).
-- security invoker: a RLS vale. Só mexe em rascunho.
create function mesclar_respostas(p_orcamento uuid, p_patch jsonb) returns jsonb
language sql
security invoker
set search_path = public
as $$
  update orcamentos
     set respostas = respostas || p_patch
   where id = p_orcamento and status = 'rascunho'
  returning respostas;
$$;
revoke all on function mesclar_respostas(uuid, jsonb) from public, anon;
grant execute on function mesclar_respostas(uuid, jsonb) to authenticated, service_role;

-- Bucket: 10 MB por arquivo e só os tipos aceitos.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'
       ]
 where id = 'anexos';
