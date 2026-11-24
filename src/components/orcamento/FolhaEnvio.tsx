"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { marcarEnviado } from "@/app/(app)/orcamentos/acoes-status";
import { hojeMaceioISO } from "@/lib/formatar";
import { dataDeEnvioValida } from "@/lib/orcamento/envio";
import { dataMaceioISO } from "@/lib/orcamento/followup";

interface Props {
  orcamentoId: string;
  /** Quando foi gerado (o envio não pode ser antes). */
  geradoEm: string | null;
  aberta: boolean;
  onFechar: () => void;
}

/**
 * Folha curta (sobe de baixo no celular): "Você já mandou para o cliente?". "Enviei agora" grava com a
 * hora atual; "Enviei em outra data" pede a data (não futura, não antes de gerado); "Ainda não" só fecha.
 */
export function FolhaEnvio({ orcamentoId, geradoEm, aberta, onFechar }: Props) {
  const router = useRouter();
  const [outraData, setOutraData] = useState(false);
  const [data, setData] = useState(() => hojeMaceioISO());
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberta, onFechar]);

  if (!aberta) return null;

  async function gravar(valor?: string) {
    setErro(null);
    if (valor !== undefined) {
      const v = dataDeEnvioValida(valor, { geradoEm });
      if (!v.ok)
        return setErro(
          v.motivo === "futura"
            ? "A data do envio não pode ser no futuro."
            : v.motivo === "antes_de_gerado"
              ? "A data do envio não pode ser antes de o orçamento ser gerado."
              : "Informe a data do envio.",
        );
    }
    setOcupado(true);
    const r = await marcarEnviado(orcamentoId, valor);
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    setOutraData(false);
    onFechar();
    router.refresh();
  }

  const botao =
    "flex min-h-14 w-full items-center justify-center rounded-lg px-4 text-lg font-semibold";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Fechar"
        tabIndex={-1}
        onClick={onFechar}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-folha-envio"
        className="relative w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 pb-8 shadow-xl sm:rounded-2xl"
      >
        <h2 id="titulo-folha-envio" className="text-xl font-semibold">
          Você já mandou para o cliente?
        </h2>
        <p className="text-base text-zinc-600">
          Registrar o envio mantém os follow-ups e os números certos.
        </p>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void gravar()}
          className={`${botao} bg-amber-700 text-white disabled:opacity-60`}
        >
          {ocupado && !outraData ? "Salvando..." : "Enviei agora"}
        </button>
        {outraData ? (
          <div className="space-y-2 rounded-lg border-2 border-indigo-700 bg-indigo-50 p-3">
            <label className="block space-y-1">
              <span className="text-lg font-medium">Data do envio</span>
              <input
                type="date"
                value={data}
                max={hojeMaceioISO()}
                min={geradoEm ? dataMaceioISO(geradoEm) : undefined}
                onChange={(e) => setData(e.target.value)}
                className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg"
              />
            </label>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void gravar(data)}
              className={`${botao} bg-indigo-700 text-white disabled:opacity-60`}
            >
              {ocupado ? "Salvando..." : "Confirmar envio"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOutraData(true)}
            className={`${botao} border border-amber-700 bg-white text-amber-800`}
          >
            Enviei em outra data
          </button>
        )}
        <button
          type="button"
          onClick={onFechar}
          className={`${botao} border border-zinc-300 bg-white text-zinc-700`}
        >
          Ainda não
        </button>
        {erro ? (
          <p role="alert" className="text-lg text-red-700">
            {erro}
          </p>
        ) : null}
      </div>
    </div>
  );
}
