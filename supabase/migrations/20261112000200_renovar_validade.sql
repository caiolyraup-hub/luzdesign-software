-- Dia 10B: renovar a validade de um orçamento gerado/enviado com uma nova versão (PDF + XLSX).
--
-- Fluxo (ver docs/arquitetura.md): a vendedora vê as diferenças de preço do catálogo e escolhe
-- "Atualizar preços e renovar" ou "Manter os preços antigos e renovar"; o servidor gera os arquivos
-- e chama esta função, que grava tudo numa transação: volta o orçamento para `gerado` (sem apagar as
-- datas de envio, como "Editar e enviar nova versão"), aplica os preços conforme o modo, guarda a
-- versão nova e a nova validade e marca a versão como renovação na linha do tempo.
--
-- É a única exceção à regra "só a dona gera": aqui a dona **e a gerente** podem renovar (security
-- definer, porque a gerente não escreve nos itens pela RLS), e a autorização é conferida dentro.

create function renovar_validade(
  p_orcamento uuid,
  p_pdf_caminho text,
  p_xlsx_caminho text,
  p_versao integer,
  p_total_esperado numeric,
  p_validade date,
  p_manter_precos boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_orc orcamentos%rowtype;
  v_total numeric(12,2);
begin
  select * into v_orc from orcamentos where id = p_orcamento for update;
  if not found or v_uid is null
     or not (v_orc.vendedora_id = v_uid or (select eh_gerente())) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if v_orc.status not in ('gerado', 'enviado', 'followup_d5', 'followup_d10') then
    raise exception 'ORCAMENTO_NAO_RENOVAVEL' using errcode = 'P0001';
  end if;
  if v_orc.pdf_versao + 1 <> p_versao then
    raise exception 'VERSAO_DIVERGENTE' using errcode = 'P0001';
  end if;
  if p_pdf_caminho not like v_orc.vendedora_id::text || '/' || p_orcamento::text || '/%'
     or (p_xlsx_caminho is not null
         and p_xlsx_caminho not like v_orc.vendedora_id::text || '/' || p_orcamento::text || '/%') then
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
  -- Item inativo precisa ser trocado ou removido antes (pelo "Editar e enviar nova versão").
  if exists (
    select 1 from orcamento_itens i join produtos p on p.codigo = i.codigo
     where i.orcamento_id = p_orcamento and not i.avulso and not p.ativo
  ) then
    raise exception 'PRODUTO_INATIVO' using errcode = 'P0001';
  end if;

  -- Volta para gerado SEM apagar enviado_em nem ultimo_envio_em (o gatilho registra o evento de status).
  -- Isso precisa vir antes de mexer nos itens: o bloqueio de edição só deixa em rascunho e gerado.
  if v_orc.status <> 'gerado' then
    update orcamentos set status = 'gerado' where id = p_orcamento;
  end if;

  if not p_manter_precos then
    update orcamento_itens i
       set preco_unitario_congelado = p.preco_unitario
      from produtos p
     where i.orcamento_id = p_orcamento and i.codigo = p.codigo and not i.avulso;
  end if;

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
           'gerado_em', now(), 'valor_total', v_total,
           'renovada', true, 'manteve_precos', p_manter_precos, 'validade', p_validade,
           'por', v_uid
         )
   where id = p_orcamento;

  return jsonb_build_object('valor_total', v_total, 'pdf_versao', p_versao, 'validade', p_validade);
end;
$$;

revoke all on function renovar_validade(uuid, text, text, integer, numeric, date, boolean) from public, anon;
grant execute on function renovar_validade(uuid, text, text, integer, numeric, date, boolean)
  to authenticated, service_role;
