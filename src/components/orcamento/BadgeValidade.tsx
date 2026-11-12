import type { AvisoValidade } from "@/lib/orcamento/validade";

/** Etiqueta da validade: rosa para vencido, âmbar para "vence hoje" e "vence amanhã". */
export function BadgeValidade({ aviso }: { aviso: AvisoValidade }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-base font-semibold ${
        aviso.tipo === "vencido" ? "bg-rose-100 text-rose-900" : "bg-amber-100 text-amber-900"
      }`}
    >
      {aviso.texto}
    </span>
  );
}
