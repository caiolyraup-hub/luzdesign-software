import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PREFIXO = "TESTE E2E";
const NOME = `${PREFIXO} completo ${Date.now()}`;
const NOME_PARCIAL = `${PREFIXO} parcial ${Date.now()}`;
const ZAP_COMPLETO = "(82) 90000-9998";
const ZAP_PARCIAL = "(82) 90000-9997";

/** Remove tudo que os testes criaram (clientes, orçamentos, anexos e arquivos) e acerta o contador. */
async function limpar() {
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", `${PREFIXO}%`);
  const ids = (clientes ?? []).map((c) => c.id);
  if (ids.length) {
    const { data: orcs } = await admin
      .from("orcamentos")
      .select("id, vendedora_id")
      .in("cliente_id", ids);
    for (const o of orcs ?? []) {
      const { data: arquivos } = await admin.storage
        .from("anexos")
        .list(`${o.vendedora_id}/${o.id}`);
      const caminhos = (arquivos ?? []).map((a) => `${o.vendedora_id}/${o.id}/${a.name}`);
      if (caminhos.length) await admin.storage.from("anexos").remove(caminhos);
    }
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

async function entrar(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
}

const proxima = (page: Page) => page.getByRole("button", { name: "Próxima" });

const print = (page: Page, nome: string, fullPage = false) =>
  page.screenshot({ path: `test-results/telas/${nome}.png`, fullPage });

async function pergunta(page: Page, titulo: string | RegExp, progresso: string) {
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  await expect(page.getByText(progresso, { exact: true })).toBeVisible();
}

/** Responde as perguntas 1 e 2 e deixa o orçamento esperando na 3. */
async function comecar(page: Page, nome: string, whatsapp: string) {
  await page.goto("/orcamentos/novo");
  await pergunta(page, "Qual é o nome do cliente?", "1 de 10");
  await page.getByRole("textbox", { name: /nome do cliente/i }).fill(nome);
  await proxima(page).click();

  // Primeira resposta válida cria o rascunho e leva para /editar?passo=2.
  await expect(page).toHaveURL(/\/orcamentos\/[0-9a-f-]{36}\/editar\?passo=2$/);
  await pergunta(page, "Qual é o WhatsApp do cliente?", "2 de 10");
  await page.getByRole("textbox", { name: /whatsapp/i }).fill(whatsapp);
  await proxima(page).click();
  await pergunta(page, "Que tipo de cliente é?", "3 de 10");
}

test("Aline responde as 10 perguntas, anexa uma imagem, vê o resumo e o rascunho na lista", async ({
  page,
}) => {
  await entrar(page);
  await comecar(page, NOME, ZAP_COMPLETO);
  await print(page, "1-tipo-cliente");

  // Validação: não avança sem escolher o tipo de cliente.
  await proxima(page).click();
  await expect(page.getByText("Escolha o tipo de cliente.")).toBeVisible();
  await page.getByRole("radio", { name: "Cliente final" }).click();
  await proxima(page).click();

  await pergunta(page, "Que tipo de obra é?", "4 de 10");
  await page.getByRole("radio", { name: "Residencial" }).click();
  await page.getByRole("radio", { name: "Reforma" }).click();
  await proxima(page).click();

  await pergunta(page, "Quais ambientes?", "5 de 10");
  await page.getByRole("button", { name: "Sala", exact: true }).click();
  await page.getByRole("button", { name: "Cozinha", exact: true }).click();
  await print(page, "2-ambientes");
  await proxima(page).click();

  await pergunta(page, "O que o cliente pediu?", "6 de 10");
  await expect(page.getByText("Pode colar a mensagem do WhatsApp do cliente")).toBeVisible();
  const pedido = page.getByRole("textbox", { name: /o que o cliente pediu/i });
  await pedido.fill("Spots embutidos na sala e fita LED na cozinha.");
  // Autosave com debounce de 1 s: aparece "Salvo" sem apertar Próxima.
  await expect(page.getByRole("status").filter({ hasText: "Salvo" })).toBeVisible({
    timeout: 10_000,
  });
  await print(page, "3-pedido-salvo");
  await proxima(page).click();

  await pergunta(page, "Qual linha de produtos?", "7 de 10");
  await page.getByRole("radio", { name: "Técnica" }).click();
  await proxima(page).click();

  await pergunta(page, /Quanto o cliente quer investir/, "8 de 10"); // opcional: segue vazio
  await proxima(page).click();

  await pergunta(page, "Qual é o prazo?", "9 de 10");
  await page.getByRole("radio", { name: /Aceita encomenda/ }).click();
  await proxima(page).click();

  await pergunta(page, /Observações e condições especiais/, "10 de 10");
  await page.getByRole("textbox", { name: /observações/i }).fill("10% à vista combinado.");
  await proxima(page).click();

  // Passo próprio de anexos.
  await expect(
    page.getByRole("heading", { level: 1, name: "Quer anexar fotos ou arquivos?" }),
  ).toBeVisible();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = "#fff";
    ctx.font = "48px sans-serif";
    ctx.fillText("TESTE", 200, 220);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByTestId("arquivo-anexo").setInputFiles({
    name: "ambiente-teste.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByText("O que é este arquivo?")).toBeVisible();
  await page.getByRole("button", { name: "Foto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fotos e arquivos (1 de 4)" })).toBeVisible();
  await expect(page.getByText("ambiente-teste.png")).toBeVisible();
  await expect(page.getByRole("img", { name: "ambiente-teste.png" })).toBeVisible();
  await print(page, "4-anexos");

  await page.getByRole("button", { name: "Ver resumo" }).click();

  // Resumo.
  await expect(page.getByRole("heading", { name: "Resumo do orçamento" })).toBeVisible();
  await print(page, "5-resumo", true);
  await expect(page.getByText(NOME)).toBeVisible();
  await expect(page.getByText(ZAP_COMPLETO)).toBeVisible();
  await expect(page.getByText("Residencial · Reforma")).toBeVisible();
  await expect(page.getByText("Sala, Cozinha")).toBeVisible();
  await expect(page.getByText("Aceita encomenda (30 a 45 dias úteis)")).toBeVisible();
  await expect(page.getByText("10% à vista combinado.")).toBeVisible();
  // Respostas completas: o botão da IA está habilitado (o teste NÃO clica: não chama a API real).
  await expect(page.getByRole("button", { name: "Montar orçamento com IA" })).toBeEnabled();
  // Sem itens montados, a tela de itens leva de volta ao resumo.
  const { data: orcResumo } = await admin
    .from("orcamentos")
    .select("id")
    .eq(
      "cliente_id",
      (await admin.from("clientes").select("id").eq("nome", NOME).single()).data!.id,
    )
    .single();
  await page.goto(`/orcamentos/${orcResumo!.id}/itens`);
  await expect(page).toHaveURL(/\/editar\?passo=12$/);
  await expect(page.getByRole("heading", { name: "Resumo do orçamento" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fotos e arquivos (1 de 4)" })).toBeVisible();

  // Sem rolagem horizontal no celular.
  const largura = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(largura.conteudo).toBeLessThanOrEqual(largura.janela);

  // O banco guardou tudo: respostas versionadas, cliente, e a imagem reduzida como JPEG no caminho certo.
  const { data: cliente } = await admin
    .from("clientes")
    .select("id, vendedora_id, whatsapp, tipo")
    .eq("nome", NOME)
    .single();
  expect(cliente).toMatchObject({ whatsapp: "+5582900009998", tipo: "final" });
  const { data: orc } = await admin
    .from("orcamentos")
    .select("id, status, vendedora_id, respostas")
    .eq("cliente_id", cliente!.id)
    .single();
  expect(orc!.status).toBe("rascunho");
  expect(orc!.vendedora_id).toBe(cliente!.vendedora_id);
  expect(orc!.respostas).toMatchObject({
    versao: 1,
    cliente_nome: NOME,
    cliente_whatsapp: "+5582900009998",
    tipo_obra: { uso: "residencial", estado: "reforma" },
    ambientes: ["sala", "cozinha"],
    linha: "tecnica",
    prazo: "encomenda",
    observacoes: "10% à vista combinado.",
  });
  const { data: anexos } = await admin
    .from("anexos")
    .select("caminho_storage, tipo, mime_type")
    .eq("orcamento_id", orc!.id);
  expect(anexos).toHaveLength(1);
  expect(anexos![0]).toMatchObject({ tipo: "foto", mime_type: "image/jpeg" });
  expect(anexos![0].caminho_storage).toMatch(
    new RegExp(`^${orc!.vendedora_id}/${orc!.id}/[0-9a-f-]{36}\\.jpg$`),
  );
  const existe = await admin.storage.from("anexos").exists(anexos![0].caminho_storage);
  expect(existe.data).toBe(true);

  // O rascunho aparece em /orcamentos, em português e com "Continuar".
  await page.goto("/orcamentos");
  const cartao = page.getByRole("listitem").filter({ hasText: NOME });
  await expect(cartao).toBeVisible();
  await expect(cartao.getByText("Rascunho", { exact: true })).toBeVisible();
  await expect(cartao.getByRole("link", { name: "Continuar" })).toBeVisible();

  // E também em "Para hoje".
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Rascunhos para terminar" })).toBeVisible();
  await expect(page.getByText(NOME)).toBeVisible();

  // Tudo respondido: reabrir o rascunho cai direto no resumo.
  await page.goto("/orcamentos");
  await cartao.getByRole("link", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Resumo do orçamento" })).toBeVisible();

  // Remover o anexo apaga a linha e o arquivo.
  await page.getByRole("button", { name: /Remover ambiente-teste\.png/ }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("heading", { name: "Fotos e arquivos (0 de 4)" })).toBeVisible();
  const { count } = await admin
    .from("anexos")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", orc!.id);
  expect(count).toBe(0);
  const aposRemover = await admin.storage.from("anexos").exists(anexos![0].caminho_storage);
  expect(aposRemover.data).toBe(false);
});

test("rascunho incompleto volta para a primeira pergunta obrigatória vazia", async ({ page }) => {
  await entrar(page);
  await comecar(page, NOME_PARCIAL, ZAP_PARCIAL);

  // Sai sem terminar (nada é perdido) e reabre pela lista.
  await page.goto("/orcamentos");
  const cartao = page.getByRole("listitem").filter({ hasText: NOME_PARCIAL });
  await expect(cartao).toBeVisible();
  await cartao.getByRole("link", { name: "Continuar" }).click();
  await pergunta(page, "Que tipo de cliente é?", "3 de 10");

  // "Voltar" mostra o que já tinha sido respondido.
  await page.getByRole("button", { name: "Voltar" }).click();
  await pergunta(page, "Qual é o WhatsApp do cliente?", "2 de 10");
  await expect(page.getByRole("textbox", { name: /whatsapp/i })).toHaveValue("+5582900009997");
});

test("com respostas faltando, o botão de montar com IA fica desabilitado", async ({ page }) => {
  await entrar(page);
  // Rascunho próprio, só com as perguntas 1 e 2 respondidas.
  await comecar(page, `${NOME_PARCIAL} ia`, "(82) 90000-9996");

  // Abre o resumo direto pelo passo 12, com respostas obrigatórias faltando.
  await page.goto(`${page.url().split("?")[0]}?passo=12`);
  await expect(page.getByRole("heading", { name: "Resumo do orçamento" })).toBeVisible();
  await expect(page.getByText("Faltam respostas obrigatórias:")).toBeVisible();
  await expect(page.getByRole("button", { name: "Montar orçamento com IA" })).toBeDisabled();
});
