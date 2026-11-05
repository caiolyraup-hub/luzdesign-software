import { z } from "zod";

/**
 * Saída estruturada da IA (structured outputs, strict). Todos os campos são obrigatórios
 * (a API exige); "não se aplica" vai como null. Não há campo de preço: a IA não define preço.
 */
export const ESQUEMA_JSON_SAIDA = {
  type: "object",
  additionalProperties: false,
  required: ["ambientes", "pendencias", "resumo_para_vendedora"],
  properties: {
    ambientes: {
      type: "array",
      description: "Um bloco por ambiente, na ordem em que a vendedora listou.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nome", "itens"],
        properties: {
          nome: { type: "string", description: "Nome do ambiente, como na pergunta 5." },
          itens: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["codigo", "quantidade", "justificativa", "descricao_avulso"],
              properties: {
                codigo: {
                  type: ["string", "null"],
                  description:
                    "Código do produto vindo das ferramentas; null se não existe no catálogo.",
                },
                quantidade: {
                  type: "number",
                  description:
                    "Maior que 0. Unidade (un) em número inteiro; metro (m) pode ter até 2 casas.",
                },
                justificativa: {
                  type: "string",
                  description:
                    "Por que este item e esta quantidade (e como chegou na conta, nos kits de fita).",
                },
                descricao_avulso: {
                  type: ["string", "null"],
                  description: "Só quando codigo é null: o que falta no catálogo.",
                },
              },
            },
          },
        },
      },
    },
    pendencias: {
      type: "array",
      description:
        "O que faltou para um orçamento completo (medidas, quantidades de pontos, dúvidas).",
      items: { type: "string" },
    },
    resumo_para_vendedora: {
      type: "string",
      description: "Resumo curto, em português, do que foi montado e do que precisa de atenção.",
    },
  },
} as const;

export const schemaItemIA = z.object({
  codigo: z.string().trim().nullable(),
  quantidade: z.number(),
  justificativa: z.string().default(""),
  descricao_avulso: z.string().trim().nullable().default(null),
});

export const schemaSaidaIA = z.object({
  ambientes: z.array(
    z.object({
      nome: z.string().trim().min(1),
      itens: z.array(schemaItemIA),
    }),
  ),
  pendencias: z.array(z.string()).default([]),
  resumo_para_vendedora: z.string().default(""),
});

export type ItemIA = z.infer<typeof schemaItemIA>;
export type SaidaIA = z.infer<typeof schemaSaidaIA>;
