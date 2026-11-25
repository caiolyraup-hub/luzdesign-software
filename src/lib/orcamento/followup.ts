import { adicionarDiasISO, hojeMaceioISO } from "../formatar";

/**
 * Follow-up D+5 e D+10, contados em dias corridos a partir do ÚLTIMO envio (ultimo_envio_em), no
 * calendário de Maceió (a virada do dia é à meia-noite de Maceió, não de Londres). Calculado na
 * leitura: não há cron.
 */

export interface ConfigFollowup {
  d5Dias: number;
  d10Dias: number;
}

export const CONFIG_FOLLOWUP_PADRAO: ConfigFollowup = { d5Dias: 5, d10Dias: 10 };

/** Dias depois do D+10 vencido em que sugerimos encerrar como perdido (sem resposta). */
export const DIAS_PARA_SUGERIR_PERDIDO = 5;

export type EtapaFollowup = "D+5" | "D+10" | "ENCERRAR";

export interface FollowupDeHoje {
  etapa: EtapaFollowup;
  /** Dia em que venceu (AAAA-MM-DD, Maceió). */
  venceEm: string;
  /** 0 = vence hoje; 3 = venceu há 3 dias. */
  diasAtraso: number;
  /** Já dá para sugerir "Marcar como perdido (sem resposta)". */
  sugerirPerdido: boolean;
}

export interface EntradaFollowup {
  status: string;
  /** Instante do último envio (ultimo_envio_em). */
  ultimoEnvioEm: string | null;
  agora?: Date;
  config?: ConfigFollowup;
}

/** Data AAAA-MM-DD de um instante, no calendário de Maceió. */
export function dataMaceioISO(instante: string | Date): string {
  return hojeMaceioISO(new Date(instante));
}

/** Dias de calendário de `de` até `ate` (AAAA-MM-DD); negativo se `ate` vem antes. */
export function diasEntreDatas(de: string, ate: string): number {
  const [a1, m1, d1] = de.split("-").map(Number);
  const [a2, m2, d2] = ate.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

export interface ProximoContato {
  etapa: EtapaFollowup;
  /** Dia do contato (AAAA-MM-DD, Maceió). */
  venceEm: string;
  /** Negativo = ainda falta; 0 = hoje; positivo = atrasado. */
  diasAtraso: number;
}

/**
 * Próximo contato de um orçamento enviado (vencido ou não), ou null se não há o que lembrar:
 *  - enviado: D+5 em ultimo envio + d5Dias;
 *  - followup_d5: D+10 em ultimo envio + d10Dias;
 *  - followup_d10: decidir se encerra, em ultimo envio + d10Dias + 5.
 */
export function proximoContato(e: EntradaFollowup): ProximoContato | null {
  if (!e.ultimoEnvioEm) return null;
  const { d5Dias, d10Dias } = e.config ?? CONFIG_FOLLOWUP_PADRAO;
  const hoje = hojeMaceioISO(e.agora ?? new Date());
  const base = dataMaceioISO(e.ultimoEnvioEm);

  let etapa: EtapaFollowup;
  let venceEm: string;
  if (e.status === "enviado") {
    etapa = "D+5";
    venceEm = adicionarDiasISO(base, d5Dias);
  } else if (e.status === "followup_d5") {
    etapa = "D+10";
    venceEm = adicionarDiasISO(base, d10Dias);
  } else if (e.status === "followup_d10") {
    etapa = "ENCERRAR";
    venceEm = adicionarDiasISO(base, d10Dias + DIAS_PARA_SUGERIR_PERDIDO);
  } else {
    return null;
  }
  return { etapa, venceEm, diasAtraso: diasEntreDatas(venceEm, hoje) };
}

/** Follow-up que vence hoje ou já venceu, ou null. Passados 5 dias do D+10, sugere perdido. */
export function followupDeHoje(e: EntradaFollowup): FollowupDeHoje | null {
  const p = proximoContato(e);
  if (!p || p.diasAtraso < 0) return null;
  return {
    ...p,
    sugerirPerdido:
      p.etapa === "ENCERRAR" || (p.etapa === "D+10" && p.diasAtraso >= DIAS_PARA_SUGERIR_PERDIDO),
  };
}

/** "Próximo contato (D+5): 30/11 · em 5 dias". */
export function textoProximoContato(p: ProximoContato): string {
  const [, mes, dia] = p.venceEm.split("-");
  const rotulo = p.etapa === "ENCERRAR" ? "Decidir se encerra" : `Próximo contato (${p.etapa})`;
  const falta = -p.diasAtraso;
  const prazo = falta > 0 ? `em ${falta} ${falta === 1 ? "dia" : "dias"}` : textoPrazoFollowup(p);
  return `${rotulo}: ${dia}/${mes} · ${prazo}`;
}

/** "vence hoje" ou "atrasado N dias". */
export function textoPrazoFollowup(f: Pick<FollowupDeHoje, "diasAtraso">): string {
  if (f.diasAtraso === 0) return "vence hoje";
  return `atrasado ${f.diasAtraso} ${f.diasAtraso === 1 ? "dia" : "dias"}`;
}

// ---------------------------------------------------------------- mensagem de WhatsApp

export const MENSAGEM_D5_PADRAO =
  "Olá, {cliente}! Aqui é {vendedora}, da Luz Design. Passando para saber se você conseguiu ver o orçamento nº {numero}. Posso ajudar com alguma dúvida?";
export const MENSAGEM_D10_PADRAO =
  "Olá, {cliente}! Tudo bem? Aqui é {vendedora}, da Luz Design. Voltando ao orçamento nº {numero}: se quiser, posso ajustar alguma coisa para fecharmos. Fico à disposição!";

/** Troca {cliente} (primeiro nome), {numero} e {vendedora} no modelo da mensagem. */
export function montarMensagemFollowup(
  modelo: string,
  dados: { cliente: string; numero: string; vendedora: string },
): string {
  const primeiroNome = dados.cliente.trim().split(/\s+/)[0] || "tudo bem";
  const primeiroNomeVendedora = dados.vendedora.trim().split(/\s+/)[0] || dados.vendedora;
  return modelo
    .replaceAll("{cliente}", primeiroNome)
    .replaceAll("{numero}", dados.numero)
    .replaceAll("{vendedora}", primeiroNomeVendedora)
    .trim();
}

/** Link do WhatsApp com a mensagem pronta (sem número, abre a lista de conversas). */
export function linkWhatsapp(whatsapp: string | null | undefined, mensagem: string): string {
  const numero = (whatsapp ?? "").replace(/\D/g, "");
  const texto = encodeURIComponent(mensagem);
  return numero ? `https://wa.me/${numero}?text=${texto}` : `https://wa.me/?text=${texto}`;
}
