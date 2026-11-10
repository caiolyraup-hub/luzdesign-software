import { describe, expect, it } from "vitest";
import { acoesDoStatus, LISTA_MOTIVOS, rotuloMotivo } from "./status";

describe("ações de status", () => {
  const para = (s: Parameters<typeof acoesDoStatus>[0]) => acoesDoStatus(s).map((a) => a.para);

  it("cada etapa oferece o próximo passo, fechar e perder", () => {
    expect(para("gerado")).toEqual(["enviado", "fechado", "perdido"]);
    expect(para("enviado")).toEqual([
      "followup_d5",
      "followup_d10",
      "fechado",
      "perdido",
      "gerado",
    ]);
    expect(para("followup_d5")).toEqual(["followup_d10", "fechado", "perdido", "enviado"]);
    expect(para("followup_d10")).toEqual(["fechado", "perdido", "followup_d5"]);
  });

  it("fechado e perdido só reabrem; rascunho não tem ação manual", () => {
    expect(para("fechado")).toEqual(["enviado"]);
    expect(para("perdido")).toEqual(["enviado"]);
    expect(para("rascunho")).toEqual([]);
  });

  it("fechar pede o valor, perder pede o motivo; o resto é um toque", () => {
    const pede = Object.fromEntries(acoesDoStatus("enviado").map((a) => [a.para, a.pede]));
    expect(pede).toMatchObject({
      fechado: "valor",
      perdido: "motivo",
      followup_d5: null,
      followup_d10: null,
    });
  });

  it("os 5 motivos de perda aparecem com rótulo em português", () => {
    expect(LISTA_MOTIVOS.map((m) => m.rotulo)).toEqual([
      "Preço",
      "Prazo / pronta-entrega",
      "Comprou em outra loja",
      "Desistiu",
      "Sem resposta",
    ]);
    expect(rotuloMotivo("comprou_em_outra_loja")).toBe("Comprou em outra loja");
    expect(rotuloMotivo(null)).toBe("");
  });
});
