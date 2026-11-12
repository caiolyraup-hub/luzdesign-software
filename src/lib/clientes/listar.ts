import type { SupabaseClient } from "@supabase/supabase-js";

export interface CartaoCliente {
  id: string;
  nome: string;
  whatsapp: string | null;
  tipo: string;
  arquiteto: string | null;
  vendedoraId: string;
  vendedoraNome: string | null;
  orcamentos: number;
  fechados: number;
  vendido: number;
  ultimoEm: string | null;
}

export interface PaginaClientes {
  total: number;
  clientes: CartaoCliente[];
  proximo: string | null;
}

export const TAMANHO_PAGINA_CLIENTES = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FiltrosClientes {
  q?: string;
  /** Só a gerência. */
  vendedora?: string;
}

type Param = string | string[] | undefined;
const um = (v: Param) => (Array.isArray(v) ? v[0] : v);

/** Lê a busca e o filtro de vendedora da URL (inválido é ignorado; vendedora só vale para a gerência). */
export function lerFiltrosClientes(
  params: Record<string, Param>,
  opcoes: { gerente: boolean },
): FiltrosClientes {
  const q = (um(params.q) ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const v = um(params.vendedora);
  return {
    q: q || undefined,
    vendedora: opcoes.gerente && v && UUID.test(v) ? v : undefined,
  };
}

/** Uma página da lista de clientes (função SQL `listar_clientes`, security invoker: a RLS decide). */
export async function listarClientes(
  supabase: SupabaseClient,
  filtros: FiltrosClientes,
  cursor?: string | null,
): Promise<PaginaClientes | null> {
  const { data, error } = await supabase.rpc("listar_clientes", {
    p: {
      ...(filtros.q ? { q: filtros.q } : {}),
      ...(filtros.vendedora ? { vendedora: filtros.vendedora } : {}),
      ...(cursor ? { cursor } : {}),
      limite: TAMANHO_PAGINA_CLIENTES,
    },
  });
  if (error || !data) return null;
  const j = data as {
    total: number | string;
    itens: Record<string, unknown>[];
    proximo: string | null;
  };
  return {
    total: Number(j.total),
    proximo: j.proximo ?? null,
    clientes: (j.itens ?? []).map((l) => ({
      id: String(l.id),
      nome: String(l.nome),
      whatsapp: (l.whatsapp as string | null) ?? null,
      tipo: String(l.tipo),
      arquiteto: (l.arquiteto_indicador as string | null) ?? null,
      vendedoraId: String(l.vendedora_id),
      vendedoraNome: (l.vendedora_nome as string | null) ?? null,
      orcamentos: Number(l.orcamentos),
      fechados: Number(l.fechados),
      vendido: Number(l.vendido),
      ultimoEm: (l.ultimo_em as string | null) ?? null,
    })),
  };
}
