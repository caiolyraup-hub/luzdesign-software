-- Dados fictícios de TESTE para o teste de isolamento (RLS). Não são dados reais.
-- Rode DEPOIS de scripts/criar-usuarios.ts (usa as vendedoras de public.usuarios).
-- Idempotente: não duplica se já existir.

do $$
declare
  v record;
  v_cliente uuid;
begin
  for v in select id, nome from public.usuarios where perfil = 'vendedora' and nome in ('Aline', 'Kely') loop
    if exists (select 1 from public.clientes where vendedora_id = v.id and nome like 'TESTE %') then
      continue;
    end if;

    insert into public.clientes (vendedora_id, nome, whatsapp, tipo)
    values (v.id, 'TESTE Cliente A de ' || v.nome, '82900000001', 'final')
    returning id into v_cliente;
    insert into public.orcamentos (vendedora_id, cliente_id, respostas, status, valor_total)
    values (v.id, v_cliente, '{"teste": true}', 'rascunho', 1500.00);

    insert into public.clientes (vendedora_id, nome, whatsapp, tipo)
    values (v.id, 'TESTE Cliente B de ' || v.nome, '82900000002', 'arquiteto')
    returning id into v_cliente;
    insert into public.orcamentos (vendedora_id, cliente_id, respostas, status, valor_total, motivo_perda)
    values (
      v.id, v_cliente, '{"teste": true}',
      case when v.nome = 'Kely' then 'perdido'::public.status_orcamento else 'enviado' end,
      2800.00,
      case when v.nome = 'Kely' then 'preco'::public.motivo_perda else null end
    );
  end loop;
end;
$$;
