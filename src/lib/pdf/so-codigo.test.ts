// Dia 16 (parte A): por padrão o PDF e a planilha do orçamento mostram só o código (nunca a descrição);
// com `mostrar_descricao` ligado voltam a ter a descrição. Os totais são os mesmos nos dois modos.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
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
const entrada = (mostrar: boolean | undefined): EntradaDadosPdf => ({
  loja,
  config: { ...config, ...(mostrar === undefined ? {} : { mostrar_descricao: mostrar }) },
  numero: "2026-0099",
  versao: 1,
  cliente: { nome: "Cliente Teste", whatsapp: null, arquiteto: null },
  vendedora: "Aline",
  itens,
  ambientes: ["Sala", "Cozinha"],
  agora: new Date("2026-11-24T15:00:00Z"),
});

async function textoDoPdf(mostrar: boolean | undefined) {
  const pdf = await renderizarPdf(montarDadosPdf(entrada(mostrar)), null);
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  return text.replace(/\s+/g, " ");
}
async function planilha(mostrar: boolean | undefined) {
  const bytes = await gerarPlanilhaOrcamento(montarDadosPdf(entrada(mostrar)), null);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return wb.getWorksheet("ORÇAMENTO")!;
}
const cabecalho = (ws: ExcelJS.Worksheet) => {
  let achada: string[] = [];
  ws.eachRow((r) => {
    if (r.getCell(1).value === "QT")
      achada = (r.values as unknown[]).slice(1).map((v) => String(v));
  });
  return achada;
};

describe("PDF só com o código (padrão)", () => {
  it("nenhuma descrição aparece e todos os códigos aparecem", async () => {
    for (const mostrar of [undefined, false]) {
      const t = await textoDoPdf(mostrar);
      expect(t).not.toContain("DESCRICAO SECRETA");
      expect(t).not.toContain("EMBUTIDO"); // nem a categoria embaixo do código
      expect(t).not.toContain("FITA LED");
      for (const c of ["12341", "12342", "12343"]) expect(t).toContain(c);
      expect(t.toUpperCase()).toContain("QTD");
      expect(t.toUpperCase()).not.toContain("DESCRIÇÃO");
    }
  });

  it("item avulso mostra na coluna CÓDIGO o texto curto que a vendedora escreveu", async () => {
    const t = await textoDoPdf(false);
    expect(t).toContain("Pendente sob medida vidro fumê");
    expect(textoAvulsoCurto("  um   texto  ")).toBe("um texto");
    expect(textoAvulsoCurto("x".repeat(80)).length).toBe(40);
    expect(textoAvulsoCurto("   ")).toBe("Item avulso");
  });

  it("os totais são os mesmos com e sem descrição", () => {
    const sem = montarDadosPdf(entrada(false));
    const com = montarDadosPdf(entrada(true));
    expect(sem.totais).toEqual(com.totais);
    expect(sem.ambientes.map((a) => a.subtotalCentavos)).toEqual(
      com.ambientes.map((a) => a.subtotalCentavos),
    );
    expect(sem.mostrarDescricao).toBe(false);
    expect(com.mostrarDescricao).toBe(true);
  });

  it("com a configuração ligada o documento volta a ter a descrição", async () => {
    const t = await textoDoPdf(true);
    expect(t).toContain("DESCRICAO SECRETA DO PRODUTO 1");
    expect(t.toUpperCase()).toContain("DESCRIÇÃO");
  });
});

describe("planilha só com o código (padrão)", () => {
  it("colunas QT | CÓDIGO | AMBIENTE | UNIT | TOTAL e nenhuma descrição", async () => {
    const ws = await planilha(false);
    expect(cabecalho(ws)).toEqual(["QT", "CÓDIGO", "AMBIENTE", "UNIT", "TOTAL"]);
    let todas = "";
    ws.eachRow((r) => (todas += " " + (r.values as unknown[]).join(" ")));
    expect(todas).not.toContain("DESCRICAO SECRETA");
    expect(todas).not.toContain("EMBUTIDO");
    for (const c of ["12341", "12342", "12343"]) expect(todas).toContain(c);
    expect(todas).toContain("Pendente sob medida vidro fumê");
  });

  it("as fórmulas calculam certo: linha, total, desconto, à vista e subtotais por ambiente", async () => {
    const dados = montarDadosPdf(entrada(false));
    const ws = await planilha(false);
    let primeira = 0;
    let ultima = 0;
    const formulas: Record<string, { formula: string; result: number }> = {};
    ws.eachRow((r, n) => {
      const a = r.getCell(1).value;
      if (typeof a === "number") {
        primeira ||= n;
        ultima = n;
        const total = r.getCell(5).value as { formula: string; result: number };
        const unit = Number(r.getCell(4).value);
        expect(total.formula).toBe(`ROUND(A${n}*D${n},2)`);
        expect(total.result).toBeCloseTo(Math.round(a * unit * 100) / 100, 2);
      }
      for (const c of [1, 5]) {
        const v = r.getCell(c).value as { formula?: string; result?: number } | null;
        if (v && typeof v === "object" && "formula" in v && v.formula)
          formulas[`${c === 1 ? "A" : "E"}${n}`] = v as never;
      }
    });
    const somas = Object.values(formulas).map((f) => f.formula);
    expect(somas).toContain(`SUM(E${primeira}:E${ultima})`);
    expect(somas.some((f) => f.startsWith("-ROUND(E") && f.endsWith("*10/100,2)"))).toBe(true);
    expect(somas.some((f) => /^E\d+\+E\d+$/.test(f))).toBe(true);
    expect(somas.filter((f) => f.startsWith("SUMIF($C$"))).toHaveLength(dados.ambientes.length);
    const soma = [...Array(ultima - primeira + 1)].reduce((s, _, i) => {
      const v = ws.getRow(primeira + i).getCell(5).value as { result: number };
      return s + v.result;
    }, 0);
    expect(soma).toBeCloseTo(dados.totais.totalCentavos / 100, 2);
  });

  it("com a configuração ligada a planilha volta às 6 colunas com a descrição", async () => {
    const ws = await planilha(true);
    expect(cabecalho(ws)).toEqual(["QT", "PRODUTO", "DESCRIÇÃO", "AMBIENTE", "UNIT", "TOTAL"]);
    let todas = "";
    ws.eachRow((r) => (todas += " " + (r.values as unknown[]).join(" ")));
    expect(todas).toContain("DESCRICAO SECRETA DO PRODUTO 1");
  });

  it("orçamento sem itens não quebra no modo só código", async () => {
    const bytes = await gerarPlanilhaOrcamento(
      montarDadosPdf({ ...entrada(false), itens: [] }),
      null,
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
