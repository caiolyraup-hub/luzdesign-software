"use server";

import type { DadosCartao } from "@/components/orcamento/CartaoOrcamento";
import { lerFiltrosLista, TAMANHO_PAGINA } from "@/lib/orcamento/filtros-lista";
import { listarOrcamentos } from "@/lib/orcamento/listar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaMais =
  { ok: false; erro: string } | { ok: true; cartoes: DadosCartao[]; proximo: string | null };

/**
 * "Ver mais": a página seguinte da lista, pelo cursor. Os filtros vêm da URL da tela e são relidos e
 * validados aqui; a sessão da própria pessoa (RLS) decide o que ela enxerga, então nem um cursor nem
 * um filtro forjado devolvem orçamento de outra vendedora.
 */
export async function carregarMaisOrcamentos(
  params: Record<string, string>,
  cursor: string,
): Promise<RespostaMais> {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const filtros = lerFiltrosLista(params, { gerente: usuario.perfil === "gerente" });
  const pagina = await listarOrcamentos(supabase, filtros, {
    cursor: /^[^|]{1,64}\|[0-9a-f-]{36}$/i.test(cursor) ? cursor : null,
    limite: TAMANHO_PAGINA,
    mostrarVendedora: usuario.perfil === "gerente",
  });
  if (!pagina) return { ok: false, erro: "Não foi possível carregar mais orçamentos." };
  return { ok: true, cartoes: pagina.cartoes, proximo: pagina.proximo };
}
