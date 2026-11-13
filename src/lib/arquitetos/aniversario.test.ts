import { describe, expect, it } from "vitest";
import {
  diaNoAno,
  mensagemAniversario,
  normalizarNomeArquiteto,
  proximaOcorrencia,
  proximosAniversarios,
  rotuloAniversario,
} from "./aniversario";

const arq = (nome: string, dia: number | null, mes: number | null) => ({
  id: nome,
  nome,
  aniversario_dia: dia,
  aniversario_mes: mes,
});

describe("proximaOcorrencia", () => {
  it("hoje conta como 0 dias", () => {
    expect(proximaOcorrencia(13, 11, "2026-11-13")).toEqual({ data: "2026-11-13", dias: 0 });
  });

  it("aniversário que já passou este ano cai no próximo", () => {
    expect(proximaOcorrencia(12, 11, "2026-11-13")).toEqual({ data: "2027-11-12", dias: 364 });
  });

  it("vira o ano: 28/12 até 02/01", () => {
    expect(proximaOcorrencia(2, 1, "2026-12-28")).toEqual({ data: "2027-01-02", dias: 5 });
  });

  it("sem dia ou mês não há ocorrência", () => {
    expect(proximaOcorrencia(null, null, "2026-11-13")).toBeNull();
    expect(proximaOcorrencia(5, null, "2026-11-13")).toBeNull();
  });

  it("29/02 cai em 28/02 em ano não bissexto e em 29/02 em ano bissexto", () => {
    expect(diaNoAno(29, 2, 2027)).toEqual({ dia: 28, mes: 2 });
    expect(diaNoAno(29, 2, 2028)).toEqual({ dia: 29, mes: 2 });
    expect(diaNoAno(29, 2, 2100)).toEqual({ dia: 28, mes: 2 }); // 2100 não é bissexto
    expect(proximaOcorrencia(29, 2, "2027-02-20")).toEqual({ data: "2027-02-28", dias: 8 });
    expect(proximaOcorrencia(29, 2, "2028-02-20")).toEqual({ data: "2028-02-29", dias: 9 });
    // Depois do 28/02 de um ano comum, o próximo é o 29/02 do bissexto seguinte? Não: o ano
    // seguinte (2028) é bissexto.
    expect(proximaOcorrencia(29, 2, "2027-03-01")).toEqual({ data: "2028-02-29", dias: 365 });
  });
});

describe("proximosAniversarios", () => {
  const todos = [
    arq("Bia", 13, 11), // hoje
    arq("Caio", 14, 11), // amanhã
    arq("Duda", 20, 11), // em 7 dias (limite)
    arq("Eva", 21, 11), // em 8 dias: fora
    arq("Fábio", null, null),
    arq("Ana", 13, 11), // hoje, ordem alfabética
  ];

  it("hoje e os próximos 7 dias, do mais próximo ao mais distante", () => {
    const r = proximosAniversarios(todos, "2026-11-13");
    expect(r.map((x) => [x.arquiteto.nome, x.dias])).toEqual([
      ["Ana", 0],
      ["Bia", 0],
      ["Caio", 1],
      ["Duda", 7],
    ]);
  });

  it("janela atravessa a virada do ano", () => {
    const r = proximosAniversarios(
      [arq("Gil", 1, 1), arq("Hugo", 5, 1), arq("Iris", 9, 1)],
      "2026-12-30",
    );
    expect(r.map((x) => [x.arquiteto.nome, x.dias, x.data])).toEqual([
      ["Gil", 2, "2027-01-01"],
      ["Hugo", 6, "2027-01-05"],
    ]);
  });

  it("29/02 em ano comum aparece no 28/02", () => {
    const r = proximosAniversarios([arq("Ivo", 29, 2)], "2027-02-27");
    expect(r.map((x) => [x.dias, x.data])).toEqual([[1, "2027-02-28"]]);
  });
});

describe("textos", () => {
  it("rótulos", () => {
    expect(rotuloAniversario(0, "2026-11-13")).toBe("hoje");
    expect(rotuloAniversario(1, "2026-11-14")).toBe("amanhã");
    expect(rotuloAniversario(4, "2026-11-17")).toBe("em 4 dias (17/11)");
  });

  it("mensagem padrão usa o primeiro nome do arquiteto e o nome da vendedora", () => {
    expect(
      mensagemAniversario("Oi, {arquiteto}! Aqui é {vendedora}.", "Lula Santana", "Aline"),
    ).toBe("Oi, Lula! Aqui é Aline.");
  });
});

describe("normalizarNomeArquiteto (mesma regra da migração)", () => {
  it.each([
    ["  Lula   Santana ", "lula santana"],
    ["LULA SANTANA", "lula santana"],
    ["Lúla Santana", "lula santana"],
    ["Márcia Conceição", "marcia conceicao"],
    ["Ana-Maria", "ana-maria"],
  ])("%s -> %s", (entrada, esperado) => {
    expect(normalizarNomeArquiteto(entrada)).toBe(esperado);
  });

  it("grafias diferentes do mesmo nome caem na mesma chave", () => {
    const chaves = new Set(
      ["Lula Santana", "lula  santana", "LÚLA SANTANA"].map(normalizarNomeArquiteto),
    );
    expect(chaves.size).toBe(1);
  });
});
