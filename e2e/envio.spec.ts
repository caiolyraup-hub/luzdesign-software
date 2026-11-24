import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 16 (parte B), 390 px: a data de envio nunca fica sem registro. Roda só no projeto de testes.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const PREFIXO = "TESTE ENVIO E2E";
const SUF = Date.now();

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

/** Orçamento "gerado" da Aline, gerado há `dias` dias, sem envio registrado. */
async function gerado(nome: string, dias: number) {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: cli.data!.id,
      respostas: { versao: 2, cliente_nome: nome },
      valor_total: 1000,
    })
    .select("id, numero")
    .single();
  await admin.from("orcamentos").update({ status: "gerado" }).eq("id", orc.data!.id);
  await admin
    .from("orcamentos")
    .update({ gerado_em: new Date(Date.now() - dias * 86_400_000).toISOString() })
    .eq("id", orc.data!.id);
  return { id: orc.data!.id as string, numero: orc.data!.numero as string };
}

test("o cartão gerado mostra 'Envio não registrado' e o botão registra o envio na hora", async ({
  page,
}) => {
  const nome = `${PREFIXO} cartao ${SUF}`;
  const o = await gerado(nome, 0);
  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(nome)}`);
  const cartao = page.getByRole("listitem").filter({ hasText: nome });
  await expect(cartao.getByText("Envio não registrado")).toBeVisible();
  await cartao.getByRole("button", { name: "Registrar envio" }).click();

  const folha = page.getByRole("dialog", { name: "Você já mandou para o cliente?" });
  await expect(folha).toBeVisible();
  await expect(folha.getByRole("button", { name: "Enviei agora" })).toBeVisible();
  await expect(folha.getByRole("button", { name: "Enviei em outra data" })).toBeVisible();
  await folha.getByRole("button", { name: "Ainda não" }).click();
  await expect(folha).toHaveCount(0);
  const { data: antes } = await admin
    .from("orcamentos")
    .select("enviado_em")
    .eq("id", o.id)
    .single();
  expect(antes!.enviado_em).toBeNull(); // "Ainda não" não grava nada

  await cartao.getByRole("button", { name: "Registrar envio" }).click();
  await page.getByRole("button", { name: "Enviei agora" }).click();
  await expect(cartao.getByText(/Enviado em \d{2}\/\d{2} às \d{2}:\d{2}/)).toBeVisible(); // hoje: com a hora
  await expect(cartao.getByText("Envio não registrado")).toHaveCount(0);
  const { data: depois } = await admin
    .from("orcamentos")
    .select("status, enviado_em, ultimo_envio_em")
    .eq("id", o.id)
    .single();
  expect(depois!.status).toBe("enviado");
  expect(depois!.enviado_em).not.toBeNull();
  expect(depois!.ultimo_envio_em).toEqual(depois!.enviado_em);
});

test("fechar um orçamento gerado pede a data do envio", async ({ page }) => {
  const nome = `${PREFIXO} fechar ${SUF}`;
  const o = await gerado(nome, 2);
  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(nome)}`);
  const cartao = page.getByRole("listitem").filter({ hasText: nome });
  await cartao.getByRole("button", { name: "Fechou" }).click();
  await expect(cartao.getByText("Quando você enviou para o cliente?")).toBeVisible();
  await cartao.getByRole("button", { name: "Confirmar venda" }).click();
  await expect(page.getByText("Status atualizado.").first()).toBeVisible();
  const { data } = await admin
    .from("orcamentos")
    .select("status, enviado_em")
    .eq("id", o.id)
    .single();
  expect(data!.status).toBe("fechado");
  expect(data!.enviado_em).not.toBeNull(); // a data pedida foi gravada junto

  // No banco também: a função recusa fechar sem a data.
  const sem = await gerado(`${PREFIXO} sem data ${SUF}`, 1);
  const api = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  await api.auth.signInWithPassword({
    email: process.env.SEED_EMAIL_ALINE!,
    password: process.env.SEED_SENHA_INICIAL!,
  });
  const r = await api.rpc("mudar_status_orcamento", {
    p_orcamento: sem.id,
    p_para: "fechado",
    p_valor_fechado: 1000,
  });
  expect(r.error?.message).toContain("ENVIO_OBRIGATORIO");
});

test("Para hoje lista os gerados há mais de 1 dia em 'Registrar envio'", async ({ page }) => {
  const velho = `${PREFIXO} velho ${SUF}`;
  const novo = `${PREFIXO} novo ${SUF}`;
  await gerado(velho, 3);
  await gerado(novo, 0);
  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  const secao = page.getByRole("region", { name: "Registrar envio" });
  await expect(secao).toBeVisible();
  await expect(secao.getByText(velho)).toBeVisible();
  await expect(secao.getByText(novo)).toHaveCount(0); // ainda não passou de 1 dia
  await secao
    .getByRole("listitem")
    .filter({ hasText: velho })
    .getByRole("button", { name: "Registrar envio" })
    .click();
  await page.getByRole("button", { name: "Enviei agora" }).click();
  await expect(secao.getByText(velho)).toHaveCount(0);
});
