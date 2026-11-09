import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

const PREFIXO = "TESTE STATUS E2E";
const NOME_FECHAR = `${PREFIXO} fechar ${Date.now()}`;
const NOME_PERDER = `${PREFIXO} perder ${Date.now()}`;
const NOME_FOLLOWUP = `${PREFIXO} followup ${Date.now()}`;

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

async function criar(
  vendedoraId: string,
  nome: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: vendedoraId, nome })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: vendedoraId,
      cliente_id: cli.data!.id,
      status,
      valor_total: 500,
      respostas: { teste: true },
      ...extra,
    })
    .select("id, numero")
    .single();
  return orc.data!;
}

test("Aline acompanha: enviado, follow-ups e fechado com valor, e vê o follow-up vencido em Para hoje", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const fechar = await criar(aline!.id, NOME_FECHAR, "gerado");
  // Enviado há 6 dias: o D+5 está atrasado e aparece em "Para hoje".
  const seisDias = new Date(Date.now() - 6 * 86_400_000).toISOString();
  await criar(aline!.id, NOME_FOLLOWUP, "enviado", { enviado_em: seisDias, status_em: seisDias });

  await entrar(page, process.env.SEED_EMAIL_ALINE!);

  // Para hoje: follow-up para fazer.
  await expect(page.getByRole("heading", { name: /Follow-ups para fazer/ })).toBeVisible();
  const vencido = page.getByRole("listitem").filter({ hasText: NOME_FOLLOWUP });
  await expect(vencido.getByText("Follow-up D+5 atrasado")).toBeVisible();

  // Lista: poucos toques mudam o status.
  await page.goto("/orcamentos?filtro=todos");
  const cartao = page.getByRole("listitem").filter({ hasText: NOME_FECHAR });
  await expect(cartao.getByText("Gerado", { exact: true })).toBeVisible();
  await cartao.getByRole("button", { name: "Marcar como enviado" }).click();
  await expect(cartao.getByText("Enviado", { exact: true })).toBeVisible();
  await cartao.getByRole("button", { name: "Follow-up D+5 feito" }).click();
  await expect(cartao.getByText("Follow-up D+5", { exact: true })).toBeVisible();

  // Fechou: o valor vem com o total; confirma com um toque.
  await cartao.getByRole("button", { name: "Fechou (vendeu)" }).click();
  await expect(cartao.getByRole("textbox")).toHaveValue("500");
  await cartao.getByRole("textbox").fill("450,50");
  await cartao.getByRole("button", { name: "Confirmar venda" }).click();
  await expect(cartao.getByText("Fechado", { exact: true })).toBeVisible();

  const { data: o } = await admin
    .from("orcamentos")
    .select("status, valor_fechado, fechado_em")
    .eq("id", fechar.id)
    .single();
  expect(o!.status).toBe("fechado");
  expect(Number(o!.valor_fechado)).toBe(450.5);
  expect(o!.fechado_em).toBeTruthy();

  // Filtro "Fechados" e a tela do orçamento mostram o resultado e a linha do tempo.
  await page.getByRole("link", { name: /Fechados/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: NOME_FECHAR })).toBeVisible();
  await page.goto(`/orcamentos/${fechar.id}`);
  await expect(page.getByText("Vendido por R$ 450,50")).toBeVisible();
  await expect(page.getByText("Status: Enviado → Follow-up D+5")).toBeVisible();
  await page.screenshot({ path: "test-results/telas/11-status-orcamento.png", fullPage: true });

  // Reabrir.
  await page.getByRole("button", { name: /Reabrir/ }).click();
  await expect(page.getByText("Enviado", { exact: true }).first()).toBeVisible();
});

test("a gerência muda o status de qualquer orçamento e registra o motivo da perda", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const perder = await criar(aline!.id, NOME_PERDER, "gerado");

  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.goto("/gerencia?filtro=todos");
  await expect(page.getByRole("heading", { name: "Orçamentos da equipe" })).toBeVisible();
  const cartao = page.getByRole("listitem").filter({ hasText: NOME_PERDER });
  await expect(cartao.getByText("Aline")).toBeVisible();

  await cartao.getByRole("button", { name: "Perdeu" }).click();
  await expect(cartao.getByRole("button", { name: "Confirmar perda" })).toBeDisabled(); // motivo é obrigatório
  await cartao.getByRole("radio", { name: "Comprou em outra loja" }).click();
  await cartao.getByRole("button", { name: "Confirmar perda" }).click();
  await expect(cartao.getByText("Perdido", { exact: true })).toBeVisible();
  await expect(cartao.getByText("Comprou em outra loja")).toBeVisible();
  await page.screenshot({ path: "test-results/telas/12-gerencia-equipe.png", fullPage: true });

  const { data: o } = await admin
    .from("orcamentos")
    .select("status, motivo_perda")
    .eq("id", perder.id)
    .single();
  expect(o).toEqual({ status: "perdido", motivo_perda: "comprou_em_outra_loja" });
  const { data: ev } = await admin
    .from("eventos")
    .select("para_status, usuarios(perfil)")
    .eq("orcamento_id", perder.id)
    .order("id");
  expect(ev!.at(-1)!.para_status).toBe("perdido");
});
