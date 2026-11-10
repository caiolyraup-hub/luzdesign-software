import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Dia 8B: envio com data, tela de produtos só para leitura depois de enviado e Follow-ups de hoje.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PREFIXO = "TESTE FOLLOWUP E2E";
const NOME = `${PREFIXO} ${Date.now()}`;

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

/** Data AAAA-MM-DD em Maceió, `dias` antes de hoje. */
const diaMaceio = (dias: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(
    Date.now() - dias * 86_400_000,
  );

test("gera, marca como enviado há 6 dias, vê o follow-up de hoje, faz o D+5 e reenvia uma nova versão", async ({
  page,
}) => {
  const { data: aline } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", process.env.SEED_EMAIL_ALINE!)
    .single();
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline!.id, nome: NOME, whatsapp: "+5582900009952" })
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
        cliente_whatsapp: "+5582900009952",
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
    preco_unitario_congelado: 1,
    quantidade: 2,
    ambiente: "Sala",
    avulso: false,
    ordem: 0,
  });

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.SEED_EMAIL_ALINE!);
  await page.getByLabel("Senha").fill(process.env.SEED_SENHA_INICIAL!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Para hoje" })).toBeVisible();

  // ---- Gera o orçamento (PDF e planilha).
  await page.goto(`/orcamentos/${id}/revisao`);
  await page.getByRole("button", { name: "Gerar orçamento" }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}$`), { timeout: 90_000 });
  await expect(page.getByText("Gerado", { exact: true })).toBeVisible();

  // Como se tivesse sido gerado há 10 dias (a data do envio não pode ser antes de gerado).
  await admin
    .from("orcamentos")
    .update({ gerado_em: new Date(Date.now() - 10 * 86_400_000).toISOString() })
    .eq("id", id);
  await page.reload();

  // ---- "Marquei como enviado" com a data de 6 dias atrás (futuro não passa).
  await page.getByRole("button", { name: "Marquei como enviado" }).click();
  const data = page.getByLabel("Data do envio");
  await expect(data).toHaveAttribute("max", diaMaceio(0));
  await data.fill(diaMaceio(6));
  await page.getByRole("button", { name: "Confirmar envio" }).click();
  await expect(page.getByText("Enviado", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Enviado em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();

  const { data: o1 } = await admin
    .from("orcamentos")
    .select("status, enviado_em, ultimo_envio_em")
    .eq("id", id)
    .single();
  expect(o1!.status).toBe("enviado");
  expect(o1!.ultimo_envio_em).toBe(o1!.enviado_em);

  // ---- Depois de enviado, a tela de produtos só mostra (sem botões de editar).
  await page.goto(`/orcamentos/${id}/revisao`);
  await expect(
    page.getByText("Orçamento já enviado: os produtos estão só para leitura."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar produto" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Gerar/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar e enviar nova versão" })).toBeVisible();

  // ---- Para hoje: o D+5 venceu ontem (envio há 6 dias).
  await page.goto("/");
  const secao = page.getByRole("region", { name: "Follow-ups de hoje" });
  const cartao = secao.getByRole("listitem").filter({ hasText: NOME });
  await expect(cartao.getByText("Follow-up D+5")).toBeVisible();
  await expect(cartao.getByText("atrasado 1 dia")).toBeVisible();
  await expect(page.getByLabel(/follow-ups vencidos/)).toBeVisible(); // badge na navegação
  const zap = await cartao.getByRole("link", { name: "Abrir WhatsApp" }).getAttribute("href");
  expect(zap).toMatch(/^https:\/\/wa\.me\/5582900009952\?text=/);
  expect(decodeURIComponent(zap!)).toContain(`nº ${orc.data!.numero}`);
  await page.screenshot({ path: "test-results/telas/dia8-4-followups-de-hoje.png" });

  // ---- "Fiz o follow-up": vira D+5 e sai da lista (o D+10 só vence com 10 dias).
  await cartao.getByRole("button", { name: "Fiz o follow-up" }).click();
  await expect(secao.getByRole("listitem").filter({ hasText: NOME })).toHaveCount(0);
  const { data: o2 } = await admin.from("orcamentos").select("status").eq("id", id).single();
  expect(o2!.status).toBe("followup_d5");

  // ---- "Editar e enviar nova versão": mantém as datas, libera a edição e a nova versão recomeça a contagem.
  await page.goto(`/orcamentos/${id}`);
  await page.getByRole("button", { name: "Editar e enviar nova versão" }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}/revisao$`));
  await expect(page.getByRole("heading", { name: "Produtos do orçamento" })).toBeVisible();
  const { data: o3 } = await admin
    .from("orcamentos")
    .select("status, enviado_em, ultimo_envio_em")
    .eq("id", id)
    .single();
  expect(o3!.status).toBe("gerado");
  expect(o3!.enviado_em).toBe(o1!.enviado_em);
  expect(o3!.ultimo_envio_em).toBe(o1!.ultimo_envio_em);

  await page.getByRole("button", { name: "Gerar nova versão do orçamento" }).click();
  await expect(page).toHaveURL(new RegExp(`/orcamentos/${id}$`), { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Orçamento (versão 2)" })).toBeVisible();
  await page.getByRole("button", { name: "Marquei como enviado" }).click();
  await page.getByRole("button", { name: "Confirmar envio" }).click(); // hoje
  await expect(page.getByText("Enviado", { exact: true }).first()).toBeVisible();

  const { data: o4 } = await admin
    .from("orcamentos")
    .select("status, enviado_em, ultimo_envio_em")
    .eq("id", id)
    .single();
  expect(o4!.status).toBe("enviado");
  expect(o4!.enviado_em).toBe(o1!.enviado_em); // o primeiro envio continua o mesmo
  expect(new Date(o4!.ultimo_envio_em!).getTime()).toBeGreaterThan(
    new Date(o1!.ultimo_envio_em!).getTime(),
  );

  // Contagem recomeçou: nada vence hoje.
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Follow-ups de hoje" }).getByText(NOME),
  ).toHaveCount(0);
});
