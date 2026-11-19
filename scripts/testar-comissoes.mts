// Comissões (dia 11D) contra o Supabase real: só o dono lê e escreve; a vendedora que fecha o
// orçamento gera a comissão sem conseguir lê-la; a gerente também não vê. Uso: pnpm test:rls.
// Cria dados "COM RLS", define percentuais de teste e restaura tudo (percentuais voltam a vazio).
import "./guarda-import.mts";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável ${nome} ausente no .env.test.local`);
  return v;
}
const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const senha = exigir("SEED_SENHA_INICIAL");
const opcoes = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, exigir("SUPABASE_SERVICE_ROLE_KEY"), opcoes);

type Pessoa = { c: SupabaseClient; id: string };
async function entrar(email: string): Promise<Pessoa> {
  const c = createClient(url, anonKey, opcoes);
  const { data, error } = await c.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) throw new Error(`Login falhou para ${email}: ${error?.message}`);
  return { c, id: data.user.id };
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
  await admin.from("orcamentos").delete().eq("respostas->>com_rls", "true");
  await admin.from("clientes").delete().like("nome", "COM RLS%");
  await admin.from("arquitetos").delete().like("nome", "COM RLS%");
  await admin
    .from("configuracoes_comissao")
    .update({
      percentual_arquiteto_padrao: null,
      percentual_vendedora_padrao: null,
      percentual_vendedora_com_arquiteto: null,
    })
    .eq("id", true);
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

const aline = await entrar(exigir("SEED_EMAIL_ALINE"));
const gerente = await entrar(exigir("SEED_EMAIL_GERENCIA"));
const dono = await entrar(exigir("SEED_EMAIL_DONO"));

console.log("\nComissões (banco real)");
await limpar();
try {
  await caso("só o dono tem eh_dono(); a gerência tem eh_gerente(), como o dono", async () => {
    assert.equal((await dono.c.rpc("eh_dono")).data, true);
    assert.equal((await gerente.c.rpc("eh_dono")).data, false);
    assert.equal((await aline.c.rpc("eh_dono")).data, false);
    assert.equal((await dono.c.rpc("eh_gerente")).data, true);
    assert.equal((await gerente.c.rpc("eh_gerente")).data, true);
    assert.equal((await aline.c.rpc("eh_gerente")).data, false);
  });

  await caso(
    "a gerente e a vendedora não leem nem escrevem os percentuais; o dono sim",
    async () => {
      for (const p of [aline, gerente]) {
        const r = await p.c.from("configuracoes_comissao").select("*");
        assert.equal(r.data?.length ?? 0, 0);
        const u = await p.c
          .from("configuracoes_comissao")
          .update({ percentual_arquiteto_padrao: 9 })
          .eq("id", true)
          .select();
        assert.equal(u.data?.length ?? 0, 0);
        for (const t of [
          "comissoes_arquiteto_percentual",
          "comissoes_vendedora_percentual",
          "comissoes",
        ]) {
          assert.equal((await p.c.from(t).select("*")).data?.length ?? 0, 0, t);
        }
      }
      const u = await dono.c
        .from("configuracoes_comissao")
        .update({ percentual_arquiteto_padrao: 5, percentual_vendedora_padrao: 3 })
        .eq("id", true)
        .select();
      assert.equal(u.data?.length, 1);
      const d = await dono.c.from("configuracoes_comissao").select("*").single();
      assert.equal(Number(d.data?.percentual_arquiteto_padrao), 5);
    },
  );

  const arq = await admin
    .from("arquitetos")
    .insert({ nome: "COM RLS Arquiteta" })
    .select("id")
    .single();
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: aline.id, nome: "COM RLS Cliente", arquiteto_id: arq.data!.id })
    .select("id")
    .single();
  const orc = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: aline.id,
      cliente_id: cli.data!.id,
      arquiteto_id: arq.data!.id,
      respostas: { com_rls: "true" },
      valor_total: 1000,
    })
    .select("id")
    .single();
  await admin.from("orcamentos").update({ status: "gerado" }).eq("id", orc.data!.id);

  await caso("a vendedora fecha o orçamento e gera a comissão sem conseguir lê-la", async () => {
    const f = await aline.c.rpc("mudar_status_orcamento", {
      p_orcamento: orc.data!.id,
      p_para: "fechado",
      p_valor_fechado: 1000,
    });
    assert.equal(f.error, null, f.error?.message);
    assert.equal((await aline.c.from("comissoes").select("*")).data?.length ?? 0, 0);
    assert.equal((await gerente.c.from("comissoes").select("*")).data?.length ?? 0, 0);
    const doDono = await dono.c
      .from("comissoes")
      .select("tipo, percentual, valor, base, status")
      .eq("orcamento_id", orc.data!.id)
      .order("tipo");
    assert.deepEqual(
      (doDono.data ?? []).map((l) => [l.tipo, Number(l.percentual), Number(l.valor), l.status]),
      [
        ["arquiteto", 5, 50, "a_pagar"],
        ["vendedora", 3, 30, "a_pagar"],
      ],
    );
  });

  await caso("ninguém além do dono escreve, paga ou recalcula comissão", async () => {
    const id = (
      await dono.c
        .from("comissoes")
        .select("id")
        .eq("orcamento_id", orc.data!.id)
        .eq("tipo", "arquiteto")
        .single()
    ).data!.id;
    for (const p of [aline, gerente]) {
      const i = await p.c.from("comissoes").insert({
        orcamento_id: orc.data!.id,
        tipo: "vendedora",
        beneficiario_id: p.id,
        base: 1,
        percentual: 1,
        valor: 1,
        competencia: "2026-11-01",
      });
      assert.notEqual(i.error, null);
      const u = await p.c.from("comissoes").update({ status: "paga" }).eq("id", id).select();
      assert.equal(u.data?.length ?? 0, 0);
      assert.notEqual((await p.c.rpc("recalcular_comissao", { p_id: id })).error, null);
      assert.notEqual(
        (await p.c.rpc("calcular_fechamentos_anteriores", { p_gravar: false })).error,
        null,
      );
      assert.notEqual(
        (await p.c.rpc("comissao_linhas", { p_orcamento: orc.data!.id })).error,
        null,
      );
    }
    const pago = await dono.c
      .from("comissoes")
      .update({ status: "paga", paga_em: "2026-11-13" })
      .eq("id", id)
      .select();
    assert.equal(pago.data?.length, 1);
  });

  await caso("reabrir cancela a a pagar e preserva a paga para revisão", async () => {
    const r = await aline.c.rpc("mudar_status_orcamento", {
      p_orcamento: orc.data!.id,
      p_para: "enviado",
    });
    assert.equal(r.error, null, r.error?.message);
    const l = await dono.c
      .from("comissoes")
      .select("tipo, status, revisar")
      .eq("orcamento_id", orc.data!.id)
      .order("tipo");
    assert.deepEqual(l.data, [
      { tipo: "arquiteto", status: "paga", revisar: true },
      { tipo: "vendedora", status: "cancelada", revisar: false },
    ]);
  });

  await caso(
    "a Aline não vê comissão em nenhum caminho: embed no orçamento, view, API",
    async () => {
      const r = await aline.c
        .from("orcamentos")
        .select("id, comissoes(id, valor)")
        .eq("id", orc.data!.id);
      const emb = (r.data?.[0] as { comissoes?: unknown[] } | undefined)?.comissoes;
      assert.ok(r.error || !emb || emb.length === 0);
      const v = await aline.c.from("orcamentos_reais").select("*").eq("id", orc.data!.id).single();
      assert.deepEqual(
        Object.keys(v.data ?? {}).filter((k) => /comiss/i.test(k)),
        [],
      );
    },
  );
} finally {
  await limpar();
}
console.log(`\n${ok} verificações das comissões passaram.`);
