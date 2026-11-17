import { describe, expect, it } from "vitest";
import { limparMensagemErro, limparRota } from "./limpar";

describe("limparMensagemErro", () => {
  it("tira e-mail e números longos, mantém o resto", () => {
    expect(limparMensagemErro(new Error("falha ao salvar maria@exemplo.com (82) 99999-1234"))).toBe(
      "Error: falha ao salvar [e-mail] [número]",
    );
    expect(limparMensagemErro("CNPJ 04.487.554/0001-16 inválido")).toBe("CNPJ [número] inválido");
    expect(limparMensagemErro("timeout após 5000 ms")).toBe("timeout após 5000 ms");
  });
  it("limita o tamanho e aceita qualquer tipo", () => {
    expect(limparMensagemErro("x".repeat(1000))).toHaveLength(400);
    expect(limparMensagemErro(undefined)).toBe("erro");
    expect(limparMensagemErro({ a: 1 })).toBe("[object Object]");
  });
});

describe("limparRota", () => {
  it("só o caminho", () => {
    expect(limparRota("/orcamentos?q=Maria+Silva&status=gerado")).toBe("/orcamentos");
    expect(limparRota(null)).toBeNull();
  });
});
