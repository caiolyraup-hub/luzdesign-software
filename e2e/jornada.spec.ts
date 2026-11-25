import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

// Dia 12C: a jornada completa de cada perfil, no iPhone (WebKit) e no Android (Chromium). Os testes
// rodam em série: o fechamento da vendedora gera a comissão que o dono depois vê e paga.
test.describe.configure({ mode: "serial" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SUFIXO = `${Date.now()}`.slice(-9);
const NOME = `JORNADA E2E Cliente ${SUFIXO}`;
const ZAP_DIGITADO = `(82) 9${SUFIXO.slice(-4)}-${SUFIXO.slice(-8, -4)}`;
const ARQ_NOME = `JORNADA E2E Arquiteta ${SUFIXO}`;
const ARQ_DUP = `JORNADA E2E Arquiteta Duplicada ${SUFIXO}`;
const CODIGO_REF = "99995";
const REFERENCIA = "JRN-55123/AB";

async function limpar() {
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", "JORNADA E2E%");
  const ids = (clientes ?? []).map((c) => c.id);
  if (ids.length) {
    const { data: orcs } = await admin
      .from("orcamentos")
      .select("id, vendedora_id")
      .in("cliente_id", ids);
    for (const o of orcs ?? []) {
      const { data: arquivos } = await admin.storage.from("pdfs").list(`${o.vendedora_id}/${o.id}`);
      const caminhos = (arquivos ?? []).map((a) => `${o.vendedora_id}/${o.id}/${a.name}`);
      if (caminhos.length) await admin.storage.from("pdfs").remove(caminhos);
      await admin.from("uso_ia").delete().eq("orcamento_id", o.id);
    }
    await admin.from("orcamentos").delete().in("cliente_id", ids);
    await admin.from("clientes").delete().in("id", ids);
  }
  await admin.from("arquitetos").delete().like("nome", "JORNADA E2E%");
  await admin.from("produtos").delete().eq("codigo", CODIGO_REF);
  await admin
    .from("produtos_descricao_formatada")
    .delete()
    .like("descricao_formatada", "Padronizada: %");
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

test.beforeAll(async () => {
  await limpar();
  await admin.from("arquitetos").insert([{ nome: ARQ_NOME }, { nome: ARQ_DUP }]);
  await admin.from("produtos").insert({
    codigo: CODIGO_REF,
    categoria: "SPOT",
    descricao: "SPOT JORNADA 5W 3K",
    preco_unitario: 40,
  });
  await admin
    .from("produtos_dados_fornecedor")
    .insert({ codigo: CODIGO_REF, fabricante: "FABJORNADA", referencia_fabricante: REFERENCIA });
  await admin
    .from("configuracoes_comissao")
    .update({ percentual_arquiteto_padrao: 5, percentual_vendedora_padrao: 3 })
    .eq("id", true);
});
test.afterAll(limpar);

async function entrar(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
}
const proxima = (page: Page) => page.getByRole("button", { name: "Próxima" });

/** Toca em Próxima até a pergunta seguinte aparecer (no iPhone o primeiro toque pode vir antes da hidratação). */
async function avancar(page: Page, proximaPergunta: RegExp, preencher?: () => Promise<void>) {
  await expect(async () => {
    // Preenche de novo a cada tentativa: no iPhone o campo pode ser zerado pela hidratação do React.
    if (preencher) await preencher();
    await proxima(page).click({ timeout: 5_000 });
    await expect(page.getByRole("heading", { level: 1, name: proximaPergunta })).toBeVisible({
      timeout: 4_000,
    });
  }).toPass({ timeout: 40_000 });
}

async function lerDownload(page: Page, nomeLink: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: nomeLink }).click(),
  ]);
  const partes: Buffer[] = [];
  for await (const p of await download.createReadStream()) partes.push(Buffer.from(p));
  return Buffer.concat(partes);
}

let orcamentoId = "";
let numero = "";

