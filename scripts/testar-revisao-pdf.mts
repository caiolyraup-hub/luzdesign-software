// Revisão e PDF (dia 6) contra o Supabase real: gera PDF de verdade (render + Storage + banco).
// Uso: pnpm test:rls (roda depois dos outros). Cria dados "TESTE RLS PDF" e apaga tudo no fim.
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { gerarPdfOrcamento } from "../src/lib/pdf/gerar";
import { renderizarPdf } from "../src/lib/pdf/renderizar";

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

type Pessoa = { cliente: SupabaseClient; id: string; nome: string };

async function entrar(email: string, nome: string): Promise<Pessoa> {
  const cliente = createClient(url, anon, opcoes);
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

const RESPOSTAS = {
  versao: 1,
  teste_rls: "true",
  cliente_nome: "TESTE RLS PDF",
  cliente_whatsapp: "+5582900009960",
  tipo_cliente: "final",
  tipo_obra: { uso: "residencial", estado: "reforma" },
  ambientes: ["sala", "cozinha"],
  pedido_cliente: "Teste do PDF.",
  linha: "tecnica",
  prazo: "encomenda",
};

async function limpar() {
  const { data: orcs } = await admin
    .from("orcamentos")
    .select("id, vendedora_id")
    .eq("respostas->>teste_rls", "true");
  for (const o of orcs ?? []) {
    for (const bucket of ["pdfs", "anexos"]) {
      const { data: arquivos } = await admin.storage.from(bucket).list(`${o.vendedora_id}/${o.id}`);
      const caminhos = (arquivos ?? []).map((a) => `${o.vendedora_id}/${o.id}/${a.name}`);
      if (caminhos.length) await admin.storage.from(bucket).remove(caminhos);
    }
  }
  await admin.from("orcamentos").delete().eq("respostas->>teste_rls", "true");
  await admin.from("clientes").delete().like("nome", "TESTE RLS PDF%");
  // O teste da gerente mexe no telefone da loja: garante que volta a ficar vazio.
  await admin.from("configuracoes_loja").update({ telefone: null }).eq("id", true);
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

const aline = await entrar(exigir("SEED_EMAIL_ALINE"), "Aline");
const kely = await entrar(exigir("SEED_EMAIL_KELY"), "Kely");
const gerente = await entrar(exigir("SEED_EMAIL_GERENCIA"), "Gerência");

const deps = (p: Pessoa) => ({ sessao: p.cliente, renderizar: renderizarPdf });

async function criarOrcamento(dono: Pessoa, usandoAdmin: boolean, sufixo: string) {
  const via = usandoAdmin ? admin : dono.cliente;
  const cli = await via
    .from("clientes")
    .insert({
      vendedora_id: dono.id,
      nome: `TESTE RLS PDF ${sufixo}`,
      whatsapp: `+55829000099${sufixo === "A" ? "61" : "62"}`,
    })
    .select("id")
    .single();
  assert.equal(cli.error, null, cli.error?.message);
  const orc = await via
    .from("orcamentos")
    .insert({ vendedora_id: dono.id, cliente_id: cli.data!.id, respostas: RESPOSTAS })
    .select("id, numero")
    .single();
  assert.equal(orc.error, null, orc.error?.message);
  return { id: orc.data!.id as string, numero: orc.data!.numero as string };
}

console.log("\nRevisão e PDF (banco, Storage e render reais)");
await limpar();
try {
  const { data: produtos } = await admin
    .from("produtos")
    .select("codigo, preco_unitario")
    .eq("ativo", true)
    .in("codigo", ["9520", "12222"]);
  assert.equal(produtos?.length, 2, "catálogo provisório ausente (códigos 9520 e 12222)");
  const preco = Object.fromEntries(
    (produtos ?? []).map((p) => [p.codigo, Number(p.preco_unitario)]),
  );

  const a = await criarOrcamento(aline, false, "A");
  const k = await criarOrcamento(kely, true, "K");

  // Itens da Aline (pela sessão dela, como a revisão faz) e da Kely (admin).
  const itensA = await aline.cliente.from("orcamento_itens").insert([
    // preços "velhos" de propósito: o PDF tem de congelar o do catálogo
    {
      orcamento_id: a.id,
      codigo: "9520",
      descricao_congelada: "ANTIGA",
      preco_unitario_congelado: 1,
      quantidade: 6,
      ambiente: "Sala",
      avulso: false,
      ordem: 0,
    },
    {
      orcamento_id: a.id,
      codigo: "12222",
      descricao_congelada: "ANTIGA",
      preco_unitario_congelado: 1,
      quantidade: 8.5,
      ambiente: "Cozinha",
      avulso: false,
      ordem: 1,
    },
    {
      orcamento_id: a.id,
      codigo: null,
      descricao_congelada: "Pendente sob medida (teste)",
      preco_unitario_congelado: 500,
      quantidade: 1,
      ambiente: "Sala",
      avulso: true,
      ordem: 2,
    },
  ]);
  assert.equal(itensA.error, null, itensA.error?.message);
  await admin.from("orcamento_itens").insert({
    orcamento_id: k.id,
    codigo: "9520",
    descricao_congelada: "X",
    preco_unitario_congelado: preco["9520"],
    quantidade: 1,
    ambiente: "Sala",
    avulso: false,
    ordem: 0,
  });

  const esperado = Math.round((preco["9520"] * 6 + preco["12222"] * 8.5 + 500) * 100);
  let caminhoA = "";

  await caso(
    "Aline gera o PDF: congela preços do catálogo, vira gerado e guarda o arquivo",
    async () => {
      const r = await gerarPdfOrcamento(deps(aline), aline, a.id);
      assert.equal(r.ok, true, JSON.stringify(r));
      if (!r.ok) return;
      assert.equal(r.versao, 1);
      assert.equal(r.totalCentavos, esperado);
      caminhoA = r.caminho;
      assert.equal(caminhoA, `${aline.id}/${a.id}/${a.numero}-v1.pdf`);

      const { data: o } = await admin
        .from("orcamentos")
        .select("status, valor_total, validade, pdf_caminho, pdf_versao, gerado_em")
        .eq("id", a.id)
        .single();
      assert.equal(o!.status, "gerado");
      assert.equal(Math.round(Number(o!.valor_total) * 100), esperado);
      assert.equal(o!.pdf_caminho, caminhoA);
      assert.equal(o!.pdf_versao, 1);
      assert.ok(o!.gerado_em && o!.validade);

      const { data: itens } = await admin
        .from("orcamento_itens")
        .select("codigo, preco_unitario_congelado, descricao_congelada")
        .eq("orcamento_id", a.id)
        .order("ordem");
      assert.equal(
        Number(itens![0].preco_unitario_congelado),
        preco["9520"],
        "preço do catálogo, não o 1 digitado",
      );
      assert.notEqual(itens![0].descricao_congelada, "ANTIGA");
      assert.equal(Number(itens![2].preco_unitario_congelado), 500, "avulso mantém o preço manual");

      const baixado = await admin.storage.from("pdfs").download(caminhoA);
      assert.equal(baixado.error, null);
      const bytes = Buffer.from(await baixado.data!.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    },
  );

  await caso("Aline lê o próprio PDF; Kely e visitante não", async () => {
    assert.equal(
      (await aline.cliente.storage.from("pdfs").createSignedUrl(caminhoA, 60)).error,
      null,
    );
    const k1 = await kely.cliente.storage.from("pdfs").createSignedUrl(caminhoA, 60);
    assert.ok(k1.error, "Kely não pode assinar leitura do PDF da Aline");
    const k2 = await kely.cliente.storage.from("pdfs").download(caminhoA);
    assert.ok(k2.error, "Kely não pode baixar o PDF da Aline");
    const semSessao = createClient(url, anon, opcoes);
    assert.ok((await semSessao.storage.from("pdfs").download(caminhoA)).error);
  });

  await caso("a gerente lê o PDF, mas não grava nem gera", async () => {
    assert.equal(
      (await gerente.cliente.storage.from("pdfs").createSignedUrl(caminhoA, 60)).error,
      null,
    );
    const envio = await gerente.cliente.storage
      .from("pdfs")
      .upload(
        `${aline.id}/${a.id}/gerente.pdf`,
        new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      );
    assert.ok(envio.error, "gerente não grava em pdfs");
    const gera = await gerarPdfOrcamento(deps(gerente), gerente, a.id);
    assert.equal(gera.ok, false);
    if (!gera.ok) assert.equal(gera.motivo, "nao_encontrado");
    // Nem direto pela função do banco, com o total certo.
    const direto = await gerente.cliente.rpc("gerar_orcamento", {
      p_orcamento: a.id,
      p_pdf_caminho: `${aline.id}/${a.id}/${a.numero}-v2.pdf`,
      p_versao: 2,
      p_total_esperado: esperado / 100,
      p_validade: "2026-12-31",
    });
    assert.ok(direto.error, "a gerente não pode gerar orçamento de outra pessoa");
    assert.match(direto.error!.message, /ORCAMENTO_NAO_EDITAVEL/);
  });

  await caso(
    "Aline não gera PDF, não edita itens nem envia arquivo no orçamento da Kely",
    async () => {
      const gera = await gerarPdfOrcamento(deps(aline), aline, k.id);
      assert.equal(gera.ok, false);
      if (!gera.ok) assert.equal(gera.motivo, "nao_encontrado");

      const direto = await aline.cliente.rpc("gerar_orcamento", {
        p_orcamento: k.id,
        p_pdf_caminho: `${kely.id}/${k.id}/${k.numero}-v1.pdf`,
        p_versao: 1,
        p_total_esperado: preco["9520"],
        p_validade: "2026-12-31",
      });
      assert.ok(direto.error);

      const edita = await aline.cliente
        .from("orcamento_itens")
        .update({ quantidade: 99 })
        .eq("orcamento_id", k.id)
        .select();
      assert.deepEqual(edita.data ?? [], []);
      const insere = await aline.cliente.from("orcamento_itens").insert({
        orcamento_id: k.id,
        codigo: "9520",
        descricao_congelada: "intruso",
        preco_unitario_congelado: 1,
        quantidade: 1,
        ambiente: "Sala",
        avulso: false,
        ordem: 9,
      });
      assert.ok(insere.error, "inserir item no orçamento da Kely deve ser negado");
      const apaga = await aline.cliente
        .from("orcamento_itens")
        .delete()
        .eq("orcamento_id", k.id)
        .select();
      assert.deepEqual(apaga.data ?? [], []);
      const recalcula = await aline.cliente.rpc("recalcular_total_orcamento", {
        p_orcamento: k.id,
      });
      assert.equal(recalcula.data, null);

      const upload = await aline.cliente.storage
        .from("pdfs")
        .upload(
          `${kely.id}/${k.id}/intruso.pdf`,
          new Blob(["%PDF-1.4"], { type: "application/pdf" }),
        );
      assert.ok(upload.error, "Aline não grava na pasta da Kely");

      const { data: depois } = await admin
        .from("orcamento_itens")
        .select("quantidade")
        .eq("orcamento_id", k.id);
      assert.equal(depois?.length, 1);
      assert.equal(Number(depois![0].quantidade), 1);
    },
  );

  await caso(
    "nova versão (v2) mantém o PDF anterior no Storage; a vendedora não apaga PDFs",
    async () => {
      const up = await aline.cliente
        .from("orcamento_itens")
        .update({ quantidade: 7 })
        .eq("orcamento_id", a.id)
        .eq("codigo", "9520")
        .select();
      assert.equal(up.data?.length, 1);
      const r = await gerarPdfOrcamento(deps(aline), aline, a.id);
      assert.equal(r.ok, true, JSON.stringify(r));
      if (!r.ok) return;
      assert.equal(r.versao, 2);

      assert.equal(
        (await admin.storage.from("pdfs").exists(caminhoA)).data,
        true,
        "v1 continua lá",
      );
      assert.equal((await admin.storage.from("pdfs").exists(r.caminho)).data, true);
      const { data: o } = await admin
        .from("orcamentos")
        .select("pdf_versao, pdf_versoes, status")
        .eq("id", a.id)
        .single();
      assert.equal(o!.pdf_versao, 2);
      assert.deepEqual(
        (o!.pdf_versoes as { versao: number }[]).map((v) => v.versao),
        [1, 2],
      );
      assert.equal(o!.status, "gerado");

      const apagar = await aline.cliente.storage.from("pdfs").remove([caminhoA]);
      assert.deepEqual(apagar.data ?? [], []);
      assert.equal(
        (await admin.storage.from("pdfs").exists(caminhoA)).data,
        true,
        "a vendedora não apaga versões",
      );
    },
  );

  await caso(
    "status: a dona acompanha, a gerência também, outra vendedora não; motivo e transições valem",
    async () => {
      const mudar = (
        p: Pessoa,
        para: string,
        valor: number | null = null,
        motivo: string | null = null,
      ) =>
        p.cliente.rpc("mudar_status_orcamento", {
          p_orcamento: a.id,
          p_para: para,
          p_valor_fechado: valor,
          p_motivo: motivo,
        });

      assert.equal((await mudar(aline, "enviado")).error, null);
      assert.equal((await mudar(aline, "followup_d5")).error, null);

      const kely1 = await mudar(kely, "followup_d10");
      assert.ok(kely1.error, "Kely não muda o status do orçamento da Aline");
      const { data: continua } = await admin
        .from("orcamentos")
        .select("status")
        .eq("id", a.id)
        .single();
      assert.equal(continua!.status, "followup_d5");

      const salto = await mudar(aline, "rascunho");
      assert.match(salto.error?.message ?? "", /TRANSICAO_INVALIDA/);
      const semMotivo = await mudar(aline, "perdido");
      assert.match(semMotivo.error?.message ?? "", /MOTIVO_OBRIGATORIO/);

      // A gerência perde o orçamento da Aline com motivo.
      assert.equal((await mudar(gerente, "perdido", null, "preco")).error, null);
      const { data: perdido } = await admin
        .from("orcamentos")
        .select("status, motivo_perda, perdido_em")
        .eq("id", a.id)
        .single();
      assert.equal(perdido!.status, "perdido");
      assert.equal(perdido!.motivo_perda, "preco");
      assert.ok(perdido!.perdido_em);

      // Reabre e fecha com valor negociado.
      assert.equal((await mudar(aline, "enviado")).error, null);
      assert.equal((await mudar(aline, "fechado", 1234.5)).error, null);
      const { data: fechado } = await admin
        .from("orcamentos")
        .select("status, valor_fechado, motivo_perda")
        .eq("id", a.id)
        .single();
      assert.equal(fechado!.status, "fechado");
      assert.equal(Number(fechado!.valor_fechado), 1234.5);
      assert.equal(fechado!.motivo_perda, null);

      // Os eventos guardam quem mudou, inclusive a gerência.
      const { data: eventos } = await admin
        .from("eventos")
        .select("usuario_id, para_status")
        .eq("orcamento_id", a.id)
        .order("id");
      const porGerencia = (eventos ?? [])
        .filter((e) => e.usuario_id === gerente.id)
        .map((e) => e.para_status);
      assert.deepEqual(porGerencia, ["perdido"]);

      // O PDF gerado antes continua intacto; volta para gerado para o teste seguinte poder editar.
      assert.equal((await mudar(aline, "enviado")).error, null);
      assert.equal((await mudar(aline, "gerado")).error, null);
    },
  );

  await caso("sem itens ou com avulso sem preço, o PDF é bloqueado", async () => {
    const vazio = await criarOrcamento(aline, false, "B");
    const r1 = await gerarPdfOrcamento(deps(aline), aline, vazio.id);
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.equal(r1.motivo, "bloqueado");

    await aline.cliente.from("orcamento_itens").insert({
      orcamento_id: vazio.id,
      codigo: null,
      descricao_congelada: "Avulso sem preço",
      preco_unitario_congelado: 0,
      quantidade: 1,
      ambiente: "Sala",
      avulso: true,
      ordem: 0,
    });
    const r2 = await gerarPdfOrcamento(deps(aline), aline, vazio.id);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.match(r2.erro, /preço/i);
    const { data: o } = await admin
      .from("orcamentos")
      .select("status, pdf_versao")
      .eq("id", vazio.id)
      .single();
    assert.deepEqual(o, { status: "rascunho", pdf_versao: 0 });
  });

  await caso(
    "análise do ambiente: a dona edita; outra vendedora não vê nem edita; gerente só lê",
    async () => {
      const mk = await admin
        .from("orcamento_ambientes")
        .insert({ orcamento_id: k.id, nome: "Sala", ordem: 0, analise: "texto da Kely" })
        .select("id");
      assert.equal(mk.error, null, mk.error?.message);
      const ma = await aline.cliente
        .from("orcamento_ambientes")
        .insert({ orcamento_id: a.id, nome: "Sala", ordem: 0, analise: "texto da Aline" })
        .select("id");
      assert.equal(ma.error, null, ma.error?.message);

      const ve = await aline.cliente
        .from("orcamento_ambientes")
        .select("analise")
        .eq("orcamento_id", k.id);
      assert.deepEqual(ve.data ?? [], [], "Aline não lê a análise da Kely");
      const edita = await aline.cliente
        .from("orcamento_ambientes")
        .update({ analise: "invadida" })
        .eq("orcamento_id", k.id)
        .select();
      assert.deepEqual(edita.data ?? [], []);
      const insere = await aline.cliente
        .from("orcamento_ambientes")
        .insert({ orcamento_id: k.id, nome: "Intruso", ordem: 9 });
      assert.ok(insere.error, "inserir ambiente no orçamento da Kely deve ser negado");
      const apaga = await aline.cliente
        .from("orcamento_ambientes")
        .delete()
        .eq("orcamento_id", k.id)
        .select();
      assert.deepEqual(apaga.data ?? [], []);
      const intacto = await admin
        .from("orcamento_ambientes")
        .select("analise")
        .eq("orcamento_id", k.id);
      assert.equal(intacto.data?.[0]?.analise, "texto da Kely");

      const dona = await aline.cliente
        .from("orcamento_ambientes")
        .update({ analise: "editada pela dona" })
        .eq("orcamento_id", a.id)
        .select("analise");
      assert.equal(dona.data?.[0]?.analise, "editada pela dona");

      const g = await gerente.cliente
        .from("orcamento_ambientes")
        .select("analise")
        .eq("orcamento_id", a.id);
      assert.equal(g.data?.length, 1, "gerente lê");
      const gEdita = await gerente.cliente
        .from("orcamento_ambientes")
        .update({ analise: "gerente" })
        .eq("orcamento_id", a.id)
        .select();
      assert.deepEqual(gEdita.data ?? [], []);
      const gIns = await gerente.cliente
        .from("orcamento_ambientes")
        .insert({ orcamento_id: a.id, nome: "G", ordem: 5 });
      assert.ok(gIns.error, "gerente não grava");
      const anon = await createClient(url, exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY"), opcoes)
        .from("orcamento_ambientes")
        .select("id");
      assert.deepEqual(anon.data ?? [], []);
    },
  );

  await caso("configuracoes_loja: todos leem, a vendedora não edita, a gerente edita", async () => {
    const lida = await aline.cliente
      .from("configuracoes_loja")
      .select("nome_fantasia, cnpj")
      .eq("id", true)
      .single();
    assert.equal(lida.data?.nome_fantasia, "Luz Design");
    const tenta = await aline.cliente
      .from("configuracoes_loja")
      .update({ telefone: "intruso" })
      .eq("id", true)
      .select();
    assert.deepEqual(tenta.data ?? [], []);
    const { data: depois } = await admin
      .from("configuracoes_loja")
      .select("telefone")
      .eq("id", true)
      .single();
    assert.equal(depois!.telefone, null);

    const ok1 = await gerente.cliente
      .from("configuracoes_loja")
      .update({ telefone: "(82) 3000-0000" })
      .eq("id", true)
      .select("telefone");
    assert.equal(ok1.data?.[0]?.telefone, "(82) 3000-0000");
    await gerente.cliente.from("configuracoes_loja").update({ telefone: null }).eq("id", true);
  });
} finally {
  await limpar();
}

console.log(
  `\n${ok} verificações de revisão e PDF passaram${process.exitCode ? ", com FALHAS" : ""}.`,
);
