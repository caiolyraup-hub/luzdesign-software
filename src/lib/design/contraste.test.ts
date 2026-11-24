// Contraste WCAG AA das cores da marca (dia 16). Lê os tokens de src/app/globals.css, então um token
// trocado sem querer derruba o teste. Texto normal: 4,5:1; texto grande e componentes: 3:1.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");
const cor = (nome: string): string => {
  const m = new RegExp(`--color-${nome}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token --color-${nome} não existe`);
  return m[1];
};

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function razao(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [descrição, frente, fundo, mínimo]
const PARES: [string, string, string, number][] = [
  ["texto marrom no fundo", "marrom", "fundo", 4.5],
  ["texto marrom no branco", "marrom", "branco", 4.5],
  ["título marrom no fundo", "marrom-titulo", "fundo", 4.5],
  ["texto suave (zinc-600) no fundo", "zinc-600", "fundo", 4.5],
  ["texto suave no branco", "zinc-600", "branco", 4.5],
  ["texto suave sobre amarelo claro (amber-50)", "zinc-600", "amber-50", 4.5],
  ["texto zinc-700 no fundo", "zinc-700", "fundo", 4.5],
  ["BOTÃO PRINCIPAL: marrom sobre amarelo", "sobre-primario", "primario", 4.5],
  ["marrom sobre amarelo claro", "marrom", "amarelo-claro", 4.5],
  ["link e destaque: cobre escuro (amber-700) no fundo", "amber-700", "fundo", 4.5],
  ["link e destaque: cobre escuro no branco", "amber-700", "branco", 4.5],
  ["cobre escuro sobre amarelo claro", "amber-700", "amarelo-claro", 4.5],
  ["marrom título sobre amarelo claro", "amber-800", "amarelo-claro", 4.5],
  ["branco sobre cobre (barras e selos)", "branco", "cobre", 4.5],
  ["borda de campo no branco (componente 3:1)", "borda-campo", "branco", 3],
  ["foco: marrom no fundo", "marrom", "fundo", 3],
];

describe("contraste das cores da marca (WCAG AA)", () => {
  const linhas: string[] = [];
  for (const [descricao, frente, fundo, minimo] of PARES) {
    it(`${descricao} >= ${minimo}:1`, () => {
      const r = razao(cor(frente), cor(fundo));
      linhas.push(`${descricao.padEnd(52)} ${cor(frente)} / ${cor(fundo)}  ${r.toFixed(2)}:1`);
      expect(r).toBeGreaterThanOrEqual(minimo);
    });
  }

  it("amarelo NUNCA é cor de texto sobre o branco (só serve de fundo)", () => {
    expect(razao(cor("amarelo"), cor("branco"))).toBeLessThan(3);
  });

  it("(quadro dos pares)", () => {
    console.log("\n" + linhas.join("\n") + "\n");
  });
});
