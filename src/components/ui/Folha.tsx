"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Folha: sobe de baixo no celular e abre com escala no computador. Fecha com Esc ou tocando fora; o foco
 * vai para dentro ao abrir e volta ao botão que abriu ao fechar.
 */
export function Folha({
  aberta,
  onFechar,
  titulo,
  children,
}: {
  aberta: boolean;
  onFechar: () => void;
  titulo: string;
  children: ReactNode;
}) {
  const id = useId();
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberta) return;
    const anterior = document.activeElement as HTMLElement | null;
    painel.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      anterior?.focus?.();
    };
  }, [aberta, onFechar]);

  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Fechar"
        tabIndex={-1}
        onClick={onFechar}
        className="fundo-entra bg-marrom/40 absolute inset-0"
      />
      <div
        ref={painel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="folha-entra vidro-forte relative w-full max-w-md space-y-3 rounded-t-2xl p-5 pb-8 outline-none sm:rounded-2xl"
      >
        <h2 id={id} className="text-xl font-semibold">
          {titulo}
        </h2>
        {children}
      </div>
    </div>
  );
}
