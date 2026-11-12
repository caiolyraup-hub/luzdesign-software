import { describe, expect, it } from "vitest";
import { compararPrecos, resumirRenovacao, type ItemParaRenovar } from "./renovacao";

const item = (p: Partial<ItemParaRenovar> = {}): ItemParaRenovar => ({
  id: "i",
  codigo: "9520",
  descricao: "STELLA",
  ambiente: "Sala",
  quantidade: 2,
  precoCongelado: 30,
  precoCatalogo: 40,
  produtoAtivo: true,
  avulso: false,
  estoque: null,
  ...p,
});

describe("compararPrecos", () => {
  it("preço que subiu: diferença por unidade, em % e no total do item", () => {
    const [d] = compararPrecos([item()]);
    expect(d).toMatchObject({
      situacao: "mudou",
      precoAntigo: 30,
      precoNovo: 40,
      diferenca: 10,
      percentual: 33.3,
      diferencaTotalCentavos: 2000,
    });
  });

  it("preço que baixou tem diferença negativa", () => {
    const [d] = compararPrecos([item({ precoCatalogo: 27 })]);
    expect(d).toMatchObject({
      situacao: "mudou",
      diferenca: -3,
      percentual: -10,
      diferencaTotalCentavos: -600,
    });
  });

  it("preço igual (ignora diferença de ponto flutuante)", () => {
    const [d] = compararPrecos([item({ precoCongelado: 0.1 + 0.2, precoCatalogo: 0.3 })]);
    expect(d.situacao).toBe("igual");
  });

  it("item inativo ou que sumiu do catálogo: não muda de preço e impede renovar", () => {
    const difs = compararPrecos([
      item({ id: "a", produtoAtivo: false }),
      item({ id: "b", precoCatalogo: null }),
    ]);
    expect(difs.map((d) => d.situacao)).toEqual(["inativo", "inativo"]);
    expect(difs[0].precoNovo).toBe(30);
    expect(resumirRenovacao(difs).podeRenovar).toBe(false);
    expect(resumirRenovacao(difs).inativos).toBe(2);
  });

  it("avulso mantém o preço manual", () => {
    const [d] = compararPrecos([item({ avulso: true, codigo: null, precoCatalogo: null })]);
    expect(d).toMatchObject({ situacao: "avulso", precoNovo: 30, diferenca: 0 });
  });

  it("sem estoque: só quando o estoque informado é menor que a quantidade", () => {
    const difs = compararPrecos([
      item({ id: "a", estoque: 1 }),
      item({ id: "b", estoque: 2 }),
      item({ id: "c", estoque: null }),
    ]);
    expect(difs.map((d) => d.semEstoque)).toEqual([true, false, false]);
  });

  it("percentual nulo se o preço antigo era zero", () => {
    expect(compararPrecos([item({ precoCongelado: 0 })])[0].percentual).toBeNull();
  });
});

describe("resumirRenovacao", () => {
  it("totais antigo e novo, diferença e contagens", () => {
    const r = resumirRenovacao(
      compararPrecos([
        item({ id: "a" }), // 2 x 30 -> 2 x 40
        item({ id: "b", quantidade: 4, precoCongelado: 15, precoCatalogo: 20 }), // 60 -> 80
        item({
          id: "c",
          avulso: true,
          codigo: null,
          precoCongelado: 100,
          precoCatalogo: null,
          quantidade: 1,
        }),
        item({ id: "d", precoCongelado: 10, precoCatalogo: 10, estoque: 0 }),
      ]),
    );
    expect(r.totalAntigoCentavos).toBe(6000 + 6000 + 10000 + 2000);
    expect(r.totalNovoCentavos).toBe(8000 + 8000 + 10000 + 2000);
    expect(r.diferencaCentavos).toBe(4000);
    expect(r).toMatchObject({ mudaram: 2, inativos: 0, semEstoque: 1, podeRenovar: true });
  });

  it("sem itens não renova", () => {
    expect(resumirRenovacao([]).podeRenovar).toBe(false);
  });
});
