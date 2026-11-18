// Importação do estoque (dia 12D) com uma planilha SINTÉTICA e o mapeamento novo do dia 11, contra o
// Supabase real: fabricante, referência e modelo vão para produtos_dados_fornecedor (e só a gerência os
// lê); a descrição de `produtos` sai limpa; uma descrição editada à mão NÃO é sobrescrita pela carga.
// Usa os códigos 99996 a 99998 e apaga tudo no fim. Uso: pnpm test:rls
import "./guarda-import.mts";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { importar } from "../src/lib/estoque/importar";
import { lerPlanilha } from "../src/lib/estoque/lerPlanilha";
import { prepararCarga, sugerirMapeamento } from "../src/lib/estoque/mapeamento";
import { criarRepositorioSupabase } from "../src/lib/estoque/repositorio-supabase";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const opcoes = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opcoes);
const CODIGOS = ["99996", "99997", "99998"];

async function limpar() {
  await admin.from("produtos").delete().in("codigo", CODIGOS);
  await admin.from("sync_estoque").delete().like("origem", "planilha:teste-importacao%");
}

// Colunas prováveis do sistema da loja: nomes diferentes dos do sistema, com acento e vírgula decimal.
const CSV = [
  "Cód.;Descrição do produto;Preço Venda;Fabricante;Ref. Fabricante;Modelo;Grupo;Saldo;Un",
  "99996;MB BLET 6338 EMBUT PT 5W 3.0K;52,00;MB;6338;BLET;SPOT;12;UN",
  "99997;TSI-7324 10W BR 3K ASTRA;60,50;ASTRA;TSI-7324;;EMBUTIDO;3;UN",
  "99998;MT FITA NIT. 22W 3.0K;20,00;NIT;;;FITA LED;100;MTS",
].join("\n");

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

console.log("\nImportação sintética (banco real)");
await limpar();
try {
  const planilha = await lerPlanilha({
    nome: "teste-importacao.csv",
    dados: new TextEncoder().encode(CSV),
  });
  const mapeamento = sugerirMapeamento(planilha.colunas);
  const repo = criarRepositorioSupabase(admin);

  await caso("o mapeamento sugerido reconhece fabricante, referência e modelo", async () => {
    assert.equal(mapeamento.marca, "Fabricante");
    assert.equal(mapeamento.referencia_fabricante, "Ref. Fabricante");
    assert.equal(mapeamento.modelo, "Modelo");
    assert.equal(mapeamento.codigo, "Cód.");
    assert.equal(mapeamento.preco_unitario, "Preço Venda");
  });

  const carga = prepararCarga(planilha.linhas, mapeamento);
  await caso("a carga é lida sem erros (3 produtos)", async () => {
    assert.equal(carga.erros.length, 0, JSON.stringify(carga.erros));
    assert.equal(carga.produtos.length, 3);
  });

  await caso(
    "importar grava a descrição limpa em produtos e o resto em produtos_dados_fornecedor",
    async () => {
      const r = await importar(repo, carga.produtos, {
        origem: "planilha:teste-importacao.csv",
        linhasLidas: carga.linhasLidas,
        erros: carga.erros,
      });
      assert.equal(r.novos, 3);
      const p = await admin
        .from("produtos")
        .select("codigo, descricao, categoria, preco_unitario")
        .in("codigo", CODIGOS)
        .order("codigo");
      assert.deepEqual(
        (p.data ?? []).map((x) => [x.codigo, x.descricao]),
        [
          ["99996", "SPOT EMBUT PT 5W 3.0K"],
          ["99997", "EMBUTIDO 10W BR 3K"],
          ["99998", "MT FITA 22W 3.0K"],
        ],
      );
      const f = await admin
        .from("produtos_dados_fornecedor")
        .select(
          "codigo, fabricante, referencia_fabricante, modelo, descricao_fornecedor, referencias_normalizadas",
        )
        .in("codigo", CODIGOS)
        .order("codigo");
      assert.equal(f.data?.[0].fabricante, "MB");
      assert.equal(f.data?.[0].referencia_fabricante, "6338");
      assert.equal(f.data?.[0].modelo, "BLET");
      assert.equal(f.data?.[0].descricao_fornecedor, "MB BLET 6338 EMBUT PT 5W 3.0K");
      assert.deepEqual(f.data?.[1].referencias_normalizadas, ["TSI7324"]);
      assert.equal(f.data?.[2].fabricante, "NIT");
    },
  );

  await caso("a vendedora não lê nada disso (nem a coluna marca existe em produtos)", async () => {
    const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opcoes);
    await c.auth.signInWithPassword({
      email: process.env.SEED_EMAIL_ALINE!,
      password: process.env.SEED_SENHA_INICIAL!,
    });
    assert.equal(
      (await c.from("produtos_dados_fornecedor").select("*").in("codigo", CODIGOS)).data?.length ??
        0,
      0,
    );
    const prod = await c.from("produtos").select("*").in("codigo", CODIGOS);
    assert.equal(prod.data?.length, 3);
    assert.deepEqual(
      Object.keys(prod.data![0]).filter((k) => /marca|fabric|refer|modelo/i.test(k)),
      [],
    );
    const ref = await c.rpc("buscar_por_referencia", { p_texto: "tsi 7324" });
    assert.deepEqual(ref.data, [{ codigo: "99997", descricao: "EMBUTIDO 10W BR 3K" }]);
  });

  await caso(
    "descrição editada à mão não é sobrescrita por uma nova carga (preço e estoque entram)",
    async () => {
      await admin
        .from("produtos")
        .update({
          descricao: "EMBUTIDO 10W BRANCO 3000 K (gerência)",
          descricao_editada_em: new Date().toISOString(),
        })
        .eq("codigo", "99997");
      const nova = CSV.replace("60,50", "65,00")
        .replace("TSI-7324 10W BR 3K ASTRA", "TSI-7324 10W BR 3K ASTRA NOVO")
        .replace(";3;UN", ";9;UN");
      const pl = await lerPlanilha({
        nome: "teste-importacao.csv",
        dados: new TextEncoder().encode(nova),
      });
      const c2 = prepararCarga(pl.linhas, sugerirMapeamento(pl.colunas));
      await importar(repo, c2.produtos, {
        origem: "planilha:teste-importacao.csv",
        linhasLidas: c2.linhasLidas,
        erros: c2.erros,
      });
      const p = await admin
        .from("produtos")
        .select("descricao, preco_unitario, estoque_disponivel")
        .eq("codigo", "99997")
        .single();
      assert.equal(p.data?.descricao, "EMBUTIDO 10W BRANCO 3000 K (gerência)");
      assert.equal(Number(p.data?.preco_unitario), 65);
      assert.equal(Number(p.data?.estoque_disponivel), 9);
      // o cadastro do fornecedor continua sendo atualizado (texto original novo)
      const f = await admin
        .from("produtos_dados_fornecedor")
        .select("descricao_fornecedor")
        .eq("codigo", "99997")
        .single();
      assert.match(f.data!.descricao_fornecedor!, /NOVO/);
      // a que não foi editada segue a carga
      const outra = await admin.from("produtos").select("descricao").eq("codigo", "99996").single();
      assert.equal(outra.data?.descricao, "SPOT EMBUT PT 5W 3.0K");
    },
  );
} finally {
  await limpar();
}
console.log(`\n${ok} verificações da importação passaram.`);
