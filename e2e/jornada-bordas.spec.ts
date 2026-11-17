import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Dia 12C: casos de borda no celular (iPhone e Android): sair no meio do formulário e voltar, perder a
// conexão ao salvar, dois toques rápidos em Gerar e um orçamento de 80 itens.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const SUFIXO = `${Date.now()}`.slice(-8);
const PREFIXO = "JORNADA E2E borda";

async function limpar() {
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

async function entrar(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
}

/**
 * Responde a pergunta 1 e espera a 2. Não toca de novo se a 2 já apareceu: um segundo toque criaria um
 * segundo rascunho (no iPhone o primeiro toque pode vir antes da hidratação e ser ignorado).
 */
async function primeiraPergunta(page: Page, nome: string) {
  const segunda = page.getByRole("heading", { level: 1, name: /WhatsApp do cliente/i });
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    if (await segunda.isVisible()) return;
    await page.getByRole("textbox", { name: /nome do cliente/i }).fill(nome);
    await page.getByRole("button", { name: "Próxima" }).click();
    if (
      await segunda.waitFor({ timeout: 8_000 }).then(
        () => true,
        () => false,
      )
    )
      return;
  }
  await expect(segunda).toBeVisible();
}

async function rascunhoComItens(nome: string, zap: string, quantos: number) {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome, whatsapp: zap })
    .select("id")
    .single();
  if (cli.error) throw new Error(`cliente da borda: ${cli.error.message} (${zap})`);
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: cli.data!.id,
      respostas: {
        versao: 2,
        cliente_nome: nome,
        cliente_whatsapp: zap,
        tipo_cliente: "final",
        prazo: "encomenda",
      },
    })
    .select("id")
    .single();
  const itens = Array.from({ length: quantos }, (_, i) => ({
    orcamento_id: orc.data!.id,
    codigo: null,
    descricao_congelada: `Item avulso de teste número ${i + 1} com descrição de tamanho razoável para o PDF`,
    preco_unitario_congelado: 10 + i,
    quantidade: 1 + (i % 3),
    ambiente: `Ambiente ${1 + (i % 4)}`,
    avulso: true,
    descricao_manual: true,
    ordem: i,
  }));
  await admin.from("orcamento_itens").insert(itens);
  return orc.data!.id as string;
}

test("sair no meio do formulário e voltar pela lista continua de onde parou", async ({ page }) => {
  await entrar(page);
  const nome = `${PREFIXO} meio ${SUFIXO}`;
  await page.goto("/orcamentos/novo");
  await primeiraPergunta(page, nome);
  // Sai sem terminar.
  await page.goto("/orcamentos");
  const cartao = page.getByRole("listitem").filter({ hasText: nome });
  await expect(cartao).toBeVisible();
  await cartao.getByRole("link", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /WhatsApp do cliente/i })).toBeVisible();
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByRole("textbox", { name: /nome do cliente/i })).toHaveValue(nome);
});

test("sem internet ao salvar: a tela avisa, não perde o que foi digitado e funciona ao voltar", async ({
  page,
  context,
}) => {
  await entrar(page);
  const nome = `${PREFIXO} offline ${SUFIXO}`;
  await page.goto("/orcamentos/novo");
  await primeiraPergunta(page, nome);

  const campo = page.getByRole("textbox", { name: /whatsapp/i });
  await campo.fill(`(82) 9${SUFIXO.slice(0, 4)}-${SUFIXO.slice(4)}`);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Próxima" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /internet|conexão/i })).toBeVisible();
  await expect(campo).toHaveValue(new RegExp(`${SUFIXO.slice(4)}`)); // o digitado continua na tela
  await expect(page.getByRole("heading", { level: 1, name: /WhatsApp do cliente/i })).toBeVisible();

  await context.setOffline(false);
  await expect(async () => {
    await page.getByRole("button", { name: "Próxima" }).click({ timeout: 5_000 });
    await expect(page.getByRole("heading", { level: 1, name: /tipo de cliente/i })).toBeVisible({
      timeout: 6_000,
    });
  }).toPass({ timeout: 40_000 });
});

test("dois toques rápidos em Gerar não criam duas versões", async ({ page }) => {
  const id = await rascunhoComItens(
    `${PREFIXO} duplo ${SUFIXO}`,
    `+5582${SUFIXO.padStart(9, "7")}`,
    3,
  );
  await entrar(page);
  await page.goto(`/orcamentos/${id}/revisao`);
  const gerar = page.getByRole("button", { name: "Gerar orçamento" });
  await expect(gerar).toBeEnabled();
  await gerar.dblclick({ delay: 10 });
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}$`), { timeout: 90_000 });
  const { data: o } = await admin
    .from("orcamentos")
    .select("pdf_versao, pdf_versoes")
    .eq("id", id)
    .single();
  expect(o!.pdf_versao).toBe(1);
  expect((o!.pdf_versoes as unknown[]).length).toBe(1);
});

test("orçamento com 80 itens gera em menos de 10 s e o PDF quebra páginas", async ({ page }) => {
  const id = await rascunhoComItens(
    `${PREFIXO} oitenta ${SUFIXO}`,
    `+5582${SUFIXO.padStart(9, "8")}`,
    80,
  );
  await entrar(page);
  await page.goto(`/orcamentos/${id}/revisao`);
  const gerar = page.getByRole("button", { name: "Gerar orçamento" });
  await expect(gerar).toBeEnabled();
  const t0 = Date.now();
  await gerar.click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}$`), { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Orçamento (versão 1)" })).toBeVisible();
  const segundos = (Date.now() - t0) / 1000;
  console.log(`80 itens: PDF e XLSX gerados em ${segundos.toFixed(1)} s`);
  expect(segundos).toBeLessThan(10);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Baixar PDF" }).click(),
  ]);
  const partes: Buffer[] = [];
  for await (const p of await download.createReadStream()) partes.push(Buffer.from(p));
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.concat(partes)));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  expect(totalPages).toBeGreaterThan(1);
  const t = text.replace(/\s+/g, " ");
  expect(t).toContain("Item avulso de teste número 1 ");
  expect(t).toContain("Item avulso de teste número 80 ");
});
