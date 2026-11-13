// Dia 11C: PDF e XLSX do orçamento nunca mostram fabricante, modelo nem referência do catálogo.
import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import type { ItemRevisao } from "../orcamento/itens";
import { montarDadosPdf } from "../pdf/dados";
import { renderizarPdf } from "../pdf/renderizar";
import { gerarPlanilhaOrcamento } from "../planilha/orcamento";
import { limparDescricao } from "./limpar";

const ORIGINAIS: [string, string, string][] = [
  ["10338", "FONTE", "MB 24W"],
  ["11343", "SPOT", "MB BLET 6338 EMBUT PT 5W 3.0K"],
  ["12785", "EMBUTIDO", "DL-7324 10W BR 3K ASTRA"],
  ["10318", "PENDENTE", "CASUAL LIGHT PD1334BZ-BR"],
  ["12866", "EMBUTIDO", "STL25367BR/27 SQUARE MICRO"],
  ["8905", "EMBUTIDO", "STH8904BR/40 DEEP 22W BR 4K"],
];
const PROIBIDOS = [
  "MB",
  "ASTRA",
  "BLET",
  "6338",
  "DL-7324",
  "7324",
  "PD1334BZ",
  "CASUAL",
  "STL25367",
  "SQUARE",
  "STH8904",
  "DEEP",
];

const itens: ItemRevisao[] = ORIGINAIS.map(([codigo, categoria, original], i) => ({
  id: `i${i}`,
  codigo,
  // Descrição já limpa, como o catálogo passa a entregá-la.
  descricao: limparDescricao(original, categoria).comercial,
  preco: 50 + i,
  quantidade: 2,
  ambiente: "Sala",
  avulso: false,
  justificativa: null,
  ordem: i,
  // O fabricante é de propósito oferecido ao item: nenhum documento pode usá-lo.
  marca: "MB",
  categoria,
  unidade: "un",
  produtoAtivo: true,
  precoCatalogo: 50 + i,
}));

const dados = montarDadosPdf({
  loja: {
    nome_fantasia: "Luz Design",
    razao_social: null,
    cnpj: null,
    endereco: null,
    telefone: null,
    whatsapp: null,
    instagram: null,
    site: null,
  },
  config: { validade_dias: 7, desconto_avista_pct: 10, linhas_rodape: "Mercadoria frágil" },
  numero: "2026-0099",
  versao: 1,
  cliente: { nome: "Cliente Teste", whatsapp: null, arquiteto: null },
  vendedora: "Aline",
  itens,
  agora: new Date("2026-11-13T15:00:00Z"),
});

const acha = (texto: string) =>
  PROIBIDOS.filter((p) => new RegExp(`(?<![A-Za-z0-9])${p}(?![A-Za-z0-9])`, "i").test(texto));

describe("documentos do cliente", () => {
  it("o PDF mostra o código interno e a descrição comercial, sem fabricante nem referência", async () => {
    const pdf = await renderizarPdf(dados, null);
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), {
      mergePages: true,
    });
    const t = text.replace(/\s+/g, " ");
    expect(t).toContain("10338");
    expect(t).toContain("FONTE 24W");
    expect(acha(t)).toEqual([]);
  });

  it("o XLSX também não", async () => {
    const bytes = await gerarPlanilhaOrcamento(dados, null);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    const textos: string[] = [];
    wb.eachSheet((ws) =>
      ws.eachRow((r) =>
        r.eachCell((c) =>
          textos.push(String((c.value as { result?: unknown })?.result ?? c.value ?? "")),
        ),
      ),
    );
    const todo = textos.join(" | ");
    expect(todo).toContain("10338");
    expect(acha(todo)).toEqual([]);
  });
});
