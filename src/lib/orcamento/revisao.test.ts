import { describe, expect, it } from "vitest";
import {
  agruparPorAmbiente,
  ambientesDasRespostas,
  itensComPrecoMudado,
  nomeAmbienteValido,
  normalizarQuantidade,
  type ItemRevisao,
} from "./itens";
import { montarLinhaDoTempo } from "./linha-do-tempo";
import {
  descontoAvistaCentavos,
  moedaCentavos,
  moedaSimples,
  motivosBloqueioGerar,
  somarCentavos,
  subtotalCentavos,
  totaisDoOrcamento,
} from "./totais";

const item = (n: number, extra: Partial<ItemRevisao> = {}): ItemRevisao => ({
  id: `i${n}`,
  codigo: String(9000 + n),
  descricao: `ITEM ${n}`,
  preco: 10,
  quantidade: 1,
  ambiente: "Sala",
  avulso: false,
  justificativa: null,
  ordem: n,
  marca: null,
  unidade: "un",
  produtoAtivo: true,
  precoCatalogo: 10,
  ...extra,
});

describe("totais e desconto à vista", () => {
  it("calcula em centavos sem erro de ponto flutuante", () => {
    expect(subtotalCentavos(0.1, 3)).toBe(30);
    expect(subtotalCentavos(19.9, 3)).toBe(5970);
    expect(subtotalCentavos(20, 8.5)).toBe(17000);
    expect(subtotalCentavos(37, 6)).toBe(22200);
    expect(
      somarCentavos([
        { preco_unitario: 37, quantidade: 6 },
        { preco_unitario: 311, quantidade: 1 },
      ]),
    ).toBe(53300);
  });

  it("arredonda por item (quantidade com 2 casas) e soma os itens", () => {
    // 3,46 m x R$ 20,00 = 69,20; 1 x 0,10 = 0,10
    expect(
      somarCentavos([
        { preco_unitario: 20, quantidade: 3.46 },
        { preco_unitario: 0.1, quantidade: 1 },
      ]),
    ).toBe(6930);
    // 3 x R$ 0,335 não existe (preço tem 2 casas), mas 1,5 m x R$ 0,33 = 0,495 -> 50 centavos
    expect(subtotalCentavos(0.33, 1.5)).toBe(50);
  });

  it("desconto à vista: percentual sobre o total, arredondado em centavos", () => {
    expect(descontoAvistaCentavos(70300, 10)).toBe(7030);
    expect(descontoAvistaCentavos(145656, 10)).toBe(14566); // 14565,6 -> 14566
    expect(descontoAvistaCentavos(10000, 0)).toBe(0);
    expect(descontoAvistaCentavos(10000, 12.5)).toBe(1250);
    expect(totaisDoOrcamento([{ preco_unitario: 100, quantidade: 3 }], 10)).toEqual({
      totalCentavos: 30000,
      descontoCentavos: 3000,
      aVistaCentavos: 27000,
      percentual: 10,
    });
    // O total à vista é sempre total - desconto (nunca uma segunda conta).
    const t = totaisDoOrcamento([{ preco_unitario: 1234.56, quantidade: 1 }], 10);
    expect(t.aVistaCentavos + t.descontoCentavos).toBe(t.totalCentavos);
  });

  it("formata R$ no padrão brasileiro com espaço comum", () => {
    expect(moedaSimples(1234.56)).toBe("R$ 1.234,56");
    expect(moedaSimples(0)).toBe("R$ 0,00");
    expect(moedaCentavos(7030)).toBe("R$ 70,30");
    expect(moedaCentavos(123456789)).toBe("R$ 1.234.567,89");
    expect(moedaSimples(1234.56)).not.toContain(" ");
  });
});

describe("bloqueio do Gerar PDF", () => {
  const b = (itens: ItemRevisao[]) =>
    motivosBloqueioGerar(
      itens.map((i) => ({
        avulso: i.avulso,
        preco_unitario: i.preco,
        produtoAtivo: i.produtoAtivo,
        descricao: i.descricao,
      })),
    );

  it("sem itens bloqueia", () => {
    expect(b([])).toEqual(["Adicione ao menos um item."]);
  });

  it("avulso com preço 0 (ou vazio) bloqueia, com o texto no singular e no plural", () => {
    expect(
      b([item(1), item(2, { avulso: true, codigo: null, preco: 0, produtoAtivo: null })]),
    ).toEqual(["Defina o preço do item avulso."]);
    expect(
      b([
        item(1, { avulso: true, codigo: null, preco: 0, produtoAtivo: null }),
        item(2, { avulso: true, codigo: null, preco: 0, produtoAtivo: null }),
      ]),
    ).toEqual(["Defina o preço dos 2 itens avulsos."]);
  });

  it("avulso com preço maior que 0 libera", () => {
    expect(
      b([item(1), item(2, { avulso: true, codigo: null, preco: 0.01, produtoAtivo: null })]),
    ).toEqual([]);
  });

  it("produto inativo no catálogo bloqueia", () => {
    expect(b([item(1, { produtoAtivo: false })])).toEqual([
      "Um produto saiu do catálogo: troque o produto.",
    ]);
  });

  it("orçamento normal está liberado", () => {
    expect(b([item(1), item(2)])).toEqual([]);
  });
});

