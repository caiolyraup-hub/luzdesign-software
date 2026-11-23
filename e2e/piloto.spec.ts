import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 14: a gerência marca e desmarca orçamento do piloto na tela e filtra a lista por "Piloto";
// a vendedora não vê o botão nem consegue mudar a marca; o piloto some do filtro quando desmarcado.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const PREFIXO = "TESTE PILOTO E2E";
const NOME = `${PREFIXO} ${Date.now()}`;

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
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
}

test("a gerência marca e desmarca piloto na tela e filtra a lista; a vendedora não vê o botão", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: NOME })
    .select("id")
    .single();
  // Orçamento de rascunho, fora do piloto (o gatilho só marca depois do início do piloto).
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: cli.data!.id,
      respostas: { versao: 2, cliente_nome: NOME },
      piloto: false,
    })
    .select("id, numero")
    .single();
  const id = orc.data!.id as string;
  await admin.from("orcamentos").update({ piloto: false }).eq("id", id);

  // Vendedora: sem botão e sem o filtro (a lista dela é /orcamentos).
  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  await page.goto(`/orcamentos/${id}`);
  await expect(page.getByRole("heading", { name: `Orçamento ${orc.data!.numero}` })).toBeVisible();
  await expect(page.getByRole("button", { name: /piloto/i })).toHaveCount(0);
  await expect(page.getByText(/Só orçamentos do piloto/)).toHaveCount(0);

  // Gerência: marca.
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.goto(`/orcamentos/${id}`);
  await expect(page.getByText("Este orçamento não está marcado como do piloto.")).toBeVisible();
  await page.getByRole("button", { name: "Marcar como piloto" }).click();
  await expect(page.getByText(/Este orçamento é do piloto/)).toBeVisible();
  const { data: marcado } = await admin.from("orcamentos").select("piloto").eq("id", id).single();
  expect(marcado!.piloto).toBe(true);

  // Filtro "Piloto" da lista (pela URL e pela gaveta).
  const q = encodeURIComponent(PREFIXO);
  await page.goto(`/gerencia?filtro=todos&q=${q}&piloto=1`);
  await expect(page.getByText(NOME)).toBeVisible();
  await expect(page.getByText("Só do piloto")).toBeVisible(); // chip do filtro ativo

  // Desmarca: some do filtro, continua na lista sem filtro.
  await page.goto(`/orcamentos/${id}`);
  await page.getByRole("button", { name: "Desmarcar piloto" }).click();
  await expect(page.getByText("Este orçamento não está marcado como do piloto.")).toBeVisible();
  await page.goto(`/gerencia?filtro=todos&q=${q}&piloto=1`);
  await expect(page.getByText(NOME)).toHaveCount(0);
  await page.goto(`/gerencia?filtro=todos&q=${q}`);
  await expect(page.getByText(NOME)).toBeVisible();
});
