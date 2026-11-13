/**
 * Descrição comercial limpa (dia 11C): tira fabricante, referência e modelo do texto que a vendedora
 * e o cliente veem. É um limpador DETERMINÍSTICO (nenhuma IA): remove os nomes de fabricante
 * conhecidos, os nomes de linha/modelo conhecidos e os padrões de referência.
 *
 * Por que não criptografar: o servidor precisa mostrar esses dados à gerência, então a chave estaria
 * sempre à mão, e a busca pararia de funcionar. A proteção certa é separar o dado
 * (`produtos_dados_fornecedor`, só a gerência lê, no banco) e nunca imprimi-lo nos documentos.
 */

/** Fabricantes e marcas que aparecem no catálogo (a lista cresce com as marcas das cargas). */
export const FABRICANTES_CONHECIDOS = [
  "ASTRALED",
  "ASTRA",
  "MB",
  "NIT",
  "STELLA",
  "USINA",
  "ZIBO",
  "OPUS",
  "MOLDI",
  "AVANT",
  "ACEND",
  "S&L",
  "GMH",
  "PIX",
  "SPOTLINE",
  "CASUAL LIGHT",
] as const;

/** Nomes de linha/modelo dos fabricantes (palavras só de letras que não descrevem o produto). */
export const MODELOS_CONHECIDOS = [
  "BLET",
  "LOYO",
  "FUSY",
  "AXIS",
  "POWERUS",
  "KAIS",
  "KLOR",
  "LINYL",
  "KEN",
  "CADRE",
  "ARI",
  "ARBOR",
  "POINT",
  "DEEP",
  "FENDA",
  "ECLIPSE",
  "LITE",
  "BABY",
  "A-GREDA",
  "LED3",
] as const;

/** Tokens técnicos que parecem referência mas descrevem o produto (lâmpada, soquete, proteção, tensão). */
const PROTEGIDO =
  /^(?:AR\d{2,3}|PAR\d{2}|MR\d{2}|GU\d{2}|LP\d{2}|[PGAT]\d{1,2}|E\d{2}|IP\d{2}|\d+(?:[.,]\d+)?(?:W|K|V|MM|CM|M|MT|MTS|A|W\/M)|\d+X\S*|DIC\.?\S*|2XP20)$/i;

const REGRAS_REFERENCIA: RegExp[] = [
  /^\d{1,3}\.\d{4,}[A-Z]*$/i, // 1.90337BT
  /^\d{2,4}\.[A-Z]{1,3}\d{3,}$/i, // 377.IN65006
  /^[A-Z]{1,5}-?\d{3,}[A-Z0-9]*(?:\/\d+)?(?:-[A-Z]+)?$/i, // PD1334BZ-BR, STH8903PTO/30, DL-7324, PE012B
  /^[A-Z]{1,3}-\d{2}[A-Z]?(?:-[A-Z]+)?$/i, // AL-03A, AL-29, AL-03A-PR
  /^\d{4,5}-\d{2,3}$/, // 10050-23
  /^\d{4,5}\.?$/, // 6144, 2167
  /^\d{3}\.$/, // 325. (pedaço de 325. 5558)
  /^\d{3,5}[A-Z]{1,4}\.?$/i, // 0878PT, 30015RED.
  /^\d{3,5}\/\d+[A-Z]{0,5}$/i, // 1152/1, 16645/1BTBT
  /^[A-Z]{2}\d{2}[A-Z]?$/i, // AL03A
];

/** 30045/200BR: a variante depois da barra (tamanho e cor) continua, a referência sai. */
const REFERENCIA_COM_VARIANTE = /^\d{4,5}\/(\d{2,3})([A-Z]{0,3})$/i;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function regexNomes(nomes: readonly string[], absorverPonto = true): RegExp {
  const ordenados = [...nomes].sort((a, b) => b.length - a.length).map(escapar);
  // Fronteira de "palavra" que aceita S&L e A-GREDA. Nas descrições, o ponto colado (NIT., ASTRA.)
  // sai junto; em texto corrido (frases da IA) o ponto final fica.
  return new RegExp(
    `(?<![A-Za-z0-9])(?:${ordenados.join("|")})(?![A-Za-z0-9])${absorverPonto ? "\.?" : ""}`,
    "gi",
  );
}

export interface ResultadoLimpeza {
  /** Descrição comercial (só o que descreve o produto, com a categoria na frente quando falta). */
  comercial: string;
  /** Fabricantes encontrados no texto original. */
  fabricantes: string[];
  /** Referências (códigos do fabricante) removidas. */
  referencias: string[];
  /** Nomes de linha/modelo removidos. */
  modelos: string[];
}

export interface OpcoesLimpeza {
  /** Fabricantes extras (por exemplo, as marcas da carga). */
  fabricantes?: readonly string[];
}

