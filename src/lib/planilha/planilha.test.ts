import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ItemRevisao } from "../orcamento/itens";
import { montarDadosPdf, type EntradaDadosPdf } from "../pdf/dados";
import { dimensoesPng, gerarPlanilhaOrcamento, textoProduto } from "./orcamento";

const loja = {
  nome_fantasia: "Luz Design",
  razao_social: "Luz Design LTDA",
  cnpj: "04.487.554/0001-16",
  endereco: "Av. Dr. Júlio Marques Luz, 753-C, Jatiúca, Maceió-AL",
  telefone: "(82) 3000-0000",
  whatsapp: null,
  instagram: null,
  site: null,
};
const config = {
  validade_dias: 7,
  desconto_avista_pct: 10,
  linhas_rodape: "À vista, desconto de {desconto}%\nOrçamento válido por {validade_dias} dias",
};

const item = (n: number, extra: Partial<ItemRevisao> = {}): ItemRevisao => ({
  id: `i${n}`,
  codigo: String(10000 + n),
  descricao: `PRODUTO ${n} 6W 2.7K`,
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
  item(4, { ambiente: "Cozinha", categoria: "FONTE", preco: 52.9 }),
  item(5, {
    ambiente: "Cozinha",
    codigo: null,
    avulso: true,
    categoria: null,
    descricao: "Pendente 3 globos, vidro fumê",
    preco: 890,
    quantidade: 1,
  }),
];

const entrada = (extra: Partial<EntradaDadosPdf> = {}): EntradaDadosPdf => ({
  loja,
  config,
  numero: "2026-0007",
  versao: 1,
  cliente: { nome: "TESTE Cliente", whatsapp: "(82) 99999-1234", arquiteto: "Lula Santana" },
  vendedora: "Aline",
  itens,
  ambientes: ["Sala", "Cozinha"],
  agora: new Date("2026-11-10T15:00:00Z"),
  ...extra,
});

async function abrir(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return wb.getWorksheet("ORÇAMENTO")!;
}

/** Acha a linha cujo texto na coluna dada é igual ao dado. */
function linhaCom(ws: ExcelJS.Worksheet, coluna: number, texto: string) {
  let achada = 0;
  ws.eachRow((r, n) => {
    if (!achada && String(r.getCell(coluna).value) === texto) achada = n;
  });
  return achada;
}

const formula = (c: ExcelJS.Cell) => c.value as { formula: string; result: number };

describe("planilha XLSX do orçamento", () => {
  it("tem cabeçalho, identificação e a tabela QT | PRODUTO | DESCRIÇÃO | AMBIENTE | UNIT | TOTAL", async () => {
    const dados = montarDadosPdf(entrada());
    const ws = await abrir(await gerarPlanilhaOrcamento(dados, null));

    expect(ws.getCell("C1").value).toBe("LUZ DESIGN");
    expect(ws.getCell(linhaCom(ws, 1, "ORÇAMENTO Nº"), 3).value).toBe("2026-0007");
    expect(ws.getCell(linhaCom(ws, 1, "CLIENTE"), 3).value).toBe("TESTE Cliente");
    expect(ws.getCell(linhaCom(ws, 1, "ARQUITETO"), 3).value).toBe("Lula Santana");
    expect(ws.getCell(linhaCom(ws, 1, "VENDEDORA"), 3).value).toBe("Aline");
    expect(ws.getCell(linhaCom(ws, 1, "VALIDADE"), 3).value).toBe(dados.validade);

    const cab = linhaCom(ws, 1, "QT");
    expect([1, 2, 3, 4, 5, 6].map((c) => ws.getCell(cab, c).value)).toEqual([
      "QT",
      "PRODUTO",
      "DESCRIÇÃO",
      "AMBIENTE",
      "UNIT",
      "TOTAL",
    ]);
    // Cabeçalho da tabela na cor cobre e painel congelado nele.
    expect((ws.getCell(cab, 1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FF9F5F47");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: cab });
  });

  it("uma linha por item, ordenada por ambiente, com PRODUTO = categoria + código e UNIT do catálogo", async () => {
    const dados = montarDadosPdf(entrada());
    const ws = await abrir(await gerarPlanilhaOrcamento(dados, null));
    const cab = linhaCom(ws, 1, "QT");
    const linhas = [1, 2, 3, 4, 5].map((i) =>
      [1, 2, 3, 4, 5].map((c) => ws.getCell(cab + i, c).value),
    );
    expect(linhas).toEqual([
      [2, "EMBUTIDO 10001", "PRODUTO 1 6W 2.7K", "Sala", 11.5],
      [3, "EMBUTIDO 10002", "PRODUTO 2 6W 2.7K", "Sala", 12.5],
      [8.5, "FITA LED 10003", "PRODUTO 3 6W 2.7K", "Cozinha", 20],
      [2, "FONTE 10004", "PRODUTO 4 6W 2.7K", "Cozinha", 52.9],
      [1, "AVULSO", "Pendente 3 globos, vidro fumê", "Cozinha", 890],
    ]);
    expect(textoProduto({ categoria: null, codigo: "12345" })).toBe("12345");
  });

  it("TOTAL de cada linha, total geral, desconto e à vista são fórmulas com o resultado já gravado", async () => {
    const dados = montarDadosPdf(entrada());
    const ws = await abrir(await gerarPlanilhaOrcamento(dados, null));
    const cab = linhaCom(ws, 1, "QT");
    const primeira = cab + 1;
    const ultima = cab + 5;

    // Cada linha: =ROUND(QT*UNIT,2) com o mesmo valor do PDF.
    dados.ambientes
      .flatMap((a) => a.itens)
      .forEach((it, i) => {
        const celula = formula(ws.getCell(primeira + i, 6));
        expect(celula.formula).toBe(`ROUND(A${primeira + i}*E${primeira + i},2)`);
        expect(celula.result).toBeCloseTo(it.totalCentavos / 100, 2);
      });

    const total = linhaCom(ws, 1, "TOTAL");
    expect(formula(ws.getCell(total, 6)).formula).toBe(`SUM(F${primeira}:F${ultima})`);
    expect(formula(ws.getCell(total, 6)).result).toBeCloseTo(dados.totais.totalCentavos / 100, 2);
    const desc = linhaCom(ws, 1, "DESCONTO À VISTA (10%)");
    expect(formula(ws.getCell(desc, 6)).formula).toBe(`-ROUND(F${total}*10/100,2)`);
    expect(formula(ws.getCell(desc, 6)).result).toBeCloseTo(
      -dados.totais.descontoCentavos / 100,
      2,
    );
    const avista = linhaCom(ws, 1, "TOTAL À VISTA");
    expect(formula(ws.getCell(avista, 6)).formula).toBe(`F${total}+F${desc}`);
    expect(formula(ws.getCell(avista, 6)).result).toBeCloseTo(dados.totais.aVistaCentavos / 100, 2);

    // Totais iguais aos do PDF: 2*11,5 + 3*12,5 + 8,5*20 + 2*52,9 + 890 = 23 + 37,5 + 170 + 105,8 + 890.
    expect(dados.totais.totalCentavos).toBe(122630);
    expect(formula(ws.getCell(total, 6)).result).toBe(1226.3);
  });

  it("subtotais por ambiente usam SOMASE sobre a coluna AMBIENTE e batem com o PDF", async () => {
    const dados = montarDadosPdf(entrada());
    const ws = await abrir(await gerarPlanilhaOrcamento(dados, null));
    const cab = linhaCom(ws, 1, "QT");
    const titulo = linhaCom(ws, 1, "SUBTOTAIS POR AMBIENTE");
    expect(titulo).toBeGreaterThan(cab);

    dados.ambientes.forEach((amb, i) => {
      const r = titulo + 1 + i;
      expect(ws.getCell(r, 1).value).toBe(amb.nome);
      const c = formula(ws.getCell(r, 6));
      expect(c.formula).toBe(
        `SUMIF($D$${cab + 1}:$D$${cab + 5},D${r},$F$${cab + 1}:$F$${cab + 5})`,
      );
      expect(c.result).toBeCloseTo(amb.subtotalCentavos / 100, 2);
    });
  });

  it("formato R$, condições no fim e impressão A4 ajustada à largura", async () => {
    const dados = montarDadosPdf(entrada());
    const ws = await abrir(await gerarPlanilhaOrcamento(dados, null));
    const cab = linhaCom(ws, 1, "QT");
    expect(ws.getCell(cab + 1, 5).numFmt).toContain("R$");
    expect(ws.getCell(cab + 1, 6).numFmt).toContain("R$");
    expect(ws.getCell(linhaCom(ws, 1, "CONDIÇÕES") + 1, 1).value).toBe(
      "• À vista, desconto de 10%",
    );
    expect(ws.pageSetup).toMatchObject({
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      orientation: "portrait",
    });
    expect(ws.pageSetup.printTitlesRow).toBe(`${cab}:${cab}`);
  });

  it("com o logo da loja a planilha continua abrindo e guarda a imagem", async () => {
    const logo = readFileSync("public/marca/logo.png");
    const dim = dimensoesPng(new Uint8Array(logo));
    expect(dim?.largura).toBeGreaterThan(0);
    const bytes = await gerarPlanilhaOrcamento(montarDadosPdf(entrada()), {
      data: new Uint8Array(logo),
      format: "png",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("ORÇAMENTO")!.getImages()).toHaveLength(1);
  });

  it("orçamento sem itens não quebra (fórmulas viram zero)", async () => {
    const ws = await abrir(
      await gerarPlanilhaOrcamento(montarDadosPdf(entrada({ itens: [] })), null),
    );
    expect(formula(ws.getCell(linhaCom(ws, 1, "TOTAL"), 6)).formula).toBe("0");
  });
});
