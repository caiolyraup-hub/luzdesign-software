import {
  proximoContato,
  textoProximoContato,
  type EntradaFollowup,
} from "@/lib/orcamento/followup";

/** Lembrete do próximo contato do orçamento; destacado quando é hoje ou está atrasado. */
export function LinhaProximoContato(props: Omit<EntradaFollowup, "agora">) {
  const p = proximoContato(props);
  if (!p) return null;
  return (
    <span
      className={`block text-base ${p.diasAtraso >= 0 ? "font-semibold text-amber-800" : "text-zinc-600"}`}
    >
      {textoProximoContato(p)}
    </span>
  );
}
