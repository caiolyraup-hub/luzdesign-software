import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 12D: "Relatar problema" (todos os perfis) e /relatos (gerência e dono).
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const TEXTO = `RELATO E2E o botão não respondeu ${Date.now()}`;

async function limpar() {
  const { data } = await admin
    .from("relatos_piloto")
    .select("id, foto_path")
    .like("mensagem", "RELATO E2E%");
  const fotos = (data ?? []).map((r) => r.foto_path).filter((f): f is string => Boolean(f));
  if (fotos.length) await admin.storage.from("relatos").remove(fotos);
  await admin.from("relatos_piloto").delete().like("mensagem", "RELATO E2E%");
}
test.beforeAll(limpar);
test.afterAll(limpar);

async function entrar(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
}

test("Aline relata um problema com foto e a gerência resolve", async ({ page }) => {
  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  await page.goto("/produtos");
  await page.getByRole("link", { name: "Relatar problema" }).click();
  await expect(page).toHaveURL(/\/relatar\?tela=%2Fprodutos$/);
  await expect(page.getByText("/produtos").first()).toBeVisible(); // tela atual preenchida sozinha
  await page.getByLabel("O que aconteceu?").fill("curto"); // 5 letras valem; vazio não
  await page.getByLabel("O que aconteceu?").fill(TEXTO);
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 200;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#2c7a7b";
    ctx.fillRect(0, 0, 300, 200);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByTestId("foto-relato").setInputFiles({
    name: "tela.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await page.getByRole("button", { name: "Enviar relato" }).click();
  await expect(page.getByText("Relato enviado. Obrigado!")).toBeVisible();

  const { data } = await admin
    .from("relatos_piloto")
    .select("id, tela, status, foto_path, usuario_id")
    .eq("mensagem", TEXTO)
    .single();
  expect(data).toMatchObject({ tela: "/produtos", status: "aberto" });
  expect(data!.foto_path).toMatch(new RegExp(`^${data!.usuario_id}/[0-9a-f-]{36}\.`));

  // A vendedora não tem a tela de relatos da gerência.
  expect((await page.request.get("/relatos")).status()).toBe(404);

  // Gerência vê, abre a foto assinada e resolve.
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.getByRole("link", { name: "Relatos" }).click();
  const cartao = page.getByRole("listitem").filter({ hasText: TEXTO });
  await expect(cartao).toBeVisible();
  await expect(cartao.getByText(/Aline/)).toBeVisible();
  await expect(cartao.getByRole("link", { name: "Ver foto da tela" })).toHaveAttribute(
    "href",
    /\/storage\/v1\/object\/sign\/relatos\//,
  );
  await cartao.getByRole("button", { name: "Marcar como resolvido" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: TEXTO })).toHaveCount(0);
  await page.getByRole("link", { name: "Resolvidos" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: TEXTO })).toBeVisible();
  const { data: dep } = await admin
    .from("relatos_piloto")
    .select("status, resolvido_em")
    .eq("mensagem", TEXTO)
    .single();
  expect(dep!.status).toBe("resolvido");
  expect(dep!.resolvido_em).not.toBeNull();

  // Aba "Resumo do dia" (dia 13B): números por vendedora, relatos abertos, erros e custo de IA; sem comissão.
  await page.getByRole("link", { name: "Resumo do dia" }).click();
  await expect(page.getByText("Custo de IA do dia")).toBeVisible();
  await expect(page.getByText("Relatos abertos (")).toBeVisible();
  await expect(page.getByText("Aline", { exact: true })).toBeVisible();
  await expect(page.getByText(/comiss/i)).toHaveCount(0);
});

test("o dono também vê o link e a lista de relatos; todos os perfis têm o botão Relatar problema", async ({
  page,
}) => {
  for (const email of [
    process.env.SEED_EMAIL_KELY!,
    process.env.SEED_EMAIL_GERENCIA!,
    process.env.SEED_EMAIL_DONO!,
  ]) {
    await entrar(page, email);
    await expect(page.getByRole("link", { name: "Relatar problema" })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Relatos" })).toBeVisible(); // o último login foi o dono
});
