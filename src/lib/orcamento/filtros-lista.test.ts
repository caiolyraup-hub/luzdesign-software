import { describe, expect, it } from "vitest";
import { chipsAtivos, lerFiltrosLista, lerValor, paraParams, paraRpc } from "./filtros-lista";

const VEND = "11111111-2222-3333-4444-555555555555";
const ler = (p: Record<string, string | string[] | undefined>, gerente = false) =>
  lerFiltrosLista(p, { gerente });

describe("lerFiltrosLista", () => {
  it("sem parâmetros: padrão (em andamento, mais recentes)", () => {
    expect(ler({})).toEqual({
      q: undefined,
      preset: "andamento",
      campo: undefined,
      de: undefined,
      ate: undefined,
      valorMin: undefined,
      valorMax: undefined,
      tipo: undefined,
      temArquiteto: false,
      arquitetoId: undefined,
      motivo: undefined,
      validade: undefined,
      vendedora: undefined,
      ordem: "recentes",
    });
  });

  it("lê todos os filtros válidos", () => {
    const f = ler(
      {
        q: "  Maria   Silva ",
        filtro: "todos",
        data: "enviado",
        de: "2026-11-01",
        ate: "2026-11-30",
        min: "1.000",
        max: "5000,50",
        tipo: "arquiteto",
        arq: "1",
        motivo: "preco",
        validade: "vence_2d",
        ordem: "valor",
        vendedora: VEND,
      },
      true,
    );
    expect(f).toMatchObject({
      q: "Maria Silva",
      preset: "todos",
      campo: "enviado",
      de: "2026-11-01",
      ate: "2026-11-30",
      valorMin: 1000,
      valorMax: 5000.5,
      tipo: "arquiteto",
      temArquiteto: true,
      motivo: "preco",
      validade: "vence_2d",
      ordem: "valor",
      vendedora: VEND,
    });
  });

  it("valores inválidos são ignorados", () => {
    const f = ler({
      filtro: "xyz",
      data: "hoje",
      de: "2026-02-30",
      ate: "ontem",
      min: "abc",
      max: "-5",
      tipo: "alienigena",
      arq: "0",
      motivo: "tédio",
      validade: "eterna",
      ordem: "aleatoria",
      vendedora: "nao-e-uuid",
      arquiteto: "nao-e-uuid",
    });
    expect(f).toMatchObject({
      preset: "andamento",
      campo: undefined,
      de: undefined,
      ate: undefined,
      valorMin: undefined,
      valorMax: undefined,
      tipo: undefined,
      temArquiteto: false,
      motivo: undefined,
      validade: undefined,
      ordem: "recentes",
      vendedora: undefined,
      arquitetoId: undefined,
    });
  });

  it("período invertido é ignorado; só uma ponta vale", () => {
    expect(ler({ data: "criado", de: "2026-11-10", ate: "2026-11-01" }).campo).toBeUndefined();
    expect(ler({ data: "criado", de: "2026-11-10" })).toMatchObject({
      campo: "criado",
      de: "2026-11-10",
      ate: undefined,
    });
    expect(ler({ de: "2026-11-10", ate: "2026-11-12" }).campo).toBeUndefined(); // sem o campo
  });

  it("faixa de valor invertida é trocada", () => {
    expect(ler({ min: "900", max: "100" })).toMatchObject({ valorMin: 100, valorMax: 900 });
  });

  it("vendedora só vale para a gerente", () => {
    expect(ler({ vendedora: VEND }, false).vendedora).toBeUndefined();
    expect(ler({ vendedora: VEND }, true).vendedora).toBe(VEND);
  });

  it("parâmetro repetido usa o primeiro; busca é cortada em 80 caracteres", () => {
    expect(ler({ filtro: ["fechados", "perdidos"] }).preset).toBe("fechados");
    expect(ler({ q: "a".repeat(200) }).q).toHaveLength(80);
  });
});

describe("lerValor", () => {
  it.each([
    ["1500", 1500],
    ["1.500", 1500],
    ["1.500,50", 1500.5],
    ["R$ 2.000", 2000],
    ["99,9", 99.9],
    ["12.5", 12.5],
    ["0", 0],
  ])("%s -> %s", (t, n) => expect(lerValor(t)).toBe(n));
  it.each(["", "abc", "-1", "1,2,3", "1.5.5", "1e3"])("recusa %j", (t) =>
    expect(lerValor(t)).toBeUndefined(),
  );
});

describe("paraParams e paraRpc", () => {
  it("só o que foge do padrão vai para a URL, e volta igual", () => {
    expect(paraParams(ler({})).toString()).toBe("");
    const f = ler({ q: "9520", filtro: "todos", ordem: "cliente", arq: "1", min: "100" });
    const url = paraParams(f);
    expect(url.toString()).toBe("q=9520&filtro=todos&min=100&arq=1&ordem=cliente");
    expect(ler(Object.fromEntries(url))).toEqual(f);
  });

  it("monta a entrada do SQL; com período, os de teste ficam de fora", () => {
    const f = ler({
      q: "x",
      filtro: "perdidos",
      data: "perdido",
      de: "2026-11-01",
      ate: "2026-11-30",
    });
    expect(paraRpc(f, { cursor: "a|b" })).toMatchObject({
      q: "x",
      status: ["perdido"],
      campo: "perdido",
      de: "2026-11-01",
      ate: "2026-11-30",
      incluir_teste: false,
      ordem: "recentes",
      cursor: "a|b",
      limite: 20,
    });
    expect(paraRpc(ler({ filtro: "todos" })).status).toBeUndefined();
    expect(paraRpc(ler({})).incluir_teste).toBe(true);
  });
});

describe("chipsAtivos", () => {
  it("um chip por filtro e cada um sabe remover a si mesmo", () => {
    const f = ler({ q: "silva", min: "1000", validade: "vencida", arq: "1", tipo: "final" });
    const chips = chipsAtivos(f);
    expect(chips.map((c) => c.id)).toEqual(["q", "valor", "tipo", "arq", "validade"]);
    expect(chips[1].rotulo).toContain("a partir de");
    const sem = chips.find((c) => c.id === "valor")!.semEle;
    expect(sem.valorMin).toBeUndefined();
    expect(sem.q).toBe("silva");
    expect(chipsAtivos(ler({ filtro: "perdidos", ordem: "valor" }))).toEqual([]); // preset e ordem não viram chip
  });
});

describe("filtro por arquiteto do cadastro", () => {
  const ARQ = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("vale para qualquer perfil, vai para a URL e para a função SQL", () => {
    const f = ler({ arquiteto: ARQ });
    expect(f.arquitetoId).toBe(ARQ);
    expect(paraParams(f).get("arquiteto")).toBe(ARQ);
    expect(paraRpc(f)).toMatchObject({ arquiteto_id: ARQ });
    expect(ler({ arquiteto: ARQ }, true).arquitetoId).toBe(ARQ);
  });

  it("vira chip com o nome e sai ao remover", () => {
    const f = ler({ arquiteto: ARQ });
    const chip = chipsAtivos(f, undefined, () => "Lula Santana").find((c) => c.id === "arquiteto");
    expect(chip?.rotulo).toBe("Arquiteto: Lula Santana");
    expect(chip?.semEle.arquitetoId).toBeUndefined();
  });

  it("valor que não é uuid é ignorado", () => {
    expect(ler({ arquiteto: "lula" }).arquitetoId).toBeUndefined();
    expect(paraRpc(ler({ arquiteto: "lula" }))).not.toHaveProperty("arquiteto_id");
  });
});
