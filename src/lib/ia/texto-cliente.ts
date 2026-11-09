/** Limpeza dos textos que vão para o cliente (análise do ambiente e motivo do produto). */

/** Tira espaços repetidos e corta no limite, preferindo terminar numa frase ou palavra inteira. */
export function limparTexto(texto: string, max: number): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= max) return limpo;
  const corte = limpo.slice(0, max);
  const fimDeFrase = Math.max(
    corte.lastIndexOf(". "),
    corte.lastIndexOf("! "),
    corte.lastIndexOf("? "),
  );
  if (fimDeFrase > max * 0.5) return corte.slice(0, fimDeFrase + 1);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > max * 0.5 ? corte.slice(0, espaco) : corte).replace(/[,;:]$/, "")}…`;
}

const MENCAO_ANEXO =
  /\b(foto|fotos|fotografia|fotografias|planta|plantas|imagem|imagens|print|prints|projeto luminotécnico)\b/i;

/**
 * Se a análise não foi embasada em nenhum anexo, tira as frases que dizem "pela foto", "na planta"...
 * (a IA não pode afirmar o que não viu). Devolve o texto limpo e quantas frases saíram.
 */
export function removerReferenciasAAnexos(texto: string): { texto: string; removidas: number } {
  const frases = texto.split(/(?<=[.!?])\s+/).filter(Boolean);
  const mantidas = frases.filter((f) => !MENCAO_ANEXO.test(f));
  return { texto: mantidas.join(" "), removidas: frases.length - mantidas.length };
}

/** Texto cita foto, planta ou imagem? (usado na avaliação). */
export function mencionaAnexo(texto: string): boolean {
  return MENCAO_ANEXO.test(texto);
}
