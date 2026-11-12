import { hojeMaceioISO } from "../formatar";
import { diasEntreDatas } from "./followup";

/**
 * Validade vencida: UMA regra, usada em todo lugar (lista, cartão, Para hoje, tela do orçamento, gerência).
 * A mesma regra está em SQL: `orcamento_dias_para_vencer` (a migration 20261112000100); há um teste
 * que confere que as duas concordam.
 *
 * Vencido não é um status: é `validade < hoje` (calendário de Maceió) em orçamento gerado, enviado ou em
 * follow-up. Rascunho, fechado e perdido nunca vencem, e sem validade também não.
 */
export const STATUS_QUE_VENCEM = ["gerado", "enviado", "followup_d5", "followup_d10"] as const;

/** Dias até vencer: 0 = vence hoje, 1 = amanhã, negativo = vencido há N dias; nulo = não vence. */
export function diasParaVencer(
  status: string,
  validade: string | null | undefined,
  hoje: string = hojeMaceioISO(),
): number | null {
  if (!validade || !(STATUS_QUE_VENCEM as readonly string[]).includes(status)) return null;
  return diasEntreDatas(hoje, validade.slice(0, 10));
}

export const estaVencido = (status: string, validade: string | null | undefined, hoje?: string) => {
  const d = diasParaVencer(status, validade, hoje);
  return d !== null && d < 0;
};

/** Já vencido ou vence hoje ou amanhã: entra em "Para renovar". */
export const precisaRenovar = (
  status: string,
  validade: string | null | undefined,
  hoje?: string,
) => {
  const d = diasParaVencer(status, validade, hoje);
  return d !== null && d <= 1;
};

export interface AvisoValidade {
  /** vencido (rosa) ou vence_hoje / vence_amanha (âmbar). */
  tipo: "vencido" | "vence_hoje" | "vence_amanha";
  texto: string;
  dias: number;
}

/** Etiqueta da validade: "Vencido há 3 dias", "Vence hoje", "Vence amanhã"; nulo se está folgado. */
export function avisoValidade(
  status: string,
  validade: string | null | undefined,
  hoje?: string,
): AvisoValidade | null {
  const d = diasParaVencer(status, validade, hoje);
  if (d === null || d > 1) return null;
  if (d === 1) return { tipo: "vence_amanha", texto: "Vence amanhã", dias: d };
  if (d === 0) return { tipo: "vence_hoje", texto: "Vence hoje", dias: d };
  const n = -d;
  return { tipo: "vencido", texto: `Vencido há ${n} ${n === 1 ? "dia" : "dias"}`, dias: d };
}
