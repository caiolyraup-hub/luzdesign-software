import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemRevisao, OrigemItem } from "./itens";

export const SELECT_ITENS =
  "id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, justificativa, origem, descricao_manual, ordem, produtos(categoria, unidade, ativo, preco_unitario, descricao, produtos_descricao_formatada(descricao_formatada, descricao_origem))";

interface FormatadaJunta {
  descricao_formatada: string;
  descricao_origem: string;
}

interface ProdutoJunto {
  categoria?: string | null;
  produtos_descricao_formatada?: FormatadaJunta | FormatadaJunta[] | null;
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
  origem: OrigemItem | null;
  descricao_manual: boolean | null;
  ordem: number;
  produtos: ProdutoJunto | ProdutoJunto[] | null;
}

/** A descrição padronizada, se ainda vale para a descrição atual do catálogo; senão, a do catálogo. */
export function descricaoIdeal(produto: ProdutoJunto): string {
  const f = Array.isArray(produto.produtos_descricao_formatada)
    ? produto.produtos_descricao_formatada[0]
    : produto.produtos_descricao_formatada;
  return f && f.descricao_origem === produto.descricao ? f.descricao_formatada : produto.descricao;
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
    origem: l.origem ?? "manual",
    descricaoManual: l.descricao_manual ?? false,
    ordem: l.ordem,
    marca: null,
    categoria: l.avulso ? null : (produto?.categoria ?? null),
    unidade: l.avulso ? "un" : (produto?.unidade ?? "un"),
    produtoAtivo: l.avulso || !produto ? null : produto.ativo,
    precoCatalogo: l.avulso || !produto ? null : Number(produto.preco_unitario),
    descricaoCatalogo: l.avulso || !produto ? null : descricaoIdeal(produto),
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
