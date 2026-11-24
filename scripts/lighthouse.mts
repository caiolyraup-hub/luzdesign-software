// Lighthouse no celular (acessibilidade e desempenho) de telas logadas, para comparar duas versões do app
// ligadas localmente (build de produção). Só leitura: usa a conta de teste da gerência e telas de consulta.
// Uso: tsx --env-file=.env.local scripts/lighthouse.mts <http://localhost:3230> <rotulo> <rota1,rota2,...>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const [base, rotulo, rotasTexto] = process.argv.slice(2);
const rotas = (rotasTexto ?? "/orcamentos").split(",");
mkdirSync("test-results/lighthouse", { recursive: true });

// 1) login e cookies
const b = await chromium.launch();
const ctx = await b.newContext({ baseURL: base });
const p = await ctx.newPage();
await p.goto("/login");
await p.getByLabel("E-mail").fill(process.env.SEED_EMAIL_GERENCIA!);
await p.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
await p.getByRole("button", { name: "Entrar" }).click();
await p.getByRole("heading", { name: "Para hoje" }).waitFor({ timeout: 60_000 });
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const chrome = chromium.executablePath();
// O cookie de sessão vai por arquivo temporário (nunca como argumento: erros imprimem os argumentos).
const arquivoCabecalho = path.join(os.tmpdir(), `lh-cab-${Date.now()}.json`);
writeFileSync(arquivoCabecalho, JSON.stringify({ Cookie: cookie }));
await b.close();

// 2) Lighthouse (mobile é o padrão: Moto G Power emulado, 4G lento, CPU 4x), 3 rodadas por tela
const saida: Record<string, { acessibilidade: number[]; desempenho: number[] }> = {};
for (const rota of rotas) {
  saida[rota] = { acessibilidade: [], desempenho: [] };
  for (let i = 0; i < 5; i++) {
    const arquivo = `test-results/lighthouse/${rotulo}-${rota.replace(/[^a-z0-9]+/gi, "_")}-${i}.json`;
    try {
      execFileSync(
        process.platform === "win32" ? "npx.cmd" : "npx",
        [
          "--yes",
          "lighthouse@12.6.1",
          `${base}${rota}`,
          "--only-categories=accessibility,performance",
          "--output=json",
          `--output-path=${arquivo}`,
          `--extra-headers=${arquivoCabecalho}`,
          "--chrome-flags=--headless=new --no-sandbox",
          "--quiet",
          ...(process.env.LH_BLOQUEAR ? [`--blocked-url-patterns=${process.env.LH_BLOQUEAR}`] : []),
        ],
        {
          stdio: "ignore",
          env: { ...process.env, CHROME_PATH: chrome },
          shell: process.platform === "win32",
        },
      );
    } catch {
      rmSync(arquivoCabecalho, { force: true });
      throw new Error(
        `Lighthouse falhou em ${rota} (rodada ${i + 1}); ver se o servidor está de pé.`,
      );
    }
    const j = JSON.parse(readFileSync(arquivo, "utf8"));
    saida[rota].acessibilidade.push(Math.round(j.categories.accessibility.score * 100));
    saida[rota].desempenho.push(Math.round(j.categories.performance.score * 100));
  }
}
rmSync(arquivoCabecalho, { force: true });
const mediana = (v: number[]) => [...v].sort((a, c) => a - c)[Math.floor(v.length / 2)];
for (const [rota, r] of Object.entries(saida))
  console.log(
    `${rotulo} ${rota}: acessibilidade ${mediana(r.acessibilidade)} (${r.acessibilidade.join("/")}) · desempenho ${mediana(r.desempenho)} (${r.desempenho.join("/")})`,
  );