test("vendedora: do formulário ao fechamento, passando por produtos, IA, PDF, envio e follow-up", async ({
  page,
}) => {
  await entrar(page, process.env.SEED_EMAIL_ALINE!);

  // ---- Formulário (8 perguntas): cliente novo e arquiteto do cadastro.
  await page.goto("/orcamentos/novo");
  await avancar(page, /WhatsApp do cliente/i, () =>
    page.getByRole("textbox", { name: /nome do cliente/i }).fill(NOME),
  );
  await avancar(page, /tipo de cliente/i, () =>
    page.getByRole("textbox", { name: /whatsapp/i }).fill(ZAP_DIGITADO),
  );
  await page.getByRole("radio", { name: "Arquiteto(a)" }).click();
  await page.getByRole("button", { name: "Escolher arquiteto(a)" }).click();
  await page.getByRole("searchbox", { name: /Buscar arquiteto/ }).fill(ARQ_NOME);
  await page.getByRole("button", { name: new RegExp(ARQ_NOME) }).click();
  await expect(page.getByTestId("arquiteto-escolhido")).toHaveText(ARQ_NOME);
  await avancar(page, /endereço da obra/i);
  await avancar(page, /o que o cliente pediu/i); // endereço opcional, em branco
  await page
    .getByRole("textbox", { name: /o que o cliente pediu/i })
    .fill("Spots na sala e fita na cozinha.");
  await avancar(page, /quanto o cliente quer investir/i);
  await avancar(page, /prazo/i); // faixa de investimento (opcional)
  await page.getByRole("radio", { name: /Aceita encomenda/ }).click();
  await avancar(page, /Observações e condições especiais/i);
  await proxima(page).click(); // observações (opcional)
  await page.getByRole("button", { name: "Ver resumo" }).click();
  await expect(page.getByRole("heading", { name: "Resumo do orçamento" })).toBeVisible();
  await page.getByRole("link", { name: "Selecionar produtos" }).click();
  await expect(page.getByRole("heading", { name: "Produtos do orçamento" })).toBeVisible();
  orcamentoId = page.url().match(/orcamentos\/([0-9a-f-]{36})/)![1];

  // ---- Produto por código (Enter adiciona direto).
  const geral = page.getByRole("region", { name: "Geral" });
  await geral.getByRole("button", { name: "Adicionar produto" }).click();
  const busca = page.getByRole("searchbox", { name: "Buscar produto" });
  await busca.fill("9520");
  await busca.press("Enter");
  await expect(page.getByText(/Adicionado: /)).toBeVisible();
  // Fecha a busca recarregando a tela (o item já está salvo). No iPhone o app ainda pode estar navegando.
  await expect(async () => {
    await page.goto(`/orcamentos/${orcamentoId}/revisao`, { waitUntil: "domcontentloaded" });
  }).toPass({ timeout: 30_000 });

  // ---- Colar lista com a REFERÊNCIA exata: vira o código interno.
  await geral.getByRole("button", { name: "Colar lista" }).click();
  await page.getByRole("textbox", { name: "Lista de produtos" }).fill(`2 x ${REFERENCIA}`);
  await page.getByRole("button", { name: "Conferir lista" }).click();
  await expect(page.getByText(new RegExp(`código interno ${CODIGO_REF}`))).toBeVisible();
  await page.getByRole("button", { name: /Adicionar 1 item/ }).click();
  await expect(geral.getByText(new RegExp(`Cód\\. ${CODIGO_REF}`))).toBeVisible();

  // ---- Kit de fita (5 m): fita 12222, perfil 12086 e a fonte calculada.
  await geral.getByRole("button", { name: "Adicionar kit de fita" }).click();
  const kit = page.getByRole("group", { name: "Kit de fita em Geral" });
  await kit.getByRole("textbox", { name: "Metros de fita" }).fill("5");
  await kit.getByRole("button", { name: "Escolher a fita" }).click();
  let b = page.getByRole("searchbox", { name: "Buscar produto" });
  await b.fill("12222");
  await b.press("Enter");
  await kit.getByRole("button", { name: "Escolher o perfil" }).click();
  b = page.getByRole("searchbox", { name: "Buscar produto" });
  await b.fill("12086");
  await b.press("Enter");
  await kit.getByRole("button", { name: "Calcular o kit" }).click();
  await kit.getByRole("button", { name: "Adicionar kit ao ambiente" }).click();
  await expect(kit).toHaveCount(0);

  // ---- Indicação da IA (simulada) num ambiente novo; nada entra sozinho.
  const indicacao = page.getByRole("region", { name: "Indicação da IA" });
  await indicacao.locator("select").selectOption({ label: "Novo ambiente..." });
  await indicacao.getByPlaceholder("Nome do ambiente (ex.: Varanda)").fill("Varanda");
  await indicacao.locator("textarea").first().fill("Fita de luz quente na varanda.");
  await indicacao.getByRole("button", { name: "Pedir indicação" }).click();
  await expect(page.getByRole("heading", { name: "Sugestões para Varanda" })).toBeVisible();
  await page.getByRole("button", { name: /Adicionar todas/ }).click();
  await expect(page.getByRole("region", { name: "Varanda" })).toBeVisible();

  // ---- Gerar: PDF e XLSX com o nome do arquiteto, sem fabricante nem referência.
  await page.getByRole("button", { name: "Gerar orçamento" }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${orcamentoId}$`), { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Orçamento (versão 1)" })).toBeVisible();
  numero = (await admin.from("orcamentos").select("numero").eq("id", orcamentoId).single()).data!
    .numero as string;
  const pdf = await lerDownload(page, "Baixar PDF");
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  const t = text.replace(/\s+/g, "").toUpperCase();
  expect(t).toContain(ARQ_NOME.replace(/\s+/g, "").toUpperCase());
  expect(t).not.toContain("FABJORNADA");
  expect(t).not.toContain("JRN-55123");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    (await lerDownload(page, "Baixar planilha do estoque (XLSX)")) as unknown as ExcelJS.Buffer,
  );
  expect(wb.getWorksheet("ORÇAMENTO")).toBeTruthy();

  // ---- Enviado e follow-up D+5.
  await page.getByRole("button", { name: "Marquei como enviado" }).click();
  await page.getByRole("button", { name: "Confirmar envio" }).click();
  await expect(page.getByText("Enviado", { exact: true }).first()).toBeVisible();
  const antigo = new Date(Date.now() - 6 * 86_400_000).toISOString();
  await admin
    .from("orcamentos")
    .update({ ultimo_envio_em: antigo, enviado_em: antigo })
    .eq("id", orcamentoId);
  await page.goto("/");
  const secao = page.getByRole("region", { name: "Follow-ups de hoje" });
  const cartao = secao.getByRole("listitem").filter({ hasText: NOME });
  await expect(cartao.getByText("Follow-up D+5")).toBeVisible();
  await cartao.getByRole("button", { name: "Fiz o follow-up" }).click();
  await expect(secao.getByRole("listitem").filter({ hasText: NOME })).toHaveCount(0);

  // ---- Fechou com valor; aparece em Números.
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(NOME)}`);
  const c = page.getByRole("listitem").filter({ hasText: NOME });
  await c.getByRole("button", { name: "Fechou (vendeu)" }).click();
  await c.getByRole("textbox").fill("1000,00");
  await c.getByRole("button", { name: "Confirmar venda" }).click();
  await expect(c.getByText("Fechado", { exact: true })).toBeVisible();
  await page.goto("/meus-numeros");
  await expect(page.getByRole("heading", { name: "Meus números" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Vendido R\$/ })).toBeVisible(); // o total soma o fechamento de agora
  // A vendedora não vê comissão em lugar nenhum.
  await expect(page.getByText(/comiss/i)).toHaveCount(0);
});

