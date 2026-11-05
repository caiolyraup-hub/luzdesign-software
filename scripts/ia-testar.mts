// Teste REAL do motor de IA (chama a OpenAI e custa dinheiro). Uso: pnpm ia:testar [--indice N]
// Monta, como Aline, um rascunho de teste baseado em 1 dos 37 orçamentos reais (pedido reescrito
// como a vendedora escreveria, sem nome do cliente) e compara os códigos escolhidos com os originais.
// Apaga o rascunho de teste no fim.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { criarClienteIA } from "../src/lib/ia/cliente";
import { lerConfigIA } from "../src/lib/ia/config";
import { criarExecutorFerramentas } from "../src/lib/ia/ferramentas";
import { montarOrcamento } from "../src/lib/ia/montar";
import { criarRepositorioIA } from "../src/lib/ia/repositorio-ia";
import { lerLinha, normalizarData } from "../src/lib/estoque/provisorio";

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável ${nome} ausente no .env.local`);
  return valor;
}

const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const soPedido = process.argv.includes("--so-pedido"); // só monta o pedido, sem chamar a API

const config = lerConfigIA();
console.log(`Modelo configurado: ${config.modelo}`);

if (!soPedido) {
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY está vazia no .env.local.\n" +
        "Crie a chave em platform.openai.com, defina um limite mensal em Settings > Limits e preencha a variável.",
    );
    process.exit(1);
  }

  // ---- 1. O modelo existe nesta conta?
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1 });
  try {
    await openai.models.retrieve(config.modelo);
    console.log("Modelo encontrado na conta.");
  } catch (e) {
    const status = (e as { status?: number }).status;
    console.error(`\nNão consegui confirmar o modelo "${config.modelo}" (HTTP ${status ?? "?"}).`);
    try {
      const lista = await openai.models.list();
      const candidatos = [];
      for await (const m of lista) if (/^gpt-5/.test(m.id)) candidatos.push(m.id);
      console.error(
        candidatos.length
          ? `Modelos gpt-5* disponíveis nesta conta:\n  ${candidatos.sort().join("\n  ")}\nAjuste OPENAI_MODEL no .env.local.`
          : "Nenhum modelo gpt-5* listado para esta chave.",
      );
    } catch {
      console.error("Também não consegui listar os modelos (chave inválida ou sem permissão?).");
    }
    process.exit(1);
  }
}

// ---- 2. Escolhe um orçamento real e reescreve o pedido
type Item = string[];
interface Orc {
  date?: string;
  items?: Item[];
  total?: string;
  prof_row?: string;
}
const orcamentos = JSON.parse(readFileSync("dados/orcamentos-37-extraidos.json", "utf8")) as Orc[];

interface Linha {
  qt: number;
  ambiente: string;
  codigo: string;
  categoria: string;
  descricao: string;
}
function linhasComCodigo(o: Orc): Linha[] {
  const r: Linha[] = [];
  (o.items ?? []).forEach((it, i) => {
    const l = lerLinha(it, normalizarData(o.date), i);
    if (!("ocorrencia" in l)) return;
    r.push({
      qt: Number(it[0]),
      ambiente: it.length >= 6 ? it[3] : "Geral",
      codigo: l.ocorrencia.codigo,
      categoria: l.ocorrencia.categoria,
      descricao: l.ocorrencia.descricao,
    });
  });
  return r;
}

const admin = createClient(
  exigir("NEXT_PUBLIC_SUPABASE_URL"),
  exigir("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const { data: catalogo } = await admin.from("produtos").select("codigo, preco_unitario, ativo");
const noCatalogo = new Map((catalogo ?? []).map((p) => [p.codigo, p]));

const DICIONARIO: [RegExp, string][] = [
  [/sala|estar|tv/i, "sala"],
  [/cozinha|copa|gourmet/i, "cozinha"],
  [/qt|quarto|su[ií]te|dorm/i, "quartos"],
  [/wc|banh|lavabo/i, "banheiros"],
  [/varanda|sacada/i, "varanda"],
  [/fachada|externa/i, "fachada"],
  [/loja/i, "loja"],
];

const indiceArg = process.argv.indexOf("--indice");
const candidatos = orcamentos
  .map((o, i) => ({ o, i, linhas: linhasComCodigo(o) }))
  .filter(
    (c) =>
      c.linhas.length >= 5 &&
      c.linhas.length <= 14 &&
      c.linhas.every((l) => noCatalogo.get(l.codigo)?.ativo) &&
      new Set(c.linhas.map((l) => l.ambiente)).size >= 2 &&
      // Ambientes padrão (sala, cozinha, quartos...), para um pedido natural.
      c.linhas.every((l) => DICIONARIO.some(([re]) => re.test(l.ambiente))),
  );
const escolhido =
  indiceArg >= 0
    ? candidatos.find((c) => c.i === Number(process.argv[indiceArg + 1]))
    : candidatos[0];
if (!escolhido)
  throw new Error("Nenhum orçamento adequado encontrado em dados/orcamentos-37-extraidos.json.");
const originais = escolhido.linhas;
console.log(`\nOrçamento de referência: #${escolhido.i} (${originais.length} itens com código).`);

