"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { alterarStatusRelato } from "@/app/(app)/relatos/acoes";

export function AcoesRelato({ id, status }: { id: string; status: "aberto" | "resolvido" }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          setErro(null);
          try {
            const r = await alterarStatusRelato(id, status === "aberto" ? "resolvido" : "aberto");
            if (!r.ok) setErro(r.erro);
            else router.refresh();
          } catch {
            setErro("Sem internet. Tente de novo.");
          }
          setOcupado(false);
        }}
        className="min-h-11 rounded-lg border border-zinc-300 px-4 text-lg disabled:opacity-60"
      >
        {status === "aberto" ? "Marcar como resolvido" : "Reabrir"}
      </button>
      {erro ? (
        <p role="alert" className="text-base text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
