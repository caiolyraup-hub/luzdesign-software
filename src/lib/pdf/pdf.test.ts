import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import type { ItemRevisao } from "../orcamento/itens";
import { montarDadosPdf, linhasDoRodape, type EntradaDadosPdf } from "./dados";
import { renderizarPdf } from "./renderizar";

const loja = {
  nome_fantasia: "Luz Design",
  razao_social: "Luz Design LTDA",
  cnpj: "04.487.554/0001-16",
  endereco: "Av. Dr. Júlio Marques Luz, 753-C, Jatiúca, Maceió-AL",
  telefone: null,
  whatsapp: null,
  instagram: null,
  site: null,
};

const config = {
  validade_dias: 7,
  desconto_avista_pct: 10,
  linhas_rodape:
    "À vista, desconto de 10%\nOrçamento válido por 7 dias\nPrazo de entrega: 30 a 45 dias úteis após o pagamento\nNão fazemos trocas de peças por encomenda\nMercadoria frágil",
};

const item = (n: number, extra: Partial<ItemRevisao> = {}): ItemRevisao => ({
  id: `i${n}`,
  codigo: String(10000 + n),
  descricao: `PRODUTO DE TESTE ${n} 6W 2.7K`,
  preco: 10 + n,
  quantidade: 2,
  ambiente: "Sala",
  avulso: false,
  justificativa: null,
  ordem: n,
  marca: "MB",
  unidade: "un",
  produtoAtivo: true,
  precoCatalogo: 10 + n,
  ...extra,
});

const entrada = (itens: ItemRevisao[], extra: Partial<EntradaDadosPdf> = {}): EntradaDadosPdf => ({
  loja,
  config,
  numero: "2026-0005",
  versao: 1,
  cliente: { nome: "TESTE Cliente", whatsapp: "(82) 99999-1234", arquiteto: "Lula Santana" },
  vendedora: "Aline",
  itens,
  agora: new Date("2026-11-06T15:00:00Z"),
  ...extra,
});

async function ler(buffer: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  // O extrator separa palavras de formas diferentes; compara sem espaços repetidos.
  return { texto: text.replace(/\s+/g, " "), paginas: totalPages };
}

describe("dados do PDF", () => {
  it("agrupa por ambiente, calcula subtotais, total e à vista", () => {
    const d = montarDadosPdf(
      entrada([
        item(1, { ambiente: "Sala", preco: 37, quantidade: 6 }),
        item(2, { ambiente: "Cozinha", preco: 20, quantidade: 8.5, unidade: "m" }),
        item(3, { ambiente: "Sala", preco: 311, quantidade: 1 }),
      ]),
    );
    expect(d.ambientes.map((a) => [a.nome, a.subtotalCentavos])).toEqual([
      ["Sala", 22200 + 31100],
      ["Cozinha", 17000],
    ]);
    expect(d.totais).toEqual({
      totalCentavos: 70300,
      descontoCentavos: 7030,
      aVistaCentavos: 63270,
      percentual: 10,
    });
    expect(d.dataEmissao).toBe("06/11/2026");
    expect(d.validade).toBe("13/11/2026");
  });

  it("item avulso sai sem código; ambiente vazio não aparece", () => {
    const d = montarDadosPdf(
      entrada(
        [item(1, { avulso: true, codigo: null, descricao: "Pendente sob medida", preco: 500 })],
        {
          ambientes: ["Varanda", "Sala"],
        },
      ),
    );
    expect(d.ambientes).toHaveLength(1);
    expect(d.ambientes[0].itens[0].codigo).toBeNull();
  });

  it("linhas do rodapé aceitam {desconto} e {validade_dias} e descartam linhas vazias", () => {
    expect(
      linhasDoRodape({
        validade_dias: 5,
        desconto_avista_pct: 12.5,
        linhas_rodape: "Desconto de {desconto}%\n\n  Válido por {validade_dias} dias  \n",
      }),
    ).toEqual(["Desconto de 12,5%", "Válido por 5 dias"]);
  });
});

