import { describe, expect, it } from "vitest";
import {
  calcularComissoes,
  lerPercentual,
  resolverPeriodoComissao,
  resumirComissoes,
  semPercentuais,
  valorComissao,
  type LinhaComissao,
  type PercentuaisComissao,
} from "./calculo";

const VAZIO: PercentuaisComissao = {
  arquitetoPadrao: null,
  vendedoraPadrao: null,
  vendedoraComArquiteto: null,
};
const ARQ = "arq-1";
const VEND = "vend-1";

describe("lerPercentual", () => {
  it.each([
    ["5", 5],
    ["5,5", 5.5],
    ["5.50", 5.5],
    [" 7 % ", 7],
    ["0", 0],
    ["30", 30],
    ["12,25", 12.25],
  ])("%s -> %s", (texto, n) => expect(lerPercentual(texto)).toBe(n));

  it("vazio é 'não definido' (null) e inválido é undefined", () => {
    expect(lerPercentual("")).toBeNull();
    expect(lerPercentual("  ")).toBeNull();
    expect(lerPercentual(null)).toBeNull();
    for (const ruim of ["30,01", "31", "-1", "abc", "5,555", "1e2"])
      expect(lerPercentual(ruim), ruim).toBeUndefined();
  });
});

describe("valorComissao (2 casas, arredondamento comercial)", () => {
  it.each([
    [1200, 5, 60],
    [1200, 3, 36],
    [100.05, 3.33, 3.33],
    [100.05, 1.5, 1.5],
    [333.33, 3, 10],
    [0.5, 10, 0.05],
  ])("%s x %s%% = %s", (base, pct, esperado) => expect(valorComissao(base, pct)).toBe(esperado));
});

describe("calcularComissoes", () => {
  const f = { valorFechado: 1000, arquitetoId: ARQ, vendedoraId: VEND };

  it("percentuais vazios não calculam nada", () => {
    expect(calcularComissoes(f, VAZIO)).toEqual([]);
    expect(semPercentuais(VAZIO)).toBe(true);
  });

  it("padrão do arquiteto e da vendedora", () => {
    const p = { ...VAZIO, arquitetoPadrao: 5, vendedoraPadrao: 3 };
    expect(semPercentuais(p)).toBe(false);
    expect(calcularComissoes(f, p)).toEqual([
      { tipo: "arquiteto", beneficiarioId: ARQ, base: 1000, percentual: 5, valor: 50 },
      { tipo: "vendedora", beneficiarioId: VEND, base: 1000, percentual: 3, valor: 30 },
    ]);
  });

  it("sem arquiteto só a vendedora; arquiteto sem percentual não gera linha", () => {
    const p = { ...VAZIO, vendedoraPadrao: 3 };
    expect(calcularComissoes({ ...f, arquitetoId: null }, p).map((l) => l.tipo)).toEqual([
      "vendedora",
    ]);
    expect(calcularComissoes(f, p).map((l) => l.tipo)).toEqual(["vendedora"]);
  });

  it("percentual próprio vale sobre o padrão; venda com arquiteto tem regra própria", () => {
    const p: PercentuaisComissao = {
      arquitetoPadrao: 5,
      vendedoraPadrao: 3,
      vendedoraComArquiteto: null,
      arquitetos: { [ARQ]: 10 },
      vendedoras: { [VEND]: 4 },
    };
    const l = calcularComissoes(f, p);
    expect(l.map((x) => x.percentual)).toEqual([10, 4]);
    const com = calcularComissoes(f, { ...p, vendedoraComArquiteto: 2 });
    expect(com.find((x) => x.tipo === "vendedora")?.percentual).toBe(2);
    // sem arquiteto a regra "com arquiteto" não vale
    const sem = calcularComissoes({ ...f, arquitetoId: null }, { ...p, vendedoraComArquiteto: 2 });
    expect(sem.find((x) => x.tipo === "vendedora")?.percentual).toBe(4);
  });
});

describe("resolverPeriodoComissao", () => {
  it("mês atual por padrão, mês anterior e intervalo", () => {
    expect(resolverPeriodoComissao({}, "2026-11-13")).toEqual({
      de: "2026-11-01",
      ate: "2026-11-01",
      rotulo: "novembro de 2026",
    });
    expect(resolverPeriodoComissao({ periodo: "anterior" }, "2027-01-05")).toMatchObject({
      de: "2026-12-01",
      rotulo: "dezembro de 2026",
    });
    expect(
      resolverPeriodoComissao(
        { periodo: "intervalo", de: "2026-09-10", ate: "2026-11-02" },
        "2026-11-13",
      ),
    ).toMatchObject({ de: "2026-09-01", ate: "2026-11-01" });
  });

  it("intervalo inválido volta para o mês atual", () => {
    expect(
      resolverPeriodoComissao(
        { periodo: "intervalo", de: "2026-11-10", ate: "2026-09-01" },
        "2026-11-13",
      ).de,
    ).toBe("2026-11-01");
    expect(
      resolverPeriodoComissao({ periodo: "intervalo", de: "x", ate: "y" }, "2026-11-13").de,
    ).toBe("2026-11-01");
  });
});

describe("resumirComissoes", () => {
  const l = (p: Partial<LinhaComissao>): LinhaComissao => ({
    id: "x",
    orcamentoId: "o",
    tipo: "arquiteto",
    beneficiarioId: "a1",
    base: 1000,
    percentual: 5,
    valor: 50,
    status: "a_pagar",
    ...p,
  });

  it("soma por status e por beneficiário; cancelada não conta", () => {
    const r = resumirComissoes([
      l({}),
      l({ id: "2", status: "paga", valor: 30, base: 600 }),
      l({ id: "3", status: "cancelada", valor: 999 }),
      l({ id: "4", tipo: "vendedora", beneficiarioId: "v1", valor: 36, base: 1200 }),
    ]);
    expect(r).toMatchObject({ aPagar: 86, pagas: 30, arquitetos: 80, vendedoras: 36 });
    expect(r.porArquiteto).toEqual([
      { beneficiarioId: "a1", vendas: 2, vendido: 1600, aPagar: 50, paga: 30 },
    ]);
    expect(r.porVendedora[0]).toMatchObject({ beneficiarioId: "v1", vendas: 1, aPagar: 36 });
  });
});
