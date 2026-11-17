import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Dia 12D: conta nova nasce com "trocar a senha no primeiro login": toda rota leva a /trocar-senha até
// a senha ser trocada; depois o sistema abre normalmente e a senha provisória deixa de valer.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const EMAIL = `troca.senha.${Date.now()}@example.com`;
const PROVISORIA = `Prov-${Math.random().toString(36).slice(2)}-1`;
const NOVA = `Nova-luz-${Date.now()}`;
let userId = "";

test.beforeAll(async () => {
  const r = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PROVISORIA,
    email_confirm: true,
    user_metadata: { trocar_senha: true },
  });
  if (r.error) throw r.error;
  userId = r.data.user!.id;
  await admin
    .from("usuarios")
    .insert({ id: userId, nome: "Troca Senha E2E", email: EMAIL, perfil: "vendedora" });
});
test.afterAll(async () => {
  await admin.from("usuarios").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
});

test("primeiro login obriga trocar a senha; depois tudo abre e a provisória não vale mais", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(PROVISORIA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/trocar-senha$/);
  await expect(page.getByRole("heading", { name: "Crie sua senha" })).toBeVisible();

  // Nenhuma outra rota abre enquanto a senha não for trocada.
  for (const rota of ["/", "/orcamentos", "/orcamentos/novo", "/produtos", "/meus-numeros"]) {
    const r = await page.request.get(rota, { maxRedirects: 0 });
    expect(r.status(), rota).toBe(307);
    expect(r.headers().location, rota).toContain("/trocar-senha");
  }
  await page.goto("/orcamentos");
  await expect(page).toHaveURL(/\/trocar-senha$/);

  // O formulário limpa os campos depois de cada envio: preenche e envia de novo a cada tentativa.
  async function enviarSenha(nova: string, confirmacao: string, mensagem: string | RegExp) {
    await expect(async () => {
      await page.locator(`input[name="nova"]`).fill(nova);
      await page.locator(`input[name="confirmacao"]`).fill(confirmacao);
      await page.getByRole("button", { name: "Salvar e entrar" }).click();
      await expect(page.getByRole("alert").filter({ hasText: mensagem })).toBeVisible({
        timeout: 6_000,
      });
    }).toPass({ timeout: 40_000 });
  }
  await enviarSenha("curta1", "curta1", /pelo menos 10 caracteres/i);
  await enviarSenha(NOVA, `${NOVA}x`, "As duas senhas precisam ser iguais.");

  // Troca de verdade.
  await page.locator(`input[name="nova"]`).fill(NOVA);
  await page.locator(`input[name="confirmacao"]`).fill(NOVA);
  await page.getByRole("button", { name: "Salvar e entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
  await page.goto("/orcamentos");
  await expect(page).toHaveURL(/\/orcamentos$/);
  await page.goto("/trocar-senha");
  await expect(page).toHaveURL(/\/$/); // já trocou: a página não é mais acessível

  // A marca foi tirada e a senha provisória não vale mais.
  const { data } = await admin.auth.admin.getUserById(userId);
  expect(data.user?.user_metadata?.trocar_senha).toBe(false);
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  expect(
    (await anon.auth.signInWithPassword({ email: EMAIL, password: PROVISORIA })).error,
  ).not.toBeNull();
  expect((await anon.auth.signInWithPassword({ email: EMAIL, password: NOVA })).error).toBeNull();
});
