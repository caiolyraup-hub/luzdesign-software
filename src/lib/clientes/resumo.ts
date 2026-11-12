import { formatarDataBR } from "../formatar";

export interface OrcamentoDoCliente {
  status: string;
  valor_total: number;
  valor_fechado: number | null;
  criado_em: string;
}

export interface ResumoCliente {
  orcamentos: number;
  fechados: number;
  perdidos: number;
  /** Enviados e em follow-up (esperando resposta). */
  emAberto: number;
  /** Soma do valor fechado dos fechados (o valor total se faltar o fechado). */
  vendido: number;
  /** vendido ÷ fechados; nulo sem fechados. */
  ticketMedio: number | null;
  /** Instante do orçamento mais recente (criação). */
  ultimoEm: string | null;
}

const EM_ABERTO = ["enviado", "followup_d5", "followup_d10"];

/** Resumo do histórico de um cliente a partir dos orçamentos dele. */
export function resumoDoCliente(orcs: OrcamentoDoCliente[]): ResumoCliente {
  let vendido = 0;
  let fechados = 0;
  let perdidos = 0;
  let emAberto = 0;
  let ultimoEm: string | null = null;
  for (const o of orcs) {
    if (o.status === "fechado") {
      fechados++;
      vendido += o.valor_fechado ?? o.valor_total;
    }
    if (o.status === "perdido") perdidos++;
    if (EM_ABERTO.includes(o.status)) emAberto++;
    if (!ultimoEm || new Date(o.criado_em) > new Date(ultimoEm)) ultimoEm = o.criado_em;
  }
  vendido = Math.round(vendido * 100) / 100;
  return {
    orcamentos: orcs.length,
    fechados,
    perdidos,
    emAberto,
    vendido,
    ticketMedio: fechados > 0 ? Math.round((vendido / fechados) * 100) / 100 : null,
    ultimoEm,
  };
}

/** "3 orçamentos, 1 fechado, último em 04/11"; "Nenhum orçamento ainda" sem histórico. */
export function textoHistorico(r: {
  orcamentos: number;
  fechados: number;
  ultimoEm: string | null;
}): string {
  if (r.orcamentos === 0) return "Nenhum orçamento ainda";
  const orc = `${r.orcamentos} ${r.orcamentos === 1 ? "orçamento" : "orçamentos"}`;
  const fec = `${r.fechados} ${r.fechados === 1 ? "fechado" : "fechados"}`;
  const ultimo = r.ultimoEm ? `, último em ${formatarDataBR(r.ultimoEm).slice(0, 5)}` : "";
  return `${orc}, ${fec}${ultimo}`;
}
