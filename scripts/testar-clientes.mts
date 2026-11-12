// Clientes (dia 10D) contra o Supabase real: a vendedora não lê cliente de outra (nem a ficha por URL
// direta), só a dona altera as notas, só a gerência junta duplicados e a fusão fica registrada.
// Uso: pnpm test:rls. Cria dados "CLIENTE RLS" e apaga tudo no fim.
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável ${nome} ausente no .env.local`);
  return valor;
}

const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const senha = exigir("SEED_SENHA_INICIAL");
const opcoes = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, exigir("SUPABASE_SERVICE_ROLE_KEY"), opcoes);

type Pessoa = { cliente: SupabaseClient; id: string };

async function entrar(email: string): Promise<Pessoa> {
  const cliente = createClient(url, anonKey, opcoes);
  const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) throw new Error(`Login falhou para ${email}: ${error?.message}`);
  return { cliente, id: data.user.id };
}

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

async function limpar() {
  await admin.from("orcamentos").delete().eq("respostas->>cliente_rls", "true");
  await admin
    .from("clientes_fusoes")
    .delete()
    .eq("removido->>nome", "CLIENTE RLS Maria Silva Santos");
  await admin.from("clientes").delete().like("nome", "CLIENTE RLS%");
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

const aline = await entrar(exigir("SEED_EMAIL_ALINE"));
const kely = await entrar(exigir("SEED_EMAIL_KELY"));
const gerente = await entrar(exigir("SEED_EMAIL_GERENCIA"));

async function criarCliente(dono: Pessoa, nome: string, zap: string, obs: string | null) {
  const c = await admin
    .from("clientes")
    .insert({ vendedora_id: dono.id, nome, whatsapp: zap, observacoes: obs })
    .select("id")
    .single();
  assert.equal(c.error, null, c.error?.message);
  const o = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: dono.id,
      cliente_id: c.data!.id,
      respostas: { cliente_rls: "true" },
      valor_total: 100,
    })
    .select("id")
    .single();
  assert.equal(o.error, null, o.error?.message);
  return { cliente: c.data!.id as string, orcamento: o.data!.id as string };
}

console.log("\nClientes (banco real)");
await limpar();
try {
  const a1 = await criarCliente(
    aline,
    "CLIENTE RLS Maria Silva",
    "+55 82 97771-0001",
    "prefere fita 3000 K",
  );
  const a2 = await criarCliente(
    aline,
    "CLIENTE RLS Maria Silva Santos",
    "+5582977710001",
    "obra em dezembro",
  );
  const k1 = await criarCliente(kely, "CLIENTE RLS Maria Silva", "+5582977710009", "nota da Kely");

  await caso("a Aline não lê o cliente da Kely, nem a ficha por URL direta", async () => {
    const direto = await aline.cliente.from("clientes").select("id").eq("id", k1.cliente);
    assert.deepEqual(direto.data, []);
    const orcs = await aline.cliente.from("orcamentos").select("id").eq("cliente_id", k1.cliente);
    assert.deepEqual(orcs.data, []);
    const lista = await aline.cliente.rpc("listar_clientes", { p: { q: "CLIENTE RLS" } });
    assert.equal(lista.error, null, lista.error?.message);
    const ids = (lista.data.itens as { id: string }[]).map((i) => i.id);
    assert.ok(ids.includes(a1.cliente) && ids.includes(a2.cliente));
    assert.ok(!ids.includes(k1.cliente), "cliente da Kely vazou para a lista da Aline");
    const outra = await aline.cliente.rpc("listar_clientes", {
      p: { vendedora: kely.id, q: "CLIENTE RLS" },
    });
    assert.equal(outra.data.total, 0);
  });

  await caso("as notas: a dona altera; a Aline não altera as da Kely; a gerência lê", async () => {
    const minha = await aline.cliente
      .from("clientes")
      .update({ observacoes: "prefere fita 3000 K, obra termina em dezembro" })
      .eq("id", a1.cliente)
      .select("id");
    assert.equal(minha.data?.length, 1);
    const alheia = await aline.cliente
      .from("clientes")
      .update({ observacoes: "invadida" })
      .eq("id", k1.cliente)
      .select("id");
    assert.deepEqual(alheia.data, []);
    const { data } = await admin
      .from("clientes")
      .select("observacoes")
      .eq("id", k1.cliente)
      .single();
    assert.equal(data!.observacoes, "nota da Kely");
    const g = await gerente.cliente
      .from("clientes")
      .select("observacoes")
      .eq("id", k1.cliente)
      .single();
    assert.equal(g.data?.observacoes, "nota da Kely");
    const longa = await aline.cliente
      .from("clientes")
      .update({ observacoes: "x".repeat(1001) })
      .eq("id", a1.cliente);
    assert.ok(longa.error, "notas acima de 1.000 caracteres deveriam ser recusadas");
  });

  await caso("duplicados e fusão: a vendedora não vê nem junta; sem login também não", async () => {
    const dup = await aline.cliente.rpc("possiveis_duplicados");
    assert.match(dup.error?.message ?? "", /SEM_PERMISSAO/);
    const jun = await aline.cliente.rpc("juntar_clientes", {
      p_manter: a1.cliente,
      p_remover: a2.cliente,
    });
    assert.match(jun.error?.message ?? "", /SEM_PERMISSAO/);
    const anon = createClient(url, anonKey, opcoes);
    assert.ok((await anon.rpc("listar_clientes", { p: {} })).error);
    assert.ok(
      (await anon.rpc("juntar_clientes", { p_manter: a1.cliente, p_remover: a2.cliente })).error,
    );
    const { count } = await admin
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .in("id", [a1.cliente, a2.cliente]);
    assert.equal(count, 2);
  });

  await caso(
    "a gerência vê o par duplicado, não junta vendedoras diferentes e junta o par da mesma",
    async () => {
      const dup = await gerente.cliente.rpc("possiveis_duplicados");
      assert.equal(dup.error, null, dup.error?.message);
      const pares = dup.data as { a_id: string; b_id: string }[];
      assert.ok(
        pares.some(
          (p) => [p.a_id, p.b_id].sort().join() === [a1.cliente, a2.cliente].sort().join(),
        ),
        "o par da Aline deveria aparecer",
      );
      assert.ok(
        !pares.some(
          (p) =>
            [p.a_id, p.b_id].includes(k1.cliente) &&
            [p.a_id, p.b_id].some((x) => [a1.cliente, a2.cliente].includes(x)),
        ),
        "não deve cruzar vendedoras",
      );
      const cruzado = await gerente.cliente.rpc("juntar_clientes", {
        p_manter: a1.cliente,
        p_remover: k1.cliente,
      });
      assert.match(cruzado.error?.message ?? "", /VENDEDORAS_DIFERENTES/);

      const r = await gerente.cliente.rpc("juntar_clientes", {
        p_manter: a1.cliente,
        p_remover: a2.cliente,
      });
      assert.equal(r.error, null, r.error?.message);
      assert.equal(r.data.movidos, 1);
      const { data: o } = await admin
        .from("orcamentos")
        .select("cliente_id")
        .eq("id", a2.orcamento)
        .single();
      assert.equal(o!.cliente_id, a1.cliente);
      const { data: c } = await admin
        .from("clientes")
        .select("observacoes")
        .eq("id", a1.cliente)
        .single();
      assert.match(c!.observacoes, /obra termina em dezembro/);
      assert.match(c!.observacoes, /obra em dezembro/);
      const { data: apagado } = await admin.from("clientes").select("id").eq("id", a2.cliente);
      assert.deepEqual(apagado, []);
      const reg = await gerente.cliente
        .from("clientes_fusoes")
        .select("orcamentos_movidos, mantido_id")
        .eq("mantido_id", a1.cliente);
      assert.equal(reg.data?.length, 1);
      const dela = await aline.cliente.from("clientes_fusoes").select("id");
      assert.deepEqual(dela.data, []);
    },
  );
} finally {
  await limpar();
}

console.log(`\n${ok} verificações dos clientes passaram${process.exitCode ? ", com FALHAS" : ""}.`);
