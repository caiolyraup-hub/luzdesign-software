import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  dataExcelMaceio,
  escreverExportacao,
  type FonteExportacao,
  type MetaExportacao,
} from "./planilha";
import { dadosSinteticos } from "./dados-sinteticos";

const meta = (extra: Partial<MetaExportacao> = {}): MetaExportacao => ({
  exportadoPor: "Gerência",
  exportadoEm: new Date("2026-11-12T15:30:00Z"),
  filtros: ["Em andamento", "Busca: silva"],
  incluiuTeste: false,
  gerencia: true,
  ...extra,
});

async function gerar(fonte: FonteExportacao, m: MetaExportacao) {
  const saida = new PassThrough();
  const partes: Buffer[] = [];
  saida.on("data", (p: Buffer) => partes.push(p));
  const fim = new Promise<void>((ok, erro) => {
    saida.on("end", ok);
    saida.on("error", erro);
  });
  const contagem = await escreverExportacao(fonte, saida, m);
  await fim;
  return { buffer: Buffer.concat(partes), contagem };
}

describe("dataExcelMaceio", () => {
  it("grava a hora de parede de Maceió (UTC-3) como data do Excel", () => {
    // 12/11 15:30 UTC = 12:30 em Maceió
    expect(dataExcelMaceio("2026-11-12T15:30:00Z")?.toISOString()).toBe("2026-11-12T12:30:00.000Z");
    // virada de dia: 01/12 02:30 UTC ainda é 30/11 23:30 em Maceió
    expect(dataExcelMaceio("2026-12-01T02:30:00Z")?.toISOString()).toBe("2026-11-30T23:30:00.000Z");
    expect(dataExcelMaceio(null)).toBeNull();
    expect(dataExcelMaceio("lixo")).toBeNull();
  });
});

