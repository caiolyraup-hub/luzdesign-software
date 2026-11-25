// PDF = cliente (só código e tipo do produto). Planilha = estoque (tudo, com fabricante e referência).
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import { extrairVoltagem, textoTamanho, type MapaEstoque } from "../estoque/dados-estoque";
import type { ItemRevisao } from "../orcamento/itens";
import { gerarPlanilhaOrcamento } from "../planilha/orcamento";
import { montarDadosPdf, textoAvulsoCurto, type EntradaDadosPdf } from "./dados";
import { renderizarPdf } from "./renderizar";

const loja = {
  nome_fantasia: "Luz Design",
  razao_social: "Luz Design LTDA",
  cnpj: "04.487.554/0001-16",
  endereco: "Av. Dr. Júlio Marques Luz, 753-C, Maceió-AL",
  telefone: null,
  whatsapp: null,
  instagram: null,
  site: null,
};
const config = {
  validade_dias: 7,
  desconto_avista_pct: 10,
  linhas_rodape: "À vista, desconto de {desconto}%",
};

const item = (n: number, extra: Partial<ItemRevisao> = {}): ItemRevisao => ({
  id: `i${n}`,
  codigo: String(12340 + n),
  descricao: `DESCRICAO SECRETA DO PRODUTO ${n} 6W 2.7K`,
  preco: 10 + n + 0.5,
  quantidade: 2,
  ambiente: "Sala",
  avulso: false,
  justificativa: null,
  ordem: n,
  marca: "MB",
  categoria: "EMBUTIDO",
  unidade: "un",
  produtoAtivo: true,
  precoCatalogo: 10 + n + 0.5,
  ...extra,
});
const itens: ItemRevisao[] = [
  item(1),
  item(2, { quantidade: 3 }),
  item(3, { ambiente: "Cozinha", unidade: "m", quantidade: 8.5, categoria: "FITA LED", preco: 20 }),
  item(4, {
    ambiente: "Cozinha",
    codigo: null,
    avulso: true,
    categoria: null,
    descricao: "Pendente sob medida vidro fumê",
    preco: 890,
    quantidade: 1,
  }),
];
const entrada: EntradaDadosPdf = {
  loja,
  config,
  numero: "2026-0099",
  versao: 1,
  cliente: { nome: "Cliente Teste", whatsapp: null, arquiteto: null },
  vendedora: "Aline",
  itens,
  ambientes: ["Sala", "Cozinha"],
  agora: new Date("2026-11-24T15:00:00Z"),
};
const estoque: MapaEstoque = new Map([
  [
    "12341",
    {
      fabricante: "FABRICANTE-SECRETO",
      referencia: "REF-30865/3000",
      modelo: "MODELO-BOB",
      tamanho: "3 m",
      voltagem: "220V",
    },
  ],
]);

describe("PDF do cliente", () => {
  it("mostra código e tipo; nunca descrição, tamanho, voltagem, referência ou fabricante", async () => {
    const pdf = await renderizarPdf(montarDadosPdf(entrada), null);
    const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
    const t = text.replace(/\s+/g, " ");
    for (const c of ["12341", "12342", "12343", "EMBUTIDO", "FITA LED"]) expect(t).toContain(c);
    expect(t.toUpperCase()).toContain("TIPO");
    expect(t.toUpperCase()).not.toContain("DESCRIÇÃO");
    for (const proibido of [
      "DESCRICAO SECRETA",
      "2.7K",
      "FABRICANTE-SECRETO",
      "REF-30865",
      "MODELO-BOB",
      "220V",
    ])
      expect(t).not.toContain(proibido);
    expect(t).toContain("Pendente sob medida vidro fumê");
  });

  it("os dados do PDF nem carregam os dados do fornecedor", () => {
    const texto = JSON.stringify(montarDadosPdf(entrada));
    expect(texto).not.toContain("fabricante");
    expect(textoAvulsoCurto("x".repeat(80)).length).toBe(40);
    expect(textoAvulsoCurto("   ")).toBe("Item avulso");
  });
});

describe("planilha do estoque", () => {
  it("traz descrição, fabricante, referência, modelo, tamanho e voltagem", async () => {
    const bytes = await gerarPlanilhaOrcamento(montarDadosPdf(entrada), null, estoque);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    let todas = "";
    wb.getWorksheet("ORÇAMENTO")!.eachRow(
      (r) => (todas += " " + (r.values as unknown[]).join(" ")),
    );
    for (const v of [
      "DESCRICAO SECRETA DO PRODUTO 1",
      "FABRICANTE-SECRETO",
      "REF-30865/3000",
      "MODELO-BOB",
      "3 m",
      "220V",
    ])
      expect(todas).toContain(v);
  });

  it("orçamento sem itens não quebra", async () => {
    const bytes = await gerarPlanilhaOrcamento(montarDadosPdf({ ...entrada, itens: [] }), null);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("lê voltagem e tamanho do catálogo sem confundir com potência ou referência", () => {
    expect(extrairVoltagem("MTS FITA 10W/M 220V BR")).toBe("220V");
    expect(extrairVoltagem("12W 24 V 7321")).toBe("24V");
    expect(extrairVoltagem("FITA BIVOLT 127V/220V")).toBe("Bivolt / 127V / 220V");
    expect(extrairVoltagem("embutido 4191 18w br 3.000k", null)).toBe("");
    expect(extrairVoltagem("REF 7312V8 1.12V")).toBe("");
    expect(textoTamanho({ comprimento: 2.5 })).toBe("2,5 m");
    expect(textoTamanho({})).toBe("");
  });
});
