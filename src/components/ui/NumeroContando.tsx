"use client";

import { useEffect, useRef, useState } from "react";
import { formatarMoeda } from "@/lib/formatar";

export type TipoNumero = "moeda" | "porcentagem" | "inteiro";

function formatar(tipo: TipoNumero, n: number): string {
  if (tipo === "moeda") return formatarMoeda(n);
  if (tipo === "porcentagem") return `${String(Math.round(n * 1000) / 10).replace(".", ",")}%`;
  return String(Math.round(n));
}

/** Número dos painéis que conta até o valor na primeira vez (sem movimento se o usuário pedir menos). */
export function NumeroContando({
  valor,
  tipo = "inteiro",
  className = "",
}: {
  valor: number;
  tipo?: TipoNumero;
  className?: string;
}) {
  const [atual, setAtual] = useState(valor);
  const feito = useRef(false);

  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !Number.isFinite(valor))
      return;
    const inicio = performance.now();
    const duracao = 600;
    let quadro = 0;
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      setAtual(valor * (1 - Math.pow(1 - t, 3)));
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [valor]);

  return <span className={`numero ${className}`}>{formatar(tipo, atual)}</span>;
}
