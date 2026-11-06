const dataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Maceio",
});

const moedaBR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "05/11, 14:32" no fuso de Maceió. */
export function formatarDataHora(iso: string): string {
  return dataHora.format(new Date(iso));
}

export function formatarMoeda(valor: number): string {
  return moedaBR.format(valor);
}

const dataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Maceio",
});

/** Data de hoje em Maceió, no formato AAAA-MM-DD. */
export function hojeMaceioISO(agora: Date = new Date()): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/Maceio",
    })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** Soma dias a uma data AAAA-MM-DD (sem fuso: é só calendário). */
export function adicionarDiasISO(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** AAAA-MM-DD -> DD/MM/AAAA. */
export function isoParaBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Instante (ISO com hora) -> DD/MM/AAAA no fuso de Maceió. */
export function formatarDataBR(instante: string | Date): string {
  return dataBR.format(new Date(instante));
}
