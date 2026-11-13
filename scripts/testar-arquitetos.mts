// Arquitetos (dia 11B) contra o Supabase real: todos leem e criam; só a gerência edita, desativa e
// junta; os números da vendedora nunca incluem orçamento da outra; a foto não sai sem URL assinada.
// Uso: pnpm test:rls. Cria dados "ARQ RLS" e apaga tudo no fim.
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
  await admin.from("orcamentos").delete().eq("respostas->>arq_rls", "true");
  await admin.from("clientes").delete().like("nome", "ARQ RLS%");
  const { data: arqs } = await admin.from("arquitetos").select("id, foto_path").like("nome", "ARQ RLS%");
  const fotos = (arqs ?? []).map((a) => a.foto_path).filter((f): f is string => Boolean(f));
  if (fotos.length) await admin.storage.from("arquitetos").remove(fotos);
  const ids = (arqs ?? []).map((a) => a.id);
  if (ids.length) {
    await admin.from("eventos_arquiteto").delete().in("arquiteto_id", ids);
    await admin.from("arquitetos").delete().in("id", ids);
  }
  const { data: numeros } = await admin.from("orcamentos").select("numero").like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

const aline = await entrar(exigir("SEED_EMAIL_ALINE"));
const kely = await entrar(exigir("SEED_EMAIL_KELY"));
const gerente = await entrar(exigir("SEED_EMAIL_GERENCIA"));

console.log("\nArquitetos (banco real)");
await limpar();

