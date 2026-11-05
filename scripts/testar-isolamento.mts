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

  await caso("não altera, apaga nem cria produtos nem apelidos", async () => {
    const { data: alvoProd } = await admin
      .from("produtos")
      .select("codigo, preco_unitario")
      .limit(1);
    assert.ok(alvoProd?.length, "catálogo vazio: rode pnpm catalogo:provisorio antes");
    const { codigo, preco_unitario } = alvoProd[0];

    const up = await eu.cliente
      .from("produtos")
      .update({ preco_unitario: 0.01 })
      .eq("codigo", codigo)
      .select();
    assert.ok(up.error || (up.data ?? []).length === 0, "update em produtos");
    const del = await eu.cliente.from("produtos").delete().eq("codigo", codigo).select();
    assert.ok(del.error || (del.data ?? []).length === 0, "delete em produtos");
    const ins = await eu.cliente.from("produto_apelidos").insert({ codigo, texto: "intruso" });
    assert.ok(ins.error, "insert em produto_apelidos");

    const { data: depois } = await admin
      .from("produtos")
      .select("preco_unitario")
      .eq("codigo", codigo);
    assert.equal(Number(depois?.[0]?.preco_unitario), Number(preco_unitario));
  });

  await caso("não lê nem escreve estoque_mapeamentos", async () => {
    const { data } = await eu.cliente.from("estoque_mapeamentos").select("*");
    assert.deepEqual(data ?? [], []);
    const ins = await eu.cliente
      .from("estoque_mapeamentos")
      .insert({ nome: "intruso", colunas: {} });
    assert.ok(ins.error, "insert em estoque_mapeamentos");
  });

  await caso("busca produtos pela função buscar_produtos", async () => {
    const { data, error } = await eu.cliente.rpc("buscar_produtos", { p_texto: "", p_limite: 5 });
    assert.equal(error, null, error?.message);
    assert.ok((data ?? []).length > 0);
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

async function testarGerenciaEstoque(g: Pessoa) {
  console.log("\nGerência (estoque)");
  await caso("lê e escreve estoque_mapeamentos", async () => {
    const ins = await g.cliente
      .from("estoque_mapeamentos")
      .insert({ nome: "teste rls", colunas: { codigo: "Cód" } })
      .select("id")
      .single();
    assert.equal(ins.error, null, ins.error?.message);
    const lido = await g.cliente.from("estoque_mapeamentos").select("id").eq("id", ins.data!.id);
    assert.equal(lido.data?.length, 1);
    const del = await g.cliente
      .from("estoque_mapeamentos")
      .delete()
      .eq("id", ins.data!.id)
      .select();
    assert.equal(del.data?.length, 1);
  });

  await caso("escreve em produtos (e limpa)", async () => {
    const ins = await g.cliente
      .from("produtos")
      .insert({ codigo: "99998", descricao: "TESTE RLS GERENCIA", preco_unitario: 1 })
      .select("codigo");
    assert.equal(ins.data?.length, 1, ins.error?.message);
    const del = await g.cliente.from("produtos").delete().eq("codigo", "99998").select();
    assert.equal(del.data?.length, 1);
  });

  await caso("não escreve em sync_estoque (só service role)", async () => {
    const { error } = await g.cliente.from("sync_estoque").insert({ origem: "intruso" });
    assert.ok(error);
  });
}

const WHATSAPP_TESTE = "+5582900009999";
const PNG_MINIMO = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** Formulário e anexos (dia 4): criação, WhatsApp por vendedora, Storage e limite de 4 anexos. */
async function testarFormulario(aline: Pessoa, kely: Pessoa, gerente: Pessoa) {
  console.log("\nFormulário e anexos (dia 4)");
  const limpar = async () => {
    const { data: orcs } = await admin
      .from("orcamentos")
      .select("id, vendedora_id")
      .eq("respostas->>teste_rls", "true");
    for (const o of orcs ?? []) {
      const { data: arquivos } = await admin.storage
        .from("anexos")
        .list(`${o.vendedora_id}/${o.id}`);
      const caminhos = (arquivos ?? []).map((a) => `${o.vendedora_id}/${o.id}/${a.name}`);
      if (caminhos.length) await admin.storage.from("anexos").remove(caminhos);
    }
    await admin.from("orcamentos").delete().eq("respostas->>teste_rls", "true");
    await admin.from("clientes").delete().like("nome", "TESTE RLS%");
    // Devolve o contador ao maior número real, para os testes não deixarem buracos na numeração.
    const { data: numeros } = await admin
      .from("orcamentos")
      .select("numero")
      .like("numero", "2026-%");
    const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
    await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
  };

  await limpar();
  try {
    // Fixtures: um rascunho da Aline (criado por ela) e um da Kely com um arquivo real (criado pelo admin).
    const cliA = await aline.cliente
      .from("clientes")
      .insert({ vendedora_id: aline.id, nome: "TESTE RLS Aline" })
      .select("id")
      .single();
    assert.equal(cliA.error, null, cliA.error?.message);
    const orcA = await aline.cliente
      .from("orcamentos")
      .insert({
        vendedora_id: aline.id,
        cliente_id: cliA.data!.id,
        respostas: { teste_rls: "true" },
      })
      .select("id")
      .single();
    assert.equal(orcA.error, null, orcA.error?.message);
    const idA = orcA.data!.id as string;
    await admin
      .from("orcamentos")
      .update({ respostas: { teste_rls: "true" } })
      .eq("id", idA);

    const cliK = await admin
      .from("clientes")
      .insert({ vendedora_id: kely.id, nome: "TESTE RLS Kely" })
      .select("id")
      .single();
    const orcK = await admin
      .from("orcamentos")
      .insert({
        vendedora_id: kely.id,
        cliente_id: cliK.data!.id,
        respostas: { teste_rls: "true" },
      })
      .select("id")
      .single();
    const idK = orcK.data!.id as string;
    const caminhoK = `${kely.id}/${idK}/arquivo-da-kely.png`;
    await admin.storage.from("anexos").upload(caminhoK, PNG_MINIMO, { contentType: "image/png" });
    await admin
      .from("anexos")
      .insert({ orcamento_id: idK, caminho_storage: caminhoK, tipo: "foto" });

    await caso("Aline não cria orçamento com vendedora_id da Kely", async () => {
      const { error } = await aline.cliente
        .from("orcamentos")
        .insert({ vendedora_id: kely.id, cliente_id: cliA.data!.id });
      assert.ok(error, "inserção deveria ser negada");
    });

    await caso("Aline não cria cliente em nome da Kely", async () => {
      const { error } = await aline.cliente
        .from("clientes")
        .insert({ vendedora_id: kely.id, nome: "TESTE RLS intruso" });
      assert.ok(error, "inserção deveria ser negada");
    });

    await caso(
      "mesmo WhatsApp em duas vendedoras não conflita; repetido na mesma conflita",
      async () => {
        const a = await aline.cliente
          .from("clientes")
          .insert({ vendedora_id: aline.id, nome: "TESTE RLS zap A", whatsapp: WHATSAPP_TESTE });
        const k = await kely.cliente
          .from("clientes")
          .insert({ vendedora_id: kely.id, nome: "TESTE RLS zap K", whatsapp: WHATSAPP_TESTE });
        assert.equal(a.error, null, a.error?.message);
        assert.equal(k.error, null, k.error?.message);
        const repetido = await aline.cliente
          .from("clientes")
          .insert({ vendedora_id: aline.id, nome: "TESTE RLS zap A2", whatsapp: WHATSAPP_TESTE });
        assert.equal(repetido.error?.code, "23505");
      },
    );

    await caso("mesclar_respostas só mexe em rascunho próprio", async () => {
      const meu = await aline.cliente.rpc("mesclar_respostas", {
        p_orcamento: idA,
        p_patch: { cliente_nome: "TESTE RLS Aline" },
      });
      assert.equal(meu.error, null, meu.error?.message);
      assert.equal(meu.data?.cliente_nome, "TESTE RLS Aline");
      assert.equal(meu.data?.teste_rls, "true", "a mesclagem preserva as outras chaves");

      const alheio = await aline.cliente.rpc("mesclar_respostas", {
        p_orcamento: idK,
        p_patch: { x: 1 },
      });
      assert.ok(alheio.data === null || alheio.error, "orçamento da Kely");
      const { data: depois } = await admin.from("orcamentos").select("respostas").eq("id", idK);
      assert.equal((depois?.[0]?.respostas as Record<string, unknown>).x, undefined);

      const { data: enviado } = await aline.cliente
        .from("orcamentos")
        .select("id")
        .eq("status", "enviado")
        .limit(1);
      const naoRascunho = await aline.cliente.rpc("mesclar_respostas", {
        p_orcamento: enviado![0].id,
        p_patch: { x: 1 },
      });
      assert.ok(naoRascunho.data === null || naoRascunho.error, "orçamento já enviado");
    });

    await caso("Aline não envia arquivo para a pasta da Kely no Storage", async () => {
      const alvo = `${kely.id}/${idK}/intruso.png`;
      const assinada = await aline.cliente.storage.from("anexos").createSignedUploadUrl(alvo);
      assert.ok(assinada.error, "URL assinada deveria ser negada");
      const direto = await aline.cliente.storage
        .from("anexos")
        .upload(alvo, PNG_MINIMO, { contentType: "image/png" });
      assert.ok(direto.error, "envio direto deveria ser negado");
      // Nem para a própria pasta, mas em orçamento da Kely.
      const mista = await aline.cliente.storage
        .from("anexos")
        .upload(`${aline.id}/${idK}/misto.png`, PNG_MINIMO, { contentType: "image/png" });
      assert.ok(mista.error, "orçamento de outra não pode receber arquivo");
    });

    await caso("Aline não lê, baixa nem apaga anexo da Kely", async () => {
      const linhas = await aline.cliente.from("anexos").select("*").eq("orcamento_id", idK);
      assert.deepEqual(linhas.data, []);
      const url = await aline.cliente.storage.from("anexos").createSignedUrl(caminhoK, 60);
      assert.ok(url.error, "URL assinada de leitura deveria ser negada");
      const baixar = await aline.cliente.storage.from("anexos").download(caminhoK);
      assert.ok(baixar.error, "download deveria ser negado");
      const apagar = await aline.cliente.storage.from("anexos").remove([caminhoK]);
      assert.deepEqual(apagar.data ?? [], []);
      const existe = await admin.storage.from("anexos").exists(caminhoK);
      assert.equal(existe.data, true, "o arquivo da Kely continua lá");
    });

    await caso("Gerência lê o anexo da Kely, mas não envia arquivo", async () => {
      const url = await gerente.cliente.storage.from("anexos").createSignedUrl(caminhoK, 60);
      assert.equal(url.error, null, url.error?.message);
      const envio = await gerente.cliente.storage
        .from("anexos")
        .upload(`${kely.id}/${idK}/gerente.png`, PNG_MINIMO, { contentType: "image/png" });
      assert.ok(envio.error, "gerente não envia anexos");
    });

    await caso("envio assinado na pasta própria funciona e o 5º anexo é barrado", async () => {
      const caminho = `${aline.id}/${idA}/${crypto.randomUUID()}.png`;
      const assinada = await aline.cliente.storage.from("anexos").createSignedUploadUrl(caminho);
      assert.equal(assinada.error, null, assinada.error?.message);
      const envio = await aline.cliente.storage
        .from("anexos")
        .uploadToSignedUrl(caminho, assinada.data!.token, PNG_MINIMO, { contentType: "image/png" });
      assert.equal(envio.error, null, envio.error?.message);

      const primeiro = await aline.cliente.from("anexos").insert({
        orcamento_id: idA,
        caminho_storage: caminho,
        tipo: "foto",
        mime_type: "image/png",
      });
      assert.equal(primeiro.error, null, primeiro.error?.message);

      for (let i = 2; i <= 4; i++) {
        const r = await aline.cliente.from("anexos").insert({
          orcamento_id: idA,
          caminho_storage: `${aline.id}/${idA}/fake-${i}.png`,
          tipo: "print",
        });
        assert.equal(r.error, null, `anexo ${i}: ${r.error?.message}`);
      }
      const quinto = await aline.cliente.from("anexos").insert({
        orcamento_id: idA,
        caminho_storage: `${aline.id}/${idA}/fake-5.png`,
        tipo: "foto",
      });
      assert.ok(quinto.error, "o 5º anexo deveria ser barrado");
      assert.match(quinto.error!.message, /Limite de 4/);

      const { count } = await admin
        .from("anexos")
        .select("id", { count: "exact", head: true })
        .eq("orcamento_id", idA);
      assert.equal(count, 4);

      // Remover libera uma vaga.
      const remover = await aline.cliente
        .from("anexos")
        .delete()
        .eq("caminho_storage", `${aline.id}/${idA}/fake-4.png`)
        .select();
      assert.equal(remover.data?.length, 1);
      const de_novo = await aline.cliente.from("anexos").insert({
        orcamento_id: idA,
        caminho_storage: `${aline.id}/${idA}/fake-6.png`,
        tipo: "foto",
      });
      assert.equal(de_novo.error, null, de_novo.error?.message);
    });

    await caso("tipo de anexo inválido é recusado", async () => {
      const r = await aline.cliente
        .from("anexos")
        .insert({ orcamento_id: idA, caminho_storage: `${aline.id}/${idA}/x.png`, tipo: "video" });
      assert.ok(r.error);
    });

    await caso("o bucket recusa tipo de arquivo fora da lista", async () => {
      const caminho = `${aline.id}/${idA}/${crypto.randomUUID()}.txt`;
      const assinada = await aline.cliente.storage.from("anexos").createSignedUploadUrl(caminho);
      if (assinada.error) return; // negado já na assinatura: ok
      const envio = await aline.cliente.storage
        .from("anexos")
        .uploadToSignedUrl(caminho, assinada.data.token, new Blob(["oi"], { type: "text/plain" }), {
          contentType: "text/plain",
        });
      assert.ok(envio.error, "text/plain deveria ser recusado");
    });
  } finally {
    await limpar();
  }
}

async function anonimo() {
  console.log("\nSem login");
  await caso("não lê nada", async () => {
    const cliente = createClient(url, anon, opcoes);
    for (const tabela of [
      "orcamentos",
      "clientes",
      "produtos",
      "usuarios",
      "estoque_mapeamentos",
    ]) {
      const { data, error } = await cliente.from(tabela).select("*");
      assert.ok(error || (data ?? []).length === 0, tabela);
    }
  });

  await caso("não executa buscar_produtos", async () => {
    const cliente = createClient(url, anon, opcoes);
    const { data, error } = await cliente.rpc("buscar_produtos", { p_texto: "" });
    assert.ok(error || (data ?? []).length === 0);
  });
}

const aline = await entrar(exigir("SEED_EMAIL_ALINE"));
const kely = await entrar(exigir("SEED_EMAIL_KELY"));
const gerencia = await entrar(exigir("SEED_EMAIL_GERENCIA"));

await testarVendedora("Aline (contra Kely)", aline, kely);
await testarVendedora("Kely (contra Aline)", kely, aline);
await testarGerencia(gerencia, aline, kely);
await testarGerenciaEstoque(gerencia);
await testarFormulario(aline, kely, gerencia);
await anonimo();

console.log(`\n${ok} verificações passaram${process.exitCode ? ", com FALHAS" : ""}.`);
