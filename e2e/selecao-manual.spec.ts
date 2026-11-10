import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

// Dia 8A: a vendedora escolhe os produtos; a IA (simulada aqui) só sugere e padroniza texto.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "TESTE SELECAO E2E";
const NOME = `${PREFIXO} ${Date.now()}`;

/** Remove o que o teste criou (cliente, orçamento, uso da IA, arquivos) e as descrições simuladas. */
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
      await admin.from("uso_ia").delete().eq("orcamento_id", o.id);
    }
    await admin.from("orcamentos").delete().in("cliente_id", ids);
    await admin.from("clientes").delete().in("id", ids);
  }
  // A IA simulada grava "Padronizada: ..." no cache: sai daqui para não ir para orçamentos reais.
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

test("Aline seleciona produtos (busca, código, lista colada), pede a Indicação da IA e gera PDF e XLSX", async ({
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
    .in("codigo", ["9520", "12222", "10340"]);
  const preco = Object.fromEntries(
    (produtos ?? []).map((p) => [p.codigo, Number(p.preco_unitario)]),
  );

  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: NOME, whatsapp: "+5582900009951" })
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
        cliente_whatsapp: "+5582900009951",
        tipo_cliente: "final",
        tipo_obra: { uso: "residencial", estado: "reforma" },
        ambientes: ["sala", "cozinha"],
        // pedido_cliente fica vazio de propósito: desde o dia 8 a pergunta 6 é opcional.
        linha: "tecnica",
        prazo: "encomenda",
      },
    })
    .select("id, numero")
    .single();
  const id = orc.data!.id as string;

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();

  // O Resumo leva a "Selecionar produtos".
  await page.goto(`/orcamentos/${id}/editar?passo=12`);
  await page.getByRole("link", { name: "Selecionar produtos" }).click();
  await expect(page.getByRole("heading", { name: "Produtos do orçamento" })).toBeVisible();
  const sala = page.getByRole("region", { name: "Sala" });
  const cozinha = page.getByRole("region", { name: "Cozinha" });

  // ---- Busca: um produto pelo código (Enter adiciona direto) e outro pela descrição, sem sair da busca.
  await sala.getByRole("button", { name: "Adicionar produto" }).click();
  const busca = page.getByRole("searchbox", { name: "Buscar produto" });
  await busca.fill("9520");
  await busca.press("Enter");
  await expect(page.getByText("Adicionado: STELLA DIC 6W 2.7K")).toBeVisible();
  await busca.fill("MTS FITA 22W/M NT NIT");
  await page.getByRole("button", { name: /Cód\. 12222/ }).click();
  await expect(page.getByRole("button", { name: "Concluir (2)" })).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia8-1-busca.png" });
  await page.getByRole("button", { name: "Concluir (2)" }).click();
  await expect(sala.getByText("STELLA DIC 6W 2.7K")).toBeVisible();
  await expect(sala.getByText("MTS FITA 22W/M NT NIT")).toBeVisible();

  // ---- Colar lista na cozinha: 2 linhas reconhecidas, 1 não entendida.
  await cozinha.getByRole("button", { name: "Colar lista" }).click();
  await page
    .getByRole("textbox", { name: "Lista de produtos" })
    .fill("2 10340\n3,5 m 12222\nlinha sem sentido");
  await page.getByRole("button", { name: "Conferir lista" }).click();
  await expect(page.getByText("2 linhas reconhecidas")).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia8-2-colar-lista.png" });
  await expect(page.getByText("Linhas que não entendi:")).toBeVisible();
  await expect(page.getByText("Não achei um código de 4 ou 5 dígitos.")).toBeVisible();
  await page.getByRole("button", { name: "Adicionar 2 itens" }).click();
  await expect(cozinha.getByText("MB 48W")).toBeVisible();
  await expect(cozinha.getByRole("textbox", { name: /Quantidade de MTS FITA/ })).toHaveValue("3,5");

  // ---- Indicação da IA (simulada) num ambiente novo: nada entra sozinho; a vendedora adiciona.
  const antes = await admin.from("orcamento_itens").select("id").eq("orcamento_id", id);
  const indicacao = page.getByRole("region", { name: "Indicação da IA" });
  await indicacao.locator("select").selectOption({ label: "Novo ambiente..." });
  await indicacao.getByPlaceholder("Nome do ambiente (ex.: Varanda)").fill("Varanda");
  await indicacao.locator("textarea").first().fill("Fita de luz quente na varanda.");
  await indicacao.getByRole("button", { name: "Pedir indicação" }).click();
  await expect(page.getByRole("heading", { name: "Sugestões para Varanda" })).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia8-3-indicacao.png", fullPage: true });
  await expect(
    page.getByText("Código 00001 não existe no catálogo e foi descartado."),
  ).toBeVisible();
  const depois = await admin.from("orcamento_itens").select("id").eq("orcamento_id", id);
  expect(depois.data?.length, "a IA não grava item sozinha").toBe(antes.data?.length);

  await page.getByRole("button", { name: "Adicionar todas (2)" }).click();
  const varanda = page.getByRole("region", { name: "Varanda" });
  await expect(varanda.getByText("MTS FITA 22W/M NT NIT")).toBeVisible();
  await expect(varanda.getByText("MB 48W")).toBeVisible();

  // ---- Banco: origem de cada item e registros da IA.
  const { data: itens } = await admin
    .from("orcamento_itens")
    .select("codigo, ambiente, quantidade, origem, preco_unitario_congelado")
    .eq("orcamento_id", id);
  const origem = (cod: string, amb: string) =>
    itens?.find((i) => i.codigo === cod && i.ambiente === amb)?.origem;
  expect(origem("9520", "Sala")).toBe("manual");
  expect(origem("12222", "Sala")).toBe("manual");
  expect(origem("10340", "Cozinha")).toBe("lista_colada");
  expect(origem("12222", "Cozinha")).toBe("lista_colada");
  expect(origem("12222", "Varanda")).toBe("indicacao_ia");
  expect(origem("10340", "Varanda")).toBe("indicacao_ia");
  for (const i of itens ?? []) expect(Number(i.preco_unitario_congelado)).toBe(preco[i.codigo!]);
  const { data: hist } = await admin
    .from("indicacoes_ia")
    .select("ambiente")
    .eq("orcamento_id", id);
  expect(hist?.map((h) => h.ambiente)).toEqual(["Varanda"]);

  // ---- Gera o orçamento: PDF e planilha, com a descrição padronizada.
  const totalEsperado =
    Math.round(
      (preco["9520"] +
        preco["12222"] +
        2 * preco["10340"] +
        3.5 * preco["12222"] +
        4 * preco["12222"] +
        preco["10340"]) *
        100,
    ) / 100;
  await page.getByRole("button", { name: "Gerar orçamento" }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}$`), { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Orçamento (versão 1)" })).toBeVisible();

  const { data: o } = await admin
    .from("orcamentos")
    .select("status, valor_total, pdf_caminho, xlsx_caminho")
    .eq("id", id)
    .single();
  expect(o!.status).toBe("gerado");
  expect(Number(o!.valor_total)).toBe(totalEsperado);
  expect(o!.xlsx_caminho).toBe(o!.pdf_caminho.replace(/\.pdf$/, ".xlsx"));

  // Download pelo botão: PDF e XLSX com o nome do costume da loja.
  const [pdf] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Baixar PDF" }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(new RegExp(`^${NOME} \\d{2}\\.\\d{2}\\.\\d{2}\\.pdf$`));
  const [xlsx] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Baixar planilha (XLSX)" }).click(),
  ]);
  expect(xlsx.suggestedFilename()).toMatch(new RegExp(`^${NOME} \\d{2}\\.\\d{2}\\.\\d{2}\\.xlsx$`));

  // O PDF tem a descrição padronizada; a planilha tem as fórmulas e os mesmos totais.
  const baixado = await admin.storage.from("pdfs").download(o!.pdf_caminho);
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(await baixado.data!.arrayBuffer()), {
    mergePages: true,
  });
  expect(text.replace(/\s+/g, " ")).toContain("Padronizada: STELLA DIC 6W 2.7K");

  const planilha = await admin.storage.from("pdfs").download(o!.xlsx_caminho!);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await planilha.data!.arrayBuffer()) as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("ORÇAMENTO")!;
  const linhasProduto: string[] = [];
  let total = 0;
  ws.eachRow((r) => {
    if (r.getCell(1).value === "TOTAL") total = (r.getCell(6).value as { result: number }).result;
    const produto = String(r.getCell(2).value ?? "");
    if (/\b(9520|12222|10340)$/.test(produto)) linhasProduto.push(String(r.getCell(3).value));
  });
  expect(total).toBeCloseTo(totalEsperado, 2);
  expect(linhasProduto).toHaveLength(6);
  expect(linhasProduto.every((d) => d.startsWith("Padronizada: "))).toBe(true);

  // Registros da IA: uma indicação e uma padronização, ambas ok.
  const { data: usos } = await admin.from("uso_ia").select("tipo, status").eq("orcamento_id", id);
  expect(usos?.map((u) => `${u.tipo}:${u.status}`).sort()).toEqual([
    "formatacao:ok",
    "indicacao:ok",
  ]);
  const { data: itensFinais } = await admin
    .from("orcamento_itens")
    .select("codigo, descricao_congelada, avulso")
    .eq("orcamento_id", id);
  expect(itensFinais?.every((i) => i.descricao_congelada.startsWith("Padronizada: "))).toBe(true);
});
