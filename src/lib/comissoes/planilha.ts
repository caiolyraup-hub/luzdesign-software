import ExcelJS from "exceljs";
import { COR_DESTAQUE } from "../pdf/tema";
import type { DadosComissoes } from "./carregar";
import type { PeriodoComissao } from "./calculo";

const FORMATO_REAIS = '"R$" #,##0.00';
const COR_CABECALHO = `FF${COR_DESTAQUE.replace("#", "").toUpperCase()}`;
const STATUS = { a_pagar: "A pagar", paga: "Paga", cancelada: "Cancelada" } as const;

function aba(
  wb: ExcelJS.Workbook,
  nome: string,
  colunas: { titulo: string; largura: number; formato?: string }[],
  linhas: (string | number | Date | null)[][],
) {
  const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = colunas.map((c) => ({ header: c.titulo, width: c.largura }));
  const cab = ws.getRow(1);
  cab.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_CABECALHO } };
  });
  for (const l of linhas) {
    const r = ws.addRow(l);
    colunas.forEach((c, i) => {
      if (c.formato) r.getCell(i + 1).numFmt = c.formato;
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
}

/** Planilha de comissões (só o dono): Resumo, Arquitetos, Vendedoras e Lançamentos. */
export async function gerarPlanilhaComissoes(
  d: DadosComissoes,
  meta: { periodo: PeriodoComissao; exportadoPor: string; exportadoEm: Date; status: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Luz Design Orçamentos";
  wb.created = meta.exportadoEm;

  aba(
    wb,
    "Resumo",
    [
      { titulo: "Item", largura: 30 },
      { titulo: "Valor", largura: 24, formato: FORMATO_REAIS },
    ],
    [
      ["Competência", meta.periodo.rotulo],
      [
        "Status",
        meta.status === "todas"
          ? "Todas"
          : (STATUS[meta.status as keyof typeof STATUS] ?? meta.status),
      ],
      ["Exportado por", meta.exportadoPor],
      ["Exportado em", meta.exportadoEm],
      ["A pagar", d.resumo.aPagar],
      ["Pagas no período", d.resumo.pagas],
      ["Total dos arquitetos", d.resumo.arquitetos],
      ["Total das vendedoras", d.resumo.vendedoras],
    ],
  );

  const porBeneficiario = (lista: typeof d.resumo.porArquiteto, nomes: Map<string, string>) =>
    lista.map((b) => [nomes.get(b.beneficiarioId) ?? "—", b.vendas, b.vendido, b.aPagar, b.paga]);
  const colunasBenef = (rotulo: string) => [
    { titulo: rotulo, largura: 30 },
    { titulo: "Vendas", largura: 10, formato: "0" },
    { titulo: "Valor vendido", largura: 16, formato: FORMATO_REAIS },
    { titulo: "A pagar", largura: 16, formato: FORMATO_REAIS },
    { titulo: "Paga", largura: 16, formato: FORMATO_REAIS },
  ];
  aba(
    wb,
    "Arquitetos",
    colunasBenef("Arquiteto"),
    porBeneficiario(d.resumo.porArquiteto, d.nomes.arquitetos),
  );
  aba(
    wb,
    "Vendedoras",
    colunasBenef("Vendedora"),
    porBeneficiario(d.resumo.porVendedora, d.nomes.vendedoras),
  );

  aba(
    wb,
    "Lançamentos",
    [
      { titulo: "Competência", largura: 13 },
      { titulo: "Orçamento", largura: 12 },
      { titulo: "Cliente", largura: 28 },
      { titulo: "Tipo", largura: 12 },
      { titulo: "Beneficiário", largura: 26 },
      { titulo: "Base (valor fechado)", largura: 18, formato: FORMATO_REAIS },
      { titulo: "Percentual (%)", largura: 14, formato: "0.00" },
      { titulo: "Comissão", largura: 16, formato: FORMATO_REAIS },
      { titulo: "Status", largura: 11 },
      { titulo: "Paga em", largura: 12 },
      { titulo: "Observação", largura: 36 },
    ],
    d.lancamentos.map((l) => [
      l.competencia.slice(0, 7),
      l.orcamentoNumero,
      l.clienteNome ?? "",
      l.tipo === "arquiteto" ? "Arquiteto" : "Vendedora",
      l.beneficiarioNome,
      l.base,
      l.percentual,
      l.valor,
      STATUS[l.status],
      l.pagaEm ? l.pagaEm.split("-").reverse().join("/") : "",
      l.observacao ?? "",
    ]),
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
