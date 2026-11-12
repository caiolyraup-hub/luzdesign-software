import { subtotalCentavos } from "./totais";

/**
 * Renovar a validade: compara o preço CONGELADO de cada item com o preço ATUAL do catálogo para a
 * vendedora ver as diferenças antes de escolher "Atualizar preços" ou "Manter os preços antigos".
 */

export interface ItemParaRenovar {
  id: string;
  codigo: string | null;
  descricao: string;
  ambiente: string;
  quantidade: number;
  /** Preço congelado no orçamento. */
  precoCongelado: number;
  /** Preço atual no catálogo (nulo se o produto não existe mais). */
  precoCatalogo: number | null;
  produtoAtivo: boolean;
  avulso: boolean;
  /** Estoque informado pela loja (nulo = não informado). */
  estoque: number | null;
}

export type SituacaoRenovacao = "igual" | "mudou" | "inativo" | "avulso";

export interface DiferencaItem {
  id: string;
  codigo: string | null;
  descricao: string;
  ambiente: string;
  quantidade: number;
  precoAntigo: number;
  /** Preço que valerá se atualizar (igual ao antigo para avulso e inativo). */
  precoNovo: number;
  /** Diferença por unidade, em reais (novo - antigo). */
  diferenca: number;
  /** Diferença em %, nulo quando o preço antigo é zero. */
  percentual: number | null;
  /** Diferença no total do item (quantidade x diferença), em centavos. */
  diferencaTotalCentavos: number;
  situacao: SituacaoRenovacao;
  /** Estoque informado menor que a quantidade do orçamento. */
  semEstoque: boolean;
  estoque: number | null;
}

const centavos = (n: number) => Math.round(n * 100);

/** Uma linha por item: o que mudou, o que ficou inativo e o que está sem estoque. */
export function compararPrecos(itens: ItemParaRenovar[]): DiferencaItem[] {
  return itens.map((i) => {
    const inativo = !i.avulso && (!i.produtoAtivo || i.precoCatalogo === null);
    const situacao: SituacaoRenovacao = i.avulso
      ? "avulso"
      : inativo
        ? "inativo"
        : centavos(i.precoCatalogo!) === centavos(i.precoCongelado)
          ? "igual"
          : "mudou";
    const precoNovo =
      situacao === "mudou" || situacao === "igual" ? i.precoCatalogo! : i.precoCongelado;
    const diferenca = Math.round((precoNovo - i.precoCongelado) * 100) / 100;
    return {
      id: i.id,
      codigo: i.codigo,
      descricao: i.descricao,
      ambiente: i.ambiente,
      quantidade: i.quantidade,
      precoAntigo: i.precoCongelado,
      precoNovo,
      diferenca,
      percentual:
        i.precoCongelado > 0 ? Math.round((diferenca / i.precoCongelado) * 1000) / 10 : null,
      diferencaTotalCentavos:
        subtotalCentavos(precoNovo, i.quantidade) -
        subtotalCentavos(i.precoCongelado, i.quantidade),
      situacao,
      semEstoque: !i.avulso && i.estoque !== null && i.estoque < i.quantidade,
      estoque: i.estoque,
    };
  });
}

export interface ResumoRenovacao {
  totalAntigoCentavos: number;
  /** Total se atualizar os preços. */
  totalNovoCentavos: number;
  diferencaCentavos: number;
  mudaram: number;
  inativos: number;
  semEstoque: number;
  /** Item inativo impede renovar (precisa trocar ou remover antes). */
  podeRenovar: boolean;
}

export function resumirRenovacao(difs: DiferencaItem[]): ResumoRenovacao {
  const totalAntigo = difs.reduce((s, d) => s + subtotalCentavos(d.precoAntigo, d.quantidade), 0);
  const totalNovo = difs.reduce((s, d) => s + subtotalCentavos(d.precoNovo, d.quantidade), 0);
  const inativos = difs.filter((d) => d.situacao === "inativo").length;
  return {
    totalAntigoCentavos: totalAntigo,
    totalNovoCentavos: totalNovo,
    diferencaCentavos: totalNovo - totalAntigo,
    mudaram: difs.filter((d) => d.situacao === "mudou").length,
    inativos,
    semEstoque: difs.filter((d) => d.semEstoque).length,
    podeRenovar: inativos === 0 && difs.length > 0,
  };
}

export const MODOS_RENOVACAO = ["atualizar", "manter"] as const;
export type ModoRenovacao = (typeof MODOS_RENOVACAO)[number];

export const AVISO_PRECOS_DEFASADOS = "Estes preços podem estar defasados.";

export const MENSAGEM_RENOVAR_PADRAO =
  "Olá, {cliente}! Aqui é {vendedora}, da Luz Design. O orçamento nº {numero} venceu. Posso renovar para você? Já confiro os preços de hoje.";
