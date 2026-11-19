"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { marcarPiloto } from "@/app/(app)/orcamentos/acoes-status";

/** Só gerência e dono: marca ou desmarca o orçamento como do piloto. */
export function MarcarPiloto({ orcamentoId, piloto }: { orcamentoId: string; piloto: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function mudar() {
    setErro(null);
    setOcupado(true);
    const r = await marcarPiloto(orcamentoId, !piloto);
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    router.refresh();
  }

  return (
    <section
      aria-label="Piloto"
      className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4"
    >
      <p className="text-lg">
        {piloto
          ? "Este orçamento é do piloto: conta nos números e o go-live não o apaga."
          : "Este orçamento não está marcado como do piloto."}
      </p>
      <button
        type="button"
        disabled={ocupado}
        onClick={() => void mudar()}
        className="flex min-h-12 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-lg font-semibold disabled:opacity-60"
      >
        {ocupado ? "Salvando..." : piloto ? "Desmarcar piloto" : "Marcar como piloto"}
      </button>
      {erro ? (
        <p role="alert" className="text-base text-red-700">
          {erro}
        </p>
      ) : null}
    </section>
  );
}
