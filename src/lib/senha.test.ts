import { describe, expect, it } from "vitest";
import { validarSenhaNova } from "./senha";

describe("validarSenhaNova", () => {
  it("aceita senha forte e igual à confirmação", () => {
    expect(validarSenhaNova("Boa-luz-2026", "Boa-luz-2026")).toBeNull();
  });
  it.each([
    ["curta1", "curta1", /pelo menos 10/],
    ["somenteletras", "somenteletras", /letras e números/],
    ["1234567890", "1234567890", /letras e números/],
    ["aaaaaaaaaa", "aaaaaaaaaa", /letras e números|menos óbvia/],
    ["Boa-luz-2026", "Boa-luz-2027", /iguais/],
    ["a1".repeat(40), "a1".repeat(40), /no máximo 72/],
  ])("recusa %s", (nova, conf, msg) => {
    expect(validarSenhaNova(nova, conf)).toMatch(msg);
  });
});