test("gerente: equipe, filtro, exportação, fabricante no cadastro, juntar arquitetos; não vê Comissões", async ({
  page,
}) => {
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await expect(page.getByRole("link", { name: "Comissões" })).toHaveCount(0);

  await page.goto(`/gerencia?filtro=todos&q=${encodeURIComponent(NOME)}`);
  await expect(page.getByRole("heading", { name: "Orçamentos da equipe" })).toBeVisible();
  const cartao = page.getByRole("listitem").filter({ hasText: NOME });
  await expect(cartao.getByText("Aline")).toBeVisible();

  // Exportação da base: com fabricante e referência na aba Itens (só a gerência).
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Exportar planilha" }).click(),
  ]);
  const partes: Buffer[] = [];
  for await (const p of await download.createReadStream()) partes.push(Buffer.from(p));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(partes) as unknown as ExcelJS.Buffer);
  expect(wb.worksheets.map((w) => w.name)).toContain("Eventos");
  const cab = (wb.getWorksheet("Itens")!.getRow(1).values as string[]).join("|");
  expect(cab).toContain("Fabricante");
  expect(cab).toContain("Referência do fabricante");

  // Produtos: fabricante visível para a gerência.
  await page.goto(`/produtos?q=${CODIGO_REF}`);
  await expect(page.getByText(/FABJORNADA/)).toBeVisible();

  // Juntar dois arquitetos.
  const { data: arq } = await admin.from("arquitetos").select("id").eq("nome", ARQ_NOME).single();
  await page.goto(`/arquitetos/${arq!.id}`);
  await page.getByRole("button", { name: "Juntar duplicados" }).click();
  await page.getByRole("combobox").selectOption({ label: ARQ_DUP });
  await page.getByRole("button", { name: "Juntar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar e juntar" }).click();
  await expect(page.getByText("Cadastros juntados.")).toBeVisible();
  const { data: restou } = await admin.from("arquitetos").select("id").eq("nome", ARQ_DUP);
  expect(restou).toHaveLength(0);

  // 404 em Comissões.
  const r = await page.request.get("/comissoes");
  expect(r.status()).toBe(404);
});

test("dono: tudo da gerência e Comissões (linhas do fechamento, pagar, exportar)", async ({
  page,
}) => {
  await entrar(page, process.env.SEED_EMAIL_DONO!);
  await page.goto(`/gerencia?filtro=todos&q=${encodeURIComponent(NOME)}`);
  await expect(page.getByRole("heading", { name: "Orçamentos da equipe" })).toBeVisible();

  await page.getByRole("link", { name: "Comissões" }).click();
  await expect(page.getByRole("heading", { name: "Comissões" })).toBeVisible();
  const cartaoArq = page.getByRole("listitem").filter({ hasText: ARQ_NOME });
  await cartaoArq.locator("summary").click();
  await expect(cartaoArq.getByText(new RegExp(numero))).toBeVisible();
  await expect(cartaoArq.getByText(/R\$\s*50,00/).first()).toBeVisible(); // 5% de R$ 1.000
  await cartaoArq.getByLabel(`Selecionar ${numero}`).check();
  await cartaoArq.getByRole("button", { name: /Marcar como paga/ }).click();
  await expect(cartaoArq.getByText(/marcada/)).toBeVisible();
  const r = await page.request.get("/comissoes/exportar");
  expect(r.status()).toBe(200);
});
