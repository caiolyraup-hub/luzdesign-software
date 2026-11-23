import { describe, expect, it } from "vitest";
import { validarBackupFresco } from "./backup-fresco";

const m = {
  criado_em: "2026-11-23T14:00:00.000Z",
  projeto: "xdrubtojofckgxilkttm",
  totais: { orcamentos: 10, orcamentos_por_status: {} },
};
const base = {
  agora: new Date("2026-11-23T15:00:00.000Z"),
  orcamentosAgora: 10,
  projetoAgora: "xdrubtojofckgxilkttm",
};

describe("validarBackupFresco", () => {
  it("aceita backup recente com os mesmos orçamentos", () => {
    expect(validarBackupFresco(m, base)).toEqual([]);
  });
  it("recusa backup velho", () => {
    expect(
      validarBackupFresco(m, { ...base, agora: new Date("2026-11-23T18:30:00.000Z") })[0],
    ).toMatch(/4\.5 h/);
  });
  it("recusa quando o número de orçamentos mudou depois do backup", () => {
    expect(validarBackupFresco(m, { ...base, orcamentosAgora: 11 })[0]).toMatch(
      /mudou depois do backup/,
    );
  });
  it("recusa backup de outro projeto e de data futura", () => {
    expect(validarBackupFresco(m, { ...base, projetoAgora: "outro" })[0]).toMatch(/projeto/);
    expect(
      validarBackupFresco(m, { ...base, agora: new Date("2026-11-23T10:00:00.000Z") }),
    ).not.toEqual([]);
  });
});
