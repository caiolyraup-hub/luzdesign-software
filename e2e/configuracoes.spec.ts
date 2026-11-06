import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

// O teste altera o telefone da loja; garante que ele volta a ficar vazio, passe ou falhe.
test.afterAll(async () => {
  await admin.from("configuracoes_loja").update({ telefone: null }).eq("id", true);
});

test("a gerente edita os dados da loja; a vendedora não entra na tela", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_GERENCIA!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();

  await page.goto("/gerencia/configuracoes");
  await expect(page.getByRole("heading", { name: "Configurações da loja" })).toBeVisible();
  await expect(page.getByLabel("Nome da loja")).toHaveValue("Luz Design");
  await expect(page.getByLabel("CNPJ")).toHaveValue("04.487.554/0001-16");
  await expect(page.getByLabel("Condições no fim do orçamento")).toContainText("Mercadoria frágil");

  await page.getByLabel("Telefone").fill("(82) 3000-0000");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Dados salvos.")).toBeVisible();

  // Valor inválido: mensagem em português e nada é gravado.
  await page.getByLabel("Validade (dias)").fill("0");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("A validade é de 1 a 90 dias.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Telefone")).toHaveValue("(82) 3000-0000");
  await expect(page.getByLabel("Validade (dias)")).toHaveValue("7");

  // Vendedora: /gerencia/* redireciona para o início.
  const contexto = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "pt-BR",
  });
  const outra = await contexto.newPage();
  await outra.goto(`${page.url().split("/gerencia")[0]}/login`);
  await outra.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await outra.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await outra.getByRole("button", { name: "Entrar" }).click();
  await expect(outra.getByRole("heading", { name: "Para hoje" })).toBeVisible();
  await outra.goto("/gerencia/configuracoes");
  await expect(outra).toHaveURL(/\/$/);
  await contexto.close();
});
