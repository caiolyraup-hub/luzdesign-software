import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Dia 9B: kit de fita, "Seus mais usados" e duplicar ambiente (sem IA), no celular de 390 px.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "TESTE ATALHOS E2E";
const NOME = `${PREFIXO} ${Date.now()}`;
const NOME_HIST = `${PREFIXO} HIST ${Date.now()}`;

async function limpar() {
  const { data: clientes } = await admin.from("clientes").select("id").like("nome", `${PREFIXO}%`);
  const ids = (clientes ?? []).map((c) => c.id);
  if (ids.length) {
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

const reais = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");

test("kit de fita de 5 m, duplicar ambiente com preço de hoje e seus mais usados", async ({
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
    .in("codigo", ["12222", "12086", "10527", "9520"]);
  const preco = Object.fromEntries(
    (produtos ?? []).map((p) => [p.codigo, Number(p.preco_unitario)]),
  );
  // Fita 22 W/m, perfil de 3 m e fonte de 150 W (5 m x 22 W = 110 W; x 1,2 = 132 W).
  const totalKit = 5 * preco["12222"] + 2 * preco["12086"] + 1 * preco["10527"];

  // Histórico da vendedora: o 9520 é o produto que ela mais usa.
  const cliHist = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: NOME_HIST })
    .select("id")
    .single();
  const hist = await admin
    .from("orcamentos")
    .insert({ vendedora_id: aline!.id, cliente_id: cliHist.data!.id, respostas: { versao: 1 } })
    .select("id")
    .single();
  await admin.from("orcamento_itens").insert(
    ["Sala", "Quarto", "Cozinha"].map((ambiente, i) => ({
      orcamento_id: hist.data!.id,
      codigo: "9520",
      descricao_congelada: "STELLA DIC 6W 2.7K",
      preco_unitario_congelado: preco["9520"],
      quantidade: 1,
      ambiente,
      avulso: false,
      ordem: i,
    })),
  );

  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: NOME, whatsapp: "+5582900009953" })
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
        cliente_whatsapp: "+5582900009953",
        tipo_cliente: "final",
        tipo_obra: { uso: "residencial", estado: "reforma" },
        ambientes: ["sala"],
        linha: "tecnica",
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
  const sala1 = page.getByRole("region", { name: "Sala", exact: true });

  // ---- Seus mais usados: com a busca vazia aparecem os produtos que ela mais usou.
  await sala1.getByRole("button", { name: "Adicionar produto" }).click();
  const usados = page.getByRole("region", { name: "Seus mais usados" });
  await expect(usados.getByText("STELLA DIC 6W 2.7K")).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia9-4-mais-usados.png" });
  // Um toque adiciona (quantidade 1) e a folha continua aberta.
  await usados.getByRole("button", { name: /Cód\. 9520/ }).click();
  await expect(page.getByText("Adicionado: STELLA DIC 6W 2.7K")).toBeVisible();
  await page.getByRole("button", { name: "Concluir (1)" }).click();
  await expect(sala1.getByText("STELLA DIC 6W 2.7K")).toBeVisible();

  // ---- Kit de fita de 5 m: fita + perfil + fonte.
  await sala1.getByRole("button", { name: "Adicionar kit de fita" }).click();
  const kit = page.getByRole("group", { name: "Kit de fita em Sala" });
  await kit.getByRole("textbox", { name: "Metros de fita" }).fill("5");
  await kit.getByRole("button", { name: "Escolher a fita" }).click();
  let busca = page.getByRole("searchbox", { name: "Buscar produto" });
  await busca.fill("12222");
  await busca.press("Enter"); // código de 4 ou 5 dígitos acha o produto direto
  await expect(kit.getByText("MTS FITA 22W/M NT NIT")).toBeVisible();
  await kit.getByRole("button", { name: "Escolher o perfil" }).click();
  busca = page.getByRole("searchbox", { name: "Buscar produto" });
  await busca.fill("12086");
  await busca.press("Enter");
  await kit.getByRole("button", { name: "Calcular o kit" }).click();

  // Prévia: 5 m de fita, 2 barras de perfil e a menor fonte que aguenta 132 W.
  await expect(kit.getByText("5 m de fita")).toBeVisible();
  await expect(kit.getByText("5 m ÷ 3 m = 2 barras")).toBeVisible();
  await expect(kit.getByText(/5 m × 22 W\/m = 110 W/)).toBeVisible();
  await expect(kit.getByText("MB 150W")).toBeVisible();
  await expect(kit.getByText(/Confirmar a tensão/)).toBeVisible(); // o catálogo não informa a tensão
  await expect(kit.getByText(reais(totalKit)).last()).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia9-5-kit-previa.png", fullPage: true });
  await kit.getByRole("button", { name: "Adicionar kit ao ambiente" }).click();

  // Três itens novos (fita, perfil, fonte) além do 9520.
  await expect(kit).toHaveCount(0); // o painel do kit fecha
  await expect(sala1.getByRole("listitem")).toHaveCount(4);
  const { data: itens } = await admin
    .from("orcamento_itens")
    .select("codigo, quantidade, preco_unitario_congelado, origem")
    .eq("orcamento_id", id)
    .order("ordem");
  const porCodigo = Object.fromEntries((itens ?? []).map((i) => [i.codigo, i]));
  expect(Number(porCodigo["12222"].quantidade)).toBe(5);
  expect(Number(porCodigo["12086"].quantidade)).toBe(2);
  expect(Number(porCodigo["10527"].quantidade)).toBe(1);
  expect(Number(porCodigo["12222"].preco_unitario_congelado)).toBe(preco["12222"]); // preço do catálogo
  const totalComKit = preco["9520"] + totalKit;
  await expect(page.getByText(reais(totalComKit)).first()).toBeVisible();

  // ---- Duplicar ambiente: o preço de uma fita é "velho" no item; a cópia traz o do catálogo.
  await admin
    .from("orcamento_itens")
    .update({ preco_unitario_congelado: 1 })
    .eq("orcamento_id", id)
    .eq("codigo", "12222");
  await page.reload();
  await page
    .getByRole("region", { name: "Sala", exact: true })
    .getByRole("button", { name: "Duplicar ambiente" })
    .click();
  const dup = page.getByRole("group", { name: "Duplicar Sala" });
  await expect(dup.getByRole("textbox")).toHaveValue("Sala 2"); // sugestão
  await dup.getByRole("button", { name: "Duplicar ambiente" }).click();
  await expect(dup).toHaveCount(0);

  const sala2 = page.getByRole("region", { name: "Sala 2", exact: true });
  await expect(sala2.getByRole("listitem")).toHaveCount(4);
  const { data: depois } = await admin
    .from("orcamento_itens")
    .select("codigo, ambiente, quantidade, preco_unitario_congelado")
    .eq("orcamento_id", id);
  const copia = (depois ?? []).filter((i) => i.ambiente === "Sala 2");
  const original = (depois ?? []).filter((i) => i.ambiente === "Sala");
  expect(copia).toHaveLength(4);
  const fitaCopia = copia.find((i) => i.codigo === "12222")!;
  const fitaOriginal = original.find((i) => i.codigo === "12222")!;
  expect(Number(fitaCopia.quantidade)).toBe(5);
  expect(Number(fitaCopia.preco_unitario_congelado)).toBe(preco["12222"]); // preço de hoje
  expect(Number(fitaOriginal.preco_unitario_congelado)).toBe(1); // o original não muda
  // Total da tela = original (com a fita a R$ 1) + cópia (preço de hoje).
  const totalOriginal = preco["9520"] + 5 * 1 + 2 * preco["12086"] + preco["10527"];
  await expect(page.getByText(reais(totalOriginal + totalComKit)).first()).toBeVisible();
  await page.screenshot({ path: "test-results/telas/dia9-6-duplicado.png" });

  // ---- A partir de enviado, nada disso aparece (a tela fica só para leitura).
  await admin.from("orcamentos").update({ status: "gerado" }).eq("id", id);
  await admin.from("orcamentos").update({ status: "enviado" }).eq("id", id);
  await page.reload();
  await expect(
    page.getByText("Orçamento já enviado: os produtos estão só para leitura."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Duplicar ambiente" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Adicionar kit de fita" })).toHaveCount(0);
});
