import type { UnidadeProduto } from "../dominio";
import type { ProdutoImportacao } from "./tipos";

/** Formato dos orçamentos extraídos: items = [qt, "CATEGORIA CODIGO", ".DESCRICAO", (ambiente,) unitario, total]. */
export interface OrcamentoExtraido {
  date?: string;
  items?: string[][];
}

export const MARCAS_CONHECIDAS = ["MB", "NIT", "STELLA", "ASTRA", "USINA", "OPUS", "ZIBO", "MOLDI"];

export interface Ocorrencia {
  codigo: string;
  categoria: string;
  complemento: string;
  descricao: string;
  preco: number;
  /** Data do orçamento (YYYY-MM-DD) ou "" se não deu para ler. */
  data: string;
  ordem: number;
}

export interface LinhaIgnorada {
  motivo: "a definir" | "sem código" | "sem preço" | "estrutura inválida";
  /** Há um número de 4-5 dígitos no começo da descrição que talvez seja o código. */
  codigoPossivel: boolean;
}

export interface Divergencia {
  codigo: string;
  descricao: string;
  precos: { preco: number; datas: string[] }[];
  usado: number;
}

export interface DuvidaUnidade {
  codigo: string;
  descricao: string;
  motivo: string;
}

export interface ResultadoProvisorio {
  produtos: ProdutoImportacao[];
  totalLinhas: number;
  ignoradas: LinhaIgnorada[];
  divergencias: Divergencia[];
  duvidasUnidade: DuvidaUnidade[];
  marcasMultiplas: { codigo: string; marcas: string[] }[];
  semMarca: number;
}

const eNumero = (s: string | undefined) => s !== undefined && /^-?\d+(\.\d+)?$/.test(s.trim());

