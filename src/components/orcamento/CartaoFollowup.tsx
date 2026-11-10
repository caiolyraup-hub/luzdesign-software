"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { mudarStatus, registrarFollowup } from "@/app/(app)/orcamentos/acoes-status";
import type { EtapaFollowup } from "@/lib/orcamento/followup";
import { formatarMoeda } from "@/lib/formatar";

export interface DadosFollowup {
  id: string;
  numero: string;
  clienteNome: string;
  valorTotal: number;
  etapa: EtapaFollowup;
  /** "vence hoje" ou "atrasado N dias". */
  prazo: string;
  atrasado: boolean;
  sugerirPerdido: boolean;
  /** Link wa.me com a mensagem da etapa já preenchida. */
  linkWhatsapp: string;
}

/**
 * Cartão de "Follow-ups de hoje": cliente, número, valor, etapa e prazo, com Abrir WhatsApp (mensagem
 * pronta) e Fiz o follow-up, ambos a um toque. Depois do D+10 sem resposta, sugere encerrar.
 */
export function CartaoFollowup({ d }: { d: DadosFollowup }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoPerda, setConfirmandoPerda] = useState(false);

  async function fiz() {
    setErro(null);
    setOcupado(true);
    const r = await registrarFollowup(d.id);
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    router.refresh();
  }

  async function perdido() {
    setErro(null);
    setOcupado(true);
    const r = await mudarStatus(d.id, "perdido", { motivo: "sem_resposta" });
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    router.refresh();
  }

  const botao = "flex min-h-12 items-center justify-center rounded-lg px-4 text-lg font-semibold";

  return (
    <li className="space-y-3 rounded-lg border-2 border-amber-700 bg-amber-50 p-4">
      <Link href={`/orcamentos/${d.id}`} className="block space-y-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-lg font-medium">{d.clienteNome}</span>
          {d.valorTotal > 0 ? (
            <span className="shrink-0 text-lg font-semibold">{formatarMoeda(d.valorTotal)}</span>
          ) : null}
        </span>
        <span className="block text-base text-zinc-700">{d.numero}</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-amber-200 px-3 py-1 text-base font-semibold text-amber-950">
            {d.etapa === "ENCERRAR" ? "Sem resposta" : `Follow-up ${d.etapa}`}
          </span>
          <span
            className={`text-base font-medium ${d.atrasado ? "text-red-800" : "text-amber-900"}`}
          >
            {d.prazo}
          </span>
        </span>
      </Link>

      {d.etapa !== "ENCERRAR" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <a
            href={d.linkWhatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={`${botao} border-2 border-emerald-700 bg-white text-emerald-800`}
          >
            Abrir WhatsApp
          </a>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void fiz()}
            className={`${botao} bg-amber-700 text-white disabled:opacity-60`}
          >
            {ocupado ? "Salvando..." : "Fiz o follow-up"}
          </button>
        </div>
      ) : (
        <p className="text-base text-zinc-700">
          Já fez o último follow-up e não houve resposta. Se não vai mais acontecer, encerre.
        </p>
      )}

      {d.sugerirPerdido ? (
        confirmandoPerda ? (
          <div className="space-y-2 rounded-lg border-2 border-red-700 bg-red-50 p-3">
            <p className="text-base font-medium">
              Marcar como perdido? O motivo será “Sem resposta”.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoPerda(false)}
                className={`${botao} flex-1 border border-zinc-300 bg-white`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void perdido()}
                className={`${botao} flex-[2] bg-red-700 text-white disabled:opacity-60`}
              >
                Confirmar perda
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmandoPerda(true)}
            className={`${botao} w-full border border-red-700 bg-white text-red-800`}
          >
            Marcar como perdido (sem resposta)
          </button>
        )
      ) : null}

      {erro ? (
        <p role="alert" className="text-base text-red-700">
          {erro}
        </p>
      ) : null}
    </li>
  );
}
