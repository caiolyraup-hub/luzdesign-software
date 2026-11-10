import { z } from "zod";

/** Quantas sugestões a Indicação devolve, no máximo. */
export const MAX_SUGESTOES = 20;
/** Limite do motivo (interno, curto) de cada sugestão. */
export const MAX_MOTIVO_SUGESTAO = 200;

/**
 * Saída estruturada da Indicação da IA (structured outputs, strict). Todos os campos são
 * obrigatórios (a API exige). Não há campo de preço: a IA não define preço.
 */
export const ESQUEMA_JSON_INDICACAO = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "sugestoes", "observacoes"],
  properties: {
    resumo: {
      type: "string",
      description:
        "2 a 3 frases PARA A VENDEDORA: o que foi sugerido para o ambiente e a lógica geral.",
    },
    sugestoes: {
      type: "array",
      description: "Produtos do catálogo sugeridos para o ambiente.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "quantidade", "motivo"],
        properties: {
          codigo: {
            type: "string",
            description: "Código do produto, vindo das ferramentas (1 a 5 dígitos).",
          },
          quantidade: {
            type: "number",
            description:
              "Maior que 0. Unidade (un) em número inteiro; metro (m) pode ter até 2 casas.",
          },
          motivo: {
            type: "string",
            description: "INTERNO e curto: por que este produto e como chegou na quantidade.",
          },
        },
      },
    },
    observacoes: {
      type: "array",
      description:
        'Avisos para a vendedora (por exemplo "a fita pedida precisa de fonte; sugeri uma de 60 W"). Lista vazia se não houver.',
      items: { type: "string" },
    },
  },
} as const;

export const schemaIndicacaoIA = z.object({
  resumo: z.string().default(""),
  sugestoes: z.array(
    z.object({
      codigo: z.string().trim(),
      quantidade: z.number(),
      motivo: z.string().default(""),
    }),
  ),
  observacoes: z.array(z.string()).default([]),
});

export type SaidaIndicacao = z.infer<typeof schemaIndicacaoIA>;

/** Padronização de texto: descrição comercial dos produtos e nome dos ambientes. */
export const ESQUEMA_JSON_FORMATACAO = {
  type: "object",
  additionalProperties: false,
  required: ["produtos", "ambientes"],
  properties: {
    produtos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "descricao_formatada"],
        properties: {
          codigo: { type: "string" },
          descricao_formatada: {
            type: "string",
            description:
              "Descrição comercial em português, com abreviações abertas, mantendo TODOS os números e medidas da original.",
          },
        },
      },
    },
    ambientes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "formatado"],
        properties: {
          original: { type: "string" },
          formatado: { type: "string", description: "Mesmo nome com maiúsculas e acentos certos." },
        },
      },
    },
  },
} as const;

export const schemaFormatacaoIA = z.object({
  produtos: z.array(z.object({ codigo: z.string().trim(), descricao_formatada: z.string() })),
  ambientes: z.array(z.object({ original: z.string(), formatado: z.string() })).default([]),
});

export type SaidaFormatacao = z.infer<typeof schemaFormatacaoIA>;