/** DD.MM.AA ou AAAA-MM-DD -> AAAA-MM-DD. */
export function normalizarData(bruto: string | undefined): string {
  if (!bruto) return "";
  const br = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(bruto.trim());
  if (br) return `20${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto.trim());
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
}

// 4 ou 5 dígitos soltos: não colado a vírgula/ponto+dígito (3.000K, 2,50MTS) nem a letras (12W).
const REGEX_CODIGO = /(?<![\d,]|\d\.)(\d{4,5})(?!\d|[.,]\d|[A-Za-z%])/;

export function normalizarCategoria(bruta: string): string {
  const t = bruta
    .toUpperCase()
    .replace(/[.\s]+$/, "")
    .trim();
  if (/^(MTS?\s+)?FITA/.test(t)) return "FITA LED";
  if (/^EMBUT/.test(t)) return "EMBUTIDO";
  if (/^PERFIL/.test(t)) return "PERFIL";
  if (/^(MINI\s+)?SPOT/.test(t)) return "SPOT";
  if (/^PLAFON/.test(t)) return "PLAFON";
  if (/^(PF\/)?ARAND/.test(t)) return "ARANDELA";
  if (/^(FONTE|FOTE)/.test(t)) return "FONTE";
  if (/^ACESS/.test(t)) return "ACESSÓRIO";
  if (/^LED/.test(t)) return "LED";
  if (/^TRILHO/.test(t)) return "TRILHO";
  return t.replace(/\s+/g, " ");
}

export function limparDescricao(bruta: string): string {
  return bruta
    .replace(/^[.\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Variações de escrita que apontam para a mesma marca. */
const SINONIMOS_MARCA: Record<string, string> = { ASTRALED: "ASTRA" };

export function detectarMarcas(texto: string): string[] {
  const nomes = [...MARCAS_CONHECIDAS, ...Object.keys(SINONIMOS_MARCA)];
  const achadas = nomes
    .map((m) => ({ m: SINONIMOS_MARCA[m] ?? m, i: texto.search(new RegExp(`\\b${m}\\b`)) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  return [...new Set(achadas.map((x) => x.m))];
}

function kelvin(bruto: string): number {
  const t = bruto.replace(",", ".");
  const [inteiro, decimal = ""] = t.split(".");
  if (decimal.length === 3) return Number(inteiro + decimal); // 3.000 / 2.700
  const n = Number(t);
  return n >= 100 ? n : Math.round(n * 1000); // 2.7 / 3.0 / 3
}

export function extrairAtributos(texto: string): { w?: number; k?: number; comprimento?: number } {
  const r: { w?: number; k?: number; comprimento?: number } = {};
  const w = /(\d+(?:[.,]\d+)?)\s*W\b/i.exec(texto);
  if (w) r.w = Number(w[1].replace(",", "."));
  const k = /(\d+(?:[.,]\d+)?)\s*K\b/i.exec(texto);
  if (k) r.k = kelvin(k[1]);
  const c = /(?<![\d,.])(\d+(?:[.,]\d+)?)\s*(?:MTS?|M)\b(?!\/)/i.exec(texto);
  if (c) r.comprimento = Number(c[1].replace(",", "."));
  return r;
}

/** Lê uma linha de orçamento. Devolve a ocorrência, ou o motivo de ter sido ignorada. */
export function lerLinha(
  item: string[],
  data: string,
  ordem: number,
): { ocorrencia: Ocorrencia } | { ignorada: LinhaIgnorada } {
  const texto = item.join(" ");
  if (item.length < 4) {
    return {
      ignorada: {
        motivo: /DEFINIR/i.test(texto) ? "a definir" : "estrutura inválida",
        codigoPossivel: false,
      },
    };
  }
  const unitario = item[item.length - 2];
  const total = item[item.length - 1];
  const campo1 = item[1] ?? "";
  const bruta = item.length >= 5 ? item[2] : "";
  const codigoPossivel = /^[.\s]*\d{4,5}\b/.test(bruta);

  if (!eNumero(unitario) || !eNumero(total)) {
    return {
      ignorada: {
        motivo: /DEFINIR/i.test(texto) ? "a definir" : "sem preço",
        codigoPossivel: false,
      },
    };
  }

  const m = REGEX_CODIGO.exec(campo1);
  if (!m || m.index === undefined) {
    return {
      ignorada: { motivo: /DEFINIR/i.test(campo1) ? "a definir" : "sem código", codigoPossivel },
    };
  }

  const antes = campo1.slice(0, m.index).replace(/[.\s]+$/, "");
  const depois = campo1.slice(m.index + m[1].length).trim();
  const categoria = normalizarCategoria(antes);
  const complementoCat =
    antes.toUpperCase().replace(/\s+/g, " ") === categoria ? "" : antes.toUpperCase();
  const complemento = [complementoCat, depois.toUpperCase()].filter(Boolean).join(" ").trim();

  let descricao = limparDescricao(bruta);
  if (!descricao) descricao = [antes.toUpperCase(), depois.toUpperCase()].filter(Boolean).join(" ");

  return {
    ocorrencia: {
      codigo: m[1],
      categoria,
      complemento,
      descricao,
      preco: Number(unitario),
      data,
      ordem,
    },
  };
}

function maisFrequente<T>(itens: T[], desempate: (a: T, b: T) => number): T {
  const contagem = new Map<T, number>();
  itens.forEach((i) => contagem.set(i, (contagem.get(i) ?? 0) + 1));
  return [...contagem.entries()].sort((a, b) => b[1] - a[1] || desempate(a[0], b[0]))[0][0];
}

export function extrairCatalogo(orcamentos: OrcamentoExtraido[]): ResultadoProvisorio {
  const ocorrencias: Ocorrencia[] = [];
  const ignoradas: LinhaIgnorada[] = [];
  let totalLinhas = 0;
  let ordem = 0;

  for (const o of orcamentos) {
    const data = normalizarData(o.date);
    for (const item of o.items ?? []) {
      totalLinhas++;
      const r = lerLinha(item, data, ordem++);
      if ("ignorada" in r) ignoradas.push(r.ignorada);
      else ocorrencias.push(r.ocorrencia);
    }
  }

  const porCodigo = new Map<string, Ocorrencia[]>();
  for (const oc of ocorrencias) porCodigo.set(oc.codigo, [...(porCodigo.get(oc.codigo) ?? []), oc]);

  const produtos: ProdutoImportacao[] = [];
  const divergencias: Divergencia[] = [];
  const duvidasUnidade: DuvidaUnidade[] = [];
  const marcasMultiplas: { codigo: string; marcas: string[] }[] = [];
  let semMarca = 0;

  for (const [codigo, lista] of [...porCodigo].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    // Mais recente primeiro (data, depois ordem no arquivo).
    const recentes = [...lista].sort(
      (a, b) => (b.data || "").localeCompare(a.data || "") || b.ordem - a.ordem,
    );
    const maisRecente = recentes[0];

    const descricao = maisFrequente(
      lista.map((l) => l.descricao),
      (a, b) =>
        recentes.findIndex((r) => r.descricao === a) - recentes.findIndex((r) => r.descricao === b),
    );
    const apelidos = [...new Set(lista.map((l) => l.descricao))].filter((d) => d !== descricao);
    // Fita aparece como "LED 12222" com "MTS FITA ..." na descrição: a descrição manda.
    const categoria = /\bFITA\b/.test(descricao)
      ? "FITA LED"
      : maisFrequente(
          lista.map((l) => l.categoria),
          (a, b) =>
            recentes.findIndex((r) => r.categoria === a) -
            recentes.findIndex((r) => r.categoria === b),
        );
    const complemento = recentes.find((r) => r.categoria === categoria)?.complemento ?? "";

    const preco = maisRecente.preco;
    const distintos = [...new Set(lista.map((l) => l.preco))];
    if (distintos.length > 1) {
      divergencias.push({
        codigo,
        descricao,
        precos: distintos
          .map((p) => ({
            preco: p,
            datas: [
              ...new Set(lista.filter((l) => l.preco === p).map((l) => l.data || "sem data")),
            ].sort(),
          }))
          .sort((a, b) => (b.datas.at(-1) ?? "").localeCompare(a.datas.at(-1) ?? "")),
        usado: preco,
      });
    }

    const unidade: UnidadeProduto = categoria === "FITA LED" ? "m" : "un";
    if (categoria === "PERFIL") {
      duvidasUnidade.push({ codigo, descricao, motivo: "perfil vendido por barra; assumido un" });
    } else if (categoria === "FITA LED" && !/\/M\b|MTS?\b/.test(descricao)) {
      duvidasUnidade.push({
        codigo,
        descricao,
        motivo: "fita sem indicação de metro na descrição; assumido m",
      });
    }

    const textoMarca = `${descricao} ${complemento}`;
    const marcas = detectarMarcas(textoMarca);
    if (marcas.length > 1) marcasMultiplas.push({ codigo, marcas });
    if (marcas.length === 0) semMarca++;

    const atributos: Record<string, unknown> = {
      ...extrairAtributos(`${descricao} ${complemento}`),
    };
    if (complemento) atributos.complemento = complemento;

    produtos.push({
      codigo,
      descricao,
      preco_unitario: preco,
      categoria,
      marca: marcas[0] ?? null,
      unidade,
      atributos,
      apelidos,
    });
  }

  return {
    produtos,
    totalLinhas,
    ignoradas,
    divergencias,
    duvidasUnidade,
    marcasMultiplas,
    semMarca,
  };
}
