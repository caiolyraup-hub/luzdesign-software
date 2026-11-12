import { isoParaBR } from "../formatar";
import { rotuloStatus } from "./status";

export interface EntradaLinhaDoTempo {
  criadoEm: string;
  /** Última montagem pela IA (null = nunca montou). */
  montadoEm: string | null;
  versoesPdf: { versao: number; gerado_em: string; renovada?: boolean; validade?: string }[];
  /** Mudanças de status registradas pelo banco. */
  eventos: { de_status: string | null; para_status: string; criado_em: string }[];
}

export interface EventoTempo {
  quando: string;
  texto: string;
}

/** Eventos do orçamento em ordem cronológica: criado, montado pela IA, PDFs gerados e mudanças de status. */
export function montarLinhaDoTempo(e: EntradaLinhaDoTempo): EventoTempo[] {
  const lista: EventoTempo[] = [{ quando: e.criadoEm, texto: "Orçamento criado" }];
  if (e.montadoEm) lista.push({ quando: e.montadoEm, texto: "Itens montados pela IA" });
  for (const v of e.versoesPdf)
    lista.push({
      quando: v.gerado_em,
      texto: v.renovada
        ? `Validade renovada (versão ${v.versao}${v.validade ? `, válida até ${isoParaBR(v.validade)}` : ""})`
        : `PDF gerado (versão ${v.versao})`,
    });
  for (const ev of e.eventos) {
    if (ev.de_status === null) continue; // criação: já está na lista
    if (ev.de_status === "rascunho" && ev.para_status === "gerado") continue; // coberto pelo "PDF gerado"
    lista.push({
      quando: ev.criado_em,
      texto: `Status: ${rotuloStatus(ev.de_status)} → ${rotuloStatus(ev.para_status)}`,
    });
  }
  return lista.sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime());
}
