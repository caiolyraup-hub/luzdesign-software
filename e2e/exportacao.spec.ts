import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

// Dia 10C: "Exportar planilha" para a vendedora (só os dados dela) e para a gerência (com Eventos e a
// opção de incluir os de teste), no celular de 390 px.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const MARCA = `EXPORT E2E ${Date.now()}`;

async function limpar() {
  // Auditoria das exportações feitas por este teste.
  await admin.from("eventos_exportacao").delete().eq("filtros->>q", "EXPORT E2E");
  await admin.from("orcamentos").delete().eq("respostas->>export_e2e", "true");
  await admin.from("clientes").delete().like("nome", "%EXPORT E2E%");
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

async function criar(vendedoraId: string, nome: string, zap: string, itens: number) {
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: vendedoraId, nome, whatsapp: zap })
    .select("id")
    .single();
  const o = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: vendedoraId,
      cliente_id: cli.data!.id,
      respostas: { export_e2e: "true" },
      valor_total: 100 * itens,
    })
    .select("id, numero")
    .single();
  await admin.from("orcamento_itens").insert(
    Array.from({ length: itens }, (_, i) => ({
      orcamento_id: o.data!.id,
      codigo: null,
      descricao_congelada: `Item avulso ${i + 1} ${MARCA}`,
      preco_unitario_congelado: 100,
      quantidade: 1,
      ambiente: "Sala",
      avulso: true,
      ordem: i,
    })),
  );
  return o.data!.numero as string;
}

async function baixar(page: Page, clique: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent("download"), clique()]);
  const nome = download.suggestedFilename();
  const stream = await download.createReadStream();
  const partes: Buffer[] = [];
  for await (const p of stream) partes.push(Buffer.from(p));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(partes) as unknown as ExcelJS.Buffer);
  return { nome, wb };
}

const coluna = (wb: ExcelJS.Workbook, aba: string, col: number) => {
  const v: string[] = [];
  wb.getWorksheet(aba)?.eachRow((r, n) => {
    if (n > 1) v.push(String(r.getCell(col).value ?? ""));
  });
  return v;
};

test("a vendedora exporta só os dados dela; a gerência recebe Eventos e escolhe incluir os de teste", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const { data: kely } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_KELY!)
    .single();
  const nA = await criar(aline!.id, `${MARCA} Aline`, "+5582977710001", 3);
  const nK = await criar(kely!.id, `${MARCA} Kely`, "+5582977710002", 2);
  const nT = await criar(aline!.id, `TESTE ${MARCA}`, "+5582977710003", 1);

  // ---- Vendedora.
  await entrar(page, process.env.SEED_EMAIL_ALINE!);
  await page.goto(`/orcamentos?filtro=todos&q=${encodeURIComponent("EXPORT E2E")}`);
  await expect(page.getByRole("link", { name: "Exportar planilha" })).toBeVisible();
  await expect(page.getByLabel("Incluir orçamentos de teste")).toHaveCount(0); // opção só da gerência
  const { nome, wb } = await baixar(page, () =>
    page.getByRole("link", { name: "Exportar planilha" }).click(),
  );
  expect(nome).toMatch(/^luz-design-orcamentos \d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumo", "Orçamentos", "Itens", "Clientes"]);
  const numeros = coluna(wb, "Orçamentos", 1);
  expect(numeros).toContain(nA);
  expect(numeros).not.toContain(nK); // da Kely: nunca
  expect(numeros).not.toContain(nT); // teste: fora por padrão
  expect(coluna(wb, "Itens", 4).filter((d) => d.includes(MARCA))).toHaveLength(3);
  expect(coluna(wb, "Itens", 4).join("|")).not.toContain("Kely");
  const valor = wb.getWorksheet("Orçamentos")!.getRow(2).getCell(8);
  expect(typeof valor.value).toBe("number");
  expect(valor.numFmt).toBe('"R$" #,##0.00');

  // A auditoria registrou a exportação (quem, filtros e quantidade de linhas).
  const { data: aud } = await admin
    .from("eventos_exportacao")
    .select("usuario_id, linhas, filtros, incluiu_teste, detalhes")
    .eq("usuario_id", aline!.id)
    .order("id", { ascending: false })
    .limit(1)
    .single();
  expect(aud!.incluiu_teste).toBe(false);
  expect(aud!.linhas).toBe(1);
  expect((aud!.filtros as { q?: string }).q).toBe("EXPORT E2E");
  expect((aud!.detalhes as { itens: number }).itens).toBe(3);

  // ---- Gerência: as duas vendedoras, aba Eventos; o de teste só com a opção.
  await page.context().clearCookies();
  await entrar(page, process.env.SEED_EMAIL_GERENCIA!);
  await page.goto(`/gerencia?filtro=todos&q=${encodeURIComponent("EXPORT E2E")}`);
  const sem = await baixar(page, () =>
    page.getByRole("link", { name: "Exportar planilha" }).click(),
  );
  expect(sem.wb.worksheets.map((w) => w.name)).toEqual([
    "Resumo",
    "Orçamentos",
    "Itens",
    "Clientes",
    "Eventos",
  ]);
  const semNumeros = coluna(sem.wb, "Orçamentos", 1);
  expect(semNumeros).toContain(nA);
  expect(semNumeros).toContain(nK);
  expect(semNumeros).not.toContain(nT);
  expect(coluna(sem.wb, "Eventos", 1)).toContain(nA);

  await page.getByLabel("Incluir orçamentos de teste").check();
  await expect(page.getByRole("link", { name: "Exportar planilha" })).toHaveAttribute(
    "href",
    /teste=1/,
  );
  const com = await baixar(page, () =>
    page.getByRole("link", { name: "Exportar planilha" }).click(),
  );
  expect(coluna(com.wb, "Orçamentos", 1)).toContain(nT);
  await page.screenshot({ path: "test-results/telas/dia10-7-exportar.png" });
});
