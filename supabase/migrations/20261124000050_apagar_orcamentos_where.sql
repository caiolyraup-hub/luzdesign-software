-- Correção: o Supabase recusa DELETE sem WHERE (pg_safeupdate). Mesma função da 20261123000100.
-- Dia 15 (parte A): apagar todos os orçamentos para a loja começar do zero. A função só CONTA quando
-- p_executar = false (simulação). Executando, tudo acontece numa transação só (uma função é atômica):
-- se qualquer passo falhar, nada é apagado. Só o servidor (service role) chama; os arquivos do Storage
-- saem depois, pelo script, e só se esta função terminou.
--
-- SAI (ligado a orçamento): orcamentos; em cascata orcamento_itens, orcamento_ambientes, anexos, eventos,
-- indicacoes_ia e comissoes (os valores calculados); uso_ia com orcamento_id; eventos_exportacao inteira
-- (é o registro de exportações de listas de orçamentos). Opcional: clientes que ficarem sem orçamento e o
-- contador de numeração.
-- FICA: produtos e tudo do catálogo/estoque, usuarios, arquitetos (e eventos), percentuais de comissão,
-- configuracoes_loja, relatos_piloto, erros_app, uso_ia sem orçamento, clientes_fusoes.
create or replace function apagar_todos_orcamentos(
  p_executar boolean default false,
  p_incluir_piloto boolean default false,
  p_apagar_clientes boolean default false,
  p_reiniciar_contador boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids uuid[];
  v_orcs jsonb;
  v_antes jsonb;
  v_depois jsonb;
  v_clientes_orfaos jsonb;
  v_maior integer;
  v_ano integer := extract(year from (now() at time zone 'America/Maceio'))::integer;
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from orcamentos where p_incluir_piloto or not piloto;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vendedora_id', vendedora_id, 'numero', numero)), '[]'::jsonb)
    into v_orcs from orcamentos where id = any (v_ids);

  -- clientes que ficariam sem nenhum orçamento depois da limpeza
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) order by c.nome), '[]'::jsonb)
    into v_clientes_orfaos
    from clientes c
   where not exists (select 1 from orcamentos o where o.cliente_id = c.id and not (o.id = any (v_ids)));

  v_antes := jsonb_build_object(
    'orcamentos', cardinality(v_ids),
    'orcamentos_piloto', (select count(*) from orcamentos where id = any (v_ids) and piloto),
    'valor_total', (select coalesce(sum(valor_total), 0) from orcamentos where id = any (v_ids)),
    'por_status', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb)
                     from (select status::text s, count(*) n from orcamentos where id = any (v_ids) group by 1) t),
    'por_vendedora', (select coalesce(jsonb_object_agg(nome, n), '{}'::jsonb)
                        from (select u.nome, count(*) n from orcamentos o join usuarios u on u.id = o.vendedora_id
                               where o.id = any (v_ids) group by 1) t),
    'orcamento_itens', (select count(*) from orcamento_itens where orcamento_id = any (v_ids)),
    'orcamento_ambientes', (select count(*) from orcamento_ambientes where orcamento_id = any (v_ids)),
    'anexos', (select count(*) from anexos where orcamento_id = any (v_ids)),
    'eventos', (select count(*) from eventos where orcamento_id = any (v_ids)),
    'indicacoes_ia', (select count(*) from indicacoes_ia where orcamento_id = any (v_ids)),
    'comissoes', (select count(*) from comissoes where orcamento_id = any (v_ids)),
    'uso_ia_do_orcamento', (select count(*) from uso_ia where orcamento_id = any (v_ids)),
    'eventos_exportacao', (select count(*) from eventos_exportacao),
    'clientes_sem_orcamento_depois', jsonb_array_length(v_clientes_orfaos),
    'contador', (select coalesce(jsonb_object_agg(ano::text, ultimo), '{}'::jsonb) from orcamento_contador)
  );

  if p_executar then
    delete from uso_ia where orcamento_id = any (v_ids);
    delete from eventos_exportacao where true;
    delete from orcamentos where id = any (v_ids); -- cascata: itens, ambientes, anexos, eventos, IA, comissões
    if p_apagar_clientes then
      delete from clientes c
       where not exists (select 1 from orcamentos o where o.cliente_id = c.id);
    end if;
    if p_reiniciar_contador then
      select coalesce(max(substring(numero from '[0-9]+$')::integer), 0) into v_maior
        from orcamentos where numero like v_ano::text || '-%';
      update orcamento_contador set ultimo = v_maior where ano = v_ano;
    end if;
  end if;

  v_depois := jsonb_build_object(
    'orcamentos_total', (select count(*) from orcamentos),
    'orcamento_itens', (select count(*) from orcamento_itens),
    'orcamento_ambientes', (select count(*) from orcamento_ambientes),
    'anexos', (select count(*) from anexos),
    'eventos', (select count(*) from eventos),
    'indicacoes_ia', (select count(*) from indicacoes_ia),
    'comissoes', (select count(*) from comissoes),
    'uso_ia_do_orcamento', (select count(*) from uso_ia where orcamento_id is not null),
    'eventos_exportacao', (select count(*) from eventos_exportacao),
    'clientes', (select count(*) from clientes),
    'contador', (select coalesce(jsonb_object_agg(ano::text, ultimo), '{}'::jsonb) from orcamento_contador)
  );

  return jsonb_build_object(
    'executado', p_executar,
    'orcamentos', v_orcs,
    'clientes_sem_orcamento', v_clientes_orfaos,
    'antes', v_antes,
    'depois', v_depois,
    -- o que NÃO pode mudar (a conferência compara antes e depois da execução)
    'fica', jsonb_build_object(
      'produtos', (select count(*) from produtos),
      'produto_apelidos', (select count(*) from produto_apelidos),
      'produtos_dados_fornecedor', (select count(*) from produtos_dados_fornecedor),
      'produtos_descricao_formatada', (select count(*) from produtos_descricao_formatada),
      'sync_estoque', (select count(*) from sync_estoque),
      'estoque_mapeamentos', (select count(*) from estoque_mapeamentos),
      'usuarios', (select count(*) from usuarios),
      'arquitetos', (select count(*) from arquitetos),
      'eventos_arquiteto', (select count(*) from eventos_arquiteto),
      'configuracoes_loja', (select count(*) from configuracoes_loja),
      'configuracoes_comissao', (select count(*) from configuracoes_comissao),
      'comissoes_arquiteto_percentual', (select count(*) from comissoes_arquiteto_percentual),
      'comissoes_vendedora_percentual', (select count(*) from comissoes_vendedora_percentual),
      'relatos_piloto', (select count(*) from relatos_piloto),
      'erros_app', (select count(*) from erros_app),
      'clientes_fusoes', (select count(*) from clientes_fusoes),
      'uso_ia_sem_orcamento', (select count(*) from uso_ia where orcamento_id is null)
    )
  );
end;
$$;
revoke all on function apagar_todos_orcamentos(boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function apagar_todos_orcamentos(boolean, boolean, boolean, boolean) to service_role;
