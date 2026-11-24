"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { marcarPiloto } from "@/app/(app)/orcamentos/acoes-status";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { useToast } from "@/components/ui/Toast";

/** Só gerência e dono: marca ou desmarca o orçamento como do piloto. */
export function MarcarPiloto({ orcamentoId, piloto }: { orcamentoId: string; piloto: boolean }) {
  const router = useRouter();
  const { avisar } = useToast();
  const [ocupado, setOcupado] = useState(false);

  async function mudar() {
    setOcupado(true);
    const r = await marcarPiloto(orcamentoId, !piloto);
    setOcupado(false);
    if (!r.ok) return avisar("erro", r.erro);
    avisar("sucesso", piloto ? "Piloto desmarcado." : "Marcado como piloto.");
    router.refresh();
  }

  return (
    <Cartao aria-label="Piloto" className="space-y-2">
      <p className="text-lg">
        {piloto
          ? "Este orçamento é do piloto: conta nos números e o go-live não o apaga."
          : "Este orçamento não está marcado como do piloto."}
      </p>
      <Botao variante="fantasma" tamanho="compacto" disabled={ocupado} onClick={() => void mudar()}>
        {ocupado ? "Salvando..." : piloto ? "Desmarcar piloto" : "Marcar como piloto"}
      </Botao>
    </Cartao>
  );
}
