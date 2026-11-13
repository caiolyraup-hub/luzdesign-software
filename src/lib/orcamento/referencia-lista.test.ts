import { describe, expect, it } from "vitest";
import { candidatoReferencia } from "./referencia-lista";

describe("candidatoReferencia", () => {
  it.each([
    ["DL-7324", "DL-7324", 1, null],
    ["10 x DL-7324", "DL-7324", 10, null],
    ["10x DL-7324", "DL-7324", 10, null],
    ["DL-7324 x 10", "DL-7324", 10, null],
    ["3,5 m PF-1908", "PF-1908", 3.5, "m"],
    ["ref: STH8903BR/30 - 4 un", "STH8903BR/30", 4, "un"],
    ["- 6338 x 2", "6338", 2, null],
    ["30045/200BR", "30045/200BR", 1, null],
  ])("%s", (texto, referencia, quantidade, unidade) => {
    expect(candidatoReferencia(texto)).toEqual({ referencia, quantidade, unidade });
  });

  it.each(["", "ok", "pendente para sala", "spot dicroico branco", "x 5", "0 x DL-7324"])(
    "não é referência: %j",
    (texto) => {
      expect(candidatoReferencia(texto)).toBeNull();
    },
  );
});
