-- Row Level Security (dia 2). Ver docs/seguranca.md.

-- Visitante anônimo não acessa nada.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

alter table usuarios enable row level security;
alter table produtos enable row level security;
alter table produto_apelidos enable row level security;
alter table sync_estoque enable row level security;
alter table clientes enable row level security;
alter table orcamentos enable row level security;
alter table orcamento_itens enable row level security;
alter table anexos enable row level security;
alter table eventos enable row level security;
alter table uso_ia enable row level security;

-- usuarios: cada um lê a própria linha; gerente lê todas. Sem escrita pelo cliente
-- (evita que alguém troque o próprio perfil).
create policy usuarios_ler on usuarios for select to authenticated
  using (id = (select auth.uid()) or (select eh_gerente()));

-- produtos e apelidos: leitura para logados; escrita só da gerente (service role ignora RLS).
create policy produtos_ler on produtos for select to authenticated using (true);
create policy produtos_gerente_escreve on produtos for all to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));

create policy apelidos_ler on produto_apelidos for select to authenticated using (true);
create policy apelidos_gerente_escreve on produto_apelidos for all to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));

-- sync_estoque e uso_ia: leitura só da gerente; escrita só do service role (sem policy de escrita).
create policy sync_estoque_ler on sync_estoque for select to authenticated
  using ((select eh_gerente()));
create policy uso_ia_ler on uso_ia for select to authenticated
  using ((select eh_gerente()));

-- clientes ----------------------------------------------------------------------
create policy clientes_ler on clientes for select to authenticated
  using (vendedora_id = (select auth.uid()) or (select eh_gerente()));
create policy clientes_inserir on clientes for insert to authenticated
  with check (vendedora_id = (select auth.uid()));
create policy clientes_atualizar on clientes for update to authenticated
  using (vendedora_id = (select auth.uid())) with check (vendedora_id = (select auth.uid()));
create policy clientes_gerente_reatribui on clientes for update to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));
create policy clientes_apagar on clientes for delete to authenticated
  using (vendedora_id = (select auth.uid()));

-- orcamentos --------------------------------------------------------------------
create policy orcamentos_ler on orcamentos for select to authenticated
  using (vendedora_id = (select auth.uid()) or (select eh_gerente()));
-- Ninguém cria orçamento em nome de outra, nem a gerente; o cliente tem de ser da mesma vendedora.
create policy orcamentos_inserir on orcamentos for insert to authenticated
  with check (
    vendedora_id = (select auth.uid())
    and exists (
      select 1 from clientes c
      where c.id = cliente_id and c.vendedora_id = orcamentos.vendedora_id
    )
  );
create policy orcamentos_atualizar on orcamentos for update to authenticated
  using (vendedora_id = (select auth.uid())) with check (vendedora_id = (select auth.uid()));
-- A gerente pode reatribuir (mudar vendedora_id).
create policy orcamentos_gerente_reatribui on orcamentos for update to authenticated
  using ((select eh_gerente())) with check ((select eh_gerente()));
create policy orcamentos_apagar on orcamentos for delete to authenticated
  using (vendedora_id = (select auth.uid()));

-- Tabelas filhas: seguem o dono do orçamento ----------------------------------------
create policy itens_ler on orcamento_itens for select to authenticated
  using ((select eh_gerente()) or exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));
create policy itens_escrever on orcamento_itens for all to authenticated
  using (exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())))
  with check (exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));

create policy anexos_ler on anexos for select to authenticated
  using ((select eh_gerente()) or exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));
create policy anexos_escrever on anexos for all to authenticated
  using (exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())))
  with check (exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));

-- eventos: só leitura (o gatilho, security definer, é quem grava).
create policy eventos_ler on eventos for select to authenticated
  using ((select eh_gerente()) or exists (
    select 1 from orcamentos o where o.id = orcamento_id and o.vendedora_id = (select auth.uid())));
