// Busca e filtros da lista (dia 10A) contra o Supabase real: a busca da Aline nunca devolve orçamento da
// Kely, nem com o mesmo nome de cliente, o mesmo código de produto, filtro de vendedora ou cursor forjado.
// Uso: pnpm test:rls. Cria dados "BUSCA RLS" e apaga tudo no fim.
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
  await admin.from("orcamentos").delete().eq("respostas->>busca_rls", "true");
  await admin.from("clientes").delete().like("nome", "BUSCA RLS%");
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

type Resultado = {
  total: number;
  itens: { id: string; vendedora_id: string }[];
  proximo: string | null;
};
async function listar(p: Pessoa, filtros: Record<string, unknown>): Promise<Resultado> {
  const r = await p.cliente.rpc("listar_orcamentos", { p: filtros });
  assert.equal(r.error, null, r.error?.message);
  return r.data as Resultado;
}

const aline = await entrar(exigir("SEED_EMAIL_ALINE"));
const kely = await entrar(exigir("SEED_EMAIL_KELY"));
const gerente = await entrar(exigir("SEED_EMAIL_GERENCIA"));

async function criar(dono: Pessoa, whatsapp: string, comItem: boolean) {
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: dono.id, nome: "BUSCA RLS Maria Silva", whatsapp })
    .select("id")
    .single();
  assert.equal(cli.error, null, cli.error?.message);
  const o = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: dono.id,
      cliente_id: cli.data!.id,
      respostas: { busca_rls: "true" },
      valor_total: 777,
    })
    .select("id")
    .single();
  assert.equal(o.error, null, o.error?.message);
  if (comItem) {
    const i = await admin.from("orcamento_itens").insert({
      orcamento_id: o.data!.id,
      codigo: "9520",
      descricao_congelada: "STELLA BUSCA RLS",
      preco_unitario_congelado: 1,
      quantidade: 1,
      ambiente: "Sala",
      avulso: false,
      ordem: 0,
    });
    assert.equal(i.error, null, i.error?.message);
  }
  return o.data!.id as string;
}