describe("quantidade", () => {
  it("unidade: inteiro, arredonda para cima", () => {
    expect(normalizarQuantidade("un", 2)).toEqual({ ok: true, valor: 2, ajustada: false });
    expect(normalizarQuantidade("un", 2.2)).toEqual({ ok: true, valor: 3, ajustada: true });
  });
  it("metro: até 2 casas", () => {
    expect(normalizarQuantidade("m", 8.456)).toEqual({ ok: true, valor: 8.46, ajustada: true });
    expect(normalizarQuantidade("m", 8.5)).toEqual({ ok: true, valor: 8.5, ajustada: false });
  });
  it("avulso aceita 2 casas", () => {
    expect(normalizarQuantidade("un", 1.5, true)).toEqual({
      ok: true,
      valor: 1.5,
      ajustada: false,
    });
  });
  it("recusa zero, negativo, NaN e absurdo", () => {
    for (const n of [0, -1, Number.NaN, Infinity, 1e9])
      expect(normalizarQuantidade("un", n).ok).toBe(false);
  });
});

describe("ambientes e agrupamento", () => {
  it("ambientes da pergunta 5 viram rótulos; 'outro' usa o texto digitado", () => {
    expect(
      ambientesDasRespostas({
        ambientes: ["sala", "outro", "varanda"],
        ambiente_outro: "Escritório",
      }),
    ).toEqual(["Sala", "Escritório", "Varanda"]);
    expect(ambientesDasRespostas({})).toEqual([]);
  });

  it("agrupa na ordem da base, depois os ambientes só dos itens, e mantém ambientes vazios", () => {
    const grupos = agruparPorAmbiente(
      [
        item(1, { ambiente: "cozinha", ordem: 5 }),
        item(2, { ambiente: "Sala", ordem: 1 }),
        item(3, { ambiente: "Garagem", ordem: 3 }),
      ],
      ["Sala", "Cozinha", "Varanda"],
    );
    expect(grupos.map((g) => [g.nome, g.itens.map((i) => i.id)])).toEqual([
      ["Sala", ["i2"]],
      ["Cozinha", ["i1"]], // "cozinha" e "Cozinha" são o mesmo ambiente
      ["Varanda", []],
      ["Garagem", ["i3"]],
    ]);
  });

  it("nome de ambiente: aparado e limitado", () => {
    expect(nomeAmbienteValido("  Quarto   de   casal ")).toBe("Quarto de casal");
    expect(nomeAmbienteValido("   ")).toBeNull();
    expect(nomeAmbienteValido("x".repeat(61))).toBeNull();
  });
});

describe("preço mudou no estoque", () => {
  it("só conta itens com código cujo preço do catálogo é outro", () => {
    const mudaram = itensComPrecoMudado([
      item(1),
      item(2, { precoCatalogo: 12 }),
      item(3, { avulso: true, codigo: null, precoCatalogo: null, produtoAtivo: null }),
      item(4, { preco: 10.001, precoCatalogo: 10 }),
    ]);
    expect(mudaram.map((i) => i.id)).toEqual(["i2"]);
  });
});

describe("linha do tempo", () => {
  it("junta criado, IA, PDFs e status, em ordem, sem duplicar a criação nem rascunho->gerado", () => {
    const t = montarLinhaDoTempo({
      criadoEm: "2026-11-06T10:00:00Z",
      montadoEm: "2026-11-06T10:30:00Z",
      versoesPdf: [
        { versao: 1, gerado_em: "2026-11-06T11:00:00Z" },
        { versao: 2, gerado_em: "2026-11-06T12:00:00Z" },
      ],
      eventos: [
        { de_status: null, para_status: "rascunho", criado_em: "2026-11-06T10:00:00Z" },
        { de_status: "rascunho", para_status: "gerado", criado_em: "2026-11-06T11:00:00Z" },
        { de_status: "gerado", para_status: "enviado", criado_em: "2026-11-06T13:00:00Z" },
      ],
    });
    expect(t.map((e) => e.texto)).toEqual([
      "Orçamento criado",
      "Itens montados pela IA",
      "PDF gerado (versão 1)",
      "PDF gerado (versão 2)",
      "Status: Gerado → Enviado",
    ]);
  });

  it("sem IA, só criado", () => {
    expect(
      montarLinhaDoTempo({
        criadoEm: "2026-11-06T10:00:00Z",
        montadoEm: null,
        versoesPdf: [],
        eventos: [],
      }),
    ).toEqual([{ quando: "2026-11-06T10:00:00Z", texto: "Orçamento criado" }]);
  });
});
