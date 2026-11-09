"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { mudarStatus } from "@/app/(app)/orcamentos/acoes-status";
import type { MotivoPerda, StatusOrcamento } from "@/lib/dominio";
import { acoesDoStatus, LISTA_MOTIVOS, type AcaoStatus } from "@/lib/orcamento/status";

interface Props {
  orcamentoId: string;
  status: StatusOrcamento;
  /** Valor sugerido ao fechar (o total do orçamento). */
  valorTotal: number;
  /** Versão menor, para cartões de lista. */
  compacto?: boolean;
}

const ESTILOS: Record<AcaoStatus["estilo"], string> = {
  primaria: "bg-amber-700 text-white",
  secundaria: "border border-amber-700 bg-white text-amber-800",
  sucesso: "bg-emerald-700 text-white",
  perigo: "border border-red-700 bg-white text-red-800",
  discreta: "border border-zinc-300 bg-white text-zinc-700",
};

const textoBR = (n: number) => String(n).replace(".", ",");

/**
 * Botões do acompanhamento: um toque para enviado e follow-ups; "Fechou" pede o valor da venda e
 * "Perdeu" pede o motivo (os dois com um toque de confirmação). Serve à vendedora e à gerência.
 */
export function StatusAcoes({ orcamentoId, status, valorTotal, compacto = false }: Props) {
  const router = useRouter();
  const [aberta, setAberta] = useState<AcaoStatus | null>(null);
  const [valor, setValor] = useState(valorTotal > 0 ? textoBR(valorTotal) : "");
  const [motivo, setMotivo] = useState<MotivoPerda | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const acoes = acoesDoStatus(status);
  if (acoes.length === 0) return null;

  const tamanho = compacto ? "min-h-11 px-3 text-base" : "min-h-14 px-4 text-lg";

  async function confirmar(acao: AcaoStatus) {
    setErro(null);
    setOcupado(true);
    const extra: { valorFechado?: number; motivo?: MotivoPerda } = {};
    if (acao.pede === "valor") {
      const n = Number(valor.replace(/\./g, "").replace(",", "."));
      if (!(n > 0)) {
        setOcupado(false);
        return setErro("Informe o valor da venda.");
      }
      extra.valorFechado = n;
    }
    if (acao.pede === "motivo") {
      if (!motivo) {
        setOcupado(false);
        return setErro("Escolha o motivo da perda.");
      }
      extra.motivo = motivo;
    }
    const r = await mudarStatus(orcamentoId, acao.para, extra);
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    setAberta(null);
    setMotivo(null);
    setFeito(acao.rotulo);
    router.refresh();
  }

  function tocar(acao: AcaoStatus) {
    setFeito(null);
    setErro(null);
    if (acao.pede) setAberta(aberta?.para === acao.para ? null : acao);
    else void confirmar(acao);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {acoes.map((a) => (
          <button
            key={a.para}
            type="button"
            disabled={ocupado}
            onClick={() => tocar(a)}
            aria-pressed={aberta?.para === a.para}
            className={`${tamanho} rounded-lg font-semibold disabled:opacity-60 ${ESTILOS[a.estilo]} ${
              compacto || a.estilo === "discreta" ? "" : "w-full sm:w-auto"
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {aberta?.pede === "valor" ? (
        <div className="space-y-2 rounded-lg border-2 border-emerald-700 bg-emerald-50 p-4">
          <label className="block space-y-1">
            <span className="text-lg font-medium">Valor da venda (R$)</span>
            <input
              type="text"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg"
            />
            <span className="block text-base text-zinc-600">
              Já vem com o total do orçamento; ajuste se negociou outro valor.
            </span>
          </label>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void confirmar(aberta)}
            className="min-h-14 w-full rounded-lg bg-emerald-700 px-4 text-lg font-semibold text-white disabled:opacity-60"
          >
            {ocupado ? "Salvando..." : "Confirmar venda"}
          </button>
        </div>
      ) : null}

      {aberta?.pede === "motivo" ? (
        <div className="space-y-2 rounded-lg border-2 border-red-700 bg-red-50 p-4">
          <p className="text-lg font-medium">Por que perdeu?</p>
          <div
            role="radiogroup"
            aria-label="Motivo da perda"
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {LISTA_MOTIVOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                role="radio"
                aria-checked={motivo === m.valor}
                onClick={() => setMotivo(m.valor)}
                className={`min-h-12 rounded-lg border-2 px-3 text-left text-lg ${
                  motivo === m.valor
                    ? "border-red-700 bg-white font-semibold"
                    : "border-zinc-300 bg-white"
                }`}
              >
                {m.rotulo}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={ocupado || !motivo}
            onClick={() => void confirmar(aberta)}
            className="min-h-14 w-full rounded-lg bg-red-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
          >
            {ocupado ? "Salvando..." : "Confirmar perda"}
          </button>
        </div>
      ) : null}

      {erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}
      {feito ? (
        <p role="status" className="text-base text-emerald-800">
          Status atualizado.
        </p>
      ) : null}
    </div>
  );
}
