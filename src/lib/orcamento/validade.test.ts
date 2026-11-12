import { describe, expect, it } from "vitest";
import { avisoValidade, diasParaVencer, estaVencido, precisaRenovar } from "./validade";

const HOJE = "2026-11-12";

describe("diasParaVencer / estaVencido", () => {
  it("vence hoje, amanhã e vencido há N dias", () => {
    expect(diasParaVencer("gerado", "2026-11-12", HOJE)).toBe(0);
    expect(diasParaVencer("enviado", "2026-11-13", HOJE)).toBe(1);
    expect(diasParaVencer("followup_d5", "2026-11-09", HOJE)).toBe(-3);
    expect(estaVencido("followup_d10", "2026-11-11", HOJE)).toBe(true);
    expect(estaVencido("gerado", "2026-11-12", HOJE)).toBe(false); // vence hoje ainda vale hoje
  });

  it("fechado, perdido e rascunho nunca vencem; sem validade também não", () => {
    for (const s of ["fechado", "perdido", "rascunho"]) {
      expect(diasParaVencer(s, "2020-01-01", HOJE)).toBeNull();
      expect(estaVencido(s, "2020-01-01", HOJE)).toBe(false);
    }
    expect(diasParaVencer("gerado", null, HOJE)).toBeNull();
    expect(estaVencido("enviado", undefined, HOJE)).toBe(false);
  });

  it("aceita validade com hora (date vinda do banco como texto)", () => {
    expect(diasParaVencer("gerado", "2026-11-10T00:00:00", HOJE)).toBe(-2);
  });

  it("a virada do dia é a de Maceió (padrão: hoje em Maceió)", () => {
    // 13/11 02:30 UTC ainda é 12/11 em Maceió: validade 12/11 vence hoje, não está vencida.
    const quase = new Date("2026-11-13T02:30:00Z");
    const hojeMaceio = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(
      quase,
    );
    expect(hojeMaceio).toBe("2026-11-12");
    expect(diasParaVencer("gerado", "2026-11-12", hojeMaceio)).toBe(0);
    const depois = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(
      new Date("2026-11-13T03:00:00Z"),
    );
    expect(estaVencido("gerado", "2026-11-12", depois)).toBe(true);
  });
});

describe("precisaRenovar e avisoValidade", () => {
  it("renovar: vencido ou vence em até 1 dia", () => {
    expect(precisaRenovar("gerado", "2026-11-14", HOJE)).toBe(false); // 2 dias
    expect(precisaRenovar("gerado", "2026-11-13", HOJE)).toBe(true);
    expect(precisaRenovar("gerado", "2026-11-12", HOJE)).toBe(true);
    expect(precisaRenovar("gerado", "2026-11-01", HOJE)).toBe(true);
    expect(precisaRenovar("fechado", "2026-11-01", HOJE)).toBe(false);
  });

  it("textos das etiquetas", () => {
    expect(avisoValidade("enviado", "2026-11-11", HOJE)).toMatchObject({
      tipo: "vencido",
      texto: "Vencido há 1 dia",
    });
    expect(avisoValidade("enviado", "2026-11-09", HOJE)?.texto).toBe("Vencido há 3 dias");
    expect(avisoValidade("gerado", "2026-11-12", HOJE)).toMatchObject({
      tipo: "vence_hoje",
      texto: "Vence hoje",
    });
    expect(avisoValidade("gerado", "2026-11-13", HOJE)?.texto).toBe("Vence amanhã");
    expect(avisoValidade("gerado", "2026-11-14", HOJE)).toBeNull();
    expect(avisoValidade("fechado", "2026-11-01", HOJE)).toBeNull();
  });
});
