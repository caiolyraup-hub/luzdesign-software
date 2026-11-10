import type { ClienteIA, RespostaIA } from "./motor";

/**
 * Cliente de IA FALSO para os testes ponta a ponta (IA_SIMULADA=1, nunca em produção): responde na
 * hora, sem rede e sem custo, no mesmo formato da API. Indicação: sugere fita e fonte (e um código
 * inventado, para o servidor descartar). Formatação: devolve "Padronizada: <descrição>".
 */
export function criarClienteIASimulado(): ClienteIA {
  const resposta = (conteudo: unknown): RespostaIA => ({
    output: [
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(conteudo) }] },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  });

  return {
    responses: {
      async create(parametros) {
        const formato = (parametros.text as { format?: { name?: string } } | undefined)?.format;
        if (formato?.name === "formatacao_luz_design") {
          const entrada = JSON.parse(
            (parametros.input as { content: { text: string }[] }[])[0].content[0].text ?? "{}",
          ) as { produtos?: { codigo: string; descricao: string }[]; ambientes?: string[] };
          return resposta({
            produtos: (entrada.produtos ?? []).map((p) => ({
              codigo: p.codigo,
              descricao_formatada: `Padronizada: ${p.descricao}`,
            })),
            ambientes: (entrada.ambientes ?? []).map((a) => ({ original: a, formatado: a })),
          });
        }
        return resposta({
          resumo: "Indicação simulada: fita de 22 W com a fonte para o ambiente.",
          sugestoes: [
            { codigo: "12222", quantidade: 4, motivo: "Fita simulada, 4 m." },
            { codigo: "10340", quantidade: 1, motivo: "Fonte simulada para a fita." },
            {
              codigo: "00001",
              quantidade: 2,
              motivo: "Código que não existe (deve ser descartado).",
            },
          ],
          observacoes: ["Confirmar tensão (12/24 V) da fita e da fonte."],
        });
      },
    },
  };
}
