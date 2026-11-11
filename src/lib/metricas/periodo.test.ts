import { describe, expect, it } from "vitest";
import { dataISOValida, paramsDoPeriodo, resolverPeriodo } from "./periodo";

// 15/11/2026 12:00 em Maceió (UTC-3).
const AGORA = new Date("2026-11-15T15:00:00Z");

describe("resolverPeriodo", () => {
  it("padrão: do dia 1 do mês até hoje", () => {
    const p = resolverPeriodo({}, AGORA);
    expect(p).toMatchObject({ id: "mes", inicio: "2026-11-01", fim: "2026-11-15", aviso: null });
    expect(p.descricao).toBe("01/11/2026 a 15/11/2026");
  });

  it("usa o calendário de Maceió: 01/12 02:30 UTC ainda é 30/11", () => {
    expect(resolverPeriodo({}, new Date("2026-12-01T02:30:00Z"))).toMatchObject({
      inicio: "2026-11-01",
      fim: "2026-11-30",
    });
    expect(resolverPeriodo({}, new Date("2026-12-01T03:00:00Z"))).toMatchObject({
      inicio: "2026-12-01",
      fim: "2026-12-01",
    });
  });

  it("mês passado", () => {
    expect(resolverPeriodo({ periodo: "mes-anterior" }, AGORA)).toMatchObject({
      id: "mes-anterior",
      inicio: "2026-10-01",
      fim: "2026-10-31",
    });
  });

  it("mês passado em janeiro volta para dezembro do ano anterior", () => {
    expect(
      resolverPeriodo({ periodo: "mes-anterior" }, new Date("2027-01-10T15:00:00Z")),
    ).toMatchObject({ inicio: "2026-12-01", fim: "2026-12-31" });
  });

  it("mês passado em março de ano bissexto termina em 29/02", () => {
    expect(
      resolverPeriodo({ periodo: "mes-anterior" }, new Date("2028-03-10T15:00:00Z")),
    ).toMatchObject({ inicio: "2028-02-01", fim: "2028-02-29" });
  });

  it("90 dias: hoje e os 89 anteriores", () => {
    expect(resolverPeriodo({ periodo: "90-dias" }, AGORA)).toMatchObject({
      inicio: "2026-08-18",
      fim: "2026-11-15",
    });
  });

  it("personalizado válido", () => {
    const p = resolverPeriodo(
      { periodo: "personalizado", de: "2026-10-05", ate: "2026-11-02" },
      AGORA,
    );
    expect(p).toMatchObject({
      id: "personalizado",
      inicio: "2026-10-05",
      fim: "2026-11-02",
      aviso: null,
    });
  });

  it("personalizado de um dia só vale", () => {
    expect(
      resolverPeriodo({ periodo: "personalizado", de: "2026-11-03", ate: "2026-11-03" }, AGORA)
        .aviso,
    ).toBeNull();
  });

  it.each([
    ["sem datas", undefined, undefined],
    ["data inexistente", "2026-02-30", "2026-03-05"],
    ["formato errado", "05/10/2026", "2026-11-02"],
    ["fim antes do início", "2026-11-10", "2026-11-01"],
    ["mais de 366 dias", "2025-01-01", "2026-11-01"],
  ])("personalizado inválido (%s) cai no mês atual com aviso", (_nome, de, ate) => {
    const p = resolverPeriodo({ periodo: "personalizado", de, ate }, AGORA);
    expect(p).toMatchObject({ id: "mes", inicio: "2026-11-01", fim: "2026-11-15" });
    expect(p.aviso).toBeTruthy();
  });

  it("exatamente 366 dias ainda vale; 367 não", () => {
    expect(
      resolverPeriodo({ periodo: "personalizado", de: "2025-11-01", ate: "2026-11-01" }, AGORA)
        .aviso,
    ).toBeNull();
    expect(
      resolverPeriodo({ periodo: "personalizado", de: "2025-10-31", ate: "2026-11-01" }, AGORA)
        .aviso,
    ).toBeTruthy();
  });

  it("período desconhecido vira o mês atual", () => {
    expect(resolverPeriodo({ periodo: "ano" }, AGORA).id).toBe("mes");
  });
});

describe("dataISOValida e paramsDoPeriodo", () => {
  it("valida o calendário", () => {
    expect(dataISOValida("2028-02-29")).toBe(true);
    expect(dataISOValida("2026-02-29")).toBe(false);
    expect(dataISOValida("2026-13-01")).toBe(false);
    expect(dataISOValida("")).toBe(false);
  });

  it("monta os parâmetros da URL", () => {
    expect(paramsDoPeriodo(resolverPeriodo({ periodo: "90-dias" }, AGORA))).toEqual({
      periodo: "90-dias",
    });
    expect(
      paramsDoPeriodo(
        resolverPeriodo({ periodo: "personalizado", de: "2026-10-05", ate: "2026-11-02" }, AGORA),
      ),
    ).toEqual({ periodo: "personalizado", de: "2026-10-05", ate: "2026-11-02" });
  });
});
