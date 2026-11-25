import ExcelJS from "exceljs";
import type { MapaEstoque } from "../estoque/dados-estoque";
import type { DadosPdf } from "../pdf/dados";
import { COR_DESTAQUE } from "../pdf/tema";

/**
 * Planilha do ESTOQUE (XLSX): o mesmo orçamento do PDF com tudo que o estoque precisa para separar o
 * material (descrição, fabricante, referência, modelo, tamanho e voltagem). Uso interno: não vai ao
 * cliente. Pensada para ser EDITADA: o TOTAL de cada linha, o total geral, o desconto à vista e os
 * subtotais por ambiente são fórmulas de verdade. O resultado calculado também é gravado em cada
 * fórmula, para a planilha abrir certa até em visualizador que não recalcula (WhatsApp, celular).
 */

export interface LogoPlanilha {
  data: Uint8Array;
  format: "png" | "jpg";
}

export const COLUNAS = [
  "QT",
  "CÓDIGO",
  "TIPO",
  "DESCRIÇÃO",
  "FABRICANTE",
  "REFERÊNCIA",
  "MODELO",
  "TAMANHO",
  "VOLTAGEM",
  "AMBIENTE",
  "UNIT",
  "TOTAL",
] as const;
const LARGURAS = [7, 11, 14, 42, 15, 17, 13, 11, 11, 18, 13, 15];
const letra = (n: number) => String.fromCharCode(64 + n);
const FORMATO_REAIS = '"R$" #,##0.00';
const COR_CABECALHO = `FF${COR_DESTAQUE.replace("#", "").toUpperCase()}`;
const COR_SUAVE = "FFF6EDE8";
const FINA = { style: "thin" as const, color: { argb: "FFD9CFC9" } };

const reais = (centavos: number) => centavos / 100;
const comoTexto = (v: string | null | undefined) => (v ?? "").trim();

/** Largura e altura de um PNG lidas do cabeçalho (para manter a proporção do logo). */
export function dimensoesPng(dados: Uint8Array): { largura: number; altura: number } | null {
  if (dados.length < 24) return null;
  const assinatura = [0x89, 0x50, 0x4e, 0x47];
  if (!assinatura.every((b, i) => dados[i] === b)) return null;
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  return { largura: v.getUint32(16), altura: v.getUint32(20) };
}

