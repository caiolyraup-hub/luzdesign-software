import { OPCOES_AMBIENTES, type Respostas } from "./perguntas";

/** Item como a tela de revisão enxerga (já com os dados do catálogo ao lado). */
export interface ItemRevisao {
  id: string;
  /** null = item avulso. */
  codigo: string | null;
  descricao: string;
  /** Preço unitário congelado no item (reais). */
  preco: number;
  quantidade: number;
  ambiente: string;
  avulso: boolean;
  justificativa: string | null;
  ordem: number;
  marca: string | null;
  unidade: "un" | "m";
  /** null quando o item não tem produto. */
  produtoAtivo: boolean | null;
  /** Preço atual do produto no catálogo (null em avulso). */
  precoCatalogo: number | null;
  /** Descrição atual do produto no catálogo (null em avulso). */
  descricaoCatalogo?: string | null;
  /** Motivo curto da indicação, para o cliente (vai no PDF). */
  motivo?: string | null;
}

export const QUANTIDADE_MAXIMA = 100_000;

export type ResultadoQuantidade =
  { ok: true; valor: number; ajustada: boolean } | { ok: false; erro: string };

/**
 * Regras de quantidade: maior que zero; por unidade (un) é número inteiro (arredonda para cima);
 * por metro (m) aceita até 2 casas. Item avulso conta como unidade, mas aceita 2 casas.
 */
export function normalizarQuantidade(
  unidade: "un" | "m",
  bruto: number,
  avulso = false,
): ResultadoQuantidade {
  if (!Number.isFinite(bruto) || bruto <= 0)
    return { ok: false, erro: "A quantidade precisa ser maior que zero." };
  if (bruto > QUANTIDADE_MAXIMA) return { ok: false, erro: "Quantidade grande demais." };
  if (unidade === "un" && !avulso) {
    const valor = Math.ceil(bruto - 1e-9);
    return { ok: true, valor, ajustada: valor !== bruto };
  }
  const valor = Math.round(bruto * 100) / 100;
  if (valor <= 0) return { ok: false, erro: "A quantidade precisa ser maior que zero." };
  return { ok: true, valor, ajustada: valor !== bruto };
}

const chave = (nome: string) => nome.trim().toLowerCase();

/** Nome de ambiente limpo (1 a 60 caracteres) ou null se inválido. */
export function nomeAmbienteValido(bruto: string): string | null {
  const nome = bruto.replace(/\s+/g, " ").trim();
  return nome.length >= 1 && nome.length <= 60 ? nome : null;
}

/** Ambientes da pergunta 5 como rótulos ("Sala", "Cozinha", e o "outro" digitado). */
export function ambientesDasRespostas(respostas: Respostas): string[] {
  const valores = Array.isArray(respostas.ambientes) ? (respostas.ambientes as string[]) : [];
  const nomes: string[] = [];
  for (const v of valores) {
    if (v === "outro") {
      const outro =
        typeof respostas.ambiente_outro === "string"
          ? nomeAmbienteValido(respostas.ambiente_outro)
          : null;
      if (outro) nomes.push(outro);
    } else {
      const rotulo = OPCOES_AMBIENTES.find((o) => o.valor === v)?.rotulo;
      if (rotulo) nomes.push(rotulo);
    }
  }
  return nomes;
}

export interface GrupoAmbiente {
  nome: string;
  itens: ItemRevisao[];
}

/**
 * Agrupa os itens por ambiente. Ordem: primeiro os ambientes da base (perguntas e os acrescentados
 * à mão), depois os que só existem nos itens. Ambientes sem item aparecem vazios.
 */
export function agruparPorAmbiente(itens: ItemRevisao[], base: string[]): GrupoAmbiente[] {
  const grupos: GrupoAmbiente[] = [];
  const achar = (nome: string) => grupos.find((g) => chave(g.nome) === chave(nome));
  for (const nome of base) if (!achar(nome)) grupos.push({ nome, itens: [] });
  const ordenados = [...itens].sort((a, b) => a.ordem - b.ordem);
  for (const item of ordenados) {
    const nome = item.ambiente.trim() || "Geral";
    (achar(nome) ?? grupos[grupos.push({ nome, itens: [] }) - 1]).itens.push(item);
  }
  return grupos;
}

/** Itens com código cujo preço no catálogo é diferente do preço guardado. */
export function itensComPrecoMudado(itens: ItemRevisao[]): ItemRevisao[] {
  return itens.filter(
    (i) =>
      !i.avulso &&
      i.precoCatalogo !== null &&
      Math.round(i.precoCatalogo * 100) !== Math.round(i.preco * 100),
  );
}
