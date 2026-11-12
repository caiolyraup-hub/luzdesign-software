import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 10A: busca, filtros em gaveta, chips, ordenação e "Ver mais" na lista de orçamentos (390 px).
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "TESTE BUSCA E2E";

async function limpar() {
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", `${PREFIXO}%`);
  const ids = (clientes ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("orcamentos").delete().in("cliente_id", ids);
    await admin.from("clientes").delete().in("id", ids);
  }
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
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
}

test("busca, filtros, chips, ordem e Ver mais; a Kely não vê nada da Aline", async ({ page }) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();

  // 22 orçamentos da Aline (R$ 100, 200 ... 2.200); o de nº 5 tem o produto 12222.
  const ids: string[] = [];
  for (let i = 1; i <= 22; i++) {
    const cli = await admin
      .from("clientes")
      .insert({
        vendedora_id: aline!.id,
        nome: `${PREFIXO} ${String(i).padStart(2, "0")}`,
        whatsapp: `+55829888${String(70000 + i)}`,
      })
      .select("id")
      .single();
    const o = await admin
      .from("orcamentos")
      .insert({ vendedora_id: aline!.id, cliente_id: cli.data!.id, valor_total: i * 100 })
      .select("id")
      .single();
    ids.push(o.data!.id as string);
  }
  await admin.from("orcamento_itens").insert({
    orcamento_id: ids[4],
    codigo: "12222",
    descricao_congelada: "MTS FITA 22W/M NT NIT",
    preco_unitario_congelado: 20,
    quantidade: 5,
    ambiente: "Sala",
    avulso: false,
    ordem: 0,
  });

  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  const total = page.getByRole("status").filter({ hasText: /orçamentos?$/ });
  const cartoes = page.getByRole("listitem").filter({ hasText: new RegExp(PREFIXO + " \\d\\d") });

  // ---- Paginação de 20 em 20 com "Ver mais" (cursor), e a contagem total do filtro no topo.
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(PREFIXO)}`);
  await expect(total).toContainText("22 orçamentos");
  await expect(cartoes).toHaveCount(20);
  await page.screenshot({ path: "test-results/telas/dia10-1-lista.png" });
  await page.getByRole("button", { name: "Ver mais" }).click();
  await expect(cartoes).toHaveCount(22);
  await expect(page.getByRole("button", { name: "Ver mais" })).toHaveCount(0);

  // ---- Busca por código de produto, e depois por WhatsApp parcial (só dígitos, com máscara).
  const busca = page.getByRole("searchbox", { name: "Buscar orçamentos" });
  await busca.fill("12222");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL(/q=12222/);
  await expect(cartoes).toHaveCount(1);
  await expect(cartoes.first()).toContainText(`${PREFIXO} 05`);

  await page.goto("/orcamentos?filtro=todos");
  await page.getByRole("searchbox", { name: "Buscar orçamentos" }).fill("(82) 9888-70003");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(cartoes).toHaveCount(1);
  await expect(cartoes.first()).toContainText(`${PREFIXO} 03`);

  // ---- Gaveta de filtros: valor mínimo -> chip -> remover.
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(PREFIXO)}`);
  await page.getByRole("button", { name: "Filtrar" }).click();
  const gaveta = page.getByRole("dialog", { name: "Filtrar orçamentos" });
  await gaveta.getByLabel("Valor mínimo").fill("2000");
  await page.screenshot({ path: "test-results/telas/dia10-2-gaveta.png" });
  await gaveta.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/min=2000/);
  await expect(total).toContainText("3 orçamentos");
  const chip = page.getByRole("link", { name: /Remover filtro: Valor a partir de/ });
  await expect(chip).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia10-3-chips.png" });
  await chip.click();
  await expect(total).toContainText("22 orçamentos");
  await expect(page).not.toHaveURL(/min=/);

  // ---- Ordenação por maior valor (na URL), e voltar do celular.
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(PREFIXO)}&ordem=valor`);
  await expect(cartoes.first()).toContainText(`${PREFIXO} 22`);
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(PREFIXO)}&ordem=cliente`);
  await expect(cartoes.first()).toContainText(`${PREFIXO} 01`);
  await page.goBack();
  await expect(cartoes.first()).toContainText(`${PREFIXO} 22`);

  // ---- Valores inválidos na URL são ignorados (a lista não quebra).
  await page.goto(
    `/orcamentos?filtro=todos&q=${encodeURIComponent(PREFIXO)}&min=abc&ordem=xyz&tipo=zzz`,
  );
  await expect(total).toContainText("22 orçamentos");

  // ---- A Kely, com o mesmo texto de busca, não vê nenhum orçamento da Aline.
  await page.context().clearCookies();
  await entrar(page, process.env.SEED_EMAIL_KELY!);
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(PREFIXO)}`);
  await expect(total).toContainText("0 orçamentos");
  await expect(cartoes).toHaveCount(0);
});

test("a gerência usa a mesma lista, filtra por vendedora e vê o nome dela nos cartões", async ({
  page,
}) => {
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.goto(`/gerencia?filtro=todos&q=${encodeURIComponent("TESTE Cliente")}`);
  await expect(page.getByRole("heading", { name: "Orçamentos da equipe" })).toBeVisible();
  await page.getByRole("button", { name: "Filtrar" }).click();
  const gaveta = page.getByRole("dialog", { name: "Filtrar orçamentos" });
  await gaveta.getByLabel("Vendedora").selectOption({ label: "Kely" });
  await gaveta.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/vendedora=/);
  await expect(page.getByRole("link", { name: /Remover filtro: Kely/ })).toBeVisible();
  const cartoes = page.getByRole("listitem").filter({ hasText: "Kely" });
  await expect(cartoes.first()).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "· Aline ·" })).toHaveCount(0);
});
