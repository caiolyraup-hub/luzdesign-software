import { z } from "zod";

/** Limites dos textos para o cliente (a vendedora pode editar na revisão). */
export const MAX_MOTIVO = 160;
export const MAX_ANALISE = 600;

/**
 * Saída estruturada da IA (structured outputs, strict). Todos os campos são obrigatórios
 * (a API exige); "não se aplica" vai como null ou lista vazia. Não há campo de preço: a IA não define preço.
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
        required: ["nome", "analise_ambiente", "anexos_usados", "itens"],
        properties: {
          nome: { type: "string", description: "Nome do ambiente, como na pergunta 5." },
          analise_ambiente: {
            type: "string",
            description:
              "2 a 4 frases PARA O CLIENTE sobre o ambiente: uso do espaço, luz natural, pé-direito, forro, sensação desejada e onde a luz faz diferença. Só o que está nas respostas, fotos ou plantas. Sem preço.",
          },
          anexos_usados: {
            type: "array",
            description:
              "Ids (como informados no atendimento) dos anexos que embasaram a análise deste ambiente. Vazio se nenhum.",
            items: { type: "string" },
          },
          itens: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "codigo",
                "quantidade",
                "justificativa",
                "motivo_cliente",
                "descricao_avulso",
              ],
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
                    "INTERNA, para a vendedora: por que este item e como chegou na quantidade (conta dos kits de fita).",
                },
                motivo_cliente: {
                  type: "string",
                  description: `PARA O CLIENTE: uma frase curta (até cerca de ${MAX_MOTIVO} caracteres) dizendo por que este produto foi indicado para este ambiente. Sem preço nem marca concorrente.`,
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

/** Reescrever só a análise de um ambiente (ação "Reescrever análise com IA"). */
export const ESQUEMA_JSON_ANALISE = {
  type: "object",
  additionalProperties: false,
  required: ["analise_ambiente", "anexos_usados"],
  properties: {
    analise_ambiente: ESQUEMA_JSON_SAIDA.properties.ambientes.items.properties.analise_ambiente,
    anexos_usados: ESQUEMA_JSON_SAIDA.properties.ambientes.items.properties.anexos_usados,
  },
} as const;

export const schemaItemIA = z.object({
  codigo: z.string().trim().nullable(),
  quantidade: z.number(),
  justificativa: z.string().default(""),
  motivo_cliente: z.string().default(""),
  descricao_avulso: z.string().trim().nullable().default(null),
});

export const schemaSaidaIA = z.object({
  ambientes: z.array(
    z.object({
      nome: z.string().trim().min(1),
      analise_ambiente: z.string().default(""),
      anexos_usados: z.array(z.string()).default([]),
      itens: z.array(schemaItemIA),
    }),
  ),
  pendencias: z.array(z.string()).default([]),
  resumo_para_vendedora: z.string().default(""),
});

export const schemaAnaliseIA = z.object({
  analise_ambiente: z.string().default(""),
  anexos_usados: z.array(z.string()).default([]),
});

export type ItemIA = z.infer<typeof schemaItemIA>;
export type SaidaIA = z.infer<typeof schemaSaidaIA>;
export type AnaliseIA = z.infer<typeof schemaAnaliseIA>;
