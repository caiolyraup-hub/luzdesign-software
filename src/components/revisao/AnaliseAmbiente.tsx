"use client";

import { useState } from "react";
import { reescreverAnalise } from "@/app/(app)/orcamentos/acoes-ia";
import { MAX_ANALISE } from "@/lib/ia/esquema";

interface Props {
  orcamentoId: string;
  ambiente: string;
  analise: string;
  temItens: boolean;
  /** Mostrar no PDF está ligado? (só muda o aviso). */
  noPdf: boolean;
  onSalvar: (texto: string) => void;
  /** Recebe o texto novo escrito pela IA (já salvo no banco). */
  onReescrita: (texto: string) => void;
}

/** Análise do ambiente para o cliente: editável (com contador) e com "Reescrever análise com IA". */
export function AnaliseAmbiente({
  orcamentoId,
  ambiente,
  analise,
  temItens,
  noPdf,
  onSalvar,
  onReescrita,
}: Props) {
  const [digitado, setDigitado] = useState<string | null>(null);
  const [reescrevendo, setReescrevendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const texto = digitado ?? analise;

  function sair() {
    if (digitado === null) return;
    const novo = digitado;
    setDigitado(null);
    if (novo.trim() !== analise.trim()) onSalvar(novo);
  }

  async function reescrever() {
    setErro(null);
    setReescrevendo(true);
    let r;
    try {
      r = await reescreverAnalise(orcamentoId, ambiente);
    } catch {
      r = {
        ok: false as const,
        erro: "Perdi a conexão com o servidor. Tente de novo.",
        podeTentarDeNovo: true,
      };
    }
    setReescrevendo(false);
    if (!r.ok) return setErro(r.erro);
    setDigitado(null);
    onReescrita(r.analise);
  }

  return (
    <div className="space-y-2 rounded-lg bg-rose-50 p-3">
      <label className="block space-y-1">
        <span className="text-lg font-medium">Análise do ambiente (para o cliente)</span>
        <textarea
          value={texto}
          maxLength={MAX_ANALISE}
          onChange={(e) => setDigitado(e.target.value)}
          onBlur={sair}
          placeholder="Escreva ou peça para a IA. Aparece no PDF abaixo do nome do ambiente."
          aria-label={`Análise do ambiente ${ambiente}`}
          className="min-h-28 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-lg"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-base ${texto.length > MAX_ANALISE * 0.9 ? "text-red-700" : "text-zinc-600"}`}
        >
          {texto.length}/{MAX_ANALISE}
        </span>
        <button
          type="button"
          disabled={!temItens || reescrevendo}
          onClick={() => void reescrever()}
          className="min-h-11 rounded-lg border border-amber-700 bg-white px-3 text-base font-semibold text-amber-800 disabled:opacity-50"
        >
          {reescrevendo ? "Reescrevendo..." : "Reescrever análise com IA"}
        </button>
      </div>
      {!noPdf ? (
        <p className="text-base text-zinc-600">A análise não aparece no PDF (opção desligada).</p>
      ) : null}
      {erro ? (
        <p role="alert" className="text-base text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