describe("PDF", () => {
  it("contém número, cliente, totais e as condições da loja", async () => {
    const dados = montarDadosPdf(
      entrada([
        item(1, { preco: 37, quantidade: 6 }),
        item(2, { ambiente: "Cozinha", preco: 1234.56, quantidade: 1 }),
      ]),
    );
    const pdf = await renderizarPdf(dados, null);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const { texto, paginas } = await ler(pdf);
    expect(paginas).toBe(1);
    expect(texto).toContain("Nº 2026-0005");
    expect(texto.replaceAll(" ", "")).toContain("LUZDESIGN"); // sem logo: nome escrito (letras espaçadas)
    expect(texto).toContain("TESTE Cliente");
    expect(texto).toContain("Lula Santana");
    expect(texto).toContain("Aline");
    expect(texto).toContain("Válido até 13/11/2026");
    expect(texto).toContain("SALA");
    expect(texto).toContain("COZINHA");
    expect(texto).toContain("R$ 1.234,56");
    // 6 x 37 + 1.234,56 = 1.456,56; desconto de 10% = 145,66; à vista = 1.310,90
    expect(texto).toContain("R$ 1.456,56");
    expect(texto).toContain("R$ 145,66");
    expect(texto).toContain("R$ 1.310,90");
    expect(texto).toContain("TOTAL À VISTA");
    for (const linha of linhasDoRodape(config)) expect(texto).toContain(linha);
    expect(texto).toContain("Página 1 de 1");
  });

  it("orçamento de 60 itens pagina sem cortar item ao meio", async () => {
    const itens = Array.from({ length: 60 }, (_, i) =>
      item(i + 1, {
        ambiente: i < 30 ? "Sala" : "Cozinha",
        descricao: `ITEM ${i + 1} DESCRICAO LONGA DE TESTE PARA PAGINACAO 22W 3000K`,
      }),
    );
    const pdf = await renderizarPdf(montarDadosPdf(entrada(itens)), null);
    const { texto, paginas } = await ler(pdf);

    expect(paginas).toBeGreaterThanOrEqual(2);
    expect(paginas).toBeLessThanOrEqual(5);
    // Todos os itens e todos os códigos estão presentes, cada um uma vez.
    for (let n = 1; n <= 60; n++) {
      expect(texto).toContain(`ITEM ${n} DESCRICAO`);
      expect(texto.split(String(10000 + n)).length - 1).toBe(1);
    }
    expect(texto).toContain(`Página 1 de ${paginas}`);
    expect(texto).toContain(`Página ${paginas} de ${paginas}`);
    // Total: soma de (10+n)*2 para n=1..60 = 2*(600 + 1830) = 4.860,00
    expect(texto).toContain("R$ 4.860,00");
    for (const linha of linhasDoRodape(config)) expect(texto).toContain(linha);
  }, 60_000);

  it("usa o logo quando existe", async () => {
    // PNG 1x1 vermelho
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const pdf = await renderizarPdf(montarDadosPdf(entrada([item(1)])), {
      data: png,
      format: "png",
    });
    const { texto } = await ler(pdf);
    expect(texto.replaceAll(" ", "")).not.toContain("LUZDESIGN"); // o logo substitui o nome escrito
    expect(texto).toContain("Nº 2026-0005");
  });
});

describe("PDF sem análise do ambiente nem motivo dos produtos (dia 8)", () => {
  it("os dados do PDF não têm análise, miniatura nem motivo", () => {
    const dados = montarDadosPdf(entrada([item(1)]));
    expect(Object.keys(dados.ambientes[0]).sort()).toEqual(["itens", "nome", "subtotalCentavos"]);
    expect(Object.keys(dados.ambientes[0].itens[0])).not.toContain("motivo");
  });

  it("o PDF não traz o bloco de análise, mesmo se o item guardar um motivo antigo", async () => {
    const dados = montarDadosPdf(
      entrada([item(1, { descricaoManual: false, origem: "montagem_ia" })]),
    );
    const { texto } = await ler(await renderizarPdf(dados, null));
    expect(texto.replaceAll(" ", "")).not.toContain("ANÁLISEDOAMBIENTE");
    expect(texto).toContain("PRODUTO DE TESTE 1 6W 2.7K");
  });

  it("60 itens em 6 ambientes paginam sem cortar item", async () => {
    const nomes = ["Sala", "Cozinha", "Quartos", "Banheiros", "Varanda", "Fachada"];
    const itens = Array.from({ length: 60 }, (_, i) =>
      item(i + 1, {
        ambiente: nomes[Math.floor(i / 10)],
        descricao: `ITEM ${i + 1} DESCRICAO DE TESTE 22W 3000K`,
      }),
    );
    const pdf = await renderizarPdf(montarDadosPdf(entrada(itens)), null);
    const { texto, paginas } = await ler(pdf);
    expect(paginas).toBeGreaterThanOrEqual(2);
    expect(paginas).toBeLessThanOrEqual(6);
    for (let n = 1; n <= 60; n++) expect(texto).toContain(`ITEM ${n} DESCRICAO`);
    for (const n of nomes) expect(texto).toContain(`Subtotal ${n}`);
  }, 90_000);
});
