import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 11D: o dono define os percentuais, a Aline fecha um orçamento com arquiteto, o dono vê as duas
// comissões e paga a do arquiteto. Aline e a gerente não veem o item Comissões e a URL dá 404.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CLIENTE = `COM E2E Cliente ${Date.now()}`;
const ARQUITETO = `COM E2E Arquiteto ${Date.now()}`;

async function limpar() {
  await admin.from("orcamentos").delete().eq("respostas->>com_e2e", "true");
  await admin.from("clientes").delete().like("nome", "COM E2E%");
  await admin.from("arquitetos").delete().like("nome", "COM E2E%");
  await admin
    .from("configuracoes_comissao")
    .update({
      percentual_arquiteto_padrao: null,
      percentual_vendedora_padrao: null,
      percentual_vendedora_com_arquiteto: null,
    })
    .eq("id", true);
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}
test.beforeAll(limpar);
test.afterAll(limpar);

async function entrar(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("dono define percentuais, vê as comissões do fechamento da Aline e paga a do arquiteto", async ({
  page,
}) => {
  // ---- Dono: sem percentuais, a tela avisa e não calcula nada.
  await entrar(page, process.env.SEED_EMAIL_DONO!);
  await expect(page.getByRole("link", { name: "Comissões" })).toBeVisible();
  await page.getByRole("link", { name: "Comissões" }).click();
  await expect(page.getByRole("heading", { name: "Comissões" })).toBeVisible();
  await expect(page.getByText("Defina os percentuais em Ajustes de comissão.")).toBeVisible();

  // ---- Ajustes: 5% arquiteto, 3% vendedora.
  await page.getByRole("link", { name: "Ajustes de comissão" }).first().click();
  await page.getByLabel("Arquiteto (RT): percentual padrão (%)").fill("5");
  await page.getByLabel("Vendedora: percentual padrão (%)").fill("3");
  await page.getByRole("button", { name: "Salvar percentuais" }).click();
  await expect(page.getByText("Percentuais salvos.")).toBeVisible();
  // Valor fora do limite é recusado.
  await page.getByLabel("Vendedora: percentual padrão (%)").fill("31");
  await page.getByRole("button", { name: "Salvar percentuais" }).click();
  await expect(page.getByText(/de 0 a 30/)).toBeVisible();
  await page.getByLabel("Vendedora: percentual padrão (%)").fill("3");
  await page.getByRole("button", { name: "Salvar percentuais" }).click();
  await expect(page.getByText("Percentuais salvos.")).toBeVisible();

  // ---- Aline fecha um orçamento com arquiteto (pela função de status, com o login dela).
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const arq = await admin.from("arquitetos").insert({ nome: ARQUITETO }).select("id").single();
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: CLIENTE, arquiteto_id: arq.data!.id })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: cli.data!.id,
      arquiteto_id: arq.data!.id,
      respostas: { com_e2e: "true" },
      valor_total: 2000,
    })
    .select("id, numero")
    .single();
  await admin.from("orcamentos").update({ status: "gerado" }).eq("id", orc.data!.id);
  const alineApi = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await alineApi.auth.signInWithPassword({
    email: process.env.SEED_EMAIL_ALINE!,
    password: process.env.SEED_SENHA_INICIAL!,
  });
  const f = await alineApi.rpc("mudar_status_orcamento", {
    p_orcamento: orc.data!.id,
    p_para: "fechado",
    p_valor_fechado: 2000,
  });
  expect(f.error).toBeNull();

  // ---- Dono: as duas linhas aparecem (arquiteto 5% = R$ 100; vendedora 3% = R$ 60).
  await page.goto("/comissoes");
  await expect(page.getByText("Defina os percentuais")).toHaveCount(0);
  const cartoes = page.getByRole("definition");
  await expect(cartoes.filter({ hasText: /R\$\s*100,00/ }).first()).toBeVisible(); // arquitetos
  await expect(cartoes.filter({ hasText: /R\$\s*60,00/ }).first()).toBeVisible(); // vendedoras
  await page.screenshot({ path: "test-results/telas/dia11-comissoes.png", fullPage: true });

  const cartaoArq = page.getByRole("listitem").filter({ hasText: ARQUITETO });
  await cartaoArq.locator("summary").click();
  await expect(cartaoArq.getByText(new RegExp(`${orc.data!.numero}`))).toBeVisible();
  await cartaoArq.getByLabel(`Selecionar ${orc.data!.numero}`).check();
  await cartaoArq.getByRole("button", { name: /Marcar como paga/ }).click();
  await expect(cartaoArq.getByText(/1 comissão\(ões\) marcada/)).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("comissoes")
            .select("status")
            .eq("orcamento_id", orc.data!.id)
            .eq("tipo", "arquiteto")
            .single()
        ).data?.status,
    )
    .toBe("paga");

  // Exportar planilha: só o dono baixa.
  const resposta = await page.request.get("/comissoes/exportar");
  expect(resposta.status()).toBe(200);
  expect(resposta.headers()["content-type"]).toContain("spreadsheetml");
});

for (const [rotulo, email] of [
  ["Aline", process.env.SEED_EMAIL_ALINE!],
  ["a gerência", process.env.SEED_EMAIL_GERENCIA!],
] as const) {
  test(`${rotulo} não vê o item Comissões e a URL direta dá 404`, async ({ page }) => {
    await entrar(page, email);
    await expect(page.getByRole("link", { name: "Comissões" })).toHaveCount(0);
    for (const caminho of ["/comissoes", "/comissoes/ajustes", "/comissoes/exportar"]) {
      const r = await page.request.get(caminho);
      expect(r.status(), caminho).toBe(404);
    }
    const resp = await page.goto("/comissoes");
    expect(resp?.status()).toBe(404);
  });
}
