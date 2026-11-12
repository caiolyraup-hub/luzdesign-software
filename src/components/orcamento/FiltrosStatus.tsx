import Link from "next/link";
import { PRESETS } from "@/lib/orcamento/filtros-lista";

export { PRESETS as FILTROS, presetPorId as filtroPorId } from "@/lib/orcamento/filtros-lista";

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
      {PRESETS.map((f) => (
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
