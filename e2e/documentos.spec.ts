import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

// Dia 12A: o nome do arquiteto do cadastro sai no PDF e no XLSX; sem endereço, nenhum dos dois mostra
// rótulo vazio nem quebra o layout.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "TESTE DOCS E2E";
const ARQUITETO = `TESTE DOCS Arquiteta Lúcia ${Date.now()}`;

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
  await admin.from("arquitetos").delete().like("nome", "TESTE DOCS%");
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

async function lerDownload(page: Page, nomeLink: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: nomeLink }).click(),
  ]);
  const partes: Buffer[] = [];
  for await (const p of await download.createReadStream()) partes.push(Buffer.from(p));
  return Buffer.concat(partes);
}

async function gerarOrcamento(
  page: Page,
  opcoes: { nome: string; whatsapp: string; arquitetoId?: string; endereco?: string },
) {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const cli = await admin
    .from("clientes")
    .insert({
      vendedora_id: aline!.id,
      nome: opcoes.nome,
      whatsapp: opcoes.whatsapp,
      endereco: opcoes.endereco ?? null,
      arquiteto_id: opcoes.arquitetoId ?? null,
    })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline!.id,
      cliente_id: cli.data!.id,
      arquiteto_id: opcoes.arquitetoId ?? null,
      endereco: opcoes.endereco ?? null,
      respostas: {
        versao: 2,
        cliente_nome: opcoes.nome,
        cliente_whatsapp: opcoes.whatsapp,
        tipo_cliente: opcoes.arquitetoId ? "arquiteto" : "final",
        prazo: "encomenda",
      },
    })
    .select("id, numero")
    .single();
  const id = orc.data!.id as string;
  const { data: p } = await admin
    .from("produtos")
    .select("preco_unitario, descricao")
    .eq("codigo", "9520")
    .single();
  await admin.from("orcamento_itens").insert({
    orcamento_id: id,
    codigo: "9520",
    descricao_congelada: p!.descricao,
    preco_unitario_congelado: p!.preco_unitario,
    quantidade: 2,
    ambiente: "Geral",
    avulso: false,
    ordem: 0,
  });

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();
  await page.goto(`/orcamentos/${id}/revisao`);
  await page.getByRole("button", { name: "Gerar orçamento" }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}$`), { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Orçamento (versão 1)" })).toBeVisible();

  const pdf = await lerDownload(page, "Baixar PDF");
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    (await lerDownload(page, "Baixar planilha (XLSX)")) as unknown as ExcelJS.Buffer,
  );
  const celulas: string[] = [];
  wb.getWorksheet("ORÇAMENTO")!.eachRow((r) =>
    r.eachCell((c) =>
      celulas.push(String((c.value as { result?: unknown })?.result ?? c.value ?? "")),
    ),
  );
  return { pdf, texto: text.replace(/\s+/g, " "), celulas, numero: orc.data!.numero as string };
}

const semEspaco = (t: string) => t.replace(/\s+/g, "").toUpperCase();

test("o arquiteto do cadastro sai no PDF e no XLSX, com o endereço quando existe", async ({
  page,
}) => {
  const arq = await admin.from("arquitetos").insert({ nome: ARQUITETO }).select("id").single();
  const r = await gerarOrcamento(page, {
    nome: `${PREFIXO} com arquiteto ${Date.now()}`,
    whatsapp: "+5582900009971",
    arquitetoId: arq.data!.id,
    endereco: "Rua das Flores, 10, Ponta Verde",
  });
  expect(semEspaco(r.texto)).toContain(semEspaco(ARQUITETO));
  expect(semEspaco(r.texto)).toContain(semEspaco("Rua das Flores, 10, Ponta Verde"));
  expect(r.celulas).toContain(ARQUITETO);
  expect(r.celulas).toContain("ARQUITETO");
  expect(r.celulas).toContain("Rua das Flores, 10, Ponta Verde");
  expect(r.celulas).toContain("ENDEREÇO DA OBRA");
});

test("sem endereço (e sem arquiteto) nenhum documento mostra rótulo vazio nem quebra", async ({
  page,
}) => {
  const r = await gerarOrcamento(page, {
    nome: `${PREFIXO} sem endereco ${Date.now()}`,
    whatsapp: "+5582900009972",
  });
  expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const t = semEspaco(r.texto);
  expect(t).not.toContain("ENDEREÇODAOBRA");
  expect(t).not.toContain("ARQUITETO(A)");
  expect(t).toContain(semEspaco(r.numero));
  expect(r.celulas).not.toContain("ENDEREÇO DA OBRA");
  expect(r.celulas).not.toContain("ARQUITETO");
  // Nenhuma célula de identificação ficou só com o rótulo: "CLIENTE" tem valor ao lado.
  expect(r.celulas.filter((c) => c === "undefined" || c === "null")).toEqual([]);
  // O restante do layout segue completo: tabela de produtos e total.
  expect(t).toContain("TOTAL");
});
