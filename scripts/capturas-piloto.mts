// Capturas das telas do piloto no SITE NO AR (390 px) e do PDF gerado, para conferir com os olhos.
// Só lê: não cria orçamento. A única escrita é uma conta descartável (criada e removida aqui) para
// mostrar /trocar-senha. Saída: test-results/telas/piloto-*.png. Uso: pnpm piloto:capturas
import { mkdirSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "@playwright/test";

const SITE = process.env.SITE_URL ?? "https://luzdesign-software.vercel.app";
const PASTA = "test-results/telas";
mkdirSync(PASTA, { recursive: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const browser = await chromium.launch();
const contexto = () =>
  browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    baseURL: SITE,
  });

async function entrar(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

// ---- vendedora (Aline, conta de teste): revisão com a faixa e o relato
{
  const ctx = await contexto();
  const page = await ctx.newPage();
  await entrar(page, process.env.SEED_EMAIL_ALINE!, process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("heading", { name: "Para hoje" }).waitFor();
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const { data: orc } = await admin
    .from("orcamentos")
    .select("id")
    .eq("vendedora_id", aline!.id)
    .in("status", ["rascunho", "gerado"])
    .order("numero", { ascending: false })
    .limit(1)
    .single();
  await page.goto(`/orcamentos/${orc!.id}/revisao`);
  await page.getByRole("heading", { name: "Produtos do orçamento" }).waitFor();
  await page.screenshot({ path: `${PASTA}/piloto-1-produtos-do-orcamento.png` });

  await page.getByRole("link", { name: "Relatar problema" }).click();
  await page.getByLabel("O que aconteceu?").waitFor();
  await page.screenshot({ path: `${PASTA}/piloto-3-relatar-problema.png` });
  await ctx.close();
}

// ---- gerência: Produtos com o aviso âmbar
{
  const ctx = await contexto();
  const page = await ctx.newPage();
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!, process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("heading", { name: "Para hoje" }).waitFor();
  await page.goto("/produtos");
  await page.getByRole("heading", { name: "Produtos" }).waitFor();
  await page
    .getByText(/catálogo provisório/i)
    .first()
    .waitFor();
  await page.screenshot({ path: `${PASTA}/piloto-2-produtos-gerencia.png` });
  await ctx.close();
}

// ---- /trocar-senha com uma conta descartável (criada e removida aqui)
{
  const email = `caiolyra.up+captura${Date.now()}@gmail.com`;
  const provisoria = `Prov-${Math.random().toString(36).slice(2)}-Xz9`;
  const c = await admin.auth.admin.createUser({
    email,
    password: provisoria,
    email_confirm: true,
    user_metadata: { trocar_senha: true },
  });
  if (c.error) throw c.error;
  await admin
    .from("usuarios")
    .insert({ id: c.data.user.id, nome: "Captura", email, perfil: "vendedora" });
  try {
    const ctx = await contexto();
    const page = await ctx.newPage();
    await entrar(page, email, provisoria);
    await page.getByRole("heading", { name: "Crie sua senha" }).waitFor();
    await page.screenshot({ path: `${PASTA}/piloto-4-trocar-senha.png` });
    await ctx.close();
  } finally {
    await admin.from("usuarios").delete().eq("id", c.data.user.id);
    await admin.auth.admin.deleteUser(c.data.user.id);
  }
}

// ---- PDF do orçamento gerado nesta rodada (e2e/revisao-pdf.spec.ts grava o arquivo), página a página
{
  const base64 = readFileSync(`${PASTA}/piloto-pdf-orcamento.pdf`).toString("base64");
  const page = await (
    await browser.newContext({ viewport: { width: 900, height: 1200 } })
  ).newPage();
  await page.setContent(
    "<html><body style='margin:0;background:#fff'><div id='p'></div></body></html>",
  );
  await page.addScriptTag({
    url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  });
  const paginas = await page.evaluate(async (b64) => {
    // @ts-expect-error pdfjsLib vem do script
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const doc = await pdfjs.getDocument({
      data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    }).promise;
    const raiz = document.getElementById("p")!;
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 1.4 });
      const cv = document.createElement("canvas");
      cv.width = vp.width;
      cv.height = vp.height;
      cv.id = `pg${i}`;
      cv.style.display = "block";
      raiz.appendChild(cv);
      await pg.render({ canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
    }
    return doc.numPages as number;
  }, base64);
  for (let i = 1; i <= paginas; i++)
    await page.locator(`#pg${i}`).screenshot({ path: `${PASTA}/piloto-5-pdf-pagina-${i}.png` });
  console.log(`PDF: ${paginas} página(s) convertidas em imagem`);
}
await browser.close();
console.log("Capturas salvas em", PASTA);
