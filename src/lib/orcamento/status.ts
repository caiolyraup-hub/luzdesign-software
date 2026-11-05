import type { StatusOrcamento } from "../dominio";

export const ROTULOS_STATUS: Record<StatusOrcamento, string> = {
  rascunho: "Rascunho",
  gerado: "Gerado",
  enviado: "Enviado",
  followup_d5: "Follow-up D+5",
  followup_d10: "Follow-up D+10",
  fechado: "Fechado",
  perdido: "Perdido",
};

/** Classes do selo de cada status (Tailwind). Rascunho é cinza. Ver docs/modelo-de-dados.md. */
export const CLASSES_STATUS: Record<StatusOrcamento, string> = {
  rascunho: "bg-zinc-200 text-zinc-800",
  gerado: "bg-sky-100 text-sky-900",
  enviado: "bg-indigo-100 text-indigo-900",
  followup_d5: "bg-amber-100 text-amber-900",
  followup_d10: "bg-orange-100 text-orange-900",
  fechado: "bg-emerald-100 text-emerald-900",
  perdido: "bg-rose-100 text-rose-900",
};

export function rotuloStatus(status: string): string {
  return ROTULOS_STATUS[status as StatusOrcamento] ?? status;
}

export function classeStatus(status: string): string {
  return CLASSES_STATUS[status as StatusOrcamento] ?? "bg-zinc-200 text-zinc-800";
}
