// Teste de integração da RLS contra o Supabase real (precisa de migrations + usuários + seed).
// Uso: pnpm test:rls   (lê .env.local)
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável ${nome} ausente no .env.local`);
  return valor;
}

const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const anon = exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const senha = exigir("SEED_SENHA_INICIAL");
const opcoes = { auth: { autoRefreshToken: false, persistSession: false } };

const admin = createClient(url, exigir("SUPABASE_SERVICE_ROLE_KEY"), opcoes);

async function entrar(email: string) {
  const cliente = createClient(url, anon, opcoes);
  const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) throw new Error(`Login falhou para ${email}: ${error?.message}`);
  return { cliente, id: data.user.id };
}

type Pessoa = { cliente: SupabaseClient; id: string };

let ok = 0;
async function caso(nome: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok++;
    console.log(`  ok  ${nome}`);
  } catch (e) {
    console.error(`  FALHOU  ${nome}\n    ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

async function orcamentosTeste(p: Pessoa) {
  const { data, error } = await p.cliente
    .from("orcamentos")
    .select("id, vendedora_id")
    .eq("respostas->>teste", "true");
  assert.equal(error, null, error?.message);
  return data ?? [];
}

async function testarVendedora(nome: string, eu: Pessoa, outra: Pessoa) {
  console.log(`\n${nome}`);
  const meus = await orcamentosTeste(eu);

  const { data: doOutro } = await admin
    .from("orcamentos")
    .select("id, valor_total, motivo_perda")
    .eq("vendedora_id", outra.id)
    .eq("respostas->>teste", "true");
  assert.ok(doOutro && doOutro.length >= 1, "seed da outra vendedora ausente");
  const alvo = doOutro[0];

  await caso("vê só os 2 orçamentos de teste dela", async () => {
    assert.equal(meus.length, 2);
    assert.ok(meus.every((o) => o.vendedora_id === eu.id));
  });

  await caso("nenhum orçamento de outra vendedora aparece em nenhuma consulta", async () => {
    const { data, error } = await eu.cliente.from("orcamentos").select("id, vendedora_id");
    assert.equal(error, null);
    assert.ok((data ?? []).every((o) => o.vendedora_id === eu.id));
  });

  await caso("buscar orçamento da outra pelo id retorna vazio", async () => {
    const { data, error } = await eu.cliente.from("orcamentos").select("*").eq("id", alvo.id);
    assert.equal(error, null);
    assert.deepEqual(data, []);
  });

  await caso("não atualiza orçamento da outra", async () => {
    const { data } = await eu.cliente
      .from("orcamentos")
      .update({ valor_total: 1 })
      .eq("id", alvo.id)
      .select();
    assert.deepEqual(data, []);
    const { data: depois } = await admin.from("orcamentos").select("valor_total").eq("id", alvo.id);
    assert.equal(Number(depois?.[0]?.valor_total), Number(alvo.valor_total));
  });

  await caso("não apaga orçamento da outra", async () => {
    const { data } = await eu.cliente.from("orcamentos").delete().eq("id", alvo.id).select();
    assert.deepEqual(data, []);
    const { data: depois } = await admin.from("orcamentos").select("id").eq("id", alvo.id);
    assert.equal(depois?.length, 1);
  });

  await caso("não passa orçamento próprio para outra (vendedora_id)", async () => {
    const { data } = await eu.cliente
      .from("orcamentos")
      .update({ vendedora_id: outra.id })
      .eq("id", meus[0].id)
      .select();
    assert.ok(!data || data.length === 0);
    const { data: depois } = await admin
      .from("orcamentos")
      .select("vendedora_id")
      .eq("id", meus[0].id);
    assert.equal(depois?.[0]?.vendedora_id, eu.id);
  });

  await caso("não cria orçamento em nome da outra", async () => {
    const { data: cli } = await admin
      .from("clientes")
      .select("id")
      .eq("vendedora_id", outra.id)
      .limit(1);
    const { error } = await eu.cliente
      .from("orcamentos")
      .insert({ vendedora_id: outra.id, cliente_id: cli![0].id });
    assert.ok(error, "inserção deveria ser negada");
  });

  await caso("não lê itens, anexos e eventos da outra", async () => {
    for (const tabela of ["orcamento_itens", "anexos", "eventos"]) {
      const { data } = await eu.cliente.from(tabela).select("*").eq("orcamento_id", alvo.id);
      assert.deepEqual(data, [], tabela);
    }
  });

  await caso("não lê clientes da outra", async () => {
    const { data } = await eu.cliente.from("clientes").select("id").eq("vendedora_id", outra.id);
    assert.deepEqual(data, []);
  });

  await caso("não lê uso_ia nem sync_estoque", async () => {
    for (const tabela of ["uso_ia", "sync_estoque"]) {
      const { data, error } = await eu.cliente.from(tabela).select("*");
      assert.ok(error || (data ?? []).length === 0, tabela);
    }
  });

  await caso("não grava em uso_ia, sync_estoque nem produtos", async () => {
    const r1 = await eu.cliente.from("uso_ia").insert({ tokens_entrada: 1 });
    const r2 = await eu.cliente.from("sync_estoque").insert({ origem: "teste" });
    const r3 = await eu.cliente
      .from("produtos")
      .insert({ codigo: "99999", descricao: "x", preco_unitario: 1 });
    assert.ok(r1.error && r2.error && r3.error);
  });

  await caso("lê só a própria linha de usuarios e não muda o próprio perfil", async () => {
    const { data } = await eu.cliente.from("usuarios").select("id");
    assert.deepEqual(
      data?.map((u) => u.id),
      [eu.id],
    );
    await eu.cliente.from("usuarios").update({ perfil: "gerente" }).eq("id", eu.id);
    const { data: depois } = await admin.from("usuarios").select("perfil").eq("id", eu.id);
    assert.equal(depois?.[0]?.perfil, "vendedora");
  });

  await caso("lê produtos (catálogo é aberto a logados)", async () => {
    const { error } = await eu.cliente.from("produtos").select("codigo").limit(1);
    assert.equal(error, null);
  });
}

