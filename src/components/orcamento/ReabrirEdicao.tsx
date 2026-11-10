"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reabrirParaEdicao } from "@/app/(app)/orcamentos/acoes-status";

/**
 * "Editar e enviar nova versão": volta o orçamento para gerado (sem apagar as datas de envio),
 * libera a edição dos produtos e leva para a tela de produtos. Só a dona vê.
 */
export function ReabrirEdicao({ orcamentoId }: { orcamentoId: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function reabrir() {
    setErro(null);
    setOcupado(true);
    const r = await reabrirParaEdicao(orcamentoId);
    if (!r.ok) {
      setOcupado(false);
      return setErro(r.erro);
    }
    router.push(`/orcamentos/${orcamentoId}/revisao`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => void reabrir()}
        className="flex min-h-14 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-lg font-semibold disabled:opacity-60"
      >
        {ocupado ? "Abrindo..." : "Editar e enviar nova versão"}
      </button>
      {erro ? (
        <p role="alert" className="text-base text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
