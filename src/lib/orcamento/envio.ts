import { dataMaceioISO } from "./followup";

const dm = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Maceio",
});
const hm = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Maceio",
});

/** "24/11" ou, quando foi hoje, "24/11 às 14:30". */
export function dataDoEnvio(instante: string | Date, agora: Date = new Date()): string {
  const d = new Date(instante);
  const base = dm.format(d);
  return dataMaceioISO(d) === dataMaceioISO(agora) ? `${base} às ${hm.format(d)}` : base;
}

/**
 * Texto do envio para cartões e fichas: "Enviado em 24/11" (primeiro envio) e, se o último envio foi
 * em outro dia, "último envio 26/11". Sem envio registrado devolve null.
 */
export function textoEnvio(
  e: { enviadoEm?: string | null; ultimoEnvioEm?: string | null },
  agora: Date = new Date(),
): string | null {
  const primeiro = e.enviadoEm ?? e.ultimoEnvioEm;
  if (!primeiro) return null;
  const partes = [`Enviado em ${dataDoEnvio(primeiro, agora)}`];
  const ultimo = e.ultimoEnvioEm;
  if (ultimo && dataMaceioISO(ultimo) !== dataMaceioISO(primeiro))
    partes.push(`último envio ${dataDoEnvio(ultimo, agora)}`);
  return partes.join(" · ");
}

/** Orçamento gerado que ainda não tem envio registrado (o selo "Envio não registrado"). */
export function envioNaoRegistrado(o: { status: string; enviadoEm?: string | null }): boolean {
  return o.status === "gerado" && !o.enviadoEm;
}

/** Gerado há mais de 1 dia (24 h) e sem envio registrado: entra em "Registrar envio" de Para hoje. */
export function precisaRegistrarEnvio(
  o: { status: string; geradoEm: string | null; enviadoEm?: string | null },
  agora: Date = new Date(),
): boolean {
  if (!envioNaoRegistrado(o) || !o.geradoEm) return false;
  return agora.getTime() - new Date(o.geradoEm).getTime() > 24 * 3_600_000;
}

/** A data do envio é válida? Não futura e não antes de o orçamento ser gerado (mesma regra do banco). */
export function dataDeEnvioValida(
  data: string,
  opcoes: { geradoEm?: string | null; agora?: Date },
): { ok: true } | { ok: false; motivo: "futura" | "antes_de_gerado" | "invalida" } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data)))
    return { ok: false, motivo: "invalida" };
  const hoje = dataMaceioISO(opcoes.agora ?? new Date());
  if (data > hoje) return { ok: false, motivo: "futura" };
  if (opcoes.geradoEm && data < dataMaceioISO(opcoes.geradoEm))
    return { ok: false, motivo: "antes_de_gerado" };
  return { ok: true };
}