export async function gerarPlanilhaOrcamento(
  dados: DadosPdf,
  logo?: LogoPlanilha | null,
  estoque: MapaEstoque = new Map(),
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = dados.loja.nome_fantasia;
  wb.created = new Date();
  const nCols = COLUNAS.length;
  const U = letra(nCols); // última coluna (TOTAL)
  const cAmb = COLUNAS.indexOf("AMBIENTE") + 1;
  const cUnit = COLUNAS.indexOf("UNIT") + 1;
  const LA = letra(cAmb);
  const LU = letra(cUnit);
  const ws = wb.addWorksheet("ORÇAMENTO", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: {
      oddFooter: `&L${dados.loja.nome_fantasia} · Orçamento ${dados.numero}&RPágina &P de &N`,
    },
    views: [{ showGridLines: false }],
  });
  ws.columns = LARGURAS.map((width) => ({ width }));

  // ---- cabeçalho: logo (se houver) e dados da loja
  let linha = 1;
  const dimensoes = logo?.format === "png" ? dimensoesPng(logo.data) : null;
  if (logo) {
    const id = wb.addImage({
      buffer: Buffer.from(logo.data) as unknown as ExcelJS.Buffer,
      extension: logo.format === "png" ? "png" : "jpeg",
    });
    const largura = 150;
    const altura = dimensoes ? Math.round((largura * dimensoes.altura) / dimensoes.largura) : 54;
    ws.addImage(id, { tl: { col: 0.1, row: 0.2 }, ext: { width: largura, height: altura } });
  }
  const loja = dados.loja;
  const linhasLoja = [
    loja.razao_social ? `${loja.razao_social}${loja.cnpj ? ` · CNPJ ${loja.cnpj}` : ""}` : null,
    loja.endereco,
    [loja.telefone, loja.whatsapp, loja.instagram, loja.site].filter(Boolean).join(" · ") || null,
  ].filter((t): t is string => Boolean(t));

  ws.mergeCells(`C1:${U}1`);
  ws.getCell("C1").value = loja.nome_fantasia.toUpperCase();
  ws.getCell("C1").font = { bold: true, size: 15, color: { argb: COR_CABECALHO } };
  ws.getCell("C1").alignment = { horizontal: "right", vertical: "middle" };
  linhasLoja.forEach((t, i) => {
    ws.mergeCells(`C${i + 2}:${U}${i + 2}`);
    const c = ws.getCell(`C${i + 2}`);
    c.value = t;
    c.font = { size: 9, color: { argb: "FF6B6B6B" } };
    c.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  });
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 18;
  ws.getRow(4).height = 18;
  ws.mergeCells(`A5:${U}5`);
  const aviso = ws.getCell("A5");
  aviso.value = "PLANILHA DO ESTOQUE · USO INTERNO · NÃO ENVIAR AO CLIENTE";
  aviso.font = { bold: true, size: 10, color: { argb: COR_CABECALHO } };
  aviso.alignment = { horizontal: "center" };
  linha = 7;

  // ---- identificação do orçamento
  const pares: [string, string][] = [
    ["ORÇAMENTO Nº", dados.numero],
    ["DATA", dados.dataEmissao],
    ["VALIDADE", dados.validade],
    ["CLIENTE", dados.cliente.nome],
    ["WHATSAPP", comoTexto(dados.cliente.whatsapp)],
  ];
  if (dados.cliente.arquiteto) pares.push(["ARQUITETO", dados.cliente.arquiteto]);
  if (dados.cliente.endereco) pares.push(["ENDEREÇO DA OBRA", dados.cliente.endereco]);
  pares.push(["VENDEDORA", dados.vendedora]);
  for (const [rotulo, valor] of pares) {
    ws.mergeCells(`A${linha}:B${linha}`);
    const r = ws.getCell(`A${linha}`);
    r.value = rotulo;
    r.font = { bold: true, size: 9, color: { argb: COR_CABECALHO } };
    ws.mergeCells(`C${linha}:${U}${linha}`);
    const v = ws.getCell(`C${linha}`);
    v.value = valor || "—";
    v.font = { size: 10 };
    v.alignment = { horizontal: "left" };
    linha++;
  }
  linha++;

  // ---- tabela de itens (uma só, ordenada por ambiente)
  const cabecalho = linha;
  COLUNAS.forEach((nome, i) => {
    const c = ws.getCell(linha, i + 1);
    c.value = nome;
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_CABECALHO } };
    c.alignment = {
      horizontal: nome === "UNIT" || nome === "TOTAL" ? "right" : nome === "QT" ? "center" : "left",
      vertical: "middle",
    };
  });
  ws.getRow(linha).height = 22;
  linha++;

  const primeira = linha;
  for (const amb of dados.ambientes) {
    for (const item of amb.itens) {
      const r = ws.getRow(linha);
      const e = item.codigo ? estoque.get(item.codigo) : undefined;
      [
        item.quantidade,
        item.codigo ?? "AVULSO",
        comoTexto(item.categoria),
        item.descricao,
        e?.fabricante,
        e?.referencia,
        e?.modelo,
        e?.tamanho,
        e?.voltagem,
        amb.nome,
        reais(item.precoCentavos),
      ].forEach((valor, i) => {
        const c = r.getCell(i + 1);
        c.value = typeof valor === "number" ? valor : valor || "—";
        c.alignment = { vertical: "top", wrapText: true };
      });
      r.getCell(nCols).value = {
        formula: `ROUND(A${linha}*${LU}${linha},2)`,
        result: reais(item.totalCentavos),
      };
      r.getCell(1).alignment = { horizontal: "center", vertical: "top" };
      r.getCell(2).font = { bold: true, size: 11 };
      for (const col of [cUnit, nCols]) {
        r.getCell(col).numFmt = FORMATO_REAIS;
        r.getCell(col).alignment = { horizontal: "right", vertical: "top" };
      }
      for (let col = 1; col <= nCols; col++) r.getCell(col).border = { bottom: FINA };
      linha++;
    }
  }
  const ultima = linha - 1;
  const semItens = ultima < primeira;

  // ---- totais
  linha++;
  const faixa = (rotulo: string, formula: string, resultado: number, forte = false) => {
    ws.mergeCells(`A${linha}:${letra(nCols - 1)}${linha}`);
    const r = ws.getCell(`A${linha}`);
    r.value = rotulo;
    r.alignment = { horizontal: "right" };
    r.font = { bold: forte, size: forte ? 11 : 10 };
    const v = ws.getCell(`${U}${linha}`);
    v.value = { formula, result: resultado };
    v.numFmt = FORMATO_REAIS;
    v.alignment = { horizontal: "right" };
    v.font = {
      bold: true,
      size: forte ? 12 : 10,
      color: forte ? { argb: COR_CABECALHO } : undefined,
    };
    if (forte) {
      for (let col = 1; col <= nCols; col++) {
        ws.getCell(linha, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COR_SUAVE },
        };
      }
    }
    return linha++;
  };
  const faixaTotal = faixa(
    "TOTAL",
    semItens ? "0" : `SUM(${U}${primeira}:${U}${ultima})`,
    reais(dados.totais.totalCentavos),
  );
  const pct = dados.totais.percentual;
  const faixaDesc = faixa(
    `DESCONTO À VISTA (${String(pct).replace(".", ",")}%)`,
    `-ROUND(${U}${faixaTotal}*${pct}/100,2)`,
    -reais(dados.totais.descontoCentavos),
  );
  faixa(
    "TOTAL À VISTA",
    `${U}${faixaTotal}+${U}${faixaDesc}`,
    reais(dados.totais.aVistaCentavos),
    true,
  );

  // ---- subtotais por ambiente (SOMASE)
  linha++;
  ws.mergeCells(`A${linha}:${U}${linha}`);
  const titulo = ws.getCell(`A${linha}`);
  titulo.value = "SUBTOTAIS POR AMBIENTE";
  titulo.font = { bold: true, size: 9, color: { argb: COR_CABECALHO } };
  linha++;
  for (const amb of dados.ambientes) {
    if (cAmb > 2) ws.mergeCells(`A${linha}:${letra(cAmb - 1)}${linha}`);
    const nome = ws.getCell(`A${linha}`);
    nome.value = amb.nome;
    // O nome fica também em D, para a SOMASE comparar com a coluna AMBIENTE da tabela.
    const chave = ws.getCell(`${LA}${linha}`);
    chave.value = amb.nome;
    chave.font = { size: 9, color: { argb: "FF6B6B6B" } };
    const v = ws.getCell(`${U}${linha}`);
    v.value = {
      formula: semItens
        ? "0"
        : `SUMIF($${LA}$${primeira}:$${LA}$${ultima},${LA}${linha},$${U}$${primeira}:$${U}$${ultima})`,
      result: reais(amb.subtotalCentavos),
    };
    v.numFmt = FORMATO_REAIS;
    v.alignment = { horizontal: "right" };
    linha++;
  }

  // ---- condições
  if (dados.rodape.length > 0) {
    linha++;
    ws.mergeCells(`A${linha}:${U}${linha}`);
    const c = ws.getCell(`A${linha}`);
    c.value = "CONDIÇÕES";
    c.font = { bold: true, size: 9, color: { argb: COR_CABECALHO } };
    linha++;
    for (const texto of dados.rodape) {
      ws.mergeCells(`A${linha}:${U}${linha}`);
      const t = ws.getCell(`A${linha}`);
      t.value = `• ${texto}`;
      t.font = { size: 9 };
      t.alignment = { wrapText: true };
      linha++;
    }
  }

  // Cabeçalho da tabela congelado e repetido ao imprimir.
  ws.views = [{ state: "frozen", ySplit: cabecalho, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${cabecalho}:${cabecalho}`;

  const bytes = await wb.xlsx.writeBuffer();
  return new Uint8Array(bytes as ArrayBuffer);
}

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
