import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 10B: validade vencida (aviso), Para renovar, renovar com preço atualizado e nova versão no PDF.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "TESTE VALIDADE E2E";
const NOME = `${PREFIXO} ${Date.now()}`;
let precoOriginal: number | null = null;

async function limpar() {
  // Devolve o preço do catálogo se o teste o mudou.
  if (precoOriginal !== null)
    await admin.from("produtos").update({ preco_unitario: precoOriginal }).eq("codigo", "9520");
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", `${PREFIXO}%`);
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
  await admin
    .from("produtos_descricao_formatada")
    .delete()
    .like("descricao_formatada", "Padronizada: %");
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

const diaMaceio = (dias: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(
    Date.now() + dias * 86_400_000,
  );
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

async function textoDoPdf(caminho: string) {
  const { data } = await admin.storage.from("pdfs").createSignedUrl(caminho, 120);
  const bytes = new Uint8Array(await (await fetch(data!.signedUrl)).arrayBuffer());
  const { extractText } = await import("unpdf");
  const { text } = await extractText(bytes, { mergePages: true });
  return text.replace(/\s+/g, " ");
}

test("gera, vence ontem, avisa, renova atualizando um preço e o PDF novo traz a validade e o preço", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const { data: prod } = await admin
    .from("produtos")
    .select("preco_unitario")
    .eq("codigo", "9520")
    .single();
  precoOriginal = Number(prod!.preco_unitario);
  const precoNovo = precoOriginal + 5;
  const { data: cfg } = await admin.from("configuracoes_loja").select("validade_dias").single();

  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: NOME, whatsapp: "+5582900009954" })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: cli.data!.id,
      respostas: {
        versao: 1,
        cliente_nome: NOME,
        cliente_whatsapp: "+5582900009954",
        tipo_cliente: "final",
        tipo_obra: { uso: "residencial", estado: "reforma" },
        ambientes: ["sala"],
        linha: "tecnica",
        prazo: "encomenda",
      },
    })
    .select("id, numero")
    .single();
  const id = orc.data!.id as string;
  await admin.from("orcamento_itens").insert({
    orcamento_id: id,
    codigo: "9520",
    descricao_congelada: "STELLA DIC 6W 2.7K",
    preco_unitario_congelado: precoOriginal,
    quantidade: 2,
    ambiente: "Sala",
    avulso: false,
    ordem: 0,
  });

  await entrar(page, process.env.SEED_EMAIL_ALINE!);

  // ---- Gera o orçamento (versão 1).
  await page.goto(`/orcamentos/${id}/revisao`);
  await page.getByRole("button", { name: "Gerar orçamento" }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}$`), { timeout: 90_000 });
  await expect(page.getByText("Gerado", { exact: true })).toBeVisible();
  await expect(page.getByText(/Vencido há/)).toHaveCount(0);

  // ---- Força a validade para ontem: vira "Vencido há 1 dia", com a mensagem e o botão Renovar.
  const ontem = diaMaceio(-1);
  await admin.from("orcamentos").update({ validade: ontem }).eq("id", id);
  await page.reload();
  await expect(page.getByText("Vencido há 1 dia").first()).toBeVisible();
  await expect(
    page.getByText(
      `Os preços e a validade expiraram em ${ddmm(ontem)}. Renove para mandar de novo.`,
    ),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia10-4-vencido.png", fullPage: true });

  // Na lista e em "Para hoje" também aparece (e o badge da navegação soma).
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent(NOME)}`);
  const cartao = page.getByRole("listitem").filter({ hasText: NOME });
  await expect(cartao.getByText("Vencido há 1 dia")).toBeVisible();
  await page.goto("/");
  const secao = page.getByRole("region", { name: "Para renovar" });
  const item = secao.getByRole("listitem").filter({ hasText: NOME });
  await expect(item.getByText("Vencido há 1 dia")).toBeVisible();
  await expect(item.getByRole("link", { name: "Abrir WhatsApp" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/5582900009954\?text=/,
  );
  await expect(page.getByLabel(/vencidos/)).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia10-5-para-renovar.png" });

  // ---- O preço do catálogo sobe R$ 5: a renovação mostra a diferença e atualiza.
  await admin.from("produtos").update({ preco_unitario: precoNovo }).eq("codigo", "9520");
  await item.getByRole("link", { name: "Renovar", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}\\?renovar=1`));
  const painel = page.getByRole("region", { name: "Renovar validade" });
  await expect(painel.getByText("1 item mudou de preço.")).toBeVisible();
  await expect(painel.getByText("STELLA DIC 6W 2.7K")).toBeVisible();
  await expect(painel.getByText("+R$ 5,00", { exact: false })).toBeVisible();
  await expect(painel.getByText(/Estes preços podem estar defasados/)).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia10-6-renovar.png", fullPage: true });
  await painel.getByRole("button", { name: "Atualizar preços e renovar" }).click();
  await expect(page.getByText(/Validade renovada: nova versão 2/)).toBeVisible({ timeout: 90_000 });

  // ---- Banco: versão 2, validade de hoje + validade_dias, preço novo, evento na linha do tempo.
  const { data: o } = await admin
    .from("orcamentos")
    .select("status, pdf_versao, validade, valor_total, pdf_caminho, pdf_versoes")
    .eq("id", id)
    .single();
  expect(o!.status).toBe("gerado");
  expect(o!.pdf_versao).toBe(2);
  expect(o!.validade).toBe(diaMaceio(cfg!.validade_dias));
  expect(Number(o!.valor_total)).toBe(2 * precoNovo);
  expect((o!.pdf_versoes as { renovada?: boolean }[]).length).toBe(2); // a versão 1 continua guardada
  expect((o!.pdf_versoes as { renovada?: boolean }[])[1].renovada).toBe(true);
  const { data: item2 } = await admin
    .from("orcamento_itens")
    .select("preco_unitario_congelado")
    .eq("orcamento_id", id)
    .single();
  expect(Number(item2!.preco_unitario_congelado)).toBe(precoNovo);

  await page.reload();
  await expect(page.getByText(/Vencido há/)).toHaveCount(0);
  await expect(page.getByText(/Validade renovada \(versão 2/)).toBeVisible(); // linha do tempo
  await expect(page.getByRole("heading", { name: "Orçamento (versão 2)" })).toBeVisible();
  await expect(
    page.getByText(`Válido até ${diaMaceio(cfg!.validade_dias).split("-").reverse().join("/")}`),
  ).toBeVisible();

  // ---- O PDF novo traz o preço novo e a validade nova; a planilha e a versão 1 continuam disponíveis.
  const texto = await textoDoPdf(o!.pdf_caminho as string);
  expect(texto).toContain(orc.data!.numero);
  expect(texto).toContain(String(precoNovo.toFixed(2)).replace(".", ","));
  expect(texto).toContain(diaMaceio(cfg!.validade_dias).split("-").reverse().join("/"));
  await expect(page.getByRole("link", { name: "Baixar planilha (XLSX)" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Versão 1 \(PDF\)/ })).toBeVisible();

  // ---- Marcar como enviado de novo: só o último envio muda e o "Para renovar" some.
  await page.getByRole("button", { name: "Marquei como enviado" }).click();
  await page.getByRole("button", { name: "Confirmar envio" }).click();
  await expect(page.getByText("Enviado", { exact: true }).first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Para renovar" }).getByText(NOME)).toHaveCount(0);
});

test("a gerência vê o contador de vencidos sem renovação", async ({ page }) => {
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.goto("/gerencia");
  const secao = page.getByRole("region", { name: "Vencidos sem renovação" });
  await expect(secao).toBeVisible();
  await expect(secao.getByText("Aline")).toBeVisible();
  await expect(secao.getByText("Kely")).toBeVisible();
});
