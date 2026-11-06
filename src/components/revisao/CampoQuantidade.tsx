"use client";

import { useState } from "react";
import { normalizarQuantidade } from "@/lib/orcamento/itens";

interface Props {
  valor: number;
  unidade: "un" | "m";
  avulso: boolean;
  /** Chamado com a quantidade já normalizada. */
  onMudar: (quantidade: number) => void;
  rotulo: string;
}

const textoBR = (n: number) => String(n).replace(".", ",");

/** − [campo] + . Metro aceita decimais ("8,5"); unidade, só inteiros. Confirma ao sair do campo ou no Enter. */
export function CampoQuantidade({ valor, unidade, avulso, onMudar, rotulo }: Props) {
  const [digitado, setDigitado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const passo = unidade === "m" ? 0.5 : 1;

  function aplicar(n: number) {
    const q = normalizarQuantidade(unidade, n, avulso);
    if (!q.ok) return setAviso(q.erro);
    setAviso(null);
    if (q.valor !== valor) onMudar(q.valor);
  }

  function confirmar() {
    if (digitado === null) return;
    const n = Number(digitado.replace(",", "."));
    setDigitado(null);
    if (digitado.trim() === "" || Number.isNaN(n)) return setAviso("Digite um número.");
    aplicar(n);
  }

  const botao =
    "flex size-12 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-2xl";
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Diminuir ${rotulo}`}
          disabled={valor - passo <= 0}
          onClick={() => aplicar(valor - passo)}
          className={`${botao} disabled:opacity-40`}
        >
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`Quantidade de ${rotulo}`}
          value={digitado ?? textoBR(valor)}
          onChange={(e) => setDigitado(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="min-h-12 w-20 rounded-lg border border-zinc-300 text-center text-lg"
        />
        <button
          type="button"
          aria-label={`Aumentar ${rotulo}`}
          onClick={() => aplicar(valor + passo)}
          className={botao}
        >
          +
        </button>
        <span className="text-lg text-zinc-600">{unidade}</span>
      </div>
      {aviso ? (
        <p role="alert" className="pt-1 text-base text-red-700">
          {aviso}
        </p>
      ) : null}
    </div>
  );
}
