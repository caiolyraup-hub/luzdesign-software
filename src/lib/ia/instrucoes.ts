/** Auxiliares de texto compartilhados pelas chamadas à IA (limpeza de dados do cliente). */
import type { Opcao } from "../orcamento/perguntas";

export const rotulo = (opcoes: Opcao[], valor: unknown) =>
  opcoes.find((o) => o.valor === valor)?.rotulo ?? String(valor ?? "");

/**
 * Tira de um texto livre o que identifica o cliente: telefones, e-mails e o nome informado.
 * A vendedora às vezes cola a mensagem inteira do WhatsApp na pergunta 6.
 */
export function anonimizarTexto(texto: string, nomes?: string | string[]): string {
  const nomeCliente = (Array.isArray(nomes) ? nomes : [nomes ?? ""]).join(" ");
  let t = texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-mail]")
    // Formatos de telefone com DDD; o último exige separador ou 10 a 11 dígitos seguidos, para não
    // confundir com listas de códigos de produto ("12389 12390").
    .replace(/(?:\+?55[\s.-]?)?\(\d{2}\)\s?9?\d{4}[\s.-]?\d{4}/g, "[telefone]")
    .replace(/\+55[\s.-]?\d{2}[\s.-]?9?\d{4}[\s.-]?\d{4}/g, "[telefone]")
    .replace(/\b\d{2}[\s.-]9?\d{4}[\s.-]\d{4}\b/g, "[telefone]")
    .replace(/\b\d{10,11}\b/g, "[telefone]");
  if (nomeCliente) {
    const partes = nomeCliente
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3);
    for (const parte of partes) {
      const escapada = parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      t = t.replace(new RegExp(`\\b${escapada}\\b`, "gi"), "[cliente]");
    }
  }
  return t;
}
