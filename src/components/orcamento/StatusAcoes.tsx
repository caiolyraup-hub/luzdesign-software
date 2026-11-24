"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { marcarEnviado, mudarStatus } from "@/app/(app)/orcamentos/acoes-status";
import type { MotivoPerda, StatusOrcamento } from "@/lib/dominio";
import { hojeMaceioISO } from "@/lib/formatar";
import { dataMaceioISO } from "@/lib/orcamento/followup";
import { acoesDoStatus, LISTA_MOTIVOS, type AcaoStatus } from "@/lib/orcamento/status";

interface Props {
  orcamentoId: string;
  status: StatusOrcamento;
  /** Valor sugerido ao fechar (o total do orçamento). */
  valorTotal: number;
  /** Quando o orçamento foi gerado (o envio não pode ser antes). */
  geradoEm?: string | null;
  /** Primeiro envio já registrado (se vazio em "gerado", fechar ou perder pede a data do envio). */
  enviadoEm?: string | null;
  /** Esconde "Marquei como enviado" (o cartão tem o botão Registrar envio). */
  semEnviado?: boolean;
  /** Versão menor, para cartões de lista. */
  compacto?: boolean;
}

const ESTILOS: Record<AcaoStatus["estilo"], string> = {
  primaria: "bg-primario text-sobre-primario",
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
export function StatusAcoes({
  orcamentoId,
  status,
  valorTotal,
  geradoEm = null,
  enviadoEm = null,
  semEnviado = false,
  compacto = false,
}: Props) {
  const router = useRouter();
  const [aberta, setAberta] = useState<AcaoStatus | null>(null);
  const [valor, setValor] = useState(valorTotal > 0 ? textoBR(valorTotal) : "");
  const [motivo, setMotivo] = useState<MotivoPerda | null>(null);
  const [data, setData] = useState(() => hojeMaceioISO());
  const [ocupado, setOcupado] = useState(false);
  const { avisar } = useToast();

  const acoes = acoesDoStatus(status).filter((a) => !(semEnviado && a.pede === "data"));
  if (acoes.length === 0) return null;
  // Fechar ou perder um orçamento "gerado" sem envio registrado pede antes a data do envio (padrão: hoje).
  const pedeDataEnvio = status === "gerado" && !enviadoEm;

  const tamanho = compacto ? "min-h-11 px-3 text-base" : "min-h-14 px-4 text-lg";

  async function confirmar(acao: AcaoStatus) {
    setOcupado(true);
    const extra: { valorFechado?: number; motivo?: MotivoPerda; dataEnvio?: string } = {};
    if (pedeDataEnvio && (acao.pede === "valor" || acao.pede === "motivo")) {
      if (!data) {
        setOcupado(false);
        return avisar("erro", "Informe a data em que enviou o orçamento ao cliente.");
      }
      extra.dataEnvio = data;
    }
    if (acao.pede === "valor") {
      const n = Number(valor.replace(/\./g, "").replace(",", "."));
      if (!(n > 0)) {
        setOcupado(false);
        return avisar("erro", "Informe o valor da venda.");
      }
      extra.valorFechado = n;
    }
    if (acao.pede === "motivo") {
      if (!motivo) {
        setOcupado(false);
        return avisar("erro", "Escolha o motivo da perda.");
      }
      extra.motivo = motivo;
    }
    if (acao.pede === "data" && !data) {
      setOcupado(false);
      return avisar("erro", "Informe a data do envio.");
    }
    const r =
      acao.pede === "data"
        ? await marcarEnviado(orcamentoId, data)
        : await mudarStatus(orcamentoId, acao.para, extra);
    setOcupado(false);
    if (!r.ok) return avisar("erro", r.erro);
    setAberta(null);
    setMotivo(null);
    avisar("sucesso", "Status atualizado.");
    router.refresh();
  }

  function tocar(acao: AcaoStatus) {
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

      {aberta?.pede === "data" ? (
        <div className="space-y-2 rounded-lg border-2 border-indigo-700 bg-indigo-50 p-4">
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
            <span className="block text-base text-zinc-600">
              Hoje, ou um dia anterior se você já enviou antes. Os follow-ups contam desta data.
            </span>
          </label>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void confirmar(aberta)}
            className="min-h-14 w-full rounded-lg bg-indigo-700 px-4 text-lg font-semibold text-white disabled:opacity-60"
          >
            {ocupado ? "Salvando..." : "Confirmar envio"}
          </button>
        </div>
      ) : null}

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
          {pedeDataEnvio ? (
            <label className="block space-y-1">
              <span className="text-lg font-medium">Quando você enviou para o cliente?</span>
              <input
                type="date"
                value={data}
                max={hojeMaceioISO()}
                min={geradoEm ? dataMaceioISO(geradoEm) : undefined}
                onChange={(e) => setData(e.target.value)}
                className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg"
              />
              <span className="block text-base text-zinc-600">
                O envio ainda não estava registrado. Hoje, ou o dia em que mandou.
              </span>
            </label>
          ) : null}
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
          {pedeDataEnvio ? (
            <label className="block space-y-1">
              <span className="text-lg font-medium">Quando você enviou para o cliente?</span>
              <input
                type="date"
                value={data}
                max={hojeMaceioISO()}
                min={geradoEm ? dataMaceioISO(geradoEm) : undefined}
                onChange={(e) => setData(e.target.value)}
                className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg"
              />
              <span className="block text-base text-zinc-600">
                O envio ainda não estava registrado. Hoje, ou o dia em que mandou.
              </span>
            </label>
          ) : null}
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
    </div>
  );
}
