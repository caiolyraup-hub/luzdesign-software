import type { HTMLAttributes, ReactNode } from "react";

/**
 * Cartão da marca. `vidro` dá o efeito de vidro (use em painéis e blocos, poucos por tela); em linhas
 * de lista longa não use: a linha fica translúcida e sem blur (ver globals.css).
 */
export function Cartao({
  vidro = false,
  children,
  className = "",
  ...resto
}: { vidro?: boolean; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...resto}
      className={`rounded-xl p-4 ${
        vidro ? "vidro" : "border border-zinc-200 bg-white/90 shadow-sm"
      } ${className}`}
    >
      {children}
    </section>
  );
}
