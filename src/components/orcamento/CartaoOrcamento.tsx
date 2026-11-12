import Link from "next/link";
import { BadgeStatus } from "@/components/BadgeStatus";
import type { StatusOrcamento } from "@/lib/dominio";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";
import { followupDeHoje, type ConfigFollowup } from "@/lib/orcamento/followup";
import { rotuloMotivo } from "@/lib/orcamento/status";
import { avisoValidade } from "@/lib/orcamento/validade";
import { BadgeValidade } from "./BadgeValidade";
import { StatusAcoes } from "./StatusAcoes";

export interface DadosCartao {
  id: string;
  numero: string;
  status: string;
  clienteId?: string;
  clienteNome: string;
  /** Só na visão da gerência. */
  vendedoraNome?: string | null;
  valorTotal: number;
  valorFechado: number | null;
  motivoPerda: string | null;
  atualizadoEm: string;
  geradoEm: string | null;
  /** Envio mais recente: de onde contam os follow-ups. */
  ultimoEnvioEm: string | null;
  /** Validade do orçamento gerado (AAAA-MM-DD). */
  validade?: string | null;
}

/** Cartão de orçamento com o acompanhamento (status e follow-up) a um toque, para vendedora e gerência. */
export function CartaoOrcamento({
  d,
  podeAgir,
  config,
}: {
  d: DadosCartao;
  podeAgir: boolean;
  config?: ConfigFollowup;
}) {
  const devido = followupDeHoje({ status: d.status, ultimoEnvioEm: d.ultimoEnvioEm, config });
  const venc = avisoValidade(d.status, d.validade);
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
          {venc ? <BadgeValidade aviso={venc} /> : null}
          {devido ? (
            <span className="rounded-full bg-amber-200 px-3 py-1 text-base font-semibold text-amber-950">
              {devido.etapa === "ENCERRAR"
                ? "Sem resposta: encerrar?"
                : devido.diasAtraso > 0
                  ? `Follow-up ${devido.etapa} atrasado`
                  : `Follow-up ${devido.etapa} hoje`}
            </span>
          ) : null}
        </span>
      </Link>

      {venc && podeAgir ? (
        <Link
          href={`/orcamentos/${d.id}?renovar=1`}
          className="flex min-h-12 items-center justify-center rounded-lg border border-amber-700 text-lg font-semibold text-amber-800"
        >
          Renovar validade
        </Link>
      ) : null}

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
          geradoEm={d.geradoEm}
          compacto
        />
      ) : null}
    </li>
  );
}
