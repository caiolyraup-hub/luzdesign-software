import { describe, expect, it } from "vitest";
import { dataCurtaPontos, nomeArquivoOrcamento, nomeSeguro } from "./arquivos";

describe("nomes dos arquivos baixados", () => {
  it("segue o costume da loja: NOME DO CLIENTE DD.MM.AA", () => {
    expect(nomeArquivoOrcamento("Maria Souza", "2026-11-10T15:00:00Z", "2026-0007", "pdf")).toBe(
      "Maria Souza 10.11.26.pdf",
    );
    expect(nomeArquivoOrcamento("Maria Souza", "2026-11-10T15:00:00Z", "2026-0007", "xlsx")).toBe(
      "Maria Souza 10.11.26.xlsx",
    );
  });

  it("usa a data do fuso de Maceió (não a do UTC)", () => {
    expect(dataCurtaPontos("2026-11-11T01:30:00Z")).toBe("10.11.26");
  });

  it("tira caracteres inválidos no Windows e espaços sobrando", () => {
    expect(nomeSeguro('  Ana/Beatriz: "Casa" <3>?  ')).toBe("Ana Beatriz Casa 3");
    expect(nomeSeguro("João da Silva...")).toBe("João da Silva");
    expect(nomeSeguro("a".repeat(200)).length).toBe(80);
  });

  it("sem nome utilizável cai no número do orçamento; versões acima de 1 levam sufixo", () => {
    expect(nomeArquivoOrcamento("???", "2026-11-10T15:00:00Z", "2026-0007", "pdf")).toBe(
      "Orcamento 2026-0007 10.11.26.pdf",
    );
    expect(nomeArquivoOrcamento(null, null, "2026-0007", "pdf")).toBe("Orcamento 2026-0007.pdf");
    expect(nomeArquivoOrcamento("Ana", "2026-11-10T15:00:00Z", "2026-0007", "pdf", 3)).toBe(
      "Ana 10.11.26 v3.pdf",
    );
  });
});
