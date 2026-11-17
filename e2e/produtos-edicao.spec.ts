import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 12B: gerência e dono editam a descrição comercial; a vendedora não vê o botão; marca e
// referência na descrição são recusadas; a edição fica carimbada (a importação não a sobrescreve).
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const CODIGO = "99993";

async function limpar() {
  await admin.from("produtos").delete().eq("codigo", CODIGO);
}
test.beforeAll(async () => {
  await limpar();
  await admin.from("produtos").insert({
    codigo: CODIGO,
    categoria: "PERFIL",
    descricao: "PERFIL 200 BR",
    preco_unitario: 100,
  });
});
test.afterAll(limpar);

async function entrar(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a vendedora não vê o botão de editar descrição", async ({ page }) => {
  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  await page.goto(`/produtos?q=${CODIGO}`);
  await expect(page.getByText(`Cód. ${CODIGO}`)).toBeVisible();
  await expect(page.getByRole("button", { name: /Editar descrição/ })).toHaveCount(0);
  await expect(page.getByText(/Catálogo provisório/)).toHaveCount(0); // procedência: só a gerência
});

for (const [rotulo, email] of [
  ["a gerência", process.env.SEED_EMAIL_GERENCIA!],
  ["o dono", process.env.SEED_EMAIL_DONO!],
] as const) {
  test(`${rotulo} edita a descrição comercial e a edição fica carimbada`, async ({ page }) => {
    await admin
      .from("produtos")
      .update({ descricao: "PERFIL 200 BR", descricao_editada_em: null })
      .eq("codigo", CODIGO);
    await entrar(page, email);
    await page.goto(`/produtos?q=${CODIGO}`);
    await expect(page.getByRole("note")).toContainText(/Catálogo/);
    await page.getByRole("button", { name: `Editar descrição do produto ${CODIGO}` }).click();
    const campo = page.getByLabel(`Descrição comercial do produto ${CODIGO}`);

    // Marca e referência são recusadas.
    await campo.fill("PERFIL 200 BR ASTRA PF-1908");
    await page.getByRole("button", { name: "Salvar descrição" }).click();
    await expect(page.getByText(/Não coloque marca, modelo nem referência/)).toBeVisible();

    await campo.fill("PERFIL DE ALUMÍNIO 2 M BRANCO, SOBREPOR");
    await page.getByRole("button", { name: "Salvar descrição" }).click();
    await expect(page.getByText("PERFIL DE ALUMÍNIO 2 M BRANCO, SOBREPOR")).toBeVisible();
    const { data } = await admin
      .from("produtos")
      .select("descricao, descricao_editada_em")
      .eq("codigo", CODIGO)
      .single();
    expect(data!.descricao).toBe("PERFIL DE ALUMÍNIO 2 M BRANCO, SOBREPOR");
    expect(data!.descricao_editada_em).not.toBeNull();
  });
}
