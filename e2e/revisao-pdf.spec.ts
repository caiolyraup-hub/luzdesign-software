import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

const PREFIXO = "TESTE PDF E2E";
const NOME = `${PREFIXO} ${Date.now()}`;

/** Remove o que o teste criou (cliente, orçamento, itens, PDFs no Storage) e acerta o contador. */
async function limpar() {
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", `${PREFIXO}%`);
  const ids = (clientes ?? []).map((c) => c.id);
  if (ids.length) {
    const { data: orcs } = await admin
      .from("orcamentos")
      .select("id, vendedora_id")
      .in("cliente_id", ids);
    for (const o of orcs ?? []) {
      for (const bucket of ["pdfs", "anexos"]) {
        const { data: arquivos } = await admin.storage
          .from(bucket)
          .list(`${o.vendedora_id}/${o.id}`);
        const caminhos = (arquivos ?? []).map((a) => `${o.vendedora_id}/${o.id}/${a.name}`);
        if (caminhos.length) await admin.storage.from(bucket).remove(caminhos);
      }
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

const print = (page: Page, nome: string, fullPage = false) =>
  page.screenshot({ path: `test-results/telas/${nome}.png`, fullPage });

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");

test("Aline monta à mão, revisa, gera o PDF, vê o status Gerado e baixa o PDF", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const { data: produtos } = await admin
    .from("produtos")
    .select("codigo, preco_unitario")
    .in("codigo", ["9520", "12222"]);
  const preco = Object.fromEntries(
    (produtos ?? []).map((p) => [p.codigo, Number(p.preco_unitario)]),
  );

  // Orçamento da Aline com as 10 perguntas respondidas (o formulário já tem o próprio E2E).
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: NOME, whatsapp: "+5582900009950" })
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
        cliente_whatsapp: "+5582900009950",
        tipo_cliente: "final",
        tipo_obra: { uso: "residencial", estado: "reforma" },
        ambientes: ["sala", "cozinha"],
        pedido_cliente: "Teste do PDF.",
        linha: "tecnica",
        prazo: "encomenda",
      },
    })
    .select("id, numero")
    .single();
  const id = orc.data!.id as string;

  // Login.
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();

  // Resumo -> Selecionar produtos: tela vazia com os ambientes da pergunta 5.
  await page.goto("/orcamentos");
  await page
    .getByRole("listitem")
    .filter({ hasText: NOME })
    .getByRole("link", { name: "Continuar" })
    .click();
  await expect(page.getByRole("heading", { name: "Resumo do orçamento" })).toBeVisible();
  await page.getByRole("link", { name: "Selecionar produtos" }).click();
  await expect(page.getByRole("heading", { name: "Produtos do orçamento" })).toBeVisible();
  const sala = page.getByRole("region", { name: "Sala" });
  const cozinha = page.getByRole("region", { name: "Cozinha" });
  await expect(sala.getByText("Nenhum item neste ambiente ainda.")).toBeVisible();
  await expect(cozinha).toBeVisible();

  // Vazio: não dá para gerar.
  const gerar = page.getByRole("button", { name: "Gerar orçamento" });
  await expect(gerar).toBeDisabled();
  await expect(page.getByText("Adicione ao menos um item.")).toBeVisible();

  // Dois produtos pela busca.
  await sala.getByRole("button", { name: "Adicionar produto" }).click();
  await page.getByRole("searchbox", { name: "Buscar produto" }).fill("dic 6w");
  await page
    .getByRole("button", { name: /STELLA DIC 6W 2\.7K/ })
    .first()
    .click();
  // A busca continua aberta (dá para adicionar vários seguidos); "Concluir" fecha.
  await page.getByRole("button", { name: /Concluir/ }).click();
  await expect(sala.getByText("STELLA DIC 6W 2.7K")).toBeVisible();

  await cozinha.getByRole("button", { name: "Adicionar produto" }).click();
  await page.getByRole("searchbox", { name: "Buscar produto" }).fill("MTS FITA 22W/M NT NIT");
  await page.getByRole("button", { name: /Cód\. 12222/ }).click();
  await page.getByRole("button", { name: /Concluir/ }).click();
  await expect(cozinha.getByText("MTS FITA 22W/M NT NIT")).toBeVisible();

  // Quantidade: + no spot (1 -> 2) e fita por metro com decimal (8,5).
  await sala.getByRole("button", { name: /Aumentar STELLA/ }).click();
  await expect(sala.getByRole("textbox", { name: /Quantidade de STELLA/ })).toHaveValue("2");
  const qtdFita = cozinha.getByRole("textbox", { name: /Quantidade de MTS FITA/ });
  await qtdFita.fill("8,5");
  await qtdFita.press("Enter");
  await expect(qtdFita).toHaveValue("8,5");

  // Remover e desfazer.
  await cozinha.getByRole("button", { name: "Remover" }).click();
  await expect(page.getByText("Item removido.")).toBeVisible();
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(cozinha.getByText("MTS FITA 22W/M NT NIT")).toBeVisible();
  await expect(cozinha.getByRole("textbox", { name: /Quantidade de MTS FITA/ })).toHaveValue("8,5");

  // Avulso com preço 0: "preço a definir" e Gerar orçamento bloqueado, com o motivo.
  await sala.getByRole("button", { name: "Adicionar item avulso" }).click();
  await page.getByLabel("Descrição do item avulso").fill("Pendente sob medida (teste)");
  await page.getByRole("button", { name: "Adicionar avulso" }).click();
  await expect(sala.getByText("Preço a definir")).toBeVisible();
  await expect(gerar).toBeDisabled();
  await expect(page.getByText("Defina o preço do item avulso.")).toBeVisible();
  await print(page, "8-revisao-bloqueada", true);

  // Define o preço do avulso: libera.
  const precoAvulso = sala.getByRole("textbox", { name: /Preço unitário de Pendente/ });
  await precoAvulso.fill("150,00");
  await precoAvulso.press("Enter");
  await expect(gerar).toBeEnabled();
  await expect(sala.getByText("Preço a definir")).toHaveCount(0);

  // Total do rodapé: 2 x spot + 8,5 m de fita + avulso 150.
  const totalEsperado = Math.round((2 * preco["9520"] + 8.5 * preco["12222"] + 150) * 100) / 100;
  await expect(page.getByText(`Total ${moeda(totalEsperado)}`)).toBeVisible();
  await print(page, "9-revisao-pronta");

  // Preço mudou no estoque: simulamos guardando um preço velho no item (sem mexer no catálogo).
  await admin
    .from("orcamento_itens")
    .update({ preco_unitario_congelado: 1 })
    .eq("orcamento_id", id)
    .eq("codigo", "9520");
  await page.reload();
  await expect(page.getByText("O preço de 1 item mudou no estoque.")).toBeVisible();
  await page.getByRole("button", { name: "Atualizar preços" }).click();
  await expect(page.getByText("O preço de 1 item mudou no estoque.")).toHaveCount(0);
  await expect(page.getByText(`Total ${moeda(totalEsperado)}`)).toBeVisible();

  // Gera o PDF: vai para a tela do orçamento com status Gerado.
  await gerar.click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}$`), { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: `Orçamento ${orc.data!.numero}` })).toBeVisible();
  await expect(page.getByText("Gerado", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Orçamento (versão 1)" })).toBeVisible();
  await expect(page.getByText("Compartilhar no WhatsApp")).toBeVisible();
  await expect(page.getByText("PDF gerado (versão 1)")).toBeVisible(); // linha do tempo
  await print(page, "10-orcamento-gerado", true);

  // Banco: total, validade de 7 dias, preços congelados do catálogo.
  const { data: o } = await admin
    .from("orcamentos")
    .select("status, valor_total, validade, pdf_caminho, pdf_versao")
    .eq("id", id)
    .single();
  expect(o!.status).toBe("gerado");
  expect(Number(o!.valor_total)).toBe(totalEsperado);
  expect(o!.pdf_versao).toBe(1);
  expect(o!.validade).toBeTruthy();
  const { data: itens } = await admin
    .from("orcamento_itens")
    .select("codigo, preco_unitario_congelado")
    .eq("orcamento_id", id)
    .not("codigo", "is", null);
  for (const i of itens ?? []) expect(Number(i.preco_unitario_congelado)).toBe(preco[i.codigo!]);

  // Baixar o PDF.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Baixar PDF" }).click(),
  ]);
  // Nome no costume da loja: NOME DO CLIENTE DD.MM.AA.pdf
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^${NOME} \\d{2}\\.\\d{2}\\.\\d{2}\\.pdf$`),
  );
  const stream = await download.createReadStream();
  const partes: Buffer[] = [];
  for await (const p of stream) partes.push(Buffer.from(p));
  const bytes = Buffer.concat(partes);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(2000);
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
  const texto = text.replace(/\s+/g, " ");
  expect(texto).toContain(orc.data!.numero);
  expect(texto).toContain("STELLA DIC 6W 2.7K");
  // Sem análise do ambiente nem motivo dos produtos (dia 8).
  expect(texto.replaceAll(" ", "")).not.toContain("ANÁLISEDOAMBIENTE");
  // Com o logo em public/marca, ele vai embutido no PDF (sem logo o arquivo tem poucos KB).
  if (existsSync("public/marca/logo.png")) expect(bytes.length).toBeGreaterThan(100_000);

  // Planilha XLSX do mesmo orçamento, com fórmulas.
  const [baixaXlsx] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Baixar planilha (XLSX)" }).click(),
  ]);
  expect(baixaXlsx.suggestedFilename()).toMatch(
    new RegExp(`^${NOME} \\d{2}\\.\\d{2}\\.\\d{2}\\.xlsx$`),
  );
  const fluxo = await baixaXlsx.createReadStream();
  const partesX: Buffer[] = [];
  for await (const p of fluxo) partesX.push(Buffer.from(p));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(partesX) as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("ORÇAMENTO")!;
  let achouTotal = false;
  ws.eachRow((r) => {
    if (r.getCell(1).value === "TOTAL") {
      achouTotal = true;
      const v = r.getCell(6).value as { formula: string; result: number };
      expect(v.formula).toMatch(/^SUM\(F\d+:F\d+\)$/);
      expect(v.result).toBeCloseTo(totalEsperado, 2);
    }
  });
  expect(achouTotal).toBe(true);

  // Editar volta para a revisão (gera nova versão depois).
  await page.getByRole("link", { name: "Editar (gera nova versão)" }).click();
  await expect(page.getByRole("heading", { name: "Produtos do orçamento" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerar nova versão do orçamento" })).toBeEnabled();
});
