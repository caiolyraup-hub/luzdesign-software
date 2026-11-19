import { describe, expect, it } from "vitest";
import {
  REF_PRODUCAO,
  bancoEhProducao,
  garantirTesteSeguro,
  variaveisComProducao,
} from "../../../scripts/guarda-producao";

describe("trava dos testes contra a produção", () => {
  const teste = "https://abcdefghijklmnopqrst.supabase.co";

  it("deixa passar um ambiente só com o projeto de testes", () => {
    expect(() =>
      garantirTesteSeguro({
        NEXT_PUBLIC_SUPABASE_URL: teste,
        DATABASE_URL: "postgresql://x@teste",
      }),
    ).not.toThrow();
  });

  it("recusa o ref de produção em QUALQUER variável, em qualquer parte do valor", () => {
    for (const nome of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "DATABASE_URL",
      "QUALQUER_COISA",
      "E2E_BASE_URL",
    ]) {
      expect(() =>
        garantirTesteSeguro({ [nome]: `postgresql://u:p@db.${REF_PRODUCAO}.supabase.co/x` }),
      ).toThrow(new RegExp(`${nome}.*PRODUÇÃO`));
    }
  });

  it("a mensagem cita só o NOME da variável, nunca o valor", () => {
    try {
      garantirTesteSeguro({ SEGREDO: `senha-${REF_PRODUCAO}-xyz` });
      throw new Error("deveria falhar");
    } catch (e) {
      expect((e as Error).message).toContain("SEGREDO");
      expect((e as Error).message).not.toContain("senha-");
    }
  });

  it("não existe mais variável que libere o teste em produção", () => {
    expect(() =>
      garantirTesteSeguro({
        PERMITIR_TESTE_EM_PRODUCAO: "1",
        NEXT_PUBLIC_SUPABASE_URL: `https://${REF_PRODUCAO}.supabase.co`,
      }),
    ).toThrow();
  });

  it("lista todas as variáveis que apontam para a produção", () => {
    expect(
      variaveisComProducao({ B: REF_PRODUCAO, A: `x${REF_PRODUCAO}`, C: teste, D: undefined }),
    ).toEqual(["A", "B"]);
    expect(bancoEhProducao(`https://${REF_PRODUCAO}.supabase.co`)).toBe(true);
    expect(bancoEhProducao(teste)).toBe(false);
  });
});
