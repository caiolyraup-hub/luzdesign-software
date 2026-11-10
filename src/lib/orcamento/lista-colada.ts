/**
 * Lista colada pela vendedora (por exemplo, o que o arquiteto mandou): cada linha tem um código de
 * 4 ou 5 dígitos e uma quantidade. Parser DETERMINÍSTICO, sem IA. Reconhece formatos como
 * `10 12345`, `12345 x 10`, `3,5 m 23456`, `12345 - 4 un`, `10x 12345`, `12345: 10`, `cód 12345 qt 4`
 * e colunas separadas por tabulação (planilha). Linha só com o código vale quantidade 1.
 */

export type LinhaLista =
  | {
      tipo: "reconhecida";
      /** Número da linha no texto colado (a partir de 1). */
      linha: number;
      texto: string;
      codigo: string;
      quantidade: number;
      /** Unidade escrita na linha (un ou m), se houver. */
      unidade: "un" | "m" | null;
    }
  | { tipo: "nao_entendida"; linha: number; texto: string; motivo: string };

export const MAX_LINHAS_LISTA = 200;
const QUANTIDADE_MAXIMA = 100_000;

const UNIDADE_M = /^(m|mt|mts|metro|metros|mtr|mtrs)$/i;
const UNIDADE_UN = /^(un|und|unid|unids|unidade|unidades|pc|pcs|peca|pecas|peça|peças|pç|pçs)$/i;
/** Unidade logo depois de um número: o número é quantidade, não código. */
const UNIDADE_DEPOIS = /^\s*(un|und|unid|unids|unidades?|pcs?|pç|pçs|m|mt|mts|metros?)\b/i;

function numero(bruto: string): number {
  // "3,5" e "3.5" são decimais; "1.200" (milhar) não é esperado em quantidade de iluminação.
  return Number(bruto.replace(",", "."));
}

/** Entende uma linha. Devolve null para linha vazia. */
export function interpretarLinha(textoBruto: string, linha: number): LinhaLista | null {
  const texto = textoBruto.trim();
  if (!texto) return null;
  // Tira marcadores de lista ("- ", "* ", "1) ", "•") no começo, só se sobrar algo depois.
  const limpo = texto.replace(/^[-*•–—]\s+/, "").replace(/^\d{1,2}[).]\s+(?=\S)/, "");

  // Códigos: 4 ou 5 dígitos isolados (não colados em outro número, nem em decimal). Um número de
  // 4 dígitos seguido de unidade ("1200 un") é quantidade, não código. Se sobrarem dois, vale o de
  // 5 dígitos (os de 4 viram quantidade); se ainda houver dúvida, a linha não é entendida.
  const tokensCodigo = [...limpo.matchAll(/(?<![\d.,])\d{4,5}(?![\d]|[.,]\d)/g)].filter(
    (m) => !UNIDADE_DEPOIS.test(limpo.slice((m.index ?? 0) + m[0].length)),
  );
  let codigos = tokensCodigo;
  if (tokensCodigo.length > 1) {
    const cinco = tokensCodigo.filter((m) => m[0].length === 5);
    codigos = cinco.length === 1 ? cinco : tokensCodigo;
  }
  if (codigos.length === 0) {
    return {
      tipo: "nao_entendida",
      linha,
      texto,
      motivo: "Não achei um código de 4 ou 5 dígitos.",
    };
  }
  if (codigos.length > 1) {
    return {
      tipo: "nao_entendida",
      linha,
      texto,
      motivo: "Achei mais de um código na mesma linha.",
    };
  }
  const codigo = codigos[0][0];
  const posicao = codigos[0].index ?? 0;

  // O que sobra depois de tirar o código.
  const resto = `${limpo.slice(0, posicao)} ${limpo.slice(posicao + codigo.length)}`
    // palavras de apoio que não são quantidade
    .replace(/\b(c[oó]d(?:igo)?|ref|item|qtd?|quant(?:idade)?|qde)\b\.?:?/gi, " ")
    .replace(/[x×*=:;|()[\]\t]/gi, " ")
    .replace(/\s[-–—]\s/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!resto) {
    return { tipo: "reconhecida", linha, texto, codigo, quantidade: 1, unidade: null };
  }

  // Quantidade: número com unidade opcional colada ("10un", "3,5m") ou separada ("3,5 m").
  const achados = [...resto.matchAll(/(\d+(?:[.,]\d+)?)\s*([a-zA-ZçÇãÃ]{1,10})?(?![\d])/g)].filter(
    (m) => m[1] !== undefined,
  );

  const candidatos: { valor: number; unidade: "un" | "m" | null }[] = [];
  for (const m of achados) {
    const valor = numero(m[1]);
    const palavra = m[2] ?? "";
    let unidade: "un" | "m" | null = null;
    if (palavra) {
      if (UNIDADE_M.test(palavra)) unidade = "m";
      else if (UNIDADE_UN.test(palavra)) unidade = "un";
      else continue; // palavra desconhecida ao lado do número (ex.: "6W"): não é quantidade
    }
    candidatos.push({ valor, unidade });
  }

  if (candidatos.length === 0) {
    // Sobrou texto sem número de quantidade (descrição do produto, por exemplo): vale 1.
    if (/\d/.test(resto)) {
      return { tipo: "nao_entendida", linha, texto, motivo: "Não entendi a quantidade." };
    }
    return { tipo: "reconhecida", linha, texto, codigo, quantidade: 1, unidade: null };
  }
  if (candidatos.length > 1) {
    return {
      tipo: "nao_entendida",
      linha,
      texto,
      motivo: "Achei mais de uma quantidade na mesma linha.",
    };
  }
  const { valor, unidade } = candidatos[0];
  if (!Number.isFinite(valor) || valor <= 0) {
    return {
      tipo: "nao_entendida",
      linha,
      texto,
      motivo: "A quantidade precisa ser maior que zero.",
    };
  }
  if (valor > QUANTIDADE_MAXIMA) {
    return { tipo: "nao_entendida", linha, texto, motivo: "Quantidade grande demais." };
  }
  return { tipo: "reconhecida", linha, texto, codigo, quantidade: valor, unidade };
}

/** Interpreta o texto colado, linha a linha (linhas vazias são ignoradas). */
export function interpretarLista(texto: string): { linhas: LinhaLista[]; excedeu: boolean } {
  const bruto = texto.split(/\r?\n/);
  const linhas: LinhaLista[] = [];
  let excedeu = false;
  bruto.forEach((t, i) => {
    const l = interpretarLinha(t, i + 1);
    if (!l) return;
    if (linhas.length >= MAX_LINHAS_LISTA) {
      excedeu = true;
      return;
    }
    linhas.push(l);
  });
  return { linhas, excedeu };
}
