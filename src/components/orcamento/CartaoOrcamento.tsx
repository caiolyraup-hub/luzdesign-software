import Link from "next/link";
import { BadgeStatus } from "@/components/BadgeStatus";
import type { StatusOrcamento } from "@/lib/dominio";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";
import { followupDevido, rotuloMotivo } from "@/lib/orcamento/status";
import { StatusAcoes } from "./StatusAcoes";

export interface DadosCartao {
  id: string;
  numero: string;
  status: string;
  clienteNome: string;
  /** Só na visão da gerência. */
  vendedoraNome?: string | null;
  valorTotal: number;
  valorFechado: number | null;
  motivoPerda: string | null;
  atualizadoEm: string;
  enviadoEm: string | null;
  statusEm: string | null;
}

/** Cartão de orçamento com o acompanhamento (status e follow-up) a um toque, para vendedora e gerência. */
export function CartaoOrcamento({ d, podeAgir }: { d: DadosCartao; podeAgir: boolean }) {
  const devido = followupDevido({ status: d.status, enviadoEm: d.enviadoEm, statusEm: d.statusEm });
  const valor = d.status === "fechado" && d.valorFechado ? d.valorFechado : d.valorTotal;

  return (
    <li className="space-y-3 rounded-lg border border-zinc-200 p-4">
      <Link
        href={
          d.status === "rascunho" && podeAgir ? `/orcamentos/${d.id}/editar` : `/orcamentos/${d.id}`
        }
        className="block space-y-1"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-lg font-medium">{d.clienteNome}</span>
          {valor > 0 ? (
            <span className="shrink-0 text-lg font-semibold">{formatarMoeda(valor)}</span>
          ) : null}
        </span>
        <span className="block text-base text-zinc-600">
          {d.numero}
          {d.vendedoraNome ? ` · ${d.vendedoraNome}` : ""} · {formatarDataHora(d.atualizadoEm)}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <BadgeStatus status={d.status} />
          {d.status === "perdido" && d.motivoPerda ? (
            <span className="text-base text-zinc-700">{rotuloMotivo(d.motivoPerda)}</span>
          ) : null}
          {devido ? (
            <span className="rounded-full bg-amber-200 px-3 py-1 text-base font-semibold text-amber-950">
              {devido.atrasado
                ? `Follow-up ${devido.etapa} atrasado`
                : `Follow-up ${devido.etapa} hoje`}
            </span>
          ) : null}
        </span>
      </Link>

      {d.status === "rascunho" ? (
        podeAgir ? (
          <Link
            href={`/orcamentos/${d.id}/editar`}
            className="flex min-h-12 items-center justify-center rounded-lg bg-amber-700 text-lg font-semibold text-white"
          >
            Continuar
          </Link>
        ) : null
      ) : podeAgir ? (
        <StatusAcoes
          orcamentoId={d.id}
          status={d.status as StatusOrcamento}
          valorTotal={d.valorTotal}
          compacto
        />
      ) : null}
    </li>
  );
}
