"use client";

import { useSyncExternalStore } from "react";

const CONSULTA = "(min-width: 768px)";

function assinar(aoMudar: () => void) {
  const m = window.matchMedia(CONSULTA);
  m.addEventListener("change", aoMudar);
  return () => m.removeEventListener("change", aoMudar);
}

/**
 * Prévia do PDF na própria página, só em tela grande. No celular o iframe nem é criado: esconder com
 * CSS não basta (ele continua carregando e alguns navegadores de celular baixam o PDF sozinhos).
 */
export function PreviaPdf({ url, titulo }: { url: string; titulo: string }) {
  const telaGrande = useSyncExternalStore(
    assinar,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  );
  if (!telaGrande) return null;
  return (
    <iframe
      src={url}
      title={titulo}
      className="h-[70vh] w-full rounded-lg border border-zinc-300"
    />
  );
}
