-- Dia 12C: registro de erros do servidor e das telas, para a gerência acompanhar o piloto. Sem dado de
-- cliente (a mensagem é limpa de e-mails e números longos antes de gravar). Só o servidor grava (chave de
-- serviço); só a gerência e o dono leem.
create table erros_app (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  origem text not null check (origem in ('servidor', 'tela')),
  rota text,
  mensagem text not null check (char_length(mensagem) <= 400),
  digest text,
  usuario_id uuid
);
create index erros_app_criado on erros_app (criado_em desc);
revoke all on erros_app from anon;
alter table erros_app enable row level security;
create policy erros_app_ler on erros_app for select to authenticated using ((select eh_gerente()));
