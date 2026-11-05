import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buscarProdutos } from "../estoque/buscar";

/** Executa uma ferramenta pedida pela IA. Erros viram { erro } para a IA se recuperar. */
export type ExecutorFerramentas = (nome: string, argumentosJson: string) => Promise<unknown>;

/** Definições no formato de function tools da Responses API (strict: todos os campos obrigatórios). */
export const DEFINICOES_FERRAMENTAS = [
  {
    type: "function",
    name: "buscar_produtos",
    description:
      "Busca produtos ativos do catálogo da loja por código, descrição, marca, categoria ou apelido. " +
      "Devolve código, categoria, marca, descrição, unidade (un ou m), preço (só para comparar), " +
      "estoque_disponivel (null = desconhecido) e atributos (w, k, comprimento).",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["texto", "categoria", "marca", "limite"],
      properties: {
        texto: {
          type: "string",
          description: "Termos curtos, por exemplo 'fita 22W 3000K' ou 'embutido dic 6w'.",
        },
        categoria: {
          type: ["string", "null"],
          description:
            "Filtro exato de categoria (EMBUTIDO, FITA LED, PERFIL, FONTE, SPOT, PLAFON, ARANDELA, ...) ou null.",
        },
        marca: {
          type: ["string", "null"],
          description: "Filtro exato de marca (MB, NIT, STELLA, ...) ou null.",
        },
        limite: {
          type: ["integer", "null"],
          description: "Quantos resultados (1 a 15). null = 10.",
        },
      },
    },
  },
  {
    type: "function",
    name: "detalhar_produto",
    description:
      "Devolve um produto pelo código, com atributos e apelidos. Use para conferir códigos citados no pedido.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["codigo"],
      properties: { codigo: { type: "string", description: "Código do produto (1 a 5 dígitos)." } },
    },
  },
] as const;

const argsBuscar = z.object({
  texto: z.string().max(200).default(""),
  categoria: z.string().max(60).nullish(),
  marca: z.string().max(60).nullish(),
  limite: z.number().int().nullish(),
});
const argsDetalhar = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^\d{1,5}$/),
});

const LIMITE_PADRAO = 10;
const LIMITE_MAXIMO = 15;

/**
 * As ferramentas usam o cliente Supabase da PRÓPRIA vendedora: a RLS vale e a IA nunca enxerga
 * mais do que ela enxergaria. O preço devolvido aqui é só informação; o gravado é relido do banco.
 */
export function criarExecutorFerramentas(supabase: SupabaseClient): ExecutorFerramentas {
  return async (nome, argumentosJson) => {
    let bruto: unknown;
    try {
      bruto = JSON.parse(argumentosJson || "{}");
    } catch {
      return { erro: "Argumentos inválidos (JSON)." };
    }

    try {
      if (nome === "buscar_produtos") {
        const a = argsBuscar.safeParse(bruto);
        if (!a.success) return { erro: "Argumentos inválidos para buscar_produtos." };
        const limite = Math.min(Math.max(a.data.limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);
        const produtos = await buscarProdutos(supabase, {
          texto: a.data.texto,
          categoria: a.data.categoria ?? null,
          marca: a.data.marca ?? null,
          limite,
        });
        return {
          total: produtos.length,
          produtos: produtos.map((p) => ({
            codigo: p.codigo,
            categoria: p.categoria,
            marca: p.marca,
            descricao: p.descricao,
            unidade: p.unidade,
            preco_unitario: p.preco_unitario,
            estoque_disponivel: p.estoque_disponivel,
            atributos: p.atributos,
          })),
        };
      }

      if (nome === "detalhar_produto") {
        const a = argsDetalhar.safeParse(bruto);
        if (!a.success) return { erro: "Código inválido: use de 1 a 5 dígitos." };
        const { data: produto, error } = await supabase
          .from("produtos")
          .select(
            "codigo, categoria, marca, descricao, unidade, preco_unitario, estoque_disponivel, atributos, ativo",
          )
          .eq("codigo", a.data.codigo)
          .maybeSingle();
        if (error) return { erro: "Não foi possível consultar o produto agora." };
        if (!produto) return { encontrado: false, codigo: a.data.codigo };
        const { data: apelidos } = await supabase
          .from("produto_apelidos")
          .select("texto")
          .eq("codigo", a.data.codigo);
        return {
          encontrado: true,
          ...produto,
          preco_unitario: Number(produto.preco_unitario),
          estoque_disponivel:
            produto.estoque_disponivel === null ? null : Number(produto.estoque_disponivel),
          apelidos: (apelidos ?? []).map((x) => x.texto),
        };
      }

      return { erro: `Ferramenta desconhecida: ${nome}.` };
    } catch {
      return { erro: "Falha ao consultar o catálogo. Tente outra busca." };
    }
  };
}