const ambientesTexto = [...new Set(originais.map((l) => l.ambiente))];
const ambientes = new Set<string>();
const outros: string[] = [];
for (const a of ambientesTexto) {
  const achado = DICIONARIO.find(([re]) => re.test(a));
  if (achado) ambientes.add(achado[1]);
  else outros.push(a.toLowerCase());
}
if (outros.length) ambientes.add("outro");

// Pedido como a vendedora escreveria: por ambiente, quantidades e descrições, sem códigos nem nomes.
const pedido = ambientesTexto
  .map((a) => {
    const itens = originais
      .filter((l) => l.ambiente === a)
      .map((l) => `${l.qt} ${l.categoria.toLowerCase()} ${l.descricao.toLowerCase()}`);
    return `${a.toLowerCase()}: ${itens.join(", ")}`;
  })
  .join("\n");

const respostas = {
  versao: 1,
  teste_ia: "true",
  cliente_nome: "TESTE IA",
  cliente_whatsapp: "+5582900009980",
  tipo_cliente: /ARQUITETO\(A\)\s*:\s*\|\s*\S/.test(escolhido.o.prof_row ?? "")
    ? "arquiteto"
    : "final",
  ...(/ARQUITETO\(A\)\s*:\s*\|\s*\S/.test(escolhido.o.prof_row ?? "")
    ? { arquiteto_indicador: "Arquiteta (teste)" }
    : {}),
  tipo_obra: { uso: "residencial", estado: "nova" },
  ambientes: [...ambientes],
  ...(outros.length ? { ambiente_outro: outros.slice(0, 3).join(", ") } : {}),
  pedido_cliente: pedido,
  linha: "ambas",
  prazo: "encomenda",
};

if (soPedido) {
  console.log(
    `\nPedido reescrito:\n${pedido}\n\nRespostas:\n${JSON.stringify(respostas, null, 2)}`,
  );
  // Dá tempo de as conexões fecharem (evita um assert do libuv no Windows).
  setTimeout(() => process.exit(0), 200);
  await new Promise(() => undefined);
}

