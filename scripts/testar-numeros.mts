// Isolamento dos números (dia 9) contra o Supabase real: metricas_orcamentos, serie_semanal_orcamentos,
// custo_ia_orcamentos, a view orcamentos_reais e o câmbio.
// Uso: pnpm test:rls (roda por último). Cria dados "NUMEROS RLS" (e um "TESTE NUMEROS RLS") e apaga tudo no fim.
// Os números são comparados por diferença, porque o banco pode ter orçamentos reais.
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hojeMaceioISO, adicionarDiasISO } from "../src/lib/formatar";

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

type Pessoa = { cliente: SupabaseClient; id: string; nome: string };

async function entrar(email: string, nome: string): Promise<Pessoa> {
  const cliente = createClient(url, anonKey, opcoes);
  const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) throw new Error(`Login falhou para ${email}: ${error?.message}`);
  return { cliente, id: data.user.id, nome };
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

const hoje = hojeMaceioISO();
const inicio = adicionarDiasISO(hoje, -2);
const fim = adicionarDiasISO(hoje, 1);

async function limpar() {
  await admin.from("uso_ia").delete().eq("detalhes->>numeros_rls", "true");
  await admin.from("orcamentos").delete().eq("respostas->>numeros_rls", "true");
  await admin.from("clientes").delete().like("nome", "NUMEROS RLS%");
  await admin.from("clientes").delete().like("nome", "TESTE NUMEROS RLS%");
  await admin.from("configuracoes_loja").update({ cambio_usd_brl: 5.5 }).eq("id", true);
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

type Linha = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function metricas(p: Pessoa, vendedora: string | null = null) {
  const r = await p.cliente.rpc("metricas_orcamentos", {
    p_inicio: inicio,
    p_fim: fim,
    p_vendedora: vendedora,
  });
  assert.equal(r.error, null, r.error?.message);
  return r.data as { vendedoras: Linha[]; total: Linha };
}
const linhaDe = (r: { vendedoras: Linha[] }, id: string) =>
  r.vendedoras.find((v) => v.vendedora_id === id);

const aline = await entrar(exigir("SEED_EMAIL_ALINE"), "Aline");
const kely = await entrar(exigir("SEED_EMAIL_KELY"), "Kely");
const gerente = await entrar(exigir("SEED_EMAIL_GERENCIA"), "Gerência");

async function criar(dono: Pessoa, nomeCliente: string, respostas: object, total: number) {
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: dono.id, nome: nomeCliente })
    .select("id")
    .single();
  assert.equal(cli.error, null, cli.error?.message);
  const orc = await admin
    .from("orcamentos")
    .insert({ vendedora_id: dono.id, cliente_id: cli.data!.id, respostas, valor_total: total })
    .select("id")
    .single();
  assert.equal(orc.error, null, orc.error?.message);
  return orc.data!.id as string;
}

