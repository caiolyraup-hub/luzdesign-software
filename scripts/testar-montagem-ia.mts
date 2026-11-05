// Motor de IA (dia 5) contra o Supabase real, com a OpenAI SIMULADA: sessão da vendedora, RLS e uso_ia.
// Uso: pnpm test:rls (roda depois de testar-isolamento.mts). Não chama a API da OpenAI.
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ConfigIA } from "../src/lib/ia/config";
import { criarExecutorFerramentas } from "../src/lib/ia/ferramentas";
import { montarOrcamento } from "../src/lib/ia/montar";
import type { ClienteIA, RespostaIA } from "../src/lib/ia/motor";
import { criarRepositorioIA } from "../src/lib/ia/repositorio-ia";

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

type Pessoa = { cliente: SupabaseClient; id: string };

async function entrar(email: string): Promise<Pessoa> {
  const cliente = createClient(url, anon, opcoes);
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

const RESPOSTAS_PRONTAS = {
  versao: 1,
  teste_rls: "true",
  cliente_nome: "TESTE RLS IA",
  cliente_whatsapp: "+5582900009990",
  tipo_cliente: "final",
  tipo_obra: { uso: "residencial", estado: "reforma" },
  ambientes: ["sala"],
  pedido_cliente: "Spots embutidos na sala.",
  linha: "tecnica",
  prazo: "encomenda",
};

const config: ConfigIA = {
  modelo: "modelo-de-teste",
  limiteDiario: 1000,
  maxGeracoesPorOrcamento: 2,
  maxRodadasFerramentas: 8,
  precoEntradaUsdMtok: null,
  precoSaidaUsdMtok: null,
  raciocinio: null,
  timeoutChamadaMs: 1000,
};

/** IA falsa: busca no catálogo e responde com um código real, um inventado e um "preço" que deve ser ignorado. */
function iaBoa(): ClienteIA {
  let chamada = 0;
  return {
    responses: {
      async create(): Promise<RespostaIA> {
        chamada++;
        if (chamada === 1) {
          return {
            output: [
              {
                type: "function_call",
                name: "buscar_produtos",
                arguments: JSON.stringify({
                  texto: "dic 6w",
                  categoria: null,
                  marca: null,
                  limite: 5,
                }),
                call_id: "c1",
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }
        const saida = {
          ambientes: [
            {
              nome: "Sala",
              itens: [
                {
                  codigo: "9520",
                  quantidade: 2.2,
                  justificativa: "spot",
                  descricao_avulso: null,
                  preco_unitario: 0.01,
                },
                {
                  codigo: "99999",
                  quantidade: 1,
                  justificativa: "inventado",
                  descricao_avulso: null,
                },
                {
                  codigo: null,
                  quantidade: 1,
                  justificativa: "falta",
                  descricao_avulso: "Pendente de teste",
                },
              ],
            },
          ],
          pendencias: ["Confirmar pontos"],
          resumo_para_vendedora: "ok",
        };
        return {
          output: [
            { type: "message", content: [{ type: "output_text", text: JSON.stringify(saida) }] },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    },
  };
}

const iaQuebrada = (): ClienteIA => ({
  responses: {
    async create() {
      throw Object.assign(new Error("Rate limit"), { status: 429 });
    },
  },
});

function espiao() {
  const estado = { chamou: false };
  const cliente: ClienteIA = {
    responses: {
      async create() {
        estado.chamou = true;
        throw new Error("não devia chamar a API");
      },
    },
  };
  return { estado, cliente };
}

const deps = (p: Pessoa, ia: ClienteIA, extra: Partial<ConfigIA> = {}) => ({
  repo: criarRepositorioIA(p.cliente, admin),
  ia,
  executor: criarExecutorFerramentas(p.cliente),
  config: { ...config, ...extra },
});

async function limpar() {
  const { data: orcs } = await admin
    .from("orcamentos")
    .select("id")
    .eq("respostas->>teste_rls", "true");
  const ids = (orcs ?? []).map((o) => o.id);
  if (ids.length) await admin.from("uso_ia").delete().in("orcamento_id", ids);
  await admin.from("orcamentos").delete().eq("respostas->>teste_rls", "true");
  await admin.from("clientes").delete().like("nome", "TESTE RLS%");
  // Devolve o contador ao maior número real, para os testes não deixarem buracos na numeração.
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

const aline = await entrar(exigir("SEED_EMAIL_ALINE"));
const kely = await entrar(exigir("SEED_EMAIL_KELY"));

console.log("\nMotor de IA (OpenAI simulada, banco real)");
await limpar();
try {
  const cliA = await aline.cliente
    .from("clientes")
    .insert({ vendedora_id: aline.id, nome: "TESTE RLS IA Aline" })
    .select("id")
    .single();
  const orcA = await aline.cliente
    .from("orcamentos")
    .insert({ vendedora_id: aline.id, cliente_id: cliA.data!.id, respostas: RESPOSTAS_PRONTAS })
    .select("id")
    .single();
  assert.equal(orcA.error, null, orcA.error?.message);
  const idA = orcA.data!.id as string;

  const cliK = await admin
    .from("clientes")
    .insert({ vendedora_id: kely.id, nome: "TESTE RLS IA Kely" })
    .select("id")
    .single();
  const orcK = await admin
    .from("orcamentos")
    .insert({
      vendedora_id: kely.id,
      cliente_id: cliK.data!.id,
      respostas: { ...RESPOSTAS_PRONTAS, cliente_whatsapp: "+5582900009991" },
    })
    .select("id")
    .single();
  const idK = orcK.data!.id as string;

  await caso(
    "a ferramenta buscar_produtos roda com a sessão da vendedora (e não sem sessão)",
    async () => {
      const r = (await criarExecutorFerramentas(aline.cliente)(
        "buscar_produtos",
        JSON.stringify({ texto: "dic 6w", categoria: null, marca: null, limite: 5 }),
      )) as { produtos: { codigo: string }[] };
      assert.ok(
        r.produtos.some((p) => p.codigo === "9520"),
        "o código 9520 deveria aparecer",
      );

      const semSessao = (await criarExecutorFerramentas(createClient(url, anon, opcoes))(
        "buscar_produtos",
        JSON.stringify({ texto: "dic", categoria: null, marca: null, limite: 5 }),
      )) as { produtos?: unknown[]; erro?: string };
      assert.ok(
        semSessao.erro || (semSessao.produtos ?? []).length === 0,
        "sem sessão não pode buscar",
      );
    },
  );

  await caso("Aline não consegue montar o orçamento da Kely", async () => {
    const { estado, cliente } = espiao();
    const r = await montarOrcamento(deps(aline, cliente), aline.id, idK);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "nao_encontrado");
    assert.equal(estado.chamou, false, "não deve nem chamar a IA");

    const { count } = await admin
      .from("orcamento_itens")
      .select("id", { count: "exact", head: true })
      .eq("orcamento_id", idK);
    assert.equal(count, 0);
    const { count: usos } = await admin
      .from("uso_ia")
      .select("id", { count: "exact", head: true })
      .eq("orcamento_id", idK);
    assert.equal(usos, 0, "nem registra uso");

    // Mesmo trocando o usuário informado: a RLS esconde o orçamento da Aline para a Kely.
    const forjado = await montarOrcamento(deps(kely, cliente), aline.id, idK);
    assert.equal(forjado.ok, false);
  });

  await caso(
    "grava itens com o preço do catálogo, descarta código inventado e cria item avulso",
    async () => {
      const r = await montarOrcamento(deps(aline, iaBoa()), aline.id, idA);
      assert.equal(r.ok, true, JSON.stringify(r));

      const { data: itens } = await admin
        .from("orcamento_itens")
        .select("*")
        .eq("orcamento_id", idA)
        .order("ordem");
      assert.equal(itens?.length, 2, "código inventado descartado; sobram o real e o avulso");
      const { data: prod } = await admin
        .from("produtos")
        .select("preco_unitario, descricao")
        .eq("codigo", "9520")
        .single();
      assert.equal(itens![0].codigo, "9520");
      assert.equal(
        Number(itens![0].preco_unitario_congelado),
        Number(prod!.preco_unitario),
        "preço do banco, não 0,01",
      );
      assert.equal(itens![0].descricao_congelada, prod!.descricao);
      assert.equal(Number(itens![0].quantidade), 3, "2,2 un arredonda para 3");
      assert.equal(itens![1].avulso, true);
      assert.equal(itens![1].codigo, null);
      assert.equal(Number(itens![1].preco_unitario_congelado), 0);

      const { data: orc } = await admin
        .from("orcamentos")
        .select("valor_total, status, montado_em, montagem")
        .eq("id", idA)
        .single();
      assert.equal(Number(orc!.valor_total), 3 * Number(prod!.preco_unitario));
      assert.equal(orc!.status, "rascunho", "continua rascunho");
      assert.ok(orc!.montado_em);
      assert.equal(orc!.montagem.geracoes, 1);
      assert.ok(orc!.montagem.avisos.length >= 2, "avisos do código inventado e do arredondamento");
    },
  );

  await caso("uso_ia é gravado pelo servidor e a vendedora não o lê nem o apaga", async () => {
    const { data: uso } = await admin.from("uso_ia").select("*").eq("orcamento_id", idA);
    assert.equal(uso?.length, 1);
    assert.equal(uso![0].status, "ok");
    assert.equal(uso![0].vendedora_id, aline.id);
    assert.equal(uso![0].tokens_entrada, 110);
    assert.equal(uso![0].tokens_saida, 55);
    assert.equal(uso![0].chamadas_ferramenta, 1);
    assert.equal(uso![0].modelo, "modelo-de-teste");

    const lido = await aline.cliente.from("uso_ia").select("*");
    assert.deepEqual(lido.data ?? [], []);
    const apagado = await aline.cliente.from("uso_ia").delete().eq("orcamento_id", idA).select();
    assert.deepEqual(apagado.data ?? [], []);
    const forjado = await aline.cliente
      .from("uso_ia")
      .insert({ orcamento_id: idA, status: "erro" });
    assert.ok(forjado.error, "a vendedora não grava em uso_ia");
  });

  await caso(
    "erro da API não grava nada nem conta no limite; a 3ª montagem bate no limite do orçamento",
    async () => {
      const antes = await admin.from("orcamento_itens").select("id").eq("orcamento_id", idA);
      const quebrada = await montarOrcamento(deps(aline, iaQuebrada()), aline.id, idA);
      assert.equal(quebrada.ok, false);
      if (!quebrada.ok) assert.match(quebrada.erro, /muitas solicitações/);
      const depois = await admin.from("orcamento_itens").select("id").eq("orcamento_id", idA);
      assert.deepEqual(
        (depois.data ?? []).map((i) => i.id).sort(),
        (antes.data ?? []).map((i) => i.id).sort(),
        "os itens ficaram como estavam",
      );
      const { data: usos } = await admin
        .from("uso_ia")
        .select("status")
        .eq("orcamento_id", idA)
        .order("criado_em");
      assert.deepEqual(
        (usos ?? []).map((u) => u.status),
        ["ok", "erro"],
      );

      // O erro não consumiu tentativa: a 2ª boa passa; a 3ª é barrada sem chamar a API.
      const segunda = await montarOrcamento(deps(aline, iaBoa()), aline.id, idA);
      assert.equal(segunda.ok, true, JSON.stringify(segunda));
      const { estado, cliente } = espiao();
      const terceira = await montarOrcamento(deps(aline, cliente), aline.id, idA);
      assert.equal(terceira.ok, false);
      if (!terceira.ok) assert.equal(terceira.motivo, "limite_orcamento");
      assert.equal(estado.chamou, false);
    },
  );

  await caso("limite diário por vendedora bloqueia sem chamar a API", async () => {
    const { estado, cliente } = espiao();
    const r = await montarOrcamento(
      deps(aline, cliente, { limiteDiario: 1, maxGeracoesPorOrcamento: 99 }),
      aline.id,
      idA,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "limite_diario");
    assert.equal(estado.chamou, false);
  });
} finally {
  await limpar();
}

console.log(
  `\n${ok} verificações do motor de IA passaram${process.exitCode ? ", com FALHAS" : ""}.`,
);
