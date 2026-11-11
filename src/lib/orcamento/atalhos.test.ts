import { describe, expect, it } from "vitest";
import { codigosMaisUsados, sugerirNomeDuplicado } from "./atalhos";

describe("codigosMaisUsados", () => {
  it("ordena pelo número de usos, ignora avulso e empata pela primeira aparição", () => {
    const linhas = [
      "9520",
      "9520",
      "12222",
      null,
      "9520",
      "12222",
      "10527",
      "4321",
      "4321",
      null,
    ].map((codigo) => ({ codigo }));
    expect(codigosMaisUsados(linhas)).toEqual(["9520", "12222", "4321", "10527"]);
  });

  it("limita a 12", () => {
    const linhas = Array.from({ length: 30 }, (_, i) => ({ codigo: String(1000 + i) }));
    const r = codigosMaisUsados(linhas);
    expect(r).toHaveLength(12);
    expect(r[0]).toBe("1000");
  });

  it("sem histórico, lista vazia", () => {
    expect(codigosMaisUsados([])).toEqual([]);
    expect(codigosMaisUsados([{ codigo: null }])).toEqual([]);
  });
});

describe("sugerirNomeDuplicado", () => {
  it.each([
    ["Quarto 1", [], "Quarto 2"],
    ["Quarto", [], "Quarto 2"],
    ["Sala de estar", ["Sala de estar"], "Sala de estar 2"],
    ["Quarto 1", ["Quarto 1", "Quarto 2"], "Quarto 3"],
    ["quarto 2", ["Quarto 3"], "quarto 4"],
    ["Suíte  3 ", [], "Suíte 4"],
    ["Banheiro 10", [], "Banheiro 11"],
  ])("%s -> %s", (nome, existentes, esperado) => {
    expect(sugerirNomeDuplicado(nome, existentes as string[])).toBe(esperado);
  });
});
