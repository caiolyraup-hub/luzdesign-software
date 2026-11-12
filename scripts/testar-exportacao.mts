// Exportação em planilha (dia 10C) contra o Supabase real: a planilha da Aline nunca contém dado da
// Kely, a vendedora não recebe a aba Eventos, os de teste ficam fora por padrão e entram com a opção, e
// a auditoria (eventos_exportacao) só é lida pelo dono (e pela gerência) e só o servidor grava.
// Uso: pnpm test:rls. Cria dados "EXPORT RLS" e apaga tudo no fim.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { carregarFonteExportacao } from "../src/lib/exportacao/fonte-supabase";
import { escreverExportacao } from "../src/lib/exportacao/planilha";
import { lerFiltrosLista } from "../src/lib/orcamento/filtros-lista";

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

type Pessoa = { cliente: SupabaseClient; id: string; nome: string; gerente: boolean };

async function entrar(email: string, nome: string, gerente = false): Promise<Pessoa> {
  const cliente = createClient(url, anonKey, opcoes);
  const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) throw new Error(`Login falhou para ${email}: ${error?.message}`);
  return { cliente, id: data.user.id, nome, gerente };
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
  await admin.from("eventos_exportacao").delete().eq("detalhes->>export_rls", "true");
  await admin.from("orcamentos").delete().eq("respostas->>export_rls", "true");
  await admin.from("clientes").delete().like("nome", "EXPORT RLS%");
  await admin.from("clientes").delete().like("nome", "TESTE EXPORT RLS%");
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

/** Exporta como `p` (sessão dele, RLS) e devolve a planilha lida. */
async function exportar(p: Pessoa, params: Record<string, string>, incluirTeste = false) {
  const filtros = lerFiltrosLista({ filtro: "todos", ...params }, { gerente: p.gerente });
  const fonte = await carregarFonteExportacao(p.cliente, filtros, { incluirTeste });
  const saida = new PassThrough();
  const partes: Buffer[] = [];
  saida.on("data", (x: Buffer) => partes.push(x));
  const fim = new Promise<void>((resolve, erro) => {
    saida.on("end", resolve);
    saida.on("error", erro);
  });
  await escreverExportacao(fonte, saida, {
    exportadoPor: p.nome,
    exportadoEm: new Date(),
    filtros: [],
    incluiuTeste: incluirTeste,
    gerencia: p.gerente,
  });
  await fim;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(partes) as unknown as ExcelJS.Buffer);
  return wb;
}

const coluna = (wb: ExcelJS.Workbook, aba: string, col: number) => {
  const valores: string[] = [];
  wb.getWorksheet(aba)?.eachRow((r, n) => {
    if (n > 1) valores.push(String(r.getCell(col).value ?? ""));
  });
  return valores;
};

const aline = await entrar(exigir("SEED_EMAIL_ALINE"), "Aline");
const kely = await entrar(exigir("SEED_EMAIL_KELY"), "Kely");
const gerente = await entrar(exigir("SEED_EMAIL_GERENCIA"), "Gerência", true);

async function criar(dono: Pessoa, nomeCliente: string, zap: string) {
  const cli = await admin
    .from("clientes")
    .insert({ vendedora_id: dono.id, nome: nomeCliente, whatsapp: zap })
    .select("id")
    .single();
  assert.equal(cli.error, null, cli.error?.message);
  const o = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: dono.id,
      cliente_id: cli.data!.id,
      respostas: { export_rls: "true" },
      valor_total: 321,
    })
    .select("id, numero")
    .single();
  assert.equal(o.error, null, o.error?.message);
  const i = await admin.from("orcamento_itens").insert({
    orcamento_id: o.data!.id,
    codigo: null,
    descricao_congelada: `Item avulso EXPORT RLS ${dono.nome}`,
    preco_unitario_congelado: 321,
    quantidade: 1,
    ambiente: "Sala",
    avulso: true,
    ordem: 0,
  });
  assert.equal(i.error, null, i.error?.message);
  return { id: o.data!.id as string, numero: o.data!.numero as string };
}

