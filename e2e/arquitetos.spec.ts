import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "TESTE E2E ARQ";
const CLIENTE = `${PREFIXO} cliente ${Date.now()}`;
const ARQUITETO = `${PREFIXO} Lula ${Date.now()}`;

async function limpar() {
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", `${PREFIXO}%`);
  const ids = (clientes ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("orcamentos").delete().in("cliente_id", ids);
    await admin.from("clientes").delete().in("id", ids);
  }
  const { data: arqs } = await admin
    .from("arquitetos")
    .select("id, foto_path")
    .like("nome", `${PREFIXO}%`);
  const fotos = (arqs ?? []).map((a) => a.foto_path).filter((f): f is string => Boolean(f));
  if (fotos.length) await admin.storage.from("arquitetos").remove(fotos);
  if (arqs?.length)
    await admin
      .from("arquitetos")
      .delete()
      .in(
        "id",
        arqs.map((a) => a.id),
      );
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
  await expect(page).toHaveURL(/\/$/);
}

test("Aline cadastra um arquiteto com foto pelo formulário e o escolhe no orçamento", async ({
  page,
}) => {
  await entrar(page, process.env.SEED_EMAIL_ALINE!);

  await page.goto("/orcamentos/novo");
  await page.getByRole("textbox", { name: /nome do cliente/i }).fill(CLIENTE);
  await page.getByRole("button", { name: "Próxima" }).click();
  await expect(page).toHaveURL(/editar\?passo=2$/);
  await page.getByRole("textbox", { name: /whatsapp/i }).fill("(82) 90000-9941");
  await page.getByRole("button", { name: "Próxima" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Que tipo de cliente é?" }),
  ).toBeVisible();

  // Sem arquiteto escolhido não avança.
  await page.getByRole("radio", { name: "Arquiteto(a)" }).click();
  await page.getByRole("button", { name: "Próxima" }).click();
  await expect(page.getByText("Informe o nome do arquiteto(a).")).toBeVisible();

  // + Cadastrar arquiteto: cadastro curto, com foto e aniversário (29/02, sem ano).
  await page.getByRole("button", { name: "Escolher arquiteto(a)" }).click();
  await page.getByRole("button", { name: "+ Cadastrar arquiteto" }).click();
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill(ARQUITETO);
  await page.getByLabel("Dia do aniversário").fill("29");
  await page.getByLabel("Mês do aniversário").fill("2");
  await expect(page.getByText("Use a foto só com autorização do arquiteto.")).toBeVisible();
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 600;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#2c7a7b";
    ctx.fillRect(0, 0, 900, 600);
    ctx.fillStyle = "#fff";
    ctx.fillRect(300, 100, 300, 400);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByTestId("foto-arquiteto").setInputFiles({
    name: "foto.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByRole("img", { name: "Prévia da foto" })).toBeVisible();
  await page.screenshot({
    path: "test-results/telas/dia11-cadastro-arquiteto.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Salvar" }).click();

  // O arquiteto fica escolhido, sem perder o rascunho.
  await expect(page.getByTestId("arquiteto-escolhido")).toHaveText(ARQUITETO);
  await page.getByRole("button", { name: "Próxima" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Qual é o endereço da obra?" }),
  ).toBeVisible();

  // Banco: cadastro, aniversário, foto no bucket privado e ligações.
  const { data: arq } = await admin
    .from("arquitetos")
    .select("id, nome, aniversario_dia, aniversario_mes, aniversario_ano, foto_path, criado_por")
    .eq("nome", ARQUITETO)
    .single();
  expect(arq).toMatchObject({ aniversario_dia: 29, aniversario_mes: 2, aniversario_ano: null });
  expect(arq!.foto_path).toMatch(new RegExp(`^${arq!.id}/[0-9a-f-]{36}\\.jpg$`));
  expect((await admin.storage.from("arquitetos").exists(arq!.foto_path!)).data).toBe(true);
  const { data: cli } = await admin
    .from("clientes")
    .select("id, tipo, arquiteto_id, arquiteto_indicador")
    .eq("nome", CLIENTE)
    .single();
  expect(cli).toMatchObject({
    tipo: "arquiteto",
    arquiteto_id: arq!.id,
    arquiteto_indicador: ARQUITETO,
  });
  const { data: orc } = await admin
    .from("orcamentos")
    .select("arquiteto_id, respostas")
    .eq("cliente_id", cli!.id)
    .single();
  expect(orc!.arquiteto_id).toBe(arq!.id);
  expect(orc!.respostas).toMatchObject({ arquiteto_id: arq!.id, arquiteto_indicador: ARQUITETO });

  // Lista: foto por URL assinada (o bucket é privado) e a vendedora não edita.
  await page.goto(`/arquitetos?q=${encodeURIComponent(ARQUITETO)}`);
  const cartao = page.getByRole("listitem").filter({ hasText: ARQUITETO });
  await expect(cartao).toBeVisible();
  const img = cartao.getByRole("img", { name: `Foto de ${ARQUITETO}` });
  await expect(img).toBeVisible();
  expect(await img.getAttribute("src")).toContain("/storage/v1/object/sign/arquitetos/");
  await page.screenshot({ path: "test-results/telas/dia11-lista-arquitetos.png", fullPage: true });
  await cartao.getByRole("link").click();
  await expect(page.getByRole("heading", { name: ARQUITETO })).toBeVisible();
  await expect(page.getByText("29/02", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar dados" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Juntar duplicados" })).toHaveCount(0);

  const largura = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(largura.conteudo).toBeLessThanOrEqual(largura.janela);
});

test("a gerência edita, desativa e reativa o arquiteto", async ({ page }) => {
  const { data: arq } = await admin.from("arquitetos").select("id").eq("nome", ARQUITETO).single();
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.goto(`/arquitetos/${arq!.id}`);
  await expect(page.getByRole("button", { name: "Editar dados" })).toBeVisible();

  await page.getByRole("button", { name: "Editar dados" }).click();
  await page.getByRole("textbox", { name: "Escritório (opcional)" }).fill("Estúdio Teste");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Estúdio Teste")).toBeVisible();

  await page.getByRole("button", { name: "Desativar" }).click();
  await expect(page.getByText("Desativado", { exact: true })).toBeVisible();
  const { data: depois } = await admin
    .from("arquitetos")
    .select("ativo")
    .eq("id", arq!.id)
    .single();
  expect(depois!.ativo).toBe(false);

  await page.getByRole("button", { name: "Reativar" }).click();
  await expect(page.getByRole("button", { name: "Desativar" })).toBeVisible();
});

test("Para hoje mostra os aniversários de hoje e dos próximos dias, com a mensagem padrão", async ({
  page,
}) => {
  // Datas no fuso de Maceió (o mesmo que o sistema usa).
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Maceio",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [ano, mes, dia] = partes.split("-").map(Number);
  const em = (dias: number) => {
    const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
    return { dia: d.getUTCDate(), mes: d.getUTCMonth() + 1 };
  };
  const hoje = em(0);
  const doisDias = em(2);
  const longe = em(12);
  const nomes = {
    hoje: `${PREFIXO} Hoje ${Date.now()}`,
    dois: `${PREFIXO} Dois ${Date.now()}`,
    longe: `${PREFIXO} Longe ${Date.now()}`,
  };
  const ins = await admin.from("arquitetos").insert([
    {
      nome: nomes.hoje,
      whatsapp: "+5582900009942",
      aniversario_dia: hoje.dia,
      aniversario_mes: hoje.mes,
    },
    { nome: nomes.dois, aniversario_dia: doisDias.dia, aniversario_mes: doisDias.mes },
    { nome: nomes.longe, aniversario_dia: longe.dia, aniversario_mes: longe.mes },
  ]);
  expect(ins.error).toBeNull();

  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  const secao = page.getByRole("region", { name: "Aniversários" });
  await expect(secao).toBeVisible();
  const cartaoHoje = secao.getByRole("listitem").filter({ hasText: nomes.hoje });
  await expect(cartaoHoje.getByText("Aniversário hoje")).toBeVisible();
  const zap = await cartaoHoje.getByRole("link", { name: "Abrir WhatsApp" }).getAttribute("href");
  expect(zap).toContain("https://wa.me/5582900009942?text=");
  expect(decodeURIComponent(zap!)).toContain("Aline"); // {vendedora}
  expect(decodeURIComponent(zap!)).toContain("feliz aniversário");
  await expect(
    secao
      .getByRole("listitem")
      .filter({ hasText: nomes.dois })
      .getByText(/em 2 dias/),
  ).toBeVisible();
  await expect(secao.getByText(nomes.longe)).toHaveCount(0); // fora dos 7 dias
  await page.screenshot({ path: "test-results/telas/dia11-aniversarios.png", fullPage: true });
});
