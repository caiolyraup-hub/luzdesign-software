import { describe, expect, it } from "vitest";
import { clienteEhDeTeste, NOMES_PARA_REGRA_DE_TESTE } from "./eh-teste";

describe("clienteEhDeTeste", () => {
  it.each(NOMES_PARA_REGRA_DE_TESTE)("%s -> %s", (nome, esperado) => {
    expect(clienteEhDeTeste(nome)).toBe(esperado);
  });

  it("vazio ou nulo não é de teste", () => {
    expect(clienteEhDeTeste("")).toBe(false);
    expect(clienteEhDeTeste(null)).toBe(false);
    expect(clienteEhDeTeste(undefined)).toBe(false);
  });
});
