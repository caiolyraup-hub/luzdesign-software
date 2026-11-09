import Link from "next/link";
import type { StatusOrcamento } from "@/lib/dominio";

export interface Filtro {
  id: string;
  rotulo: string;
  status: StatusOrcamento[] | null; // null = todos
}

export const FILTROS: Filtro[] = [
  {
    id: "andamento",
    rotulo: "Em andamento",
    status: ["rascunho", "gerado", "enviado", "followup_d5", "followup_d10"],
  },
  { id: "followup", rotulo: "Follow-up", status: ["enviado", "followup_d5", "followup_d10"] },
  { id: "fechados", rotulo: "Fechados", status: ["fechado"] },
  { id: "perdidos", rotulo: "Perdidos", status: ["perdido"] },
  { id: "todos", rotulo: "Todos", status: null },
];

export function filtroPorId(id: string | undefined): Filtro {
  return FILTROS.find((f) => f.id === id) ?? FILTROS[0];
}

/** Chips de filtro (links, funcionam sem JavaScript). `extra` mantém outros parâmetros da URL. */
export function FiltrosStatus({
  base,
  atual,
  contagens,
  extra = {},
}: {
  base: string;
  atual: string;
  contagens: Record<string, number>;
  extra?: Record<string, string | undefined>;
}) {
  const montar = (id: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    p.set("filtro", id);
    return `${base}?${p.toString()}`;
  };
  return (
    <nav aria-label="Filtrar por status" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {FILTROS.map((f) => (
        <Link
          key={f.id}
          href={montar(f.id)}
          aria-current={atual === f.id ? "page" : undefined}
          className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-base ${
            atual === f.id
              ? "border-amber-700 bg-amber-700 font-semibold text-white"
              : "border-zinc-300 bg-white"
          }`}
        >
          {f.rotulo} ({contagens[f.id] ?? 0})
        </Link>
      ))}
    </nav>
  );
}