async function testarGerencia(g: Pessoa, aline: Pessoa, kely: Pessoa) {
  console.log("\nGerência");
  await caso("vê os 4 orçamentos de teste (2 de cada vendedora)", async () => {
    const todos = await orcamentosTeste(g);
    assert.equal(todos.length, 4);
    assert.equal(todos.filter((o) => o.vendedora_id === aline.id).length, 2);
    assert.equal(todos.filter((o) => o.vendedora_id === kely.id).length, 2);
  });

  await caso("lê uso_ia, sync_estoque e todos os usuarios", async () => {
    for (const tabela of ["uso_ia", "sync_estoque"]) {
      const { error } = await g.cliente.from(tabela).select("*");
      assert.equal(error, null, tabela);
    }
    const { data } = await g.cliente.from("usuarios").select("id");
    assert.ok((data ?? []).length >= 3);
  });

  await caso("não cria orçamento em nome de outra", async () => {
    const { data: cli } = await admin
      .from("clientes")
      .select("id")
      .eq("vendedora_id", aline.id)
      .limit(1);
    const { error } = await g.cliente
      .from("orcamentos")
      .insert({ vendedora_id: aline.id, cliente_id: cli![0].id });
    assert.ok(error);
  });

  await caso("reatribui orçamento e desfaz", async () => {
    const [o] = (await orcamentosTeste(g)).filter((x) => x.vendedora_id === aline.id);
    const troca = await g.cliente
      .from("orcamentos")
      .update({ vendedora_id: kely.id })
      .eq("id", o.id)
      .select();
    assert.equal(troca.data?.length, 1);
    const volta = await admin
      .from("orcamentos")
      .update({ vendedora_id: aline.id })
      .eq("id", o.id)
      .select();
    assert.equal(volta.data?.length, 1);
  });
}

async function anonimo() {
  console.log("\nSem login");
  await caso("não lê nada", async () => {
    const cliente = createClient(url, anon, opcoes);
    for (const tabela of ["orcamentos", "clientes", "produtos", "usuarios"]) {
      const { data, error } = await cliente.from(tabela).select("*");
      assert.ok(error || (data ?? []).length === 0, tabela);
    }
  });
}

const aline = await entrar(exigir("SEED_EMAIL_ALINE"));
const kely = await entrar(exigir("SEED_EMAIL_KELY"));
const gerencia = await entrar(exigir("SEED_EMAIL_GERENCIA"));

await testarVendedora("Aline (contra Kely)", aline, kely);
await testarVendedora("Kely (contra Aline)", kely, aline);
await testarGerencia(gerencia, aline, kely);
await anonimo();

console.log(`\n${ok} verificações passaram${process.exitCode ? ", com FALHAS" : ""}.`);
