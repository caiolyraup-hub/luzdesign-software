import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 10D: lista de clientes, ficha, notas, novo orçamento para o cliente, histórico no formulário e
// fusão de duplicados (gerência), no celular de 390 px.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "CLIENTE E2E";
const ANA = `${PREFIXO} Ana Lima`;

async function limpar() {
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", `${PREFIXO}%`);
  const ids = (clientes ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("orcamentos").delete().in("cliente_id", ids);
    await admin.from("clientes").delete().in("id", ids);
  }
  await admin.from("clientes_fusoes").delete().like("removido->>nome", `${PREFIXO}%`);
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

test("clientes: lista, ficha, notas, novo orçamento pulando para a pergunta 4 e histórico no formulário", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const ana = await admin
    .from("clientes")
    .insert({
      vendedora_id: aline!.id,
      nome: ANA,
      whatsapp: "+5582977720001",
      tipo: "arquiteto",
      arquiteto_indicador: "Ana Lima Arquitetura",
    })
    .select("id")
    .single();
  const o1 = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: ana.data!.id,
      valor_total: 1000,
      respostas: { versao: 1 },
    })
    .select("id")
    .single();
  const o2 = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: ana.data!.id,
      valor_total: 500,
      respostas: { versao: 1 },
    })
    .select("id")
    .single();
  await admin.from("orcamentos").update({ status: "gerado" }).eq("id", o1.data!.id);
  await admin.from("orcamentos").update({ status: "enviado" }).eq("id", o1.data!.id);
  await admin
    .from("orcamentos")
    .update({ status: "fechado", valor_fechado: 900 })
    .eq("id", o1.data!.id);
  await admin.from("orcamentos").update({ status: "gerado" }).eq("id", o2.data!.id);
  await admin.from("orcamentos").update({ status: "enviado" }).eq("id", o2.data!.id);

  await entrar(page, process.env.SEED_EMAIL_ALINE!);

  // ---- Lista de clientes: busca por nome e por WhatsApp (só dígitos), com o histórico de cada um.
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Clientes" }).first().click();
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Buscar clientes" }).fill("ana lima");
  await page.getByRole("button", { name: "Buscar" }).click();
  const cartao = page.getByRole("link").filter({ hasText: ANA });
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText("2 orçamentos, 1 fechado, último em");
  await expect(cartao).toContainText("R$ 900,00");
  await page.getByRole("searchbox", { name: "Buscar clientes" }).fill("(82) 97772-0001");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByRole("link").filter({ hasText: ANA })).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia10-8-clientes.png" });

  // ---- Ficha do cliente.
  await page.getByRole("link").filter({ hasText: ANA }).click();
  await expect(page.getByRole("heading", { name: ANA })).toBeVisible();
  await expect(page.getByText("Arquiteto(a): Ana Lima Arquitetura")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/5582977720001",
  );
  const resumo = page.getByRole("region", { name: "Resumo" });
  await expect(resumo.getByText("Vendido").locator("xpath=..")).toContainText("R$ 900,00");
  await expect(resumo.getByText("Ticket médio").locator("xpath=..")).toContainText("R$ 900,00");
  await expect(
    page.getByRole("region", { name: "Orçamentos do cliente" }).getByRole("listitem"),
  ).toHaveCount(2);
  await page.screenshot({ path: "test-results/telas/dia10-9-ficha.png", fullPage: true });

  // ---- Notas do cliente.
  await page
    .getByRole("textbox", { name: "Notas do cliente" })
    .fill("prefere fita 3000 K, obra termina em dezembro");
  await page.getByRole("button", { name: "Salvar notas" }).click();
  await expect(page.getByText("Notas salvas.")).toBeVisible();
  const { data: c } = await admin
    .from("clientes")
    .select("observacoes")
    .eq("id", ana.data!.id)
    .single();
  expect(c!.observacoes).toBe("prefere fita 3000 K, obra termina em dezembro");

  // ---- O nome do cliente na tela do orçamento leva à ficha.
  await page.goto(`/orcamentos/${o2.data!.id}`);
  await page.getByRole("link", { name: ANA }).click();
  await expect(page).toHaveURL(new RegExp(`/clientes/${ana.data!.id}$`));

  // ---- Novo orçamento para este cliente: o formulário abre na pergunta 4 (1 a 3 já respondidas).
  await page.getByRole("button", { name: "Novo orçamento para este cliente" }).click();
  await expect(page).toHaveURL(/\/orcamentos\/[0-9a-f-]+\/editar\?passo=4/);
  await expect(page.getByRole("heading", { name: "Qual é o endereço da obra?" })).toBeVisible();
  const { data: novo } = await admin
    .from("orcamentos")
    .select("cliente_id, respostas, status")
    .eq("cliente_id", ana.data!.id)
    .eq("status", "rascunho")
    .single();
  expect(novo!.respostas).toMatchObject({
    cliente_nome: ANA,
    cliente_whatsapp: "+5582977720001",
    tipo_cliente: "arquiteto",
    arquiteto_indicador: "Ana Lima Arquitetura",
  });
  await page.screenshot({ path: "test-results/telas/dia10-10-novo-pergunta-4.png" });

  // ---- No formulário, a pergunta do WhatsApp mostra o histórico do cliente já cadastrado.
  const outro = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: `${PREFIXO} Provisório` })
    .select("id")
    .single();
  const rasc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: outro.data!.id,
      respostas: { versao: 1, cliente_nome: `${PREFIXO} Provisório` },
    })
    .select("id")
    .single();
  await page.goto(`/orcamentos/${rasc.data!.id}/editar?passo=2`);
  await page.getByLabel("WhatsApp do cliente").fill("(82) 97772-0001");
  await expect(page.getByText("Já existe um cliente com este WhatsApp.")).toBeVisible();
  await expect(page.getByText(/3 orçamentos, 1 fechado, último em \d{2}\/\d{2}/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver ficha" })).toHaveAttribute(
    "href",
    `/clientes/${ana.data!.id}`,
  );
  await page.screenshot({ path: "test-results/telas/dia10-11-historico-formulario.png" });

  // ---- A Kely não abre a ficha da Aline por URL direta.
  await page.context().clearCookies();
  await entrar(page, process.env.SEED_EMAIL_KELY!);
  await page.goto(`/clientes/${ana.data!.id}`);
  // A RLS não devolve a linha: página de não encontrado, sem nenhum dado do cliente.
  await expect(page.getByText(/could not be found|não encontrad/i).first()).toBeVisible();
  await expect(page.getByText(ANA)).toHaveCount(0);
  await expect(page.getByText("5582977720001")).toHaveCount(0);
  await page.goto("/clientes");
  await expect(page.getByText(ANA)).toHaveCount(0);
});