try {
  // Aline cria; a Kely cria o "duplicado".
  const a1 = await aline.cliente
    .from("arquitetos")
    .insert({ nome: "ARQ RLS Lula Santana", criado_por: aline.id })
    .select("id")
    .single();
  const a2 = await kely.cliente
    .from("arquitetos")
    .insert({ nome: "ARQ RLS Lula  Santana ", criado_por: kely.id, aniversario_dia: 29, aniversario_mes: 2 })
    .select("id")
    .single();

  await caso("a vendedora cria arquiteto em nome próprio", async () => {
    assert.equal(a1.error, null, a1.error?.message);
    assert.equal(a2.error, null, a2.error?.message);
  });

  await caso("a vendedora não cria arquiteto em nome de outra pessoa", async () => {
    const r = await aline.cliente
      .from("arquitetos")
      .insert({ nome: "ARQ RLS Falso", criado_por: kely.id });
    assert.notEqual(r.error, null);
  });

  await caso("todos leem os arquitetos ativos (as duas vendedoras atendem os mesmos)", async () => {
    const doAline = await aline.cliente.from("arquitetos").select("id").eq("id", a2.data!.id);
    const daKely = await kely.cliente.from("arquitetos").select("id").eq("id", a1.data!.id);
    assert.equal(doAline.data?.length, 1);
    assert.equal(daKely.data?.length, 1);
  });

  await caso("sem login não lê nada", async () => {
    const anon = createClient(url, anonKey, opcoes);
    const r = await anon.from("arquitetos").select("id").eq("id", a1.data!.id);
    assert.ok(r.error || (r.data ?? []).length === 0);
  });

  await caso("a vendedora não edita nem apaga (nem o que ela criou)", async () => {
    const e = await aline.cliente
      .from("arquitetos")
      .update({ escritorio: "Trocado" })
      .eq("id", a1.data!.id)
      .select("id");
    assert.equal(e.data?.length ?? 0, 0);
    const d = await aline.cliente.from("arquitetos").delete().eq("id", a1.data!.id).select("id");
    assert.equal(d.data?.length ?? 0, 0);
    const desativar = await aline.cliente
      .from("arquitetos")
      .update({ ativo: false })
      .eq("id", a1.data!.id)
      .select("id");
    assert.equal(desativar.data?.length ?? 0, 0);
  });

  // Orçamentos do mesmo arquiteto: um da Aline e um da Kely, com o MESMO nome de cliente.
  async function orcamento(dono: Pessoa, valor: number) {
    const c = await admin
      .from("clientes")
      .insert({ vendedora_id: dono.id, nome: "ARQ RLS Cliente Igual", arquiteto_id: a1.data!.id })
      .select("id")
      .single();
    assert.equal(c.error, null, c.error?.message);
    const o = await admin
      .from("orcamentos")
      .insert({
        vendedora_id: dono.id,
        cliente_id: c.data!.id,
        arquiteto_id: a1.data!.id,
        respostas: { arq_rls: "true" },
        valor_total: valor,
      })
      .select("id")
      .single();
    assert.equal(o.error, null, o.error?.message);
    await admin
      .from("orcamentos")
      .update({ status: "fechado", valor_fechado: valor, fechado_em: new Date().toISOString() })
      .eq("id", o.data!.id);
    return o.data!.id as string;
  }
  const oAline = await orcamento(aline, 1111);
  const oKely = await orcamento(kely, 2222);

  type Linha = { id: string; indicados: number; fechados: number; vendido: number };
  const numeros = async (p: Pessoa) => {
    const r = await p.cliente.rpc("listar_arquitetos", { p: { q: "ARQ RLS Lula" } });
    assert.equal(r.error, null, r.error?.message);
    return (r.data as Linha[]).find((x) => x.id === a1.data!.id)!;
  };

  await caso("os números do arquiteto para a Aline não incluem orçamento da Kely", async () => {
    const n = await numeros(aline);
    assert.equal(Number(n.indicados), 1);
    assert.equal(Number(n.vendido), 1111);
    const k = await numeros(kely);
    assert.equal(Number(k.vendido), 2222);
  });

  await caso("a lista de orçamentos da Aline filtrada pelo arquiteto nunca traz o da Kely", async () => {
    const r = await aline.cliente.rpc("listar_orcamentos", {
      p: { arquiteto_id: a1.data!.id, incluir_teste: true, limite: 50, status: [] },
    });
    assert.equal(r.error, null, r.error?.message);
    const ids = (r.data as { itens: { id: string }[] }).itens.map((i) => i.id);
    assert.ok(ids.includes(oAline));
    assert.ok(!ids.includes(oKely));
  });

  await caso("a gerência soma os números dos dois", async () => {
    const n = await numeros(gerente);
    assert.equal(Number(n.indicados), 2);
    assert.equal(Number(n.vendido), 3333);
  });

  await caso("a vendedora não junta arquitetos e não lê o histórico de fusões", async () => {
    const r = await aline.cliente.rpc("juntar_arquitetos", {
      p_manter: a1.data!.id,
      p_remover: a2.data!.id,
    });
    assert.notEqual(r.error, null);
    const ev = await aline.cliente.from("eventos_arquiteto").select("id");
    assert.equal(ev.data?.length ?? 0, 0);
  });

  await caso("foto: o bucket é privado, a vendedora não baixa nem lista sem URL assinada", async () => {
    const caminho = `${a1.data!.id}/teste-rls.jpg`;
    const up = await admin.storage
      .from("arquitetos")
      .upload(caminho, new Blob(["x"], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    assert.equal(up.error, null, up.error?.message);
    await admin.from("arquitetos").update({ foto_path: caminho }).eq("id", a1.data!.id);
    const baixar = await aline.cliente.storage.from("arquitetos").download(caminho);
    assert.notEqual(baixar.error, null);
    const listar = await aline.cliente.storage.from("arquitetos").list(a1.data!.id);
    assert.equal(listar.data?.length ?? 0, 0);
    const assinar = await aline.cliente.storage.from("arquitetos").createSignedUrl(caminho, 60);
    assert.notEqual(assinar.error, null);
    const publico = await fetch(`${url}/storage/v1/object/public/arquitetos/${caminho}`);
    assert.notEqual(publico.status, 200);
  });

  await caso("a gerência edita, desativa e junta; a fusão move os orçamentos e fica registrada", async () => {
    const e = await gerente.cliente
      .from("arquitetos")
      .update({ escritorio: "Estúdio RLS" })
      .eq("id", a1.data!.id)
      .select("id");
    assert.equal(e.data?.length, 1);
    const j = await gerente.cliente.rpc("juntar_arquitetos", {
      p_manter: a1.data!.id,
      p_remover: a2.data!.id,
    });
    assert.equal(j.error, null, j.error?.message);
    const sumiu = await admin.from("arquitetos").select("id").eq("id", a2.data!.id);
    assert.equal(sumiu.data?.length, 0);
    const mantido = await admin
      .from("arquitetos")
      .select("aniversario_dia, aniversario_mes")
      .eq("id", a1.data!.id)
      .single();
    assert.deepEqual(mantido.data, { aniversario_dia: 29, aniversario_mes: 2 }); // veio do removido
    const ev = await gerente.cliente.from("eventos_arquiteto").select("tipo").eq("arquiteto_id", a1.data!.id);
    assert.equal(ev.data?.[0]?.tipo, "juntou");
  });
} finally {
  await limpar();
}

console.log(`\n${ok} verificações dos arquitetos passaram.`);