console.log("\nIsolamento dos números (banco real)");
await limpar();
try {
  // Linha de base (o banco pode ter orçamentos reais).
  const base = await metricas(gerente);
  const baseA = linhaDe(base, aline.id)!;
  const baseK = linhaDe(base, kely.id)!;
  assert.ok(baseA && baseK, "a gerente deveria ver as duas vendedoras");

  // Aline: 2 criados reais (1 fechado de R$ 900); Kely: 1 criado real; mais 1 da Aline com cliente TESTE.
  const real = { numeros_rls: "true" };
  const a1 = await criar(aline, "NUMEROS RLS A1", real, 1000);
  await criar(aline, "NUMEROS RLS A2", real, 500);
  await criar(kely, "NUMEROS RLS K1", real, 700);
  await criar(aline, "TESTE NUMEROS RLS A3", real, 99999);
  // A1: gerado, enviado e fechado (as datas saem do gatilho; fechado_em = agora).
  for (const [status, extra] of [
    ["gerado", {}],
    ["enviado", {}],
    ["fechado", { valor_fechado: 900 }],
  ] as const) {
    const u = await admin
      .from("orcamentos")
      .update({ status, ...extra })
      .eq("id", a1);
    assert.equal(u.error, null, u.error?.message);
  }

  await caso("a gerente recebe as duas vendedoras e o total", async () => {
    const r = await metricas(gerente);
    assert.equal(r.vendedoras.length, base.vendedoras.length);
    assert.equal(linhaDe(r, aline.id)!.criados - baseA.criados, 2, "Aline: 2 criados reais");
    assert.equal(linhaDe(r, kely.id)!.criados - baseK.criados, 1, "Kely: 1 criado real");
    assert.equal(r.total.criados - base.total.criados, 3);
    assert.equal(Number(linhaDe(r, aline.id)!.valor_vendido) - Number(baseA.valor_vendido), 900);
    assert.equal(linhaDe(r, aline.id)!.fechados - baseA.fechados, 1);
  });

  await caso("o orçamento de cliente TESTE não entra nos números", async () => {
    const r = await metricas(gerente);
    // 4 criados no banco, 3 contados; o valor 99999 não aparece em lugar nenhum.
    assert.equal(r.total.criados - base.total.criados, 3);
    const { data } = await gerente.cliente.from("orcamentos_reais").select("id, valor_total");
    assert.ok(!(data ?? []).some((o) => Number(o.valor_total) === 99999));
  });

  await caso("o seed (respostas.teste = true) fica fora da view", async () => {
    const { data: seed } = await admin
      .from("orcamentos")
      .select("id")
      .eq("respostas->>teste", "true");
    const ids = new Set(
      ((await gerente.cliente.from("orcamentos_reais").select("id")).data ?? []).map((o) => o.id),
    );
    for (const s of seed ?? []) assert.ok(!ids.has(s.id), "orçamento do seed apareceu nos números");
  });

  await caso("Aline recebe só a linha dela, mesmo sem filtrar", async () => {
    const r = await metricas(aline);
    assert.deepEqual(
      r.vendedoras.map((v) => v.vendedora_id),
      [aline.id],
    );
    assert.equal(r.total.criados, linhaDe(r, aline.id)!.criados);
    assert.equal(r.total.criados - baseA.criados, 2);
  });

  await caso("Aline passando o id da Kely não recebe nada da Kely", async () => {
    const r = await metricas(aline, kely.id);
    assert.deepEqual(r.vendedoras, []);
    assert.equal(r.total.criados, 0);
    assert.equal(r.total.enviados, 0);
    assert.equal(Number(r.total.valor_vendido), 0);
  });

  await caso("Kely passando o id da Aline não recebe nada da Aline", async () => {
    const r = await metricas(kely, aline.id);
    assert.deepEqual(r.vendedoras, []);
    assert.equal(r.total.criados, 0);
  });

  await caso("Kely vê só os dela", async () => {
    const r = await metricas(kely);
    assert.deepEqual(
      r.vendedoras.map((v) => v.vendedora_id),
      [kely.id],
    );
    assert.equal(r.total.criados - baseK.criados, 1);
  });

  await caso("a view orcamentos_reais mostra a cada vendedora só os dela", async () => {
    const { data } = await aline.cliente.from("orcamentos_reais").select("vendedora_id");
    assert.ok((data ?? []).every((o) => o.vendedora_id === aline.id));
  });

  await caso("a série semanal respeita a RLS", async () => {
    const dela = await aline.cliente.rpc("serie_semanal_orcamentos", {
      p_fim: hoje,
      p_vendedora: null,
    });
    assert.equal(dela.error, null, dela.error?.message);
    assert.ok((dela.data as Linha[]).every((s) => s.vendedora_id === aline.id));
    assert.equal((dela.data as Linha[]).length, 13);
    const alheia = await aline.cliente.rpc("serie_semanal_orcamentos", {
      p_fim: hoje,
      p_vendedora: kely.id,
    });
    assert.deepEqual(alheia.data, []);
    const todas = await gerente.cliente.rpc("serie_semanal_orcamentos", {
      p_fim: hoje,
      p_vendedora: null,
    });
    assert.equal((todas.data as Linha[]).length, 13 * base.vendedoras.length);
  });

  await caso("sem login, as funções não executam", async () => {
    const anon = createClient(url, anonKey, opcoes);
    for (const [fn, args] of [
      ["metricas_orcamentos", { p_inicio: inicio, p_fim: fim, p_vendedora: null }],
      ["custo_ia_orcamentos", { p_inicio: inicio, p_fim: fim }],
      ["serie_semanal_orcamentos", { p_fim: hoje, p_vendedora: null }],
    ] as const) {
      const r = await anon.rpc(fn, args);
      assert.ok(r.error, `${fn} deveria negar o acesso sem login`);
    }
  });

  await caso(
    "custo de IA: a vendedora não executa; a gerente recebe o total sem os testes",
    async () => {
      for (const p of [aline, kely]) {
        const r = await p.cliente.rpc("custo_ia_orcamentos", { p_inicio: inicio, p_fim: fim });
        assert.ok(r.error, "a vendedora não pode executar custo_ia_orcamentos");
        assert.match(r.error!.message, /SEM_PERMISSAO/);
      }
      const antes = await gerente.cliente.rpc("custo_ia_orcamentos", {
        p_inicio: inicio,
        p_fim: fim,
      });
      assert.equal(antes.error, null, antes.error?.message);
      // Um custo de R$ 0,25 em orçamento real e outro de R$ 7 em orçamento de teste.
      const { data: teste } = await admin
        .from("orcamentos")
        .select("id")
        .eq("respostas->>numeros_rls", "true")
        .eq("valor_total", 99999)
        .single();
      for (const [orc, custo] of [
        [a1, 0.25],
        [teste!.id, 7],
      ] as const) {
        const i = await admin.from("uso_ia").insert({
          orcamento_id: orc,
          vendedora_id: aline.id,
          tipo: "indicacao",
          status: "ok",
          custo_estimado: custo,
          detalhes: { numeros_rls: "true" },
        });
        assert.equal(i.error, null, i.error?.message);
      }
      const depois = await gerente.cliente.rpc("custo_ia_orcamentos", {
        p_inicio: inicio,
        p_fim: fim,
      });
      const delta = Number(depois.data.usd_total) - Number(antes.data.usd_total);
      assert.ok(
        Math.abs(delta - 0.25) < 1e-6,
        `só o custo do orçamento real deveria somar (delta ${delta})`,
      );
    },
  );

  await caso("a vendedora não lê uso_ia nem altera o câmbio; a gerente altera", async () => {
    const lido = await aline.cliente.from("uso_ia").select("id");
    assert.deepEqual(lido.data, []);
    const a = await aline.cliente
      .from("configuracoes_loja")
      .update({ cambio_usd_brl: 9 })
      .eq("id", true)
      .select("cambio_usd_brl");
    assert.deepEqual(a.data, []);
    const g = await gerente.cliente
      .from("configuracoes_loja")
      .update({ cambio_usd_brl: 5.75 })
      .eq("id", true)
      .select("cambio_usd_brl");
    assert.equal(Number(g.data?.[0]?.cambio_usd_brl), 5.75);
    const ruim = await gerente.cliente
      .from("configuracoes_loja")
      .update({ cambio_usd_brl: 0 })
      .eq("id", true);
    assert.ok(ruim.error, "câmbio zero deveria ser recusado");
  });
} finally {
  await limpar();
}

console.log(`\n${ok} verificações dos números passaram${process.exitCode ? ", com FALHAS" : ""}.`);
