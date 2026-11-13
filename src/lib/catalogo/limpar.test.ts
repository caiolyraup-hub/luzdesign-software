import { describe, expect, it } from "vitest";
import {
  censurarFornecedor,
  contemDadoDeFornecedor,
  limparDescricao,
  listaFabricantes,
  normalizarReferencia,
} from "./limpar";

// Descrições reais do catálogo (158 produtos vindos dos 37 orçamentos) -> descrição comercial.
const REAIS: [descricao: string, categoria: string, esperado: string][] = [
  ["MB 24W", "FONTE", "FONTE 24W"],
  ["60W MB", "FONTE", "FONTE 60W"],
  ["STELLA DIC 6W 2.7K", "LED", "LED DIC 6W 2.7K"],
  ["STELLA DEEP 22W 3.0K PT", "EMBUTIDO", "EMBUTIDO 22W 3.0K PT"],
  ["NIT. 12W 3.0K", "EMBUTIDO", "EMBUTIDO 12W 3.0K"],
  ["MT FITA MB 7,2W 4.0K", "FITA LED", "MT FITA 7,2W 4.0K"],
  ["MTS FITA 22W/M NT NIT", "FITA LED", "MTS FITA 22W/M NT"],
  ["MB BLET 6338 EMBUT PT 5W 3.0K", "SPOT", "SPOT EMBUT PT 5W 3.0K"],
  ["6144 BLET S. PT MB", "SPOT", "SPOT S. PT"],
  ["CASUAL LIGHT PD1334BZ-BR", "PENDENTE", "PENDENTE"],
  ["DL-7324 10W BR 3K ASTRA", "EMBUTIDO", "EMBUTIDO 10W BR 3K"],
  ["ASTRALED SP-7160 BR 2W 3.0K", "EMBUTIDO", "EMBUTIDO BR 2W 3.0K"],
  ["PF-1908 3MTS E. BR ASTRA", "PERFIL", "PERFIL 3MTS E. BR"],
  ["USINA 30015RED. BR DIC", "SPOT", "SPOT BR DIC"],
  ["STH8903BR/30 DEEP 17W BR 3K", "EMBUTIDO", "EMBUTIDO 17W BR 3K"],
  ["30045/200BR", "PERFIL", "PERFIL 200 BR"],
  ["30850/300 BT KEN S.", "PERFIL", "PERFIL 300 BT S."],
  ["1.90337BT 4XDIC", "EMBUTIDO", "EMBUTIDO 4XDIC"],
  ["377.IN65006 AR111", "EMBUTIDO", "EMBUTIDO AR111"],
  ["MB AR111 12W 2.7K", "LED", "LED AR111 12W 2.7K"],
  ["1152/1 POINT 2W PT 3K 8955 S&L", "EMBUTIDO", "EMBUTIDO 2W PT 3K"],
  ["MBLOYO P20 BR", "EMBUTIDO", "EMBUTIDO P20 BR"],
  ["12W 24V 7321 MB", "FONTE", "FONTE 12W 24V"],
  ["AVANT", "CONECTOR", "CONECTOR"],
  ["NIT", "PRESILHA", "PRESILHA"],
  ["LED G9 3,5W 3K OPUS", "LED", "LED G9 3,5W 3K"],
  ["MT FITA LED MB 7,2W 3.0K IP66", "FITA LED", "MT FITA LED 7,2W 3.0K IP66"],
];

