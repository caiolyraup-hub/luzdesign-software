/** Contas do orçamento em centavos inteiros (sem erro de ponto flutuante). Puro: serve ao servidor, à tela e ao PDF. */

/** Subtotal de uma linha em centavos: preço × quantidade (quantidade pode ter 2 casas, fita por metro). */
export function subtotalCentavos(preco: number, quantidade: number): number {
  return Math.round(Math.round(preco * 100) * quantidade);
}

export function centavosParaReais(centavos: number): number {
  return centavos / 100;
}

export interface LinhaConta {
  preco_unitario: number;
  quantidade: number;
}

export function somarCentavos(linhas: LinhaConta[]): number {
  return linhas.reduce((soma, l) => soma + subtotalCentavos(l.preco_unitario, l.quantidade), 0);
}

/** Desconto à vista em centavos (arredondado); o total à vista é o total menos o desconto. */
export function descontoAvistaCentavos(totalCentavos: number, percentual: number): number {
  return Math.round((totalCentavos * percentual) / 100);
}

export interface TotaisOrcamento {
  totalCentavos: number;
  descontoCentavos: number;
  aVistaCentavos: number;
  percentual: number;
}

export function totaisDoOrcamento(linhas: LinhaConta[], percentualAvista: number): TotaisOrcamento {
  const totalCentavos = somarCentavos(linhas);
  const descontoCentavos = descontoAvistaCentavos(totalCentavos, percentualAvista);
  return {
    totalCentavos,
    descontoCentavos,
    aVistaCentavos: totalCentavos - descontoCentavos,
    percentual: percentualAvista,
  };
}

export interface ItemParaBloqueio {
  avulso: boolean;
  preco_unitario: number;
  /** null quando o item não tem produto (avulso). */
  produtoAtivo: boolean | null;
  descricao: string;
}

/**
 * Por que o orçamento ainda não pode virar PDF. Lista vazia = pode gerar.
 * Mesmas regras da função SQL gerar_orcamento (a última barreira).
 */
export function motivosBloqueioGerar(itens: ItemParaBloqueio[]): string[] {
  const motivos: string[] = [];
  if (itens.length === 0) {
    motivos.push("Adicione ao menos um item.");
    return motivos;
  }
  const semPreco = itens.filter((i) => i.avulso && !(i.preco_unitario > 0)).length;
  if (semPreco > 0) {
    motivos.push(
      semPreco === 1
        ? "Defina o preço do item avulso."
        : `Defina o preço dos ${semPreco} itens avulsos.`,
    );
  }
  const inativos = itens.filter((i) => !i.avulso && i.produtoAtivo === false);
  if (inativos.length > 0) {
    motivos.push(
      inativos.length === 1
        ? "Um produto saiu do catálogo: troque o produto."
        : `${inativos.length} produtos saíram do catálogo: troque os produtos.`,
    );
  }
  return motivos;
}

const moedaBR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 1.234,56" com espaço comum (o espaço fixo do Intl não existe em todas as fontes de PDF). */
export function moedaSimples(valor: number): string {
  return moedaBR.format(valor).replace(/ /g, " ");
}

export function moedaCentavos(centavos: number): string {
  return moedaSimples(centavosParaReais(centavos));
}
