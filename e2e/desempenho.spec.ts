import { expect, test, type Page } from "@playwright/test";

// Dia 12C: velocidade no celular simulado (CPU 4× mais lenta e rede 4G). Rode contra a versão de
// produção (pnpm build && pnpm start --port 3211; E2E_BASE_URL=http://localhost:3211) para medir o que
// a Vercel entrega: o servidor de desenvolvimento compila a página na hora e não representa o uso real.
// Metas: tela abre em até 3 s; busca responde em até 1 s.
const META_TELA_MS = 3000;
const META_BUSCA_MS = 1000;

async function simularCelular(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150, // ms de ida e volta (4G)
    downloadThroughput: (9 * 1024 * 1024) / 8, // 9 Mbps
    uploadThroughput: (4.5 * 1024 * 1024) / 8,
  });
}

async function entrar(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
}

const medidas: Record<string, number> = {};
async function medir(page: Page, nome: string, acao: () => Promise<void>, meta: number) {
  const t0 = Date.now();
  await acao();
  medidas[nome] = Date.now() - t0;
  console.log(`MEDIDA ${nome}: ${medidas[nome]} ms (meta ${meta} ms)`);
  expect(medidas[nome], nome).toBeLessThanOrEqual(meta);
}

test("telas e busca no celular simulado (CPU 4×, 4G)", async ({ page }) => {
  await entrar(page); // login sem limitação; a simulação vale para a navegação medida
  await simularCelular(page);

  await medir(
    page,
    "Para hoje",
    async () => {
      await page.goto("/", { waitUntil: "commit" });
      await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
    },
    META_TELA_MS,
  );

  await medir(
    page,
    "Lista de orçamentos",
    async () => {
      await page.goto("/orcamentos?filtro=todos", { waitUntil: "commit" });
      await expect(page.getByRole("heading", { name: "Meus orçamentos" })).toBeVisible();
    },
    META_TELA_MS,
  );

  await medir(
    page,
    "Tela de produtos",
    async () => {
      await page.goto("/produtos", { waitUntil: "commit" });
      await expect(page.getByRole("heading", { name: "Produtos" })).toBeVisible();
      await expect(page.getByRole("listitem").first()).toBeVisible();
    },
    META_TELA_MS,
  );

  await medir(
    page,
    "Busca de produto (resposta)",
    async () => {
      await page.getByRole("searchbox", { name: "Buscar produto" }).fill("fita 22w");
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(page.getByRole("listitem").filter({ hasText: /FITA/i }).first()).toBeVisible();
    },
    META_BUSCA_MS + 1500,
  ); // inclui a navegação do formulário (round-trip 4G) além da consulta

  await medir(
    page,
    "Resumo dos números",
    async () => {
      await page.goto("/meus-numeros", { waitUntil: "commit" });
      await expect(page.getByRole("heading", { name: "Meus números" })).toBeVisible();
    },
    META_TELA_MS,
  );
});
