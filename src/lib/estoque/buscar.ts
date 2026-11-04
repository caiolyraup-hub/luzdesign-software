import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnidadeProduto } from "../dominio";

export interface ProdutoBusca {
  codigo: string;
  categoria: string | null;
  marca: string | null;
  descricao: string;
  unidade: UnidadeProduto;
  preco_unitario: number;
  estoque_disponivel: number | null;
  atributos: Record<string, unknown>;
  similaridade: number;
}

export interface OpcoesBusca {
  texto?: string;
  categoria?: string | null;
  marca?: string | null;
  limite?: number;
}

/** Chama buscar_produtos (security invoker): vale a RLS de quem está logada. */
export async function buscarProdutos(
  supabase: SupabaseClient,
  { texto = "", categoria = null, marca = null, limite = 20 }: OpcoesBusca = {},
): Promise<ProdutoBusca[]> {
  const { data, error } = await supabase.rpc("buscar_produtos", {
    p_texto: texto,
    p_categoria: categoria,
    p_marca: marca,
    p_limite: limite,
  });
  if (error) throw new Error(`Busca de produtos: ${error.message}`);
  return (data ?? []).map((p: ProdutoBusca) => ({
    ...p,
    preco_unitario: Number(p.preco_unitario),
    estoque_disponivel: p.estoque_disponivel === null ? null : Number(p.estoque_disponivel),
  }));
}
