import { describe, expect, it } from "vitest";
import {
  dataDeEnvioValida,
  dataDoEnvio,
  envioNaoRegistrado,
  precisaRegistrarEnvio,
  textoEnvio,
} from "./envio";

const agora = new Date("2026-11-24T17:00:00Z"); // 14:00 em Maceió

describe("textoEnvio", () => {
  it("sem envio registrado não mostra nada", () => {
    expect(textoEnvio({})).toBeNull();
  });
  it("envio em outro dia: só a data; envio hoje: com a hora", () => {
    expect(textoEnvio({ enviadoEm: "2026-11-20T15:00:00Z" }, agora)).toBe("Enviado em 20/11");
    expect(textoEnvio({ enviadoEm: "2026-11-24T15:30:00Z" }, agora)).toBe(
      "Enviado em 24/11 às 12:30",
    );
  });
  it("mostra o último envio só quando é de outro dia", () => {
    expect(
      textoEnvio(
        { enviadoEm: "2026-11-20T15:00:00Z", ultimoEnvioEm: "2026-11-20T21:00:00Z" },
        agora,
      ),
    ).toBe("Enviado em 20/11");
    expect(
      textoEnvio(
        { enviadoEm: "2026-11-20T15:00:00Z", ultimoEnvioEm: "2026-11-23T15:00:00Z" },
        agora,
      ),
    ).toBe("Enviado em 20/11 · último envio 23/11");
  });
  it("usa o fuso de Maceió (02:00 UTC ainda é o dia anterior)", () => {
    expect(dataDoEnvio("2026-11-21T02:00:00Z", agora)).toBe("20/11");
  });
});

describe("registrar envio", () => {
  it("selo só para gerado sem envio", () => {
    expect(envioNaoRegistrado({ status: "gerado", enviadoEm: null })).toBe(true);
    expect(envioNaoRegistrado({ status: "gerado", enviadoEm: "2026-11-20T15:00:00Z" })).toBe(false);
    expect(envioNaoRegistrado({ status: "enviado" })).toBe(false);
    expect(envioNaoRegistrado({ status: "rascunho" })).toBe(false);
  });
  it("entra em 'Registrar envio' depois de 1 dia", () => {
    const base = { status: "gerado", enviadoEm: null };
    expect(precisaRegistrarEnvio({ ...base, geradoEm: "2026-11-23T12:00:00Z" }, agora)).toBe(true);
    expect(precisaRegistrarEnvio({ ...base, geradoEm: "2026-11-24T10:00:00Z" }, agora)).toBe(false);
    expect(precisaRegistrarEnvio({ ...base, geradoEm: null }, agora)).toBe(false);
    expect(
      precisaRegistrarEnvio(
        { status: "enviado", enviadoEm: "x", geradoEm: "2026-11-01T00:00:00Z" },
        agora,
      ),
    ).toBe(false);
  });
  it("a data não pode ser futura nem antes de gerar", () => {
    const o = { geradoEm: "2026-11-20T15:00:00Z", agora };
    expect(dataDeEnvioValida("2026-11-24", o)).toEqual({ ok: true });
    expect(dataDeEnvioValida("2026-11-20", o)).toEqual({ ok: true });
    expect(dataDeEnvioValida("2026-11-25", o)).toEqual({ ok: false, motivo: "futura" });
    expect(dataDeEnvioValida("2026-11-19", o)).toEqual({ ok: false, motivo: "antes_de_gerado" });
    expect(dataDeEnvioValida("amanhã", o)).toEqual({ ok: false, motivo: "invalida" });
  });
});