test("a gerência vê os possíveis duplicados e junta os dois clientes", async ({ page }) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const a = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: `${PREFIXO} Duda Rocha`, whatsapp: "+5582977720002" })
    .select("id")
    .single();
  const b = await admin
    .from("clientes")
    .insert({
      vendedora_id: aline!.id,
      nome: `${PREFIXO} Duda Rocha Silva`,
      whatsapp: "+55 82 97772-0002",
      observacoes: "quer pronta-entrega",
    })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: b.data!.id,
      valor_total: 300,
      respostas: { versao: 1 },
    })
    .select("id")
    .single();

  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.goto("/clientes");
  const dup = page.getByRole("region", { name: "Possíveis duplicados" });
  await expect(dup).toBeVisible();
  const par = dup.getByRole("listitem").filter({ hasText: "Duda Rocha Silva" });
  await expect(par.getByText("Mesmo WhatsApp")).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia10-12-duplicados.png" });
  await par.getByRole("radio", { name: /Manter CLIENTE E2E Duda Rocha(?! Silva)/ }).check();
  await par.getByRole("button", { name: "Juntar" }).click();
  await expect(par.getByText(/passam para/)).toBeVisible(); // confirmação antes de apagar
  await par.getByRole("button", { name: "Confirmar e juntar" }).click();
  await expect(page.getByText("Clientes juntados: 1 orçamento movido.")).toBeVisible();

  const { data: movido } = await admin
    .from("orcamentos")
    .select("cliente_id")
    .eq("id", orc.data!.id)
    .single();
  expect(movido!.cliente_id).toBe(a.data!.id);
  const { data: apagado } = await admin.from("clientes").select("id").eq("id", b.data!.id);
  expect(apagado).toEqual([]);
  const { data: mantido } = await admin
    .from("clientes")
    .select("observacoes")
    .eq("id", a.data!.id)
    .single();
  expect(mantido!.observacoes).toBe("quer pronta-entrega");
  const { data: reg } = await admin
    .from("clientes_fusoes")
    .select("orcamentos_movidos")
    .eq("mantido_id", a.data!.id);
  expect(reg).toHaveLength(1);
});
