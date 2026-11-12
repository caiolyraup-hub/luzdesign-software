import type { SupabaseClient } from "@supabase/supabase-js";
import type { DadosCartao } from "@/components/orcamento/CartaoOrcamento";
import { paraRpc, PRESETS, type FiltrosLista } from "./filtros-lista";

export interface PaginaLista {
  /** Total do filtro (todas as páginas). */
  total: number;
  /** Contagem por status, sem o filtro de status (para os chips de atalho). */
  porStatus: Record<string, number>;
  cartoes: DadosCartao[];
  /** Cursor da próxima página; nulo na última. */
  proximo: string | null;
}

interface LinhaSql {
  id: string;
  numero: string;
  status: string;
  valor_total: number | string;
  valor_fechado: number | string | null;
  motivo_perda: string | null;
  atualizado_em: string;
  gerado_em: string | null;
  ultimo_envio_em: string | null;
  validade: string | null;
  vendedora_nome: string | null;
  cliente_id: string;
  cliente_nome: string | null;
}

/**
 * Uma página da lista, pela função SQL `listar_orcamentos` (security invoker: a RLS decide o que cada
 * pessoa enxerga). `mostrarVendedora` põe o nome da vendedora no cartão (visão da gerência).
 */
export async function listarOrcamentos(
  supabase: SupabaseClient,
  filtros: FiltrosLista,
  opcoes: { cursor?: string | null; limite?: number; mostrarVendedora?: boolean } = {},
): Promise<PaginaLista | null> {
  const { data, error } = await supabase.rpc("listar_orcamentos", {
    p: paraRpc(filtros, { cursor: opcoes.cursor, limite: opcoes.limite }),
  });
  if (error || !data) return null;
  const j = data as {
    total: number | string;
    por_status: Record<string, number>;
    itens: LinhaSql[];
    proximo: string | null;
  };
  return {
    total: Number(j.total),
    porStatus: j.por_status ?? {},
    proximo: j.proximo ?? null,
    cartoes: (j.itens ?? []).map((l) => ({
      id: l.id,
      numero: l.numero,
      status: l.status,
      clienteId: l.cliente_id,
      clienteNome: l.cliente_nome ?? "Sem cliente",
      vendedoraNome: opcoes.mostrarVendedora ? l.vendedora_nome : null,
      valorTotal: Number(l.valor_total),
      valorFechado: l.valor_fechado === null ? null : Number(l.valor_fechado),
      motivoPerda: l.motivo_perda,
      atualizadoEm: l.atualizado_em,
      geradoEm: l.gerado_em,
      ultimoEnvioEm: l.ultimo_envio_em,
      validade: l.validade,
    })),
  };
}

/** Quantos orçamentos cada atalho de status mostra (soma da contagem por status). */
export function contagemDosPresets(porStatus: Record<string, number>): Record<string, number> {
  const soma = (lista: string[] | null) =>
    Object.entries(porStatus)
      .filter(([s]) => lista === null || lista.includes(s))
      .reduce((a, [, n]) => a + Number(n), 0);
  return Object.fromEntries(PRESETS.map((p) => [p.id, soma(p.status)]));
}
