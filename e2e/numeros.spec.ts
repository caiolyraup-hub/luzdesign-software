import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 9A: painel da vendedora (Números) e painel da gerência (Equipe), no celular de 390 px.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const NOME = `NUMEROS E2E ${Date.now()}`;
const NOME_TESTE = `TESTE NUMEROS E2E X${Date.now()}`;

async function limpar() {
  await admin.from("orcamentos").delete().eq("respostas->>numeros_e2e", "true");
  await admin.from("clientes").delete().like("nome", "NUMEROS E2E%");
  await admin.from("clientes").delete().like("nome", "TESTE NUMEROS E2E%");
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

test.beforeAll(async () => {
  await limpar();
  await criarPerdido(NOME);
  await criarPerdido(NOME_TESTE); // cliente TESTE: não entra nos números nem na lista filtrada
});
test.afterAll(limpar);

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
}

/** Um orçamento da Aline que foi enviado e perdido por preço (R$ 1.500). */
async function criarPerdido(nomeCliente: string) {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: nomeCliente })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: cli.data!.id,
      respostas: { versao: 1, numeros_e2e: "true" },
      valor_total: 1500,
    })
    .select("id")
    .single();
  const id = orc.data!.id as string;
  await admin.from("orcamentos").update({ status: "gerado" }).eq("id", id);
  await admin.from("orcamentos").update({ status: "enviado" }).eq("id", id);
  await admin.from("orcamentos").update({ status: "perdido", motivo_perda: "preco" }).eq("id", id);
  return id;
}

test("Aline vê os cartões de Números e chega à lista de perdidos filtrada", async ({ page }) => {
  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  await page.goto("/meus-numeros");
  await expect(page.getByRole("heading", { name: "Meus números" })).toBeVisible();

  // Seletor de período (padrão: este mês).
  const periodo = page.getByRole("navigation", { name: "Período" });
  await expect(periodo.getByRole("link", { name: "Este mês" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(periodo.getByRole("link", { name: "Mês passado" })).toBeVisible();
  await expect(periodo.getByRole("link", { name: "90 dias" })).toBeVisible();
  await expect(periodo.getByRole("button", { name: "Personalizado" })).toBeVisible();

  // Os quatro cartões grandes.
  const resumo = page.getByRole("region", { name: "Resumo do período" });
  await expect(resumo.getByRole("link", { name: /^Vendido/ })).toBeVisible();
  await expect(resumo.getByRole("link", { name: /^Conversão/ })).toBeVisible();
  await expect(resumo.getByRole("link", { name: /^Em aberto/ })).toBeVisible();
  const perdeu = resumo.getByRole("link", { name: /^Deixou de vender/ });
  await expect(perdeu).toContainText("R$");
  await expect(page.getByRole("region", { name: "Funil" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Por que perdi" })).toContainText("Preço");
  await expect(page.getByText(/Indicação da IA: \d+ pedidos?/)).toBeVisible();

  // Sem rolagem horizontal da página no celular.
  const largura = await page.evaluate(() => ({
    pagina: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(largura.pagina).toBeLessThanOrEqual(largura.janela);
  await page.screenshot({ path: "test-results/telas/dia9-1-meus-numeros.png", fullPage: true });

  // Tocar em "Deixou de vender" abre a lista de perdidos do período.
  await perdeu.click();
  await expect(page).toHaveURL(/\/orcamentos\?.*filtro=perdidos.*data=perdido/);
  await expect(page.getByRole("heading", { name: "Meus orçamentos" })).toBeVisible();
  await expect(page.getByText("Orçamentos de teste ficam de fora.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: NOME }).first()).toBeVisible();
  await expect(page.getByText(NOME_TESTE)).toHaveCount(0);
  await page.screenshot({ path: "test-results/telas/dia9-2-lista-perdidos.png" });

  // Intervalo personalizado inválido (fim antes do início) cai no mês com aviso.
  await page.goto("/meus-numeros?periodo=personalizado&de=2026-11-10&ate=2026-11-01");
  await expect(page.getByText(/A data final é antes da inicial/)).toBeVisible();

  // Período sem nada: mensagem simples, sem gráfico vazio.
  await page.goto("/meus-numeros?periodo=personalizado&de=2020-01-01&ate=2020-01-31");
  await expect(page.getByText("Nenhum orçamento neste período.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Funil" })).toHaveCount(0);
});

test("a gerente vê a tabela comparativa por vendedora, o gráfico e o uso da IA", async ({
  page,
}) => {
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.goto("/gerencia");
  await expect(page.getByRole("heading", { name: "Orçamentos da equipe" })).toBeVisible();

  const comparativo = page.getByRole("region", { name: "Comparativo por vendedora" });
  await expect(comparativo.getByRole("table")).toBeVisible();
  await expect(comparativo.getByRole("columnheader", { name: "Conv. (qtd)" })).toBeVisible();
  await expect(comparativo.getByRole("rowheader", { name: /Aline/ })).toBeVisible();
  await expect(comparativo.getByRole("rowheader", { name: /Kely/ })).toBeVisible();
  await expect(comparativo.getByRole("rowheader", { name: "Total" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Gráfico semanal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Uso da IA" })).toContainText("Custo no período");
  await expect(page.getByRole("region", { name: "Uso da IA" })).toContainText("Indicações pedidas");

  const largura = await page.evaluate(() => ({
    pagina: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(largura.pagina).toBeLessThanOrEqual(largura.janela); // a tabela rola dentro dela, não a página
  await page.screenshot({ path: "test-results/telas/dia9-3-equipe.png", fullPage: true });

  // Tocar no valor "Deixou de vender" da Aline abre a lista da Aline com o filtro de perdidos.
  await comparativo.getByRole("row", { name: /Aline/ }).locator('a[href*="data=perdido"]').click();
  await expect(page).toHaveURL(/\/gerencia\?.*filtro=perdidos.*vendedora=/);
  await expect(page.getByText(/Orçamentos de teste ficam de fora/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: NOME }).first()).toBeVisible();
  await expect(page.getByText(NOME_TESTE)).toHaveCount(0);

  // Tocar no nome da Kely filtra a lista abaixo por ela.
  await page.goto("/gerencia");
  await page
    .getByRole("region", { name: "Comparativo por vendedora" })
    .getByRole("link", { name: "Kely" })
    .click();
  await expect(page).toHaveURL(/vendedora=/);
  await expect(page.getByRole("listitem").filter({ hasText: NOME })).toHaveCount(0);
});

test("a vendedora não vê custo de IA em Números", async ({ page }) => {
  await entrar(page, process.env.SEED_EMAIL_KELY!);
  await page.goto("/meus-numeros");
  await expect(page.getByRole("heading", { name: "Meus números" })).toBeVisible();
  await expect(page.getByText(/custo/i)).toHaveCount(0);
  await expect(page.getByText("US$")).toHaveCount(0);
});
