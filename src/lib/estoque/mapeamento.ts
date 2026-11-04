import type { UnidadeProduto } from "../dominio";
import {
  CAMPOS_OBRIGATORIOS,
  type CampoMapeavel,
  type ErroLinha,
  type Mapeamento,
  type ProdutoImportacao,
} from "./tipos";

/** Converte preço brasileiro ("1.234,56", "R$ 37,00") ou simples ("37.5") em número. */
export function parsePreco(bruto: string): number | null {
  let t = bruto.replace(/R\$|\s/g, "");
  if (t === "") return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Código como texto: tira espaços e o ".0" que o Excel acrescenta em números. */
export function normalizarCodigo(bruto: string): string {
  return bruto.trim().replace(/\.0+$/, "");
}

function parseUnidade(bruto: string): UnidadeProduto {
  return /^(m|mt|mts|metro|metros)$/i.test(bruto.trim()) ? "m" : "un";
}

function parseNumero(bruto: string): number | null {
  return parsePreco(bruto);
}

export interface LinhaMapeada {
  linha: number;
  produto: Partial<ProdutoImportacao> & { precoBruto?: string };
}

/** Aplica o mapeamento coluna -> campo. Não valida; ver `validar`. */
export function aplicarMapeamento(
  linhas: Record<string, string>[],
  mapeamento: Mapeamento,
): LinhaMapeada[] {
  const ler = (l: Record<string, string>, campo: CampoMapeavel) => {
    const coluna = mapeamento[campo];
    return coluna ? (l[coluna] ?? "").trim() : undefined;
  };

  return linhas.map((l, i) => {
    const codigo = ler(l, "codigo");
    const preco = ler(l, "preco_unitario");
    const estoque = ler(l, "estoque_disponivel");
    const unidade = ler(l, "unidade");
    const categoria = ler(l, "categoria");
    const marca = ler(l, "marca");

    const atributos: Record<string, unknown> = {};
    for (const campo of ["w", "k", "comprimento"] as const) {
      const v = ler(l, campo);
      const n = v ? parseNumero(v) : null;
      if (n !== null) atributos[campo] = n;
    }

    const produto: LinhaMapeada["produto"] = {
      codigo: codigo === undefined ? undefined : normalizarCodigo(codigo),
      descricao: ler(l, "descricao"),
      precoBruto: preco,
    };
    if (preco !== undefined) produto.preco_unitario = parsePreco(preco) ?? Number.NaN;
    if (categoria !== undefined) produto.categoria = categoria || null;
    if (marca !== undefined) produto.marca = marca || null;
    if (unidade !== undefined) produto.unidade = parseUnidade(unidade);
    if (estoque !== undefined)
      produto.estoque_disponivel = estoque === "" ? null : parsePreco(estoque);
    if (Object.keys(atributos).length > 0) produto.atributos = atributos;

    return { linha: i + 1, produto };
  });
}

/** Erros de uma linha (lista vazia = válida). Não interrompe a carga. */
export function validar(item: LinhaMapeada): ErroLinha[] {
  const { linha, produto } = item;
  const erros: ErroLinha[] = [];
  const erro = (mensagem: string) =>
    erros.push({ linha, codigo: produto.codigo || null, mensagem });

  if (!produto.codigo) erro("Código obrigatório.");
  else if (!/^\d{1,5}$/.test(produto.codigo))
    erro(`Código inválido: "${produto.codigo}" (use de 1 a 5 dígitos).`);

  if (!produto.descricao) erro("Descrição obrigatória.");

  if (produto.precoBruto === undefined || produto.precoBruto === "") erro("Preço obrigatório.");
  else if (produto.preco_unitario === undefined || Number.isNaN(produto.preco_unitario))
    erro(`Preço inválido: "${produto.precoBruto}".`);
  else if (produto.preco_unitario < 0) erro("Preço não pode ser negativo.");

  if (produto.estoque_disponivel !== undefined && produto.estoque_disponivel !== null) {
    if (Number.isNaN(produto.estoque_disponivel) || produto.estoque_disponivel < 0)
      erro("Estoque inválido.");
  }
  return erros;
}

export interface CargaPreparada {
  produtos: ProdutoImportacao[];
  erros: ErroLinha[];
  /** Todos os códigos presentes na planilha (válidos ou não), usados em "desativar ausentes". */
  codigosVistos: string[];
  linhasLidas: number;
}

/** Mapeia e valida a planilha inteira. Linhas inválidas viram erros; as demais seguem. */
export function prepararCarga(
  linhas: Record<string, string>[],
  mapeamento: Mapeamento,
): CargaPreparada {
  const faltando = CAMPOS_OBRIGATORIOS.filter((c) => !mapeamento[c]);
  if (faltando.length > 0)
    throw new Error(`Mapeie os campos obrigatórios: ${faltando.join(", ")}.`);

  const produtos: ProdutoImportacao[] = [];
  const erros: ErroLinha[] = [];
  const codigosVistos = new Set<string>();

  for (const item of aplicarMapeamento(linhas, mapeamento)) {
    if (item.produto.codigo) codigosVistos.add(item.produto.codigo);
    const e = validar(item);
    if (e.length > 0) {
      erros.push(...e);
      continue;
    }
    const { precoBruto: _ignorado, ...p } = item.produto;
    void _ignorado;
    produtos.push(p as ProdutoImportacao);
  }
  return { produtos, erros, codigosVistos: [...codigosVistos], linhasLidas: linhas.length };
}

const SINONIMOS_COLUNA: Record<CampoMapeavel, string[]> = {
  codigo: ["codigo", "cod", "referencia", "ref", "sku", "id produto"],
  descricao: ["descricao", "descr", "produto", "nome", "item"],
  preco_unitario: [
    "preco",
    "preco venda",
    "preco unitario",
    "valor",
    "venda",
    "unitario",
    "preco a vista",
  ],
  categoria: ["categoria", "grupo", "familia", "linha", "tipo"],
  marca: ["marca", "fabricante"],
  unidade: ["unidade", "un", "und", "unid"],
  estoque_disponivel: ["estoque", "saldo", "qtd", "quantidade", "disponivel"],
  w: ["w", "watts", "potencia"],
  k: ["k", "kelvin", "temperatura", "cor"],
  comprimento: ["comprimento", "metragem", "tamanho"],
};

function semAcento(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Sugere o mapeamento: usa o último salvo para as colunas que ainda existem
 * e completa o resto pelo nome do cabeçalho.
 */
export function sugerirMapeamento(colunas: string[], salvo?: Mapeamento | null): Mapeamento {
  const resultado: Mapeamento = {};
  for (const [campo, coluna] of Object.entries(salvo ?? {}) as [CampoMapeavel, string][]) {
    if (colunas.includes(coluna)) resultado[campo] = coluna;
  }
  const usadas = new Set(Object.values(resultado));
  for (const campo of Object.keys(SINONIMOS_COLUNA) as CampoMapeavel[]) {
    if (resultado[campo]) continue;
    const achada = colunas.find(
      (c) =>
        !usadas.has(c) && SINONIMOS_COLUNA[campo].includes(semAcento(c).replace(/[^a-z0-9 ]/g, "")),
    );
    if (achada) {
      resultado[campo] = achada;
      usadas.add(achada);
    }
  }
  return resultado;
}
