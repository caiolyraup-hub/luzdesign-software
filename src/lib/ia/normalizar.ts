import { centavosParaReais, subtotalCentavos } from "../orcamento/totais";
import type { SaidaIA } from "./esquema";

/** O que o servidor sabe do catálogo (relido do banco, nunca da IA). */
export interface ProdutoCatalogo {
  codigo: string;
  descricao: string;
  unidade: "un" | "m";
  preco_unitario: number;
  ativo: boolean;
}

export interface ItemMontado {
  ambiente: string;
  ordem: number;
  codigo: string | null;
  descricao_congelada: string;
  preco_unitario_congelado: number;
  quantidade: number;
  avulso: boolean;
  justificativa: string;
}

export interface ResultadoNormalizacao {
  itens: ItemMontado[];
  avisos: string[];
  /** Total em centavos (inteiro), para não acumular erro de ponto flutuante. */
  totalCentavos: number;
}

const QUANTIDADE_MAXIMA = 100_000;

const numeroBR = (n: number) => String(n).replace(".", ",");

// As contas em centavos vivem em lib/orcamento/totais (usadas também pela revisão e pelo PDF).
export { centavosParaReais, subtotalCentavos };

/** Códigos que a IA citou (para o servidor reler no banco). */
export function codigosCitados(saida: SaidaIA): string[] {
  const codigos = new Set<string>();
  for (const a of saida.ambientes) for (const i of a.itens) if (i.codigo) codigos.add(i.codigo);
  return [...codigos];
}

/**
 * Transforma a saída da IA em itens gravaveis. Regra central: o preço e a descrição vêm SEMPRE do
 * catálogo; código que não existe ou está inativo é descartado com aviso; sem código vira avulso.
 */
export function normalizarSaida(
  saida: SaidaIA,
  catalogo: Map<string, ProdutoCatalogo>,
): ResultadoNormalizacao {
  const itens: ItemMontado[] = [];
  const avisos: string[] = [];
  let ordem = 0;

  for (const ambiente of saida.ambientes) {
    for (const item of ambiente.itens) {
      const bruta = item.quantidade;
      if (!Number.isFinite(bruta) || bruta <= 0) {
        avisos.push(`Item descartado em ${ambiente.nome}: quantidade inválida (${String(bruta)}).`);
        continue;
      }
      if (bruta > QUANTIDADE_MAXIMA) {
        avisos.push(
          `Item descartado em ${ambiente.nome}: quantidade absurda (${numeroBR(bruta)}).`,
        );
        continue;
      }

      if (item.codigo) {
        const produto = catalogo.get(item.codigo);
        if (!produto || !produto.ativo) {
          avisos.push(
            `Código ${item.codigo} descartado em ${ambiente.nome}: ${
              produto ? "produto inativo" : "não existe no catálogo"
            }.`,
          );
          continue;
        }

        let quantidade: number;
        if (produto.unidade === "un") {
          quantidade = Math.ceil(bruta - 1e-9);
          if (quantidade !== bruta) {
            avisos.push(
              `Quantidade do código ${produto.codigo} em ${ambiente.nome} arredondada de ${numeroBR(bruta)} para ${quantidade} (vendido por unidade).`,
            );
          }
        } else {
          quantidade = Math.round(bruta * 100) / 100;
          if (quantidade <= 0) {
            avisos.push(
              `Item ${produto.codigo} descartado em ${ambiente.nome}: quantidade pequena demais.`,
            );
            continue;
          }
        }

        // Mesmo código no mesmo ambiente: uma linha só.
        const existente = itens.find(
          (i) => i.ambiente === ambiente.nome && i.codigo === produto.codigo,
        );
        if (existente) {
          existente.quantidade = Math.round((existente.quantidade + quantidade) * 100) / 100;
          existente.justificativa = [existente.justificativa, item.justificativa]
            .filter(Boolean)
            .join(" ");
          continue;
        }

        itens.push({
          ambiente: ambiente.nome,
          ordem: ordem++,
          codigo: produto.codigo,
          descricao_congelada: produto.descricao,
          preco_unitario_congelado: produto.preco_unitario,
          quantidade,
          avulso: false,
          justificativa: item.justificativa,
        });
        continue;
      }

      // Sem código: item avulso, preço a definir pela vendedora.
      const descricao = item.descricao_avulso?.trim();
      if (!descricao) {
        avisos.push(`Item sem código e sem descrição descartado em ${ambiente.nome}.`);
        continue;
      }
      const quantidade = Math.ceil(bruta - 1e-9);
      if (quantidade !== bruta) {
        avisos.push(
          `Quantidade do item avulso "${descricao}" arredondada de ${numeroBR(bruta)} para ${quantidade}.`,
        );
      }
      itens.push({
        ambiente: ambiente.nome,
        ordem: ordem++,
        codigo: null,
        descricao_congelada: descricao,
        preco_unitario_congelado: 0,
        quantidade,
        avulso: true,
        justificativa: item.justificativa,
      });
    }
  }

  const totalCentavos = itens.reduce(
    (soma, i) => soma + subtotalCentavos(i.preco_unitario_congelado, i.quantidade),
    0,
  );
  return { itens, avisos, totalCentavos };
}
