import type { SupabaseClient } from "@supabase/supabase-js";
import { dataMaceioISO } from "../orcamento/followup";
import { dataISOValida, paramsDoPeriodo, type Periodo } from "./periodo";

/** Qual data do orçamento o período filtra, quando a lista é aberta por um número do painel. */
export const CAMPOS_PERIODO = ["criado", "gerado", "enviado", "fechado", "perdido"] as const;
export type CampoPeriodo = (typeof CAMPOS_PERIODO)[number];

export const ROTULOS_CAMPO: Record<CampoPeriodo, string> = {
  criado: "criados",
  gerado: "gerados",
  enviado: "enviados",
  fechado: "fechados",
  perdido: "perdidos",
};

export interface FiltroPeriodo {
  campo: CampoPeriodo;
  /** AAAA-MM-DD, inclusivo, em Maceió. */
  de: string;
  ate: string;
  /** Só os perdidos por este motivo. */
  motivo?: string;
}

type Param = string | string[] | undefined;
const um = (v: Param) => (Array.isArray(v) ? v[0] : v);

/** Lê `data`, `de`, `ate` e `motivo` da URL; ausente ou inválido = lista sem filtro de período. */
export function lerFiltroPeriodo(params: Record<string, Param>): FiltroPeriodo | null {
  const campo = um(params.data);
  const de = um(params.de);
  const ate = um(params.ate);
  if (!CAMPOS_PERIODO.includes(campo as CampoPeriodo)) return null;
  if (!dataISOValida(de) || !dataISOValida(ate) || ate < de) return null;
  const motivo = um(params.motivo);
  return { campo: campo as CampoPeriodo, de, ate, motivo: motivo || undefined };
}

export interface LinhaComDatas {
  id: string;
  criado_em: string | null;
  gerado_em: string | null;
  enviado_em: string | null;
  fechado_em: string | null;
  perdido_em: string | null;
  motivo_perda: string | null;
}

/** A data da etapa cai no período (dias de Maceió)? */
export function noPeriodo(linha: LinhaComDatas, f: FiltroPeriodo): boolean {
  const instante = linha[`${f.campo}_em` as const];
  if (!instante) return false;
  const dia = dataMaceioISO(instante);
  if (dia < f.de || dia > f.ate) return false;
  return f.motivo ? linha.motivo_perda === f.motivo : true;
}

/** Ids dos orçamentos que entram nos números (sem os de teste), sob a RLS de quem consulta. */
export async function idsDeOrcamentosReais(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from("orcamentos_reais").select("id");
  return new Set(((data ?? []) as { id: string }[]).map((l) => l.id));
}

/** Aplica o filtro de período (e tira os de teste) a uma lista de orçamentos. */
export async function aplicarFiltroPeriodo<T extends LinhaComDatas>(
  supabase: SupabaseClient,
  linhas: T[],
  filtro: FiltroPeriodo | null,
): Promise<T[]> {
  if (!filtro) return linhas;
  const reais = await idsDeOrcamentosReais(supabase);
  return linhas.filter((l) => reais.has(l.id) && noPeriodo(l, filtro));
}

/** URL da lista aberta por um número do painel. */
export function linkLista(
  base: string,
  opcoes: {
    filtro: string;
    periodo?: Periodo;
    campo?: CampoPeriodo;
    motivo?: string;
    vendedora?: string | null;
  },
): string {
  const p = new URLSearchParams({ filtro: opcoes.filtro });
  if (opcoes.vendedora) p.set("vendedora", opcoes.vendedora);
  if (opcoes.periodo && opcoes.campo) {
    p.set("data", opcoes.campo);
    p.set("de", opcoes.periodo.inicio);
    p.set("ate", opcoes.periodo.fim);
    // Mantém também a escolha do seletor, para voltar ao painel no mesmo período.
    for (const [k, v] of Object.entries(paramsDoPeriodo(opcoes.periodo)))
      if (k === "periodo") p.set(k, v);
  }
  if (opcoes.motivo) p.set("motivo", opcoes.motivo);
  return `${base}?${p.toString()}`;
}
