// Catálogo protegido (dia 11C) contra o Supabase real: a vendedora não lê produtos_dados_fornecedor
// por nenhum caminho (tabela, API de produtos, busca, exportação), a busca por referência é exata e
// não devolve a referência; a gerência lê. Uso: pnpm test:rls
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável ${nome} ausente no .env.local`);
  return v;
}
const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const senha = exigir("SEED_SENHA_INICIAL");
const opcoes = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, exigir("SUPABASE_SERVICE_ROLE_KEY"), opcoes);

async function entrar(email: string): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, opcoes);
  const { error } = await c.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(`Login falhou para ${email}: ${error.message}`);
  return c;
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

const aline = await entrar(exigir("SEED_EMAIL_ALINE"));
const gerente = await entrar(exigir("SEED_EMAIL_GERENCIA"));
const CODIGO = "99991";
const REF = "TST-99991/AB";

console.log("\nCatálogo protegido (banco real)");
await admin.from("produtos").delete().eq("codigo", CODIGO);
try {
  await admin.from("produtos").insert({
    codigo: CODIGO,
    categoria: "SPOT",
    descricao: "SPOT TESTE RLS 5W",
    preco_unitario: 10,
  });
  await admin.from("produtos_dados_fornecedor").insert({
    codigo: CODIGO,
    fabricante: "FABRICANTE RLS",
    referencia_fabricante: REF,
    modelo: "MODELO RLS",
    descricao_fornecedor: "FABRICANTE RLS MODELO RLS TST-99991/AB SPOT",
  });

  await caso("a vendedora não lê a tabela do fornecedor", async () => {
    const r = await aline.from("produtos_dados_fornecedor").select("*");
    assert.equal(r.data?.length ?? 0, 0);
    const um = await aline.from("produtos_dados_fornecedor").select("*").eq("codigo", CODIGO);
    assert.equal(um.data?.length ?? 0, 0);
  });
  await caso("a vendedora não escreve nem apaga na tabela do fornecedor", async () => {
    const i = await aline
      .from("produtos_dados_fornecedor")
      .insert({ codigo: CODIGO, fabricante: "X" });
    assert.notEqual(i.error, null);
    const u = await aline
      .from("produtos_dados_fornecedor")
      .update({ fabricante: "X" })
      .eq("codigo", CODIGO)
      .select();
    assert.equal(u.data?.length ?? 0, 0);
    const d = await aline.from("produtos_dados_fornecedor").delete().eq("codigo", CODIGO).select();
    assert.equal(d.data?.length ?? 0, 0);
  });
  await caso("a coluna marca não existe em produtos (API da vendedora)", async () => {
    const r = await aline.from("produtos").select("marca").limit(1);
    assert.notEqual(r.error, null);
    const p = await aline.from("produtos").select("*").eq("codigo", CODIGO).single();
    assert.deepEqual(
      Object.keys(p.data!).filter((k) => /marca|fabric|refer|modelo/i.test(k)),
      [],
    );
  });
  await caso(
    "embutir produtos_dados_fornecedor a partir de produtos não devolve nada à vendedora",
    async () => {
      const r = await aline
        .from("produtos")
        .select("codigo, produtos_dados_fornecedor(fabricante, referencia_fabricante)")
        .eq("codigo", CODIGO);
      const emb = (r.data?.[0] as { produtos_dados_fornecedor?: unknown } | undefined)
        ?.produtos_dados_fornecedor;
      assert.ok(!emb || (Array.isArray(emb) && emb.length === 0) || r.error, "não pode vazar");
    },
  );
  await caso(
    "buscar_produtos: a vendedora não acha por fabricante, referência ou modelo e não recebe marca",
    async () => {
      for (const t of ["FABRICANTE RLS", "TST-99991", "MODELO RLS"]) {
        const r = await aline.rpc("buscar_produtos", { p_texto: t, p_limite: 20 });
        assert.equal(r.error, null, r.error?.message);
        assert.ok(!(r.data as { codigo: string }[]).some((p) => p.codigo === CODIGO), t);
      }
      const ok1 = await aline.rpc("buscar_produtos", { p_texto: "teste rls 5w", p_limite: 5 });
      const achou = (ok1.data as { codigo: string; marca: string | null }[]).find(
        (p) => p.codigo === CODIGO,
      );
      assert.ok(achou);
      assert.equal(achou.marca, null);
    },
  );
  await caso(
    "buscar_por_referencia: só código e descrição, exata, sem parte da referência",
    async () => {
      const r = await aline.rpc("buscar_por_referencia", { p_texto: "tst 99991 ab" });
      assert.equal(r.error, null, r.error?.message);
      assert.deepEqual(r.data, [{ codigo: CODIGO, descricao: "SPOT TESTE RLS 5W" }]);
      const parte = await aline.rpc("buscar_por_referencia", { p_texto: "TST-9999" });
      assert.deepEqual(parte.data, []);
      assert.ok(!JSON.stringify(r.data).match(/TST|FABRICANTE|MODELO/));
    },
  );
  await caso("sem login não executa buscar_por_referencia", async () => {
    const anon = createClient(url, anonKey, opcoes);
    const r = await anon.rpc("buscar_por_referencia", { p_texto: REF });
    assert.notEqual(r.error, null);
  });
  await caso("a gerência lê e busca por fabricante e referência", async () => {
    const t = await gerente
      .from("produtos_dados_fornecedor")
      .select("fabricante, referencia_fabricante")
      .eq("codigo", CODIGO)
      .single();
    assert.equal(t.data?.fabricante, "FABRICANTE RLS");
    const b = await gerente.rpc("buscar_produtos", { p_texto: "TST-99991", p_limite: 5 });
    assert.ok(
      (b.data as { codigo: string; marca: string }[]).some(
        (p) => p.codigo === CODIGO && p.marca === "FABRICANTE RLS",
      ),
    );
  });
} finally {
  await admin.from("produtos").delete().eq("codigo", CODIGO);
}
console.log(`\n${ok} verificações do catálogo passaram.`);