console.log("\nBusca e filtros da lista (banco real)");
await limpar();
try {
  const a = await criar(aline, "+5582988877001", false);
  const k = await criar(kely, "+5582988877002", true);

  await caso("a busca da Aline pelo nome repetido devolve só o orçamento dela", async () => {
    const r = await listar(aline, { q: "BUSCA RLS Maria" });
    assert.deepEqual(
      r.itens.map((i) => i.id),
      [a],
    );
    assert.equal(r.total, 1);
  });

  await caso("a busca da Kely pelo mesmo nome devolve só o dela", async () => {
    const r = await listar(kely, { q: "BUSCA RLS Maria" });
    assert.deepEqual(
      r.itens.map((i) => i.id),
      [k],
    );
  });

  await caso("a gerente enxerga os dois", async () => {
    const r = await listar(gerente, { q: "BUSCA RLS Maria" });
    assert.deepEqual(r.itens.map((i) => i.id).sort(), [a, k].sort());
    const so = await listar(gerente, { q: "BUSCA RLS Maria", vendedora: kely.id });
    assert.deepEqual(
      so.itens.map((i) => i.id),
      [k],
    );
  });

  await caso("busca por código/descrição de produto e por WhatsApp parcial não vaza", async () => {
    const porItem = await listar(aline, { q: "STELLA BUSCA RLS" });
    assert.deepEqual(porItem.itens, []); // o item é da Kely
    const porCodigo = await listar(kely, { q: "9520", incluir_teste: true });
    assert.ok(porCodigo.itens.some((i) => i.id === k));
    assert.ok(porCodigo.itens.every((i) => i.vendedora_id === kely.id));
    const porZap = await listar(aline, { q: "9888770" });
    assert.ok(porZap.itens.every((i) => i.vendedora_id === aline.id));
    assert.deepEqual(
      porZap.itens.map((i) => i.id),
      [a],
    );
  });

  await caso("filtro de vendedora e cursor forjado não abrem o orçamento da outra", async () => {
    const outra = await listar(aline, { vendedora: kely.id });
    assert.equal(outra.total, 0);
    assert.deepEqual(outra.itens, []);
    const forjado = await listar(aline, {
      q: "BUSCA RLS",
      cursor: `2999-01-01T00:00:00+00|${k}`,
      ordem: "recentes",
    });
    assert.ok(forjado.itens.every((i) => i.vendedora_id === aline.id));
    const todos = await listar(aline, { limite: 100, ordem: "cliente" });
    assert.ok(todos.itens.every((i) => i.vendedora_id === aline.id));
  });

  await caso("sem login a função não executa", async () => {
    const anon = createClient(url, anonKey, opcoes);
    const r = await anon.rpc("listar_orcamentos", { p: {} });
    assert.ok(r.error, "listar_orcamentos deveria negar o acesso sem login");
  });

  // ---- Renovar validade (dia 10B): só a dona e a gerência; a vendedora não renova o da outra.
  let contadorZap = 0;
  async function vencido(dono: Pessoa) {
    const id = await criar(dono, `+5582977${String(++contadorZap).padStart(6, "0")}`, true);
    const hoje = new Date().toISOString().slice(0, 10);
    const u = await admin
      .from("orcamentos")
      .update({
        status: "enviado",
        pdf_versao: 1,
        pdf_caminho: `${dono.id}/${id}/x-v1.pdf`,
        validade: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10) || hoje,
      })
      .eq("id", id);
    assert.equal(u.error, null, u.error?.message);
    return id;
  }
  const renovar = (
    p: Pessoa,
    id: string,
    dono: Pessoa,
    total: number,
    versao = 2,
    manter = false,
  ) =>
    p.cliente.rpc("renovar_validade", {
      p_orcamento: id,
      p_pdf_caminho: `${dono.id}/${id}/x-v${versao}.pdf`,
      p_xlsx_caminho: `${dono.id}/${id}/x-v${versao}.xlsx`,
      p_versao: versao,
      p_total_esperado: total,
      p_validade: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      p_manter_precos: manter,
    });

  await caso("renovar: a Aline não renova o orçamento da Kely; sem login também não", async () => {
    const dela = await vencido(kely);
    const r = await renovar(aline, dela, kely, 1);
    assert.ok(r.error, "a Aline não pode renovar o orçamento da Kely");
    assert.match(r.error!.message, /SEM_PERMISSAO/);
    const anon = createClient(url, anonKey, opcoes);
    const r2 = await anon.rpc("renovar_validade", {
      p_orcamento: dela,
      p_pdf_caminho: "x",
      p_versao: 2,
      p_total_esperado: 1,
      p_validade: "2030-01-01",
    });
    assert.ok(r2.error, "sem login não renova");
    const { data } = await admin
      .from("orcamentos")
      .select("status, pdf_versao")
      .eq("id", dela)
      .single();
    assert.deepEqual(data, { status: "enviado", pdf_versao: 1 });
  });

  await caso(
    "renovar: a dona renova (preço do catálogo) e a gerente renova o de outra",
    async () => {
      const { data: prod } = await admin
        .from("produtos")
        .select("preco_unitario")
        .eq("codigo", "9520")
        .single();
      const preco = Number(prod!.preco_unitario);
      const minha = await vencido(aline);
      const r = await renovar(aline, minha, aline, preco);
      assert.equal(r.error, null, r.error?.message);
      const { data: o } = await admin
        .from("orcamentos")
        .select("status, pdf_versao, pdf_versoes")
        .eq("id", minha)
        .single();
      assert.equal(o!.status, "gerado");
      assert.equal(o!.pdf_versao, 2);
      assert.equal((o!.pdf_versoes as { renovada?: boolean }[]).at(-1)?.renovada, true);

      const dela = await vencido(kely);
      const g = await renovar(gerente, dela, kely, preco);
      assert.equal(g.error, null, g.error?.message);
      const { data: o2 } = await admin
        .from("orcamentos")
        .select("status, pdf_versao")
        .eq("id", dela)
        .single();
      assert.deepEqual(o2, { status: "gerado", pdf_versao: 2 });
    },
  );

  await caso("renovar: total errado desfaz tudo; fechado não renova", async () => {
    const id = await vencido(aline);
    const r = await renovar(aline, id, aline, 123456);
    assert.ok(r.error);
    assert.match(r.error!.message, /TOTAL_DIVERGENTE/);
    const { data } = await admin
      .from("orcamentos")
      .select("status, pdf_versao")
      .eq("id", id)
      .single();
    assert.deepEqual(data, { status: "enviado", pdf_versao: 1 });
    await admin.from("orcamentos").update({ status: "fechado", valor_fechado: 1 }).eq("id", id);
    const r2 = await renovar(aline, id, aline, 1);
    assert.match(r2.error?.message ?? "", /ORCAMENTO_NAO_RENOVAVEL/);
  });
} finally {
  await limpar();
}

console.log(`\n${ok} verificações da busca passaram${process.exitCode ? ", com FALHAS" : ""}.`);
