import { describe, expect, it } from "vitest";
import { iniciais, textoAniversario, validarArquiteto } from "./validacao";

describe("validarArquiteto", () => {
  it("só o nome é obrigatório", () => {
    expect(validarArquiteto({ nome: "  Lula   Santana " })).toEqual({
      ok: true,
      dados: {
        nome: "Lula Santana",
        escritorio: null,
        whatsapp: null,
        email: null,
        aniversario_dia: null,
        aniversario_mes: null,
        aniversario_ano: null,
        observacoes: null,
      },
    });
    expect(validarArquiteto({ nome: "A" })).toMatchObject({ ok: false });
    expect(validarArquiteto({})).toMatchObject({ ok: false, erros: { nome: expect.any(String) } });
  });

  it("normaliza o WhatsApp e recusa um inválido", () => {
    const ok = validarArquiteto({ nome: "Ana", whatsapp: "(82) 99999-1234" });
    expect(ok).toMatchObject({ ok: true, dados: { whatsapp: "+5582999991234" } });
    expect(validarArquiteto({ nome: "Ana", whatsapp: "123" })).toMatchObject({
      ok: false,
      erros: { whatsapp: expect.any(String) },
    });
  });

  it("aniversário: dia e mês juntos, ano opcional", () => {
    expect(
      validarArquiteto({ nome: "Ana", aniversario_dia: "29", aniversario_mes: "2" }),
    ).toMatchObject({
      ok: true,
      dados: { aniversario_dia: 29, aniversario_mes: 2, aniversario_ano: null },
    });
    expect(
      validarArquiteto({
        nome: "Ana",
        aniversario_dia: "5",
        aniversario_mes: "11",
        aniversario_ano: "1985",
      }),
    ).toMatchObject({ ok: true, dados: { aniversario_ano: 1985 } });
    for (const entrada of [
      { aniversario_dia: "5" }, // falta o mês
      { aniversario_mes: "5" }, // falta o dia
      { aniversario_dia: "31", aniversario_mes: "4" }, // abril não tem 31
      { aniversario_dia: "30", aniversario_mes: "2" },
      { aniversario_dia: "0", aniversario_mes: "5" },
      { aniversario_dia: "5", aniversario_mes: "13" },
      { aniversario_ano: "1990" }, // ano sem dia e mês
      { aniversario_dia: "5", aniversario_mes: "5", aniversario_ano: "1800" },
      { aniversario_dia: "x", aniversario_mes: "5" },
    ]) {
      expect(validarArquiteto({ nome: "Ana", ...entrada })).toMatchObject({ ok: false });
    }
  });

  it("e-mail e observações", () => {
    expect(validarArquiteto({ nome: "Ana", email: "ana@exemplo.com" })).toMatchObject({
      ok: true,
      dados: { email: "ana@exemplo.com" },
    });
    expect(validarArquiteto({ nome: "Ana", email: "sem-arroba" })).toMatchObject({ ok: false });
    expect(validarArquiteto({ nome: "Ana", observacoes: "x".repeat(1001) })).toMatchObject({
      ok: false,
    });
  });
});

describe("textos", () => {
  it("aniversário e iniciais", () => {
    expect(textoAniversario(5, 11)).toBe("05/11");
    expect(textoAniversario(5, 11, 1985)).toBe("05/11/1985");
    expect(textoAniversario(null, null)).toBe("");
    expect(iniciais("Lula Santana")).toBe("LS");
    expect(iniciais("Madonna")).toBe("M");
    expect(iniciais("  ana   maria  da silva ")).toBe("AS");
    expect(iniciais("")).toBe("?");
  });
});
