import { describe, expect, it } from "vitest";
import {
  PERGUNTAS,
  VERSAO_RESPOSTAS,
  formatarWhatsapp,
  normalizarWhatsapp,
  perguntaDoPasso,
  primeiroPassoPendente,
  resumirResposta,
  validarPergunta,
  validarRespostas,
  type Respostas,
} from "./perguntas";

const p = (id: string) => PERGUNTAS.find((x) => x.id === id)!;

const completas: Respostas = {
  cliente_nome: "Ana Bastos",
  cliente_whatsapp: "+5582999991234",
  tipo_cliente: "final",
  tipo_obra: { uso: "residencial", estado: "reforma" },
  ambientes: ["sala", "cozinha"],
  pedido_cliente: "Quero spots na sala e fita na cozinha.",
  linha: "tecnica",
  prazo: "encomenda",
};

describe("as 10 perguntas como dados", () => {
  it("seguem a ordem e os ids de docs/perguntas.md", () => {
    expect(PERGUNTAS.map((x) => x.id)).toEqual([
      "cliente_nome",
      "cliente_whatsapp",
      "tipo_cliente",
      "tipo_obra",
      "ambientes",
      "pedido_cliente",
      "linha",
      "faixa_investimento",
      "prazo",
      "observacoes",
    ]);
    expect(PERGUNTAS.map((x) => x.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("obrigatórias são 1 a 5, 7 e 9; 6, 8 e 10 são opcionais", () => {
    expect(PERGUNTAS.filter((x) => x.obrigatoria).map((x) => x.numero)).toEqual([
      1, 2, 3, 4, 5, 7, 9,
    ]);
    expect(perguntaDoPasso(6)?.obrigatoria).toBe(false);
    expect(perguntaDoPasso(8)?.obrigatoria).toBe(false);
  });
});

describe("normalizarWhatsapp", () => {
  it.each([
    ["(82) 99999-1234", "+5582999991234"],
    ["82999991234", "+5582999991234"],
    ["+55 82 99999-1234", "+5582999991234"],
    ["055 82 99999 1234", "+5582999991234"],
    ["5582999991234", "+5582999991234"],
    ["(82) 3333-4444", "+558233334444"],
  ])("%s -> %s", (entrada, esperado) => {
    expect(normalizarWhatsapp(entrada)).toBe(esperado);
  });

  it.each([
    ["99999-1234"],
    ["123"],
    [""],
    ["(00) 99999-1234"],
    ["(82) 89999-1234"],
    ["abc"],
    ["82 99999-12345"],
  ])("recusa %s", (entrada) => {
    expect(normalizarWhatsapp(entrada)).toBeNull();
  });

  it("formata para exibir", () => {
    expect(formatarWhatsapp("+5582999991234")).toBe("(82) 99999-1234");
    expect(formatarWhatsapp("+558233334444")).toBe("(82) 3333-4444");
  });
});

describe("validação por tipo de pergunta", () => {
  it("texto curto: exige nome e apara espaços", () => {
    expect(validarPergunta(p("cliente_nome"), { cliente_nome: "  Ana  " })).toEqual({
      ok: true,
      valores: { cliente_nome: "Ana" },
    });
    expect(validarPergunta(p("cliente_nome"), { cliente_nome: " " }).ok).toBe(false);
    expect(validarPergunta(p("cliente_nome"), {})).toMatchObject({
      ok: false,
      erros: { cliente_nome: "Informe o nome do cliente." },
    });
  });

  it("telefone: normaliza para +55 e recusa inválido", () => {
    expect(validarPergunta(p("cliente_whatsapp"), { cliente_whatsapp: "(82) 99999-1234" })).toEqual(
      {
        ok: true,
        valores: { cliente_whatsapp: "+5582999991234" },
      },
    );
    expect(validarPergunta(p("cliente_whatsapp"), { cliente_whatsapp: "99999" })).toMatchObject({
      ok: false,
      erros: { cliente_whatsapp: "Informe um WhatsApp válido, com DDD." },
    });
  });

  it("cards: só aceita valores das opções", () => {
    expect(validarPergunta(p("linha"), { linha: "ambas" }).ok).toBe(true);
    expect(validarPergunta(p("linha"), { linha: "qualquer" }).ok).toBe(false);
    expect(validarPergunta(p("prazo"), { prazo: "pronta_entrega" }).ok).toBe(true);
    expect(validarPergunta(p("prazo"), {}).ok).toBe(false);
  });

  it("obra: precisa de uso e de estado", () => {
    expect(
      validarPergunta(p("tipo_obra"), { tipo_obra: { uso: "comercial", estado: "nova" } }).ok,
    ).toBe(true);
    expect(validarPergunta(p("tipo_obra"), { tipo_obra: { uso: "comercial" } }).ok).toBe(false);
    expect(validarPergunta(p("tipo_obra"), {}).ok).toBe(false);
  });

  it("múltipla escolha: ao menos um, sem repetir; 'outro' pede o texto", () => {
    expect(validarPergunta(p("ambientes"), { ambientes: [] }).ok).toBe(false);
    expect(validarPergunta(p("ambientes"), { ambientes: ["sala", "sala", "varanda"] })).toEqual({
      ok: true,
      valores: { ambientes: ["sala", "varanda"], ambiente_outro: undefined },
    });
    expect(validarPergunta(p("ambientes"), { ambientes: ["outro"] })).toMatchObject({
      ok: false,
      erros: { ambiente_outro: "Diga qual é o outro ambiente." },
    });
    expect(
      validarPergunta(p("ambientes"), { ambientes: ["outro"], ambiente_outro: "Escritório" }),
    ).toEqual({
      ok: true,
      valores: { ambientes: ["outro"], ambiente_outro: "Escritório" },
    });
    expect(validarPergunta(p("ambientes"), { ambientes: ["garagem"] }).ok).toBe(false);
  });

  it("texto longo: opcional na 6 e na 10", () => {
    expect(validarPergunta(p("pedido_cliente"), {}).ok).toBe(true);
    expect(validarPergunta(p("pedido_cliente"), { pedido_cliente: "Spots 9520 x4" }).ok).toBe(true);
    expect(validarPergunta(p("observacoes"), {})).toEqual({
      ok: true,
      valores: { observacoes: undefined },
    });
    expect(validarPergunta(p("observacoes"), { observacoes: "10% à vista" }).ok).toBe(true);
    expect(validarPergunta(p("observacoes"), { observacoes: "x".repeat(2001) }).ok).toBe(false);
  });

  it("faixa de investimento é opcional", () => {
    expect(validarPergunta(p("faixa_investimento"), {}).ok).toBe(true);
    expect(validarPergunta(p("faixa_investimento"), { faixa_investimento: "até 5 mil" })).toEqual({
      ok: true,
      valores: { faixa_investimento: "até 5 mil" },
    });
  });
});

describe("arquiteto indicador", () => {
  const v = (entrada: Record<string, unknown>) => validarPergunta(p("tipo_cliente"), entrada);

  it("não é exigido para cliente final sem indicação", () => {
    expect(v({ tipo_cliente: "final" })).toMatchObject({ ok: true });
    expect(v({ tipo_cliente: "final", indicacao_arquiteto: false })).toMatchObject({ ok: true });
  });

  it("é exigido quando o tipo é arquiteto", () => {
    expect(v({ tipo_cliente: "arquiteto" })).toMatchObject({
      ok: false,
      erros: { arquiteto_indicador: "Informe o nome do arquiteto(a)." },
    });
    expect(v({ tipo_cliente: "arquiteto", arquiteto_indicador: "Lula Santana" })).toMatchObject({
      ok: true,
      valores: { tipo_cliente: "arquiteto", arquiteto_indicador: "Lula Santana" },
    });
  });

  it("é exigido quando há indicação, em qualquer tipo", () => {
    expect(v({ tipo_cliente: "eletricista", indicacao_arquiteto: true })).toMatchObject({
      ok: false,
      erros: { arquiteto_indicador: "Informe qual arquiteto(a) indicou." },
    });
    expect(
      v({ tipo_cliente: "eletricista", indicacao_arquiteto: true, arquiteto_indicador: "Lula" }),
    ).toMatchObject({ ok: true, valores: { arquiteto_indicador: "Lula" } });
  });

  it("descarta o nome se não houver indicação", () => {
    expect(
      v({ tipo_cliente: "final", indicacao_arquiteto: false, arquiteto_indicador: "Lula" }),
    ).toMatchObject({
      ok: true,
      valores: { arquiteto_indicador: undefined },
    });
  });

  it("recusa tipo desconhecido", () => {
    expect(v({ tipo_cliente: "vizinho" }).ok).toBe(false);
  });
});

describe("conjunto de respostas", () => {
  it("primeiroPassoPendente aponta a primeira obrigatória vazia", () => {
    expect(primeiroPassoPendente({})).toBe(1);
    expect(primeiroPassoPendente({ cliente_nome: "Ana" })).toBe(2);
    expect(primeiroPassoPendente({ ...completas, cliente_whatsapp: undefined })).toBe(2);
    expect(primeiroPassoPendente({ ...completas, linha: undefined })).toBe(7);
    expect(primeiroPassoPendente({ ...completas, prazo: undefined })).toBe(9);
  });

  it("ignora o seed antigo { teste: true }", () => {
    expect(primeiroPassoPendente({ teste: true } as Respostas)).toBe(1);
  });

  it("completas (sem as opcionais) não têm pendência", () => {
    expect(primeiroPassoPendente(completas)).toBeNull();
  });

  it("validarRespostas devolve versionadas e normalizadas", () => {
    const r = validarRespostas({ ...completas, cliente_whatsapp: "(82) 99999-1234" });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.respostas.versao).toBe(VERSAO_RESPOSTAS);
      expect(r.respostas.cliente_whatsapp).toBe("+5582999991234");
    }
    expect(validarRespostas({ cliente_nome: "Ana" })).toEqual({
      ok: false,
      pendentes: [2, 3, 4, 5, 7, 9],
    });
  });

  it("resumirResposta usa os rótulos legíveis", () => {
    const r: Respostas = {
      ...completas,
      tipo_cliente: "arquiteto",
      arquiteto_indicador: "Lula",
      ambientes: ["sala", "outro"],
      ambiente_outro: "Escritório",
    };
    expect(resumirResposta(p("cliente_whatsapp"), r)).toBe("(82) 99999-1234");
    expect(resumirResposta(p("tipo_cliente"), r)).toBe("Arquiteto(a) · Arquiteto(a): Lula");
    expect(resumirResposta(p("tipo_obra"), r)).toBe("Residencial · Reforma");
    expect(resumirResposta(p("ambientes"), r)).toBe("Sala, Outro: Escritório");
    expect(resumirResposta(p("prazo"), r)).toBe("Aceita encomenda (30 a 45 dias úteis)");
    expect(resumirResposta(p("faixa_investimento"), r)).toBe("");
  });
});
