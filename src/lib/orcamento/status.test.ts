import { describe, expect, it } from "vitest";
import { acoesDoStatus, followupDevido, LISTA_MOTIVOS, rotuloMotivo } from "./status";

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

describe("follow-up vencido", () => {
  const agora = new Date("2026-11-20T12:00:00Z");
  const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000).toISOString();

  it("enviado há 5 dias: D+5 hoje; há mais: atrasado; há menos: nada", () => {
    expect(
      followupDevido({ status: "enviado", enviadoEm: diasAtras(4), statusEm: null, agora }),
    ).toBeNull();
    expect(
      followupDevido({ status: "enviado", enviadoEm: diasAtras(5), statusEm: null, agora }),
    ).toEqual({
      etapa: "D+5",
      dias: 5,
      atrasado: false,
    });
    expect(
      followupDevido({ status: "enviado", enviadoEm: diasAtras(8), statusEm: null, agora }),
    ).toEqual({
      etapa: "D+5",
      dias: 8,
      atrasado: true,
    });
  });

  it("depois do D+5 feito, o D+10 vence 5 dias depois", () => {
    expect(
      followupDevido({
        status: "followup_d5",
        enviadoEm: diasAtras(9),
        statusEm: diasAtras(4),
        agora,
      }),
    ).toBeNull();
    expect(
      followupDevido({
        status: "followup_d5",
        enviadoEm: diasAtras(10),
        statusEm: diasAtras(5),
        agora,
      }),
    ).toEqual({
      etapa: "D+10",
      dias: 5,
      atrasado: false,
    });
  });

  it("outros status não têm follow-up devido", () => {
    for (const status of ["rascunho", "gerado", "followup_d10", "fechado", "perdido"]) {
      expect(
        followupDevido({ status, enviadoEm: diasAtras(30), statusEm: diasAtras(30), agora }),
      ).toBeNull();
    }
  });
});
