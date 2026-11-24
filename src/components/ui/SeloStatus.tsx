"use client";

import { useEffect, useRef, useState } from "react";
import { classeStatus, rotuloStatus } from "@/lib/orcamento/status";

/** Ícone que separa Fechado e Perdido também sem a cor (sinal: certo e xis). */
function Icone({ status }: { status: string }) {
  if (status === "fechado")
    return (
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="mr-1 inline size-4 align-[-2px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m3 8.5 3.2 3.2L13 4.8" />
      </svg>
    );
  if (status === "perdido")
    return (
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="mr-1 inline size-4 align-[-2px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="m4 4 8 8M12 4l-8 8" />
      </svg>
    );
  return null;
}

/**
 * Selo de status. Quando o status muda (depois de aberto), o selo dá uma batidinha curta; o Fechado
 * ganha um brilho amarelo discreto. Na primeira exibição não anima (listas não ficam piscando).
 */
export function SeloStatus({ status }: { status: string }) {
  const anterior = useRef(status);
  const [mudou, setMudou] = useState(false);
  useEffect(() => {
    if (anterior.current !== status) {
      anterior.current = status;
      setMudou(true);
      const t = setTimeout(() => setMudou(false), 1300);
      return () => clearTimeout(t);
    }
  }, [status]);
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-base font-medium ${classeStatus(status)} ${
        mudou ? "selo-muda" : ""
      } ${mudou && status === "fechado" ? "selo-brilho" : ""}`}
    >
      <Icone status={status} />
      {rotuloStatus(status)}
    </span>
  );
}