// ---- 3. Cria o rascunho como Aline e monta com a IA de verdade
const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const aline = createClient(url, exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const login = await aline.auth.signInWithPassword({
  email: exigir("SEED_EMAIL_ALINE"),
  password: exigir("SEED_SENHA_INICIAL"),
});
if (login.error || !login.data.user)
  throw new Error(`Login da Aline falhou: ${login.error?.message}`);
const alineId = login.data.user.id;

const cliente = await aline
  .from("clientes")
  .insert({ vendedora_id: alineId, nome: "TESTE IA", whatsapp: "+5582900009980" })
  .select("id")
  .single();
const orcamento = await aline
  .from("orcamentos")
  .insert({ vendedora_id: alineId, cliente_id: cliente.data!.id, respostas })
  .select("id")
  .single();
if (orcamento.error) throw new Error(orcamento.error.message);
const orcId = orcamento.data.id as string;

async function apagarTeste() {
  await admin.from("uso_ia").delete().eq("orcamento_id", orcId);
  await admin.from("orcamentos").delete().eq("id", orcId);
  await admin.from("clientes").delete().eq("id", cliente.data!.id);
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

try {
  console.log(
    "\nPedido enviado à IA:\n" +
      pedido
        .split("\n")
        .map((l) => "  " + l)
        .join("\n"),
  );
  console.log("\nMontando com a IA (pode levar até 2 minutos)...");
  const r = await montarOrcamento(
    {
      repo: criarRepositorioIA(aline, admin),
      ia: criarClienteIA(),
      executor: criarExecutorFerramentas(aline),
      config,
    },
    alineId,
    orcId,
  );

  if (!r.ok) {
    console.error(`\nFALHOU (${r.motivo}): ${r.erro}`);
    const { data: uso } = await admin
      .from("uso_ia")
      .select("erro, duracao_ms")
      .eq("orcamento_id", orcId)
      .order("criado_em", { ascending: false })
      .limit(1);
    if (uso?.[0]?.erro) console.error(`Detalhe técnico: ${uso[0].erro}`);
    process.exitCode = 1;
  } else {
    console.log("\n=== Itens montados ===");
    let ambienteAtual = "";
    for (const i of r.itensMontados) {
      if (i.ambiente !== ambienteAtual) {
        ambienteAtual = i.ambiente;
        console.log(`\n${ambienteAtual}`);
      }
      const preco = i.avulso ? "preço a definir" : moeda(i.preco_unitario_congelado);
      console.log(
        `  ${(i.codigo ?? "avulso").padEnd(6)} ${String(i.quantidade).padStart(6)} x ${i.descricao_congelada} (${preco})`,
      );
      if (i.justificativa) console.log(`         ${i.justificativa}`);
    }

    const escolhidos = new Set(r.itensMontados.filter((i) => !i.avulso).map((i) => i.codigo!));
    const esperados = new Set(originais.map((l) => l.codigo));
    const comuns = [...escolhidos].filter((c) => esperados.has(c));
    const totalOriginal = Number(escolhido.o.total ?? 0);

    console.log("\n=== Resumo ===");
    console.log(`Itens: ${r.itens} (${r.itensMontados.filter((i) => i.avulso).length} avulsos)`);
    console.log(
      `Total montado: ${moeda(r.totalCentavos / 100)} | total do orçamento original: ${totalOriginal ? moeda(totalOriginal) : "n/d"}`,
    );
    console.log(
      `Códigos em comum com o original: ${comuns.length} de ${esperados.size} do original ` +
        `(e ${escolhidos.size - comuns.length} a mais que a IA escolheu)`,
    );
    console.log(`  em comum: ${comuns.join(", ") || "nenhum"}`);
    console.log(
      `  só no original: ${[...esperados].filter((c) => !escolhidos.has(c)).join(", ") || "nenhum"}`,
    );
    console.log(
      `  só na IA: ${[...escolhidos].filter((c) => !esperados.has(c)).join(", ") || "nenhum"}`,
    );
    console.log(
      `Tokens: ${r.tokensEntrada} entrada, ${r.tokensSaida} saída | ferramentas chamadas: ${r.chamadasFerramenta}`,
    );
    console.log(
      r.custoConhecido
        ? `Custo estimado: US$ ${r.custoUsd.toFixed(4)}`
        : "Custo: defina IA_PRECO_ENTRADA_USD_MTOK e IA_PRECO_SAIDA_USD_MTOK no .env.local para estimar.",
    );
    console.log(`Tempo: ${(r.duracaoMs / 1000).toFixed(1)} s`);
    if (r.pendencias.length)
      console.log("Pendências:\n" + r.pendencias.map((p) => "  - " + p).join("\n"));
    if (r.avisos.length) console.log("Avisos:\n" + r.avisos.map((a) => "  - " + a).join("\n"));
    console.log(`Resumo da IA: ${r.resumo}`);
  }
} finally {
  await apagarTeste();
  console.log("\nRascunho de teste apagado.");
}
