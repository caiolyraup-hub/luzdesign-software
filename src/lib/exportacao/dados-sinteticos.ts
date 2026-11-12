import type { EventoExport, FonteExportacao, ItemExport, OrcamentoExport } from "./planilha";

/** Dados fictícios para teste e para o exemplo: N orçamentos e K itens por orçamento. */
export function dadosSinteticos(n: number, itensPorOrcamento: number) {
  const status = ["rascunho", "gerado", "enviado", "followup_d5", "fechado", "perdido"];
  const vendedoras = [
    { id: "v1", nome: "Aline" },
    { id: "v2", nome: "Kely" },
  ];
  const orcamentos: OrcamentoExport[] = Array.from({ length: n }, (_, i) => {
    const st = status[i % status.length];
    const v = vendedoras[i % 2];
    const dia = String((i % 27) + 1).padStart(2, "0");
    return {
      id: `o${i}`,
      numero: `2026-${String(i + 1).padStart(4, "0")}`,
      vendedora_id: v.id,
      vendedora_nome: v.nome,
      cliente_id: `c${i % 800}`,
      cliente_nome: `Cliente ${i % 800}`,
      cliente_whatsapp: `+5582988${String(10000 + (i % 800))}`,
      cliente_tipo: i % 5 === 0 ? "arquiteto" : "final",
      arquiteto_indicador: i % 5 === 0 ? `Arq ${i % 40}` : null,
      status: st,
      valor_total: 1000 + (i % 97) * 13.37,
      valor_fechado: st === "fechado" ? 900 + (i % 97) * 13 : null,
      motivo_perda: st === "perdido" ? "preco" : null,
      criado_em: `2026-10-${dia}T15:00:00.000Z`,
      gerado_em: st === "rascunho" ? null : `2026-10-${dia}T16:00:00.000Z`,
      enviado_em: ["enviado", "followup_d5", "fechado", "perdido"].includes(st)
        ? `2026-10-${dia}T17:00:00.000Z`
        : null,
      ultimo_envio_em: ["enviado", "followup_d5", "fechado", "perdido"].includes(st)
        ? `2026-10-${dia}T17:00:00.000Z`
        : null,
      fechado_em: st === "fechado" ? `2026-11-${dia}T12:00:00.000Z` : null,
      perdido_em: st === "perdido" ? `2026-11-${dia}T12:00:00.000Z` : null,
      validade: st === "rascunho" ? null : `2026-11-${dia}`,
      pdf_versao: st === "rascunho" ? 0 : 1 + (i % 3),
    };
  });
  const itens = async (ids: string[]): Promise<ItemExport[]> =>
    ids.flatMap((id) =>
      Array.from({ length: itensPorOrcamento }, (_, k) => ({
        orcamento_id: id,
        ambiente: ["Sala", "Cozinha", "Quarto"][k % 3],
        codigo: k % 7 === 6 ? null : String(9000 + k),
        descricao: k % 7 === 6 ? "Pendente avulso vidro fumê" : `STELLA DIC ${k + 3}W 2.7K`,
        quantidade: 1 + (k % 4) + (k % 2 ? 0.5 : 0),
        unidade: k % 5 === 0 ? "m" : "un",
        preco_unitario: 20 + k * 1.1,
        avulso: k % 7 === 6,
        origem: ["manual", "lista_colada", "indicacao_ia", "montagem_ia"][k % 4],
      })),
    );
  const eventos = async (ids: string[]): Promise<EventoExport[]> =>
    ids.flatMap((id) => [
      {
        orcamento_id: id,
        de_status: null,
        para_status: "rascunho",
        criado_em: "2026-10-05T15:00:00.000Z",
        quem: "Aline",
      },
      {
        orcamento_id: id,
        de_status: "rascunho",
        para_status: "gerado",
        criado_em: "2026-10-05T16:00:00.000Z",
        quem: "Aline",
      },
    ]);
  const fonte: FonteExportacao = { orcamentos, itens, eventos };
  return fonte;
}
