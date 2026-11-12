import { describe, expect, it } from "vitest";
import { resumoDoCliente, textoHistorico } from "./resumo";

const o = (
  status: string,
  valor_total: number,
  criado_em: string,
  valor_fechado: number | null = null,
) => ({ status, valor_total, valor_fechado, criado_em });

describe("resumoDoCliente", () => {
  it("conta, soma o vendido pelo valor fechado e calcula o ticket médio", () => {
    const r = resumoDoCliente([
      o("fechado", 1000, "2026-11-01T15:00:00Z", 900),
      o("fechado", 2000, "2026-11-03T15:00:00Z"), // sem valor fechado: vale o total
      o("perdido", 500, "2026-11-02T15:00:00Z"),
      o("enviado", 700, "2026-11-04T15:00:00Z"),
      o("followup_d5", 300, "2026-11-04T10:00:00Z"),
      o("rascunho", 0, "2026-11-05T15:00:00Z"),
    ]);
    expect(r).toEqual({
      orcamentos: 6,
      fechados: 2,
      perdidos: 1,
      emAberto: 2,
      vendido: 2900,
      ticketMedio: 1450,
      ultimoEm: "2026-11-05T15:00:00Z",
    });
  });

  it("sem orçamentos ou sem fechados: ticket nulo", () => {
    expect(resumoDoCliente([])).toEqual({
      orcamentos: 0,
      fechados: 0,
      perdidos: 0,
      emAberto: 0,
      vendido: 0,
      ticketMedio: null,
      ultimoEm: null,
    });
    expect(resumoDoCliente([o("perdido", 100, "2026-11-01T15:00:00Z")]).ticketMedio).toBeNull();
  });

  it("arredonda centavos", () => {
    const r = resumoDoCliente([
      o("fechado", 0.1, "2026-11-01T15:00:00Z", 0.1),
      o("fechado", 0.2, "2026-11-02T15:00:00Z", 0.2),
    ]);
    expect(r.vendido).toBe(0.3);
  });
});

describe("textoHistorico", () => {
  it("no singular e no plural, com a data do último no fuso de Maceió", () => {
    expect(textoHistorico({ orcamentos: 3, fechados: 1, ultimoEm: "2026-11-04T15:00:00Z" })).toBe(
      "3 orçamentos, 1 fechado, último em 04/11",
    );
    expect(textoHistorico({ orcamentos: 1, fechados: 0, ultimoEm: "2026-11-04T15:00:00Z" })).toBe(
      "1 orçamento, 0 fechados, último em 04/11",
    );
    // 02:30 UTC do dia 5 ainda é dia 4 em Maceió
    expect(textoHistorico({ orcamentos: 2, fechados: 2, ultimoEm: "2026-11-05T02:30:00Z" })).toBe(
      "2 orçamentos, 2 fechados, último em 04/11",
    );
    expect(textoHistorico({ orcamentos: 0, fechados: 0, ultimoEm: null })).toBe(
      "Nenhum orçamento ainda",
    );
  });
});
