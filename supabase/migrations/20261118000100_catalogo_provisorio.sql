-- Dia 13: a vendedora precisa saber se o catálogo ainda é o PROVISÓRIO (158 produtos tirados de
-- orçamentos antigos). `sync_estoque` só a gerência lê, então a resposta sai por esta função (só o
-- verdadeiro/falso, sem dado do negócio). Fica provisório até existir uma carga terminada cuja origem
-- não comece com "provisorio" (a importação de planilha grava `planilha:<arquivo>`).
create function catalogo_eh_provisorio() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (select public.eh_usuario()) then null
    else not exists (
      select 1 from public.sync_estoque s
       where s.terminado_em is not null and s.origem not like 'provisorio%'
    )
  end;
$$;
revoke all on function catalogo_eh_provisorio() from public, anon;
grant execute on function catalogo_eh_provisorio() to authenticated;
