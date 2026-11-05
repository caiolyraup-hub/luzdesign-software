"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { montarComIA } from "@/app/(app)/orcamentos/acoes-ia";

const ETAPAS = [
  "Lendo o pedido",
  "Olhando as fotos e arquivos",
  "Procurando no catálogo",
  "Montando por ambiente",
  "Conferindo códigos e quantidades",
  "Calculando os valores",
];
const INTERVALO_ETAPA_MS = 7000;

interface Props {
  orcamentoId: string;
  /** Texto do botão, por exemplo "Montar orçamento com IA" ou "Montar de novo". */
  rotulo: string;
  desabilitado?: boolean;
  /** Linha abaixo do botão (por exemplo, quantas tentativas restam). */
  dica?: string;
  secundario?: boolean;
}

export function MontarComIA({ orcamentoId, rotulo, desabilitado, dica, secundario }: Props) {
  const router = useRouter();
  const [montando, setMontando] = useState(false);
  const [etapa, setEtapa] = useState(0);
  const [erro, setErro] = useState<{ texto: string; podeTentarDeNovo: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function montar() {
    setErro(null);
    setEtapa(0);
    setMontando(true);
    timer.current = setInterval(
      () => setEtapa((e) => Math.min(e + 1, ETAPAS.length - 1)),
      INTERVALO_ETAPA_MS,
    );

    let r;
    try {
      r = await montarComIA(orcamentoId);
    } catch {
      r = {
        ok: false as const,
        erro: "Perdi a conexão com o servidor. Tente de novo.",
        podeTentarDeNovo: true,
      };
    }
    if (timer.current) clearInterval(timer.current);
    setMontando(false);

    if (!r.ok) return setErro({ texto: r.erro, podeTentarDeNovo: r.podeTentarDeNovo });
    router.push(`/orcamentos/${orcamentoId}/itens`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={montar}
        disabled={desabilitado || montando}
        className={`min-h-14 w-full rounded-lg px-5 text-lg font-semibold disabled:opacity-50 ${
          secundario ? "border border-zinc-300 bg-white" : "bg-amber-700 text-white"
        }`}
      >
        {rotulo}
      </button>
      {dica ? <p className="text-center text-lg text-zinc-600">{dica}</p> : null}

      {erro ? (
        <div role="alert" className="space-y-3 rounded-lg border-2 border-red-700 bg-red-50 p-4">
          <p className="text-lg">{erro.texto}</p>
          {erro.podeTentarDeNovo ? (
            <button
              type="button"
              onClick={montar}
              className="min-h-14 w-full rounded-lg bg-red-700 px-5 text-lg font-semibold text-white"
            >
              Tentar de novo
            </button>
          ) : null}
        </div>
      ) : null}

      {montando ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-white px-6 text-center"
        >
          <span
            aria-hidden="true"
            className="size-14 animate-spin rounded-full border-4 border-zinc-200 border-t-amber-700"
          />
          <p className="text-2xl font-semibold">{ETAPAS[etapa]}...</p>
          <p className="text-lg text-zinc-600">
            A IA está montando o orçamento. Pode levar até 2 minutos. Não feche esta tela.
          </p>
        </div>
      ) : null}
    </div>
  );
}
