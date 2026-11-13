/**
 * Linha da lista colada que traz a REFERÊNCIA do fabricante (o que o arquiteto manda) em vez do
 * código interno. Extrai o candidato a referência e a quantidade; quem decide se a referência existe
 * é o banco (`buscar_por_referencia`, igualdade exata, sem ecoar o dado do fornecedor).
 */

export interface CandidatoReferencia {
  referencia: string;
  quantidade: number;
  unidade: "un" | "m" | null;
}

export function candidatoReferencia(textoBruto: string): CandidatoReferencia | null {
  let t = textoBruto
    .trim()
    .replace(/^[-*•–—]\s+/, "")
    .replace(/\b(ref(?:er[eê]ncia)?|c[oó]d(?:igo)?|item)\b\.?:?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  let quantidade = 1;
  let unidade: "un" | "m" | null = null;
  const num = (s: string) => Number(s.replace(",", "."));
  const un = (s: string | undefined): "un" | "m" | null =>
    !s ? null : /^(m|mt|mts|metros?)$/i.test(s) ? "m" : "un";

  // Quantidade no fim: "DL-7324 x 10", "6338 x 2", "STH8903BR/30 - 4 un" (o "-" precisa de espaços,
  // senão faria parte da referência, como em DL-7324).
  const fim =
    /^(.+?)(?:\s*[x×]\s*|\s+[-:]\s+)(\d{1,4}(?:[.,]\d+)?)\s*(un|und|unid|unidades?|pcs?|m|mt|mts|metros?)?$/i.exec(
      t,
    );
  if (fim && fim[1].replace(/[^A-Za-z0-9]/g, "").length >= 3) {
    t = fim[1];
    quantidade = num(fim[2]);
    unidade = un(fim[3]);
  } else {
    // Quantidade no começo: "10 x DL-7324", "10x DL-7324", "3,5 m DL-7324".
    const ini =
      /^(\d+(?:[.,]\d+)?)\s*(?:[x×]\s*|(un|und|unid|unidades?|pcs?|m|mt|mts|metros?)\s+)(.+)$/i.exec(
        t,
      );
    if (ini) {
      quantidade = num(ini[1]);
      unidade = un(ini[2]);
      t = ini[3];
    }
  }
  t = t.replace(/[,;]+$/g, "").trim();
  if (!Number.isFinite(quantidade) || quantidade <= 0 || quantidade > 100_000) return null;
  // Uma referência tem ao menos 3 letras/dígitos e pelo menos um dígito; nada de frases.
  if (t.replace(/[^A-Za-z0-9]/g, "").length < 3 || !/\d/.test(t) || t.split(/\s+/).length > 4)
    return null;
  return { referencia: t, quantidade, unidade };
}