function unicos(lista: string[]): string[] {
  return [...new Set(lista.map((s) => s.trim()).filter(Boolean))];
}

/** Lista de fabricantes sem repetição, em maiúsculas, sem vazios. */
export function listaFabricantes(extras: readonly (string | null | undefined)[] = []): string[] {
  const todos = [...FABRICANTES_CONHECIDOS, ...extras.map((e) => (e ?? "").trim().toUpperCase())];
  return unicos(todos.filter((f) => f.length >= 2));
}

export function limparDescricao(
  descricao: string,
  categoria: string | null | undefined,
  opcoes: OpcoesLimpeza = {},
): ResultadoLimpeza {
  const fabricantesLista = listaFabricantes(opcoes.fabricantes);
  const fabricantes: string[] = [];
  const modelos: string[] = [];
  const referencias: string[] = [];

  let texto = ` ${descricao.replace(/\s+/g, " ").trim()} `;

  // "MBLOYO": a marca colada no nome da linha.
  texto = texto.replace(/\bMB(?=LOYO\b)/gi, (m) => (fabricantes.push(m), ""));

  texto = texto.replace(regexNomes(fabricantesLista), (m) => {
    fabricantes.push(m.replace(/\.$/, "").toUpperCase());
    return " ";
  });
  texto = texto.replace(regexNomes(MODELOS_CONHECIDOS), (m) => {
    modelos.push(m.replace(/\.$/, "").toUpperCase());
    return " ";
  });

  const mantidos: string[] = [];
  for (const token of texto.split(/\s+/).filter(Boolean)) {
    const limpo = token.replace(/^[(]+|[),;]+$/g, "");
    if (PROTEGIDO.test(limpo)) {
      mantidos.push(token);
      continue;
    }
    const variante = REFERENCIA_COM_VARIANTE.exec(limpo);
    if (variante) {
      referencias.push(limpo.toUpperCase());
      mantidos.push(variante[2] ? `${variante[1]} ${variante[2].toUpperCase()}` : variante[1]);
      continue;
    }
    if (REGRAS_REFERENCIA.some((r) => r.test(limpo))) {
      referencias.push(limpo.toUpperCase());
      continue;
    }
    mantidos.push(token);
  }

  // Sobras de pontuação soltas ("-", "/", ".", "( )").
  let resto = mantidos
    .join(" ")
    .replace(/\(\s*\)/g, " ")
    .replace(/(?:^|\s)[-/.,;]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Vem a categoria na frente quando o texto não a diz (FONTE 24W, SPOT S. PT).
  const cat = (categoria ?? "").trim().toUpperCase();
  const primeiraPalavra = cat.split(/\s+/)[0];
  const jaTem = primeiraPalavra
    ? new RegExp(`(?<![A-Za-z0-9])${escapar(primeiraPalavra)}`, "i").test(resto)
    : true;
  if (cat && !jaTem) resto = `${cat} ${resto}`.trim();
  if (!resto) resto = cat || "PRODUTO";

  return {
    comercial: resto,
    fabricantes: unicos(fabricantes),
    referencias: unicos(referencias),
    modelos: unicos(modelos),
  };
}

/** O texto ainda mostra fabricante, linha/modelo ou referência? (usado em testes e filtros). */
export function contemDadoDeFornecedor(
  texto: string,
  extras: readonly (string | null | undefined)[] = [],
): boolean {
  const r = limparDescricao(texto, null, { fabricantes: listaFabricantes(extras) });
  return r.fabricantes.length > 0 || r.modelos.length > 0 || r.referencias.length > 0;
}

/**
 * Troca por "…" os nomes de fabricante, de linha/modelo e as referências de um texto livre (por
 * exemplo, o motivo da Indicação da IA). Mantém o resto da frase.
 */
export function censurarFornecedor(
  texto: string,
  extras: readonly (string | null | undefined)[] = [],
): string {
  const fabricantes = listaFabricantes(extras);
  let t = texto.replace(regexNomes([...fabricantes, ...MODELOS_CONHECIDOS], false), "…");
  t = t
    .split(/(\s+)/)
    .map((parte) => {
      const limpo = parte.replace(/^[(]+|[),;.]+$/g, "");
      if (!limpo || PROTEGIDO.test(limpo)) return parte;
      if (REFERENCIA_COM_VARIANTE.test(limpo) || REGRAS_REFERENCIA.some((r) => r.test(limpo)))
        return "…";
      return parte;
    })
    .join("");
  return t
    .replace(/(?:…\s*){2,}/g, "… ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalização da referência para a busca exata: maiúsculas, sem espaços, hífens, barras e pontos. */
export function normalizarReferencia(bruta: string): string {
  return bruta.toUpperCase().replace(/[\s\-/.]+/g, "");
}
