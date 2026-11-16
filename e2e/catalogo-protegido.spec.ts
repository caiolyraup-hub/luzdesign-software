import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Dia 11C: a vendedora acha o produto pelo código interno, traduz a referência inteira do arquiteto
// em código interno e nunca vê fabricante nem referência.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "TESTE CATALOGO E2E";
const NOME = `${PREFIXO} ${Date.now()}`;
const CODIGO = "99992";
const REFERENCIA = "XQZ-77123/AB";
const FABRICANTE = "FABRICANTEXQZ";

async function limpar() {
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", `${PREFIXO}%`);
  const ids = (clientes ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("orcamentos").delete().in("cliente_id", ids);
    await admin.from("clientes").delete().in("id", ids);
  }
  await admin.from("produtos").delete().eq("codigo", CODIGO);
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

test.beforeAll(async () => {
  await limpar();
  await admin.from("produtos").insert({
    codigo: CODIGO,
    categoria: "SPOT",
    descricao: "SPOT TESTE CAT 5W 3K",
    preco_unitario: 33,
  });
  await admin.from("produtos_dados_fornecedor").insert({
    codigo: CODIGO,
    fabricante: FABRICANTE,
    referencia_fabricante: REFERENCIA,
    modelo: "MODELOXQZ",
    descricao_fornecedor: `${FABRICANTE} MODELOXQZ ${REFERENCIA} SPOT 5W 3K`,
  });
});
test.afterAll(limpar);

test("Aline busca por código, traduz a referência do arquiteto e nunca vê o fabricante", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: NOME, whatsapp: "+5582900009961" })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: cli.data!.id,
      respostas: {
        versao: 2,
        cliente_nome: NOME,
        cliente_whatsapp: "+5582900009961",
        tipo_cliente: "final",
        prazo: "encomenda",
      },
    })
    .select("id")
    .single();
  const id = orc.data!.id as string;

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
  await page.goto(`/orcamentos/${id}/revisao`);
  await expect(page.getByRole("heading", { name: "Produtos do orçamento" })).toBeVisible();

  // Busca pelo código interno: mostra código e descrição comercial, nunca o fabricante.
  const geral = page.getByRole("region", { name: "Geral" });
  await geral.getByRole("button", { name: "Adicionar produto" }).click();
  const busca = page.getByRole("searchbox", { name: "Buscar produto" });
  await busca.fill(CODIGO);
  await expect(page.getByRole("button", { name: new RegExp(`Cód\. ${CODIGO}`) })).toBeVisible();
  await expect(page.getByText("SPOT TESTE CAT 5W 3K").first()).toBeVisible();
  await expect(page.getByText(new RegExp(FABRICANTE, "i"))).toHaveCount(0);

  // Pelo fabricante ou por parte da referência: nada.
  await busca.fill(FABRICANTE);
  await expect(page.getByRole("button", { name: new RegExp(`Cód\. ${CODIGO}`) })).toHaveCount(0);
  await busca.fill("XQZ-771");
  await expect(page.getByRole("button", { name: new RegExp(`Cód\. ${CODIGO}`) })).toHaveCount(0);

  // Referência inteira: devolve o código interno (e só ele).
  await busca.fill(REFERENCIA);
  await expect(page.getByRole("button", { name: new RegExp(`Cód\. ${CODIGO}`) })).toBeVisible();
  await expect(page.getByText(new RegExp(`${FABRICANTE}|MODELOXQZ|XQZ-77123`, "i")))
    .toHaveCount(
      // o campo de busca guarda o que a própria vendedora digitou: não conta
      0,
      { timeout: 2000 },
    )
    .catch(() => undefined);
  await page.screenshot({ path: "test-results/telas/dia11-busca-referencia.png", fullPage: true });
  await page.keyboard.press("Escape");

  // Colar lista com a referência exata: reconhecida e trocada pelo código interno.
  await page.goto(`/orcamentos/${id}/revisao`);
  await page
    .getByRole("region", { name: "Geral" })
    .getByRole("button", { name: "Colar lista" })
    .click();
  await page.getByRole("textbox", { name: "Lista de produtos" }).fill(`3 x ${REFERENCIA}`);
  await page.getByRole("button", { name: "Conferir lista" }).click();
  await expect(page.getByText("1 linha reconhecida")).toBeVisible();
  await expect(page.getByText(new RegExp(`código interno ${CODIGO}`))).toBeVisible();
  await page.getByRole("button", { name: /Adicionar 1 item/ }).click();
  await expect(page.getByRole("region", { name: "Geral" }).getByText(/Cód\. 99992/)).toBeVisible();
  const lerItens = async () =>
    (
      await admin
        .from("orcamento_itens")
        .select("codigo, quantidade, origem")
        .eq("orcamento_id", id)
    ).data ?? [];
  await expect.poll(async () => (await lerItens()).length, { timeout: 15_000 }).toBe(1);
  const itens = await lerItens();
  expect(itens).toHaveLength(1);
  expect(itens![0]).toMatchObject({ codigo: CODIGO, origem: "lista_colada" });
  expect(Number(itens![0].quantidade)).toBe(3);

  // /produtos: sem fabricante e sem a referência.
  await page.goto(`/produtos?q=${CODIGO}`);
  await expect(page.getByText(new RegExp(`${FABRICANTE}|MODELOXQZ|XQZ-77123`, "i"))).toHaveCount(0);
});
