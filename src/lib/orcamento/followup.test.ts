import { describe, expect, it } from "vitest";
import {
  dataMaceioISO,
  diasEntreDatas,
  followupDeHoje,
  linkWhatsapp,
  MENSAGEM_D5_PADRAO,
  montarMensagemFollowup,
  textoPrazoFollowup,
} from "./followup";

// Maceió é UTC-3 o ano todo.
const envio = "2026-11-02T15:00:00Z"; // segunda 02/11, 12h em Maceió
const em = (iso: string) => new Date(iso);

describe("calendário de Maceió", () => {
  it("a virada do dia é à meia-noite de Maceió (03h UTC)", () => {
    expect(dataMaceioISO("2026-11-03T02:59:00Z")).toBe("2026-11-02");
    expect(dataMaceioISO("2026-11-03T03:00:00Z")).toBe("2026-11-03");
  });

  it("diasEntreDatas conta dias de calendário (inclusive na virada do mês e do ano)", () => {
    expect(diasEntreDatas("2026-11-02", "2026-11-07")).toBe(5);
    expect(diasEntreDatas("2026-12-30", "2027-01-04")).toBe(5);
    expect(diasEntreDatas("2026-11-07", "2026-11-02")).toBe(-5);
  });
});

describe("followupDeHoje (D+5 a partir do último envio)", () => {
  const d5 = (agora: string, ultimoEnvioEm: string | null = envio) =>
    followupDeHoje({ status: "enviado", ultimoEnvioEm, agora: em(agora) });

  it("não vence antes do quinto dia", () => {
    expect(d5("2026-11-06T20:00:00Z")).toBeNull(); // 06/11 17h em Maceió: 4 dias
  });

  it("vence hoje no quinto dia, mesmo de madrugada em Maceió, e depois fica atrasado", () => {
    expect(d5("2026-11-07T03:00:00Z")).toEqual({
      etapa: "D+5",
      venceEm: "2026-11-07",
      diasAtraso: 0,
      sugerirPerdido: false,
    });
    expect(d5("2026-11-10T15:00:00Z")).toMatchObject({ etapa: "D+5", diasAtraso: 3 });
  });

  it("fuso: às 02h59 UTC do dia 07 ainda é dia 06 em Maceió (não venceu)", () => {
    expect(d5("2026-11-07T02:59:00Z")).toBeNull();
  });

  it("envio de madrugada em Maceió conta o dia local, não o do UTC", () => {
    // 01h em Maceió de 02/11 = 04h UTC do mesmo dia; 23h de 01/11 em Maceió = 02h UTC de 02/11.
    const tardeDeDomingo = "2026-11-02T02:00:00Z"; // domingo 01/11, 23h em Maceió
    expect(
      followupDeHoje({
        status: "enviado",
        ultimoEnvioEm: tardeDeDomingo,
        agora: em("2026-11-06T15:00:00Z"),
      }),
    ).toMatchObject({ venceEm: "2026-11-06", diasAtraso: 0 });
  });

  it("sem data de envio ou fora das etapas, nada vence", () => {
    expect(d5("2026-11-20T15:00:00Z", null)).toBeNull();
    for (const status of ["rascunho", "gerado", "fechado", "perdido"]) {
      expect(
        followupDeHoje({ status, ultimoEnvioEm: envio, agora: em("2026-12-20T15:00:00Z") }),
      ).toBeNull();
    }
  });

  it("respeita os dias configurados pela gerência", () => {
    const config = { d5Dias: 3, d10Dias: 7 };
    expect(
      followupDeHoje({
        status: "enviado",
        ultimoEnvioEm: envio,
        agora: em("2026-11-05T15:00:00Z"),
        config,
      }),
    ).toMatchObject({ etapa: "D+5", diasAtraso: 0 });
    expect(
      followupDeHoje({
        status: "enviado",
        ultimoEnvioEm: envio,
        agora: em("2026-11-04T15:00:00Z"),
        config,
      }),
    ).toBeNull();
  });
});

describe("followupDeHoje (D+10 e encerramento)", () => {
  it("o D+10 vence dez dias depois do último envio e, passados 5 dias, sugere perdido", () => {
    const d10 = (agora: string) =>
      followupDeHoje({ status: "followup_d5", ultimoEnvioEm: envio, agora: em(agora) });
    expect(d10("2026-11-11T15:00:00Z")).toBeNull(); // 9 dias
    expect(d10("2026-11-12T15:00:00Z")).toEqual({
      etapa: "D+10",
      venceEm: "2026-11-12",
      diasAtraso: 0,
      sugerirPerdido: false,
    });
    expect(d10("2026-11-16T15:00:00Z")).toMatchObject({ diasAtraso: 4, sugerirPerdido: false });
    expect(d10("2026-11-17T15:00:00Z")).toMatchObject({ diasAtraso: 5, sugerirPerdido: true });
  });

  it("depois do D+10 feito, sem resposta por 5 dias aparece 'encerrar'", () => {
    const f = (agora: string) =>
      followupDeHoje({ status: "followup_d10", ultimoEnvioEm: envio, agora: em(agora) });
    expect(f("2026-11-16T15:00:00Z")).toBeNull();
    expect(f("2026-11-17T15:00:00Z")).toMatchObject({
      etapa: "ENCERRAR",
      diasAtraso: 0,
      sugerirPerdido: true,
    });
  });

  it("um novo envio (nova versão) recomeça a contagem", () => {
    // Enviado de novo em 09/11: o D+5 só vence em 14/11, mesmo com o primeiro envio em 02/11.
    const reenvio = "2026-11-09T15:00:00Z";
    expect(
      followupDeHoje({
        status: "enviado",
        ultimoEnvioEm: reenvio,
        agora: em("2026-11-13T15:00:00Z"),
      }),
    ).toBeNull();
    expect(
      followupDeHoje({
        status: "enviado",
        ultimoEnvioEm: reenvio,
        agora: em("2026-11-14T15:00:00Z"),
      }),
    ).toMatchObject({ venceEm: "2026-11-14", diasAtraso: 0 });
  });
});

describe("texto e mensagem", () => {
  it("texto do prazo", () => {
    expect(textoPrazoFollowup({ diasAtraso: 0 })).toBe("vence hoje");
    expect(textoPrazoFollowup({ diasAtraso: 1 })).toBe("atrasado 1 dia");
    expect(textoPrazoFollowup({ diasAtraso: 4 })).toBe("atrasado 4 dias");
  });

  it("mensagem usa o primeiro nome do cliente e da vendedora, e o número", () => {
    const m = montarMensagemFollowup(MENSAGEM_D5_PADRAO, {
      cliente: "Maria Souza",
      numero: "2026-0007",
      vendedora: "Aline Santos",
    });
    expect(m).toContain("Olá, Maria!");
    expect(m).toContain("Aqui é Aline,");
    expect(m).toContain("nº 2026-0007");
    expect(m).not.toMatch(/[{}]/);
  });

  it("link do WhatsApp com o número só com dígitos e a mensagem codificada", () => {
    expect(linkWhatsapp("+55 82 99999-1234", "Olá, Maria! Tudo bem?")).toBe(
      "https://wa.me/5582999991234?text=Ol%C3%A1%2C%20Maria!%20Tudo%20bem%3F",
    );
    expect(linkWhatsapp(null, "x")).toBe("https://wa.me/?text=x");
  });
});
