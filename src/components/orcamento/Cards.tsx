"use client";

import type { Opcao } from "@/lib/orcamento/perguntas";

const base =
  "flex min-h-14 w-full flex-col items-start justify-center rounded-lg border-2 px-4 py-3 text-left text-lg";
const marcado = "border-amber-700 bg-amber-50 font-semibold";
const normal = "border-zinc-300 bg-white";

interface UnicoProps {
  nome: string;
  opcoes: Opcao[];
  valor: string | undefined;
  onChange: (valor: string) => void;
  colunas?: 1 | 2;
}

/** Escolha única em cards de tocar (no lugar de <select>). */
export function CardsUnico({ nome, opcoes, valor, onChange, colunas = 1 }: UnicoProps) {
  return (
    <div
      role="radiogroup"
      aria-label={nome}
      className={`grid gap-3 ${colunas === 2 ? "grid-cols-2" : "grid-cols-1"}`}
    >
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => onChange(o.valor)}
          className={`${base} ${valor === o.valor ? marcado : normal}`}
        >
          {o.rotulo}
          {o.dica ? <span className="text-base font-normal text-zinc-600">{o.dica}</span> : null}
        </button>
      ))}
    </div>
  );
}

interface MultiploProps {
  nome: string;
  opcoes: Opcao[];
  valores: string[];
  onChange: (valores: string[]) => void;
}

/** Múltipla escolha em cards (2 colunas). */
export function CardsMultiplo({ nome, opcoes, valores, onChange }: MultiploProps) {
  function alternar(valor: string) {
    onChange(valores.includes(valor) ? valores.filter((v) => v !== valor) : [...valores, valor]);
  }
  return (
    <div role="group" aria-label={nome} className="grid grid-cols-2 gap-3">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valores.includes(o.valor)}
          onClick={() => alternar(o.valor)}
          className={`${base} ${valores.includes(o.valor) ? marcado : normal}`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
