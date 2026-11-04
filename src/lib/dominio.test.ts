import { describe, expect, it } from "vitest";
import { MOTIVOS_PERDA, PERFIS, STATUS_ORCAMENTO, TIPOS_CLIENTE } from "./dominio";

describe("domínio", () => {
  it("mantém os status do orçamento na ordem do funil", () => {
    expect(STATUS_ORCAMENTO).toEqual([
      "rascunho",
      "gerado",
      "enviado",
      "followup_d5",
      "followup_d10",
      "fechado",
      "perdido",
    ]);
  });

  it("lista os cinco motivos de perda", () => {
    expect(MOTIVOS_PERDA).toEqual([
      "preco",
      "prazo_pronta_entrega",
      "comprou_em_outra_loja",
      "desistiu",
      "sem_resposta",
    ]);
  });

  it("define os perfis e tipos de cliente", () => {
    expect(PERFIS).toEqual(["vendedora", "gerente"]);
    expect(TIPOS_CLIENTE).toEqual(["final", "arquiteto", "eletricista", "construtora", "empresa"]);
  });
});
