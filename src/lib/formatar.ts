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