console.log("\nExportação em planilha (banco real)");
await limpar();
try {
  const a = await criar(aline, "EXPORT RLS Maria Silva", "+5582977700001");
  const k = await criar(kely, "EXPORT RLS Maria Silva", "+5582977700002");
  const t = await criar(aline, "TESTE EXPORT RLS Zé", "+5582977700003");

  await caso(
    "a planilha da Aline tem só os dados da Aline (mesmo nome de cliente da Kely)",
    async () => {
      const wb = await exportar(aline, { q: "EXPORT RLS" });
      const numeros = coluna(wb, "Orçamentos", 1);
      assert.ok(numeros.includes(a.numero), "falta o orçamento da Aline");
      assert.ok(!numeros.includes(k.numero), "o orçamento da Kely vazou para a planilha da Aline");
      const itens = coluna(wb, "Itens", 4).join("|");
      assert.ok(itens.includes("EXPORT RLS Aline"));
      assert.ok(!itens.includes("EXPORT RLS Kely"), "item da Kely vazou");
      assert.ok(
        coluna(wb, "Orçamentos", 2).every((v) => v === "Aline"),
        "outra vendedora na planilha",
      );
      assert.ok(!coluna(wb, "Clientes", 2).includes("+5582977700002"), "cliente da Kely vazou");
    },
  );

  await caso("a vendedora não recebe a aba Eventos; a gerência recebe", async () => {
    const dela = await exportar(aline, { q: "EXPORT RLS" });
    assert.ok(!dela.getWorksheet("Eventos"), "a aba Eventos não deveria existir para a vendedora");
    const todos = await exportar(gerente, { q: "EXPORT RLS" });
    assert.ok(todos.getWorksheet("Eventos"), "a gerência deveria receber a aba Eventos");
    const numeros = coluna(todos, "Orçamentos", 1);
    assert.ok(numeros.includes(a.numero) && numeros.includes(k.numero), "a gerência vê as duas");
    assert.ok(coluna(todos, "Eventos", 1).includes(a.numero), "eventos do orçamento da Aline");
  });

  await caso("orçamento de teste fica fora por padrão e entra com a opção", async () => {
    const sem = await exportar(aline, { q: "EXPORT RLS" });
    assert.ok(!coluna(sem, "Orçamentos", 1).includes(t.numero), "o de teste não deveria entrar");
    const com = await exportar(aline, { q: "EXPORT RLS" }, true);
    assert.ok(
      coluna(com, "Orçamentos", 1).includes(t.numero),
      "o de teste deveria entrar com a opção",
    );
  });

  await caso("filtro de vendedora da gerência e a vendedora pedindo a outra", async () => {
    const soKely = await exportar(gerente, { q: "EXPORT RLS", vendedora: kely.id });
    assert.deepEqual(coluna(soKely, "Orçamentos", 1), [k.numero]);
    // A vendedora não usa o filtro de vendedora (ignorado), e a RLS impede o resto.
    const dela = await exportar(aline, { q: "EXPORT RLS", vendedora: kely.id });
    assert.ok(!coluna(dela, "Orçamentos", 1).includes(k.numero));
  });

  await caso(
    "auditoria: só o servidor grava; a vendedora lê só as próprias; a gerência lê tudo",
    async () => {
      const tentativa = await aline.cliente
        .from("eventos_exportacao")
        .insert({ usuario_id: aline.id, linhas: 1 });
      assert.ok(tentativa.error, "a vendedora não pode gravar na auditoria");
      for (const p of [aline, kely]) {
        const r = await admin
          .from("eventos_exportacao")
          .insert({ usuario_id: p.id, linhas: 2, detalhes: { export_rls: "true" } });
        assert.equal(r.error, null, r.error?.message);
      }
      const dela = await aline.cliente.from("eventos_exportacao").select("usuario_id, detalhes");
      const meus = (dela.data ?? []).filter((x) => x.detalhes?.export_rls === "true");
      assert.deepEqual(
        meus.map((x) => x.usuario_id),
        [aline.id],
      );
      const todas = await gerente.cliente.from("eventos_exportacao").select("usuario_id, detalhes");
      const rls = (todas.data ?? []).filter((x) => x.detalhes?.export_rls === "true");
      assert.deepEqual(rls.map((x) => x.usuario_id).sort(), [aline.id, kely.id].sort());
    },
  );
} finally {
  await limpar();
}

console.log(
  `\n${ok} verificações da exportação passaram${process.exitCode ? ", com FALHAS" : ""}.`,
);
