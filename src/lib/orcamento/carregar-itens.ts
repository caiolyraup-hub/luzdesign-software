import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemRevisao } from "./itens";

export const SELECT_ITENS =
  "id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, justificativa, motivo_cliente, ordem, produtos(marca, unidade, ativo, preco_unitario, descricao)";

interface ProdutoJunto {
  marca: string | null;
  unidade: "un" | "m";
  ativo: boolean;
  preco_unitario: number | string;
  descricao: string;
}

export interface LinhaItem {
  id: string;
  codigo: string | null;
  descricao_congelada: string;
  preco_unitario_congelado: number | string;
  quantidade: number | string;
  ambiente: string | null;
  avulso: boolean;
  justificativa: string | null;
  motivo_cliente: string | null;
  ordem: number;
  produtos: ProdutoJunto | ProdutoJunto[] | null;
}

export function paraItemRevisao(l: LinhaItem): ItemRevisao {
  const produto = Array.isArray(l.produtos) ? l.produtos[0] : l.produtos;
  return {
    id: l.id,
    codigo: l.avulso ? null : l.codigo,
    descricao: l.descricao_congelada,
    preco: Number(l.preco_unitario_congelado),
    quantidade: Number(l.quantidade),
    ambiente: l.ambiente?.trim() || "Geral",
    avulso: l.avulso,
    justificativa: l.justificativa,
    motivo: l.motivo_cliente,
    ordem: l.ordem,
    marca: produto?.marca ?? null,
    unidade: l.avulso ? "un" : (produto?.unidade ?? "un"),
    produtoAtivo: l.avulso || !produto ? null : produto.ativo,
    precoCatalogo: l.avulso || !produto ? null : Number(produto.preco_unitario),
    descricaoCatalogo: l.avulso || !produto ? null : produto.descricao,
  };
}

/** Itens do orçamento (sob a RLS de quem chama) com os dados atuais do catálogo ao lado. */
export async function carregarItensRevisao(
  supabase: SupabaseClient,
  orcamentoId: string,
): Promise<ItemRevisao[]> {
  const { data, error } = await supabase
    .from("orcamento_itens")
    .select(SELECT_ITENS)
    .eq("orcamento_id", orcamentoId)
    .order("ordem");
  if (error) throw new Error(`Ler itens: ${error.message}`);
  return ((data ?? []) as unknown as LinhaItem[]).map(paraItemRevisao);
}
