// Capturas das telas em 390 px e 1280 px, para comparar o visual antes e depois (dia 16). SÓ LEITURA:
// entra com as contas de teste da gerência e do dono e com uma conta de vendedora DESCARTÁVEL (criada e
// removida aqui); nada é criado nem alterado nos orçamentos.
// Uso: pnpm exec tsx --env-file=.env.local scripts/capturas-design.mts <pasta> [--base https://...]
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "@playwright/test";

const pasta = process.argv[2] ?? "test-results/telas/design";
const base = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "https://luzdesign-software.vercel.app";
mkdirSync(pasta, { recursive: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const TAMANHOS = [
  { nome: "390", largura: 390, altura: 844, movel: true },
  { nome: "1280", largura: 1280, altura: 800, movel: false },
];

async function contexto(b: Browser, t: (typeof TAMANHOS)[number]) {
  return b.newContext({
    viewport: { width: t.largura, height: t.altura },
    deviceScaleFactor: t.movel ? 2 : 1,
    isMobile: t.movel,
    hasTouch: t.movel,
    baseURL: base,
    locale: "pt-BR",
    timezoneId: "America/Maceio",
  });
}
async function entrar(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page
    .getByRole("heading", { name: /Para hoje|Equipe|Orçamentos/ })
    .first()
    .waitFor({ timeout: 45_000 });
}
async function foto(page: Page, rota: string, nome: string, t: string) {
  try {
    await page.goto(rota, { waitUntil: "networkidle", timeout: 45_000 });
  } catch {
    await page.goto(rota);
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${pasta}/${nome}-${t}.png`, fullPage: false });
}

const { data: orc } = await admin.from("orcamentos").select("id,status").order("numero").limit(20);
const gerado = orc?.find((o) => o.status === "gerado")?.id;
const rascunho = orc?.find((o) => o.status === "rascunho")?.id;
const enviado = orc?.find((o) => o.status === "followup_d10" || o.status === "enviado")?.id;

// conta de vendedora descartável (e a de "trocar senha")
const stamp = Date.now();
const emailV = `caiolyra.up+capdesign${stamp}@gmail.com`;
const emailT = `caiolyra.up+captroca${stamp}@gmail.com`;
const senhaV = `Cap-${Math.random().toString(36).slice(2)}-Xz9`;
const ids: string[] = [];
for (const [email, troca, nome] of [
  [emailV, false, "Captura Vendedora"],
  [emailT, true, "Captura Troca"],
] as const) {
  const c = await admin.auth.admin.createUser({
    email,
    password: senhaV,
    email_confirm: true,
    user_metadata: { trocar_senha: troca },
  });
  if (c.error) throw c.error;
  ids.push(c.data.user.id);
  await admin.from("usuarios").insert({ id: c.data.user.id, nome, email, perfil: "vendedora" });
}

const b = await chromium.launch();
try {
  for (const t of TAMANHOS) {
    // público
    {
      const ctx = await contexto(b, t);
      const p = await ctx.newPage();
      await foto(p, "/login", "00-login", t.nome);
      await ctx.close();
    }
    // trocar senha
    {
      const ctx = await contexto(b, t);
      const p = await ctx.newPage();
      await p.goto("/login");
      await p.getByLabel("E-mail").fill(emailT);
      await p.getByLabel("Senha").fill(senhaV);
      await p.getByRole("button", { name: "Entrar" }).click();
      await p.getByRole("heading", { name: "Crie sua senha" }).waitFor();
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${pasta}/01-trocar-senha-${t.nome}.png` });
      await ctx.close();
    }
    // vendedora (descartável): só telas de leitura
    {
      const ctx = await contexto(b, t);
      const p = await ctx.newPage();
      await entrar(p, emailV, senhaV);
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${pasta}/10-vendedora-para-hoje-${t.nome}.png` });
      for (const [rota, nome] of [
        ["/orcamentos?filtro=todos", "11-vendedora-lista"],
        ["/produtos", "12-vendedora-produtos"],
        ["/meus-numeros", "13-vendedora-numeros"],
        ["/clientes", "14-vendedora-clientes"],
        ["/arquitetos", "15-vendedora-arquitetos"],
        ["/relatar", "16-vendedora-relatar"],
      ] as const)
        await foto(p, rota, nome, t.nome);
      await ctx.close();
    }
    // gerência
    {
      const ctx = await contexto(b, t);
      const p = await ctx.newPage();
      await entrar(p, process.env.SEED_EMAIL_GERENCIA!, process.env.SEED_SENHA_INICIAL!);
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${pasta}/20-gerencia-inicio-${t.nome}.png` });
      const rotas: [string, string][] = [
        ["/gerencia?filtro=todos", "21-gerencia-equipe"],
        ["/gerencia/estoque", "22-gerencia-estoque"],
        ["/gerencia/configuracoes", "23-gerencia-ajustes"],
        ["/produtos", "24-gerencia-produtos"],
        ["/relatos", "25-gerencia-relatos"],
        ["/relatos?status=resumo", "26-gerencia-resumo-do-dia"],
        ["/clientes", "27-gerencia-clientes"],
        ["/arquitetos", "28-gerencia-arquitetos"],
      ];
      if (gerado) rotas.push([`/orcamentos/${gerado}`, "29-gerencia-orcamento-gerado"]);
      if (enviado) rotas.push([`/orcamentos/${enviado}`, "30-gerencia-orcamento-enviado"]);
      if (rascunho) rotas.push([`/orcamentos/${rascunho}`, "31-gerencia-orcamento-rascunho"]);
      for (const [rota, nome] of rotas) await foto(p, rota, nome, t.nome);
      await ctx.close();
    }
    // dono
    {
      const ctx = await contexto(b, t);
      const p = await ctx.newPage();
      await entrar(p, process.env.SEED_EMAIL_DONO!, process.env.SEED_SENHA_INICIAL!);
      await foto(p, "/comissoes", "40-dono-comissoes", t.nome);
      await ctx.close();
    }
  }
} finally {
  await b.close();
  for (const id of ids) {
    await admin.from("usuarios").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
}
console.log("Capturas em", pasta);
