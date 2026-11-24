import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type VarianteBotao = "principal" | "secundario" | "perigo" | "fantasma";

const VARIANTES: Record<VarianteBotao, string> = {
  principal: "bg-primario text-sobre-primario",
  secundario: "border border-amber-700 bg-white text-amber-800",
  perigo: "border border-red-700 bg-white text-red-800",
  fantasma: "border border-zinc-300 bg-white text-zinc-700",
};

const TAMANHOS = {
  normal: "min-h-14 px-4 text-lg",
  compacto: "min-h-11 px-3 text-base",
} as const;

interface BaseProps {
  variante?: VarianteBotao;
  tamanho?: keyof typeof TAMANHOS;
  /** Ocupa a largura toda (padrão no celular). */
  cheio?: boolean;
  children: ReactNode;
}

function classes({ variante = "principal", tamanho = "normal", cheio = true }: BaseProps) {
  return `inline-flex items-center justify-center rounded-lg font-semibold disabled:opacity-60 ${
    VARIANTES[variante]
  } ${TAMANHOS[tamanho]} ${cheio ? "w-full" : ""}`;
}

/** Botão da marca. Alvo de toque de 44 px no mínimo. */
export function Botao({
  variante,
  tamanho,
  cheio,
  children,
  className = "",
  ...resto
}: BaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...resto}
      className={`${classes({ variante, tamanho, cheio, children })} ${className}`}
    >
      {children}
    </button>
  );
}

/** O mesmo botão, como link. */
export function BotaoLink({
  href,
  variante,
  tamanho,
  cheio,
  children,
}: BaseProps & { href: string }) {
  return (
    <Link href={href} className={classes({ variante, tamanho, cheio, children })}>
      {children}
    </Link>
  );
}
