import ExcelJS from "exceljs";
import type { PlanilhaLida } from "./tipos";

export interface ArquivoPlanilha {
  nome: string;
  dados: Uint8Array;
}

/** UTF-8 se for válido; senão Latin-1/Windows-1252 (comum em sistemas brasileiros). */
export function decodificarTexto(dados: Uint8Array): string {
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(dados);
  } catch {
    texto = new TextDecoder("windows-1252").decode(dados);
  }
  return texto.replace(/^﻿/, "");
}

/** Escolhe entre `;`, `,` e tabulação pelo que mais aparece na primeira linha (fora de aspas). */
export function detectarSeparador(texto: string): string {
  const contagem: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let dentroAspas = false;
  for (const c of texto) {
    if (c === '"') dentroAspas = !dentroAspas;
    else if (!dentroAspas && (c === "\n" || c === "\r")) break;
    else if (!dentroAspas && c in contagem) contagem[c]++;
  }
  return Object.entries(contagem).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(texto: string, separador: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let dentroAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else dentroAspas = false;
      } else campo += c;
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === separador) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/** Primeira linha não vazia vira o cabeçalho; nomes vazios ou repetidos ganham sufixo. */
function montarPlanilha(matriz: string[][]): PlanilhaLida {
  const vazia = (l: string[]) => l.every((c) => c.trim() === "");
  const inicio = matriz.findIndex((l) => !vazia(l));
  if (inicio < 0) return { colunas: [], linhas: [] };

  const usados = new Map<string, number>();
  const colunas = matriz[inicio].map((bruto, i) => {
    const base = bruto.trim() || `Coluna ${i + 1}`;
    const n = usados.get(base) ?? 0;
    usados.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });

  const linhas = matriz
    .slice(inicio + 1)
    .filter((l) => !vazia(l))
    .map((l) => Object.fromEntries(colunas.map((nome, i) => [nome, (l[i] ?? "").trim()])));

  return { colunas, linhas };
}

function celulaParaTexto(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") {
    // Evita "1.234" virar milhar ao reler: preços têm no máximo 2 casas.
    return Number.isInteger(valor) ? String(valor) : String(Number(valor.toFixed(2)));
  }
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "boolean") return valor ? "1" : "0";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "object") {
    if ("result" in valor && valor.result !== undefined)
      return celulaParaTexto(valor.result as ExcelJS.CellValue);
    if ("richText" in valor)
      return valor.richText
        .map((t) => t.text)
        .join("")
        .trim();
    if ("text" in valor && typeof valor.text === "string") return valor.text.trim();
  }
  return "";
}

export async function lerPlanilha(arquivo: ArquivoPlanilha): Promise<PlanilhaLida> {
  const nome = arquivo.nome.toLowerCase();

  if (nome.endsWith(".xlsx")) {
    const pasta = new ExcelJS.Workbook();
    await pasta.xlsx.load(arquivo.dados as unknown as ExcelJS.Buffer);
    const aba = pasta.worksheets[0];
    if (!aba) return { colunas: [], linhas: [] };
    const matriz: string[][] = [];
    aba.eachRow({ includeEmpty: false }, (linha) => {
      const valores: string[] = [];
      for (let c = 1; c <= linha.cellCount; c++)
        valores.push(celulaParaTexto(linha.getCell(c).value));
      matriz.push(valores);
    });
    return montarPlanilha(matriz);
  }

  if (nome.endsWith(".csv") || nome.endsWith(".txt")) {
    const texto = decodificarTexto(arquivo.dados);
    return montarPlanilha(parseCsv(texto, detectarSeparador(texto)));
  }

  throw new Error(
    "Formato não suportado. Envie um arquivo .xlsx ou .csv (salve o .xls como .xlsx).",
  );
}
