import { describe, expect, it } from "vitest";
import { interpretarLinha, interpretarLista, MAX_LINHAS_LISTA } from "./lista-colada";

const ok = (texto: string) => {
  const l = interpretarLinha(texto, 1);
  expect(l?.tipo, texto).toBe("reconhecida");
  return l as Extract<NonNullable<typeof l>, { tipo: "reconhecida" }>;
};

describe("lista colada: formatos reconhecidos", () => {
  it.each([
    ["10 12345", "12345", 10, null],
    ["12345 x 10", "12345", 10, null],
    ["12345 X 10", "12345", 10, null],
    ["10x 12345", "12345", 10, null],
    ["10 x 12345", "12345", 10, null],
    ["3,5 m 23456", "23456", 3.5, "m"],
    ["3.5m 23456", "23456", 3.5, "m"],
    ["12345 - 4 un", "12345", 4, "un"],
    ["12345 – 4 un", "12345", 4, "un"],
    ["12345: 10", "12345", 10, null],
    ["12345 = 10", "12345", 10, null],
    ["12345 (10)", "12345", 10, null],
    ["12345\t10", "12345", 10, null],
    ["cód 12345 qt 4", "12345", 4, null],
    ["Cód. 12345 - Qtd: 8", "12345", 8, null],
    ["- 6 un 12345", "12345", 6, "un"],
    ["2) 12345 x 3", "12345", 3, null],
    ["12345 8 mts", "12345", 8, "m"],
    ["12345", "12345", 1, null],
    ["10 9520", "9520", 10, null],
    ["9520 x 3", "9520", 3, null],
    ["3,5 m 8465", "8465", 3.5, "m"],
    ["12345 1200 un", "12345", 1200, "un"],
    ["1200 un 9520", "9520", 1200, "un"],
    ["9520 12345", "12345", 9520, null],
    ["12345 STELLA DIC 6W 2.7K 4un", "12345", 4, "un"],
  ])("%j", (texto, codigo, quantidade, unidade) => {
    const l = ok(texto);
    expect(l.codigo).toBe(codigo);
    expect(l.quantidade).toBe(quantidade);
    expect(l.unidade).toBe(unidade);
  });
});

describe("lista colada: linhas que não entende", () => {
  it.each([
    ["sem código nenhum", "Não achei um código"],
    ["12345 12346", "mais de um código"],
    ["9520 8465", "mais de um código"],
    ["10 12345 20", "mais de uma quantidade"],
    ["12345 0", "maior que zero"],
    ["12345 999999", "grande demais"],
    ["123456 3", "Não achei um código"],
    ["123 3", "Não achei um código"],
    ["12345 6W", "quantidade"],
  ])("%j", (texto, parte) => {
    const l = interpretarLinha(texto, 4);
    expect(l?.tipo).toBe("nao_entendida");
    if (l?.tipo === "nao_entendida") {
      expect(l.motivo).toContain(parte);
      expect(l.linha).toBe(4);
    }
  });

  it("linha vazia é ignorada", () => {
    expect(interpretarLinha("   ", 1)).toBeNull();
  });
});

describe("lista colada: texto inteiro", () => {
  it("numera as linhas, ignora as vazias e separa o que entendeu do que não entendeu", () => {
    const { linhas, excedeu } = interpretarLista(
      "10 12345\r\n\r\n12346 x 2\nlinha solta\n3,5 m 23456\n",
    );
    expect(excedeu).toBe(false);
    expect(linhas.map((l) => [l.linha, l.tipo])).toEqual([
      [1, "reconhecida"],
      [3, "reconhecida"],
      [4, "nao_entendida"],
      [5, "reconhecida"],
    ]);
  });

  it("limita o número de linhas", () => {
    const texto = Array.from({ length: MAX_LINHAS_LISTA + 5 }, () => "12345 x 1").join("\n");
    const { linhas, excedeu } = interpretarLista(texto);
    expect(linhas).toHaveLength(MAX_LINHAS_LISTA);
    expect(excedeu).toBe(true);
  });
});