describe("limparDescricao (descrições reais do catálogo)", () => {
  it.each(REAIS)("%s (%s) -> %s", (descricao, categoria, esperado) => {
    expect(limparDescricao(descricao, categoria).comercial).toBe(esperado);
  });

  it("nenhum resultado ainda mostra fabricante, linha/modelo ou referência", () => {
    for (const [descricao, categoria] of REAIS) {
      const { comercial } = limparDescricao(descricao, categoria);
      expect(contemDadoDeFornecedor(comercial), `${descricao} -> ${comercial}`).toBe(false);
    }
  });

  it("guarda o que saiu: fabricante, referência e modelo", () => {
    const r = limparDescricao("MB BLET 6338 EMBUT PT 5W 3.0K", "SPOT");
    expect(r.fabricantes).toEqual(["MB"]);
    expect(r.referencias).toEqual(["6338"]);
    expect(r.modelos).toEqual(["BLET"]);
    const p = limparDescricao("STH8903PTO/30 DEEP 17W", "EMBUTIDO");
    expect(p.referencias).toEqual(["STH8903PTO/30"]);
    expect(p.modelos).toEqual(["DEEP"]);
  });

  it("não confunde tipo de lâmpada, potência, cor e proteção com referência", () => {
    const manter = ["AR70", "AR111", "P20", "G9", "G45", "A60", "PAR16", "MR16", "GU10", "IP66"];
    for (const t of manter) {
      expect(limparDescricao(`SPOT ${t} 7W 3.0K`, "SPOT").comercial).toContain(t);
    }
    expect(limparDescricao("MB 150W", "FONTE").comercial).toBe("FONTE 150W");
    expect(limparDescricao("FITA 220V 10W/M", "FITA LED").comercial).toBe("FITA 220V 10W/M");
    expect(limparDescricao("PERFIL 2MTS 3X0.91CM", "PERFIL").comercial).toBe(
      "PERFIL 2MTS 3X0.91CM",
    );
  });

  it("aceita fabricantes extras (as marcas da carga) e ignora minúsculas", () => {
    expect(limparDescricao("spot Lumina 5W", "SPOT", { fabricantes: ["Lumina"] }).comercial).toBe(
      "spot 5W",
    );
    expect(limparDescricao("fonte mb 48w", "FONTE").comercial).toBe("fonte 48w");
  });

  it("se sobrar nada, usa a categoria; sem categoria, 'PRODUTO'", () => {
    expect(limparDescricao("NIT", "PRESILHA").comercial).toBe("PRESILHA");
    expect(limparDescricao("MB", null).comercial).toBe("PRODUTO");
  });

  it("não repete a categoria quando o texto já a diz", () => {
    expect(limparDescricao("MT FITA MB 5W", "FITA LED").comercial).toBe("MT FITA 5W");
    expect(limparDescricao("LED DIC.4,8W 3K MB", "LED").comercial).toBe("LED DIC.4,8W 3K");
  });
});

describe("listaFabricantes", () => {
  it("junta os conhecidos com os extras, sem repetir", () => {
    const l = listaFabricantes(["mb", " Lumina ", null, ""]);
    expect(l).toContain("MB");
    expect(l).toContain("LUMINA");
    expect(l.filter((f) => f === "MB")).toHaveLength(1);
  });
});

describe("censurarFornecedor (texto livre da IA)", () => {
  it("troca fabricante, modelo e referência, mantendo o resto", () => {
    expect(censurarFornecedor("Combina com o MB BLET 6338 na sala.")).toBe(
      "Combina com o … na sala.",
    );
    expect(censurarFornecedor("Use o DL-7324 da ASTRA, 10W.")).toBe("Use o … da …, 10W.");
    expect(censurarFornecedor("Sugeri fonte de 60W e fita de 22W/M.")).toBe(
      "Sugeri fonte de 60W e fita de 22W/M.",
    );
  });

  it("respeita fabricantes extras", () => {
    expect(censurarFornecedor("Prefira a Lumina.", ["Lumina"])).toBe("Prefira a ….");
  });
});

describe("normalizarReferencia", () => {
  it("maiúsculas, sem espaço, hífen, barra ou ponto", () => {
    expect(normalizarReferencia("dl-7324")).toBe("DL7324");
    expect(normalizarReferencia(" STH 8903 PTO / 30 ")).toBe("STH8903PTO30");
    expect(normalizarReferencia("1.90337 bt")).toBe("190337BT");
  });
});