describe("planilha de exportação (conteúdo)", () => {
  it("abas, cabeçalhos, linhas, formatos e totais batem com os dados", async () => {
    const fonte = dadosSinteticos(60, 7);
    const { buffer, contagem } = await gerar(fonte, meta());
    expect(contagem).toEqual({ orcamentos: 60, itens: 420, clientes: 60, eventos: 120 });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Resumo",
      "Orçamentos",
      "Itens",
      "Clientes",
      "Eventos",
    ]);

    // Orçamentos: cabeçalho na cor cobre, filtro automático, painel congelado, uma linha por orçamento.
    const wo = wb.getWorksheet("Orçamentos")!;
    expect(wo.rowCount).toBe(61);
    expect(wo.getRow(1).values).toEqual([
      undefined,
      "Número",
      "Vendedora",
      "Cliente",
      "WhatsApp",
      "Tipo de cliente",
      "Arquiteto",
      "Status",
      "Valor total",
      "Valor fechado",
      "Motivo da perda",
      "Criado",
      "Gerado",
      "Enviado (primeiro)",
      "Último envio",
      "Fechado",
      "Perdido",
      "Validade",
      "Vencido",
      "Versão do PDF",
    ]);
    const cab = wo.getRow(1).getCell(1);
    expect((cab.fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FF9F5F47");
    expect(wo.autoFilter).toBeTruthy();
    expect(wo.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });

    const l2 = wo.getRow(2);
    expect(l2.getCell(1).value).toBe("2026-0001");
    expect(typeof l2.getCell(8).value).toBe("number"); // valor é número, nunca texto
    expect(l2.getCell(8).numFmt).toBe('"R$" #,##0.00');
    expect(l2.getCell(4).value).toBe("+558298810000"); // WhatsApp como texto
    expect(typeof l2.getCell(4).value).toBe("string");
    expect(l2.getCell(11).value).toBeInstanceOf(Date); // data do Excel
    expect(l2.getCell(11).numFmt).toBe("dd/mm/yyyy hh:mm");
    // 15:00 UTC = 12:00 em Maceió
    expect((l2.getCell(11).value as Date).toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(l2.getCell(7).value).toBe("Rascunho");
    expect(wo.getRow(3).getCell(7).value).toBe("Gerado");

    // Soma da coluna Valor total confere com a soma dos dados.
    let soma = 0;
    wo.eachRow((r, n) => {
      if (n > 1) soma += r.getCell(8).value as number;
    });
    expect(soma).toBeCloseTo(
      fonte.orcamentos.reduce((s, o) => s + o.valor_total, 0),
      1,
    );

    // Itens: uma linha por item; total do item = quantidade x unitário; avulso e origem em português.
    const wi = wb.getWorksheet("Itens")!;
    expect(wi.rowCount).toBe(421);
    expect(wi.getRow(1).getCell(1).value).toBe("Orçamento");
    const i2 = wi.getRow(2);
    expect(i2.getCell(1).value).toBe("2026-0001");
    // k=0: quantidade 1, preço 20, total 20
    expect(i2.getCell(5).value).toBe(1);
    expect(i2.getCell(7).value).toBe(20);
    expect(i2.getCell(8).value).toBe(20);
    expect(i2.getCell(9).value).toBe("Não");
    expect(i2.getCell(10).value).toBe("Manual");
    const avulso = wi.getRow(8); // k=6: avulso, sem código
    expect(avulso.getCell(9).value).toBe("Sim");
    expect(avulso.getCell(3).value ?? "").toBe(""); // avulso não tem código
    expect(wi.getRow(3).getCell(10).value).toBe("Lista colada");
    expect(wi.getRow(4).getCell(10).value).toBe("Indicação da IA");
    expect(wi.getRow(5).getCell(10).value).toBe("Montagem antiga");

    // Clientes e Eventos.
    const wc = wb.getWorksheet("Clientes")!;
    expect(wc.rowCount).toBe(61);
    expect(wc.getRow(1).getCell(5).value).toBe("Orçamentos");
    const we = wb.getWorksheet("Eventos")!;
    expect(we.rowCount).toBe(121);
    expect(we.getRow(2).getCell(4).value).toBe("Rascunho");

    // Resumo: totais e tabela por vendedora.
    const wr = wb.getWorksheet("Resumo")!;
    const achar = (rotulo: string) => {
      let v: unknown;
      wr.eachRow((r) => {
        if (r.getCell(1).value === rotulo) v = r.getCell(2).value;
      });
      return v;
    };
    expect(achar("Orçamentos exportados")).toBe(60);
    expect(achar("Exportado por")).toBe("Gerência");
    expect(achar("Período e filtros")).toBe("Em andamento; Busca: silva");
    expect(achar("Orçamentos de teste")).toBe("Fora da exportação");
    expect(achar("Valor total")).toBeCloseTo(
      fonte.orcamentos.reduce((s, o) => s + o.valor_total, 0),
      1,
    );
    const fechados = fonte.orcamentos.filter((o) => o.status === "fechado");
    expect(achar("Vendido (fechados)")).toBeCloseTo(
      fechados.reduce((s, o) => s + (o.valor_fechado ?? 0), 0),
      1,
    );
    expect(achar("Em aberto (quantidade)")).toBe(
      fonte.orcamentos.filter((o) => ["enviado", "followup_d5", "followup_d10"].includes(o.status))
        .length,
    );
    expect(achar("Aline")).toBe(30); // orçamentos da Aline na tabela por vendedora
    expect(achar("Kely")).toBe(30);
    expect(achar("Total")).toBe(60);
  });

  it("vencido: sim/não pela regra única de vencimento", async () => {
    const fonte = dadosSinteticos(6, 1);
    // exportado em 12/11: validade 2026-11-01 (dia 1 + i%27) está vencida nos que vencem
    const { buffer } = await gerar(fonte, meta({ exportadoEm: new Date("2026-11-12T15:00:00Z") }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const wo = wb.getWorksheet("Orçamentos")!;
    const colVencido = (n: number) => wo.getRow(n + 1).getCell(18).value;
    expect(colVencido(1)).toBe("Não"); // rascunho nunca vence
    expect(colVencido(2)).toBe("Sim"); // gerado com validade 2026-11-02
    expect(colVencido(5)).toBe("Não"); // fechado nunca vence
    expect(colVencido(6)).toBe("Não"); // perdido nunca vence
  });

  it("vendedora: sem a aba Eventos e sem eventos lidos do banco", async () => {
    const fonte = dadosSinteticos(10, 2);
    let leuEventos = false;
    const { buffer, contagem } = await gerar(
      { ...fonte, eventos: async () => ((leuEventos = true), []) },
      meta({ gerencia: false, exportadoPor: "Aline" }),
    );
    expect(leuEventos).toBe(false);
    expect(contagem.eventos).toBe(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumo", "Orçamentos", "Itens", "Clientes"]);
  });

  it("sem nenhum orçamento: gera o arquivo com os cabeçalhos", async () => {
    const { buffer, contagem } = await gerar({ orcamentos: [], itens: async () => [] }, meta());
    expect(contagem).toEqual({ orcamentos: 0, itens: 0, clientes: 0, eventos: 0 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("Orçamentos")!.rowCount).toBe(1);
  });

  it("chama aoFinalizar com as contagens antes de fechar o arquivo", async () => {
    let visto: unknown = null;
    await gerar(dadosSinteticos(5, 2), meta({ aoFinalizar: (c) => void (visto = c) }));
    expect(visto).toMatchObject({ orcamentos: 5, itens: 10 });
  });
});

describe("volume: 5.000 orçamentos e 30.000 itens", () => {
  it("gera em fluxo, sem estourar a memória, e as linhas conferem", async () => {
    const fonte = dadosSinteticos(5000, 6);
    const antes = process.memoryUsage().heapUsed;
    const t0 = Date.now();
    const saida = new PassThrough();
    let bytes = 0;
    let pico = 0;
    saida.on("data", (p: Buffer) => {
      bytes += p.length; // descarta: não acumula o arquivo na memória
      pico = Math.max(pico, process.memoryUsage().heapUsed);
    });
    const fim = new Promise<void>((ok, erro) => {
      saida.on("end", ok);
      saida.on("error", erro);
    });
    const contagem = await escreverExportacao(fonte, saida, meta());
    await fim;
    const ms = Date.now() - t0;
    const mbHeap = Math.max(0, pico - antes) / 1024 / 1024;
    console.log(
      `exportação 5.000 orçamentos / 30.000 itens: ${(ms / 1000).toFixed(1)} s, ${(bytes / 1024 / 1024).toFixed(1)} MB de arquivo, +${mbHeap.toFixed(0)} MB de heap no pico`,
    );
    expect(contagem).toMatchObject({ orcamentos: 5000, itens: 30000, eventos: 10000 });
    expect(contagem.clientes).toBe(800);
    expect(ms).toBeLessThan(60_000);
    expect(bytes).toBeGreaterThan(500_000);
  }, 120_000);
});
