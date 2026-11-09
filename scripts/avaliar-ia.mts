// Avaliação do motor de IA com 10 orçamentos reais (chama a OpenAI de verdade e custa dinheiro).
// Uso: pnpm ia:avaliar [--rodada N] [--indices 0,33] [--so-relatorio]
//  - monta, como Aline, um rascunho de teste para cada pedido de dados/avaliacao/pedidos.json;
//  - compara com o orçamento real e grava dados/avaliacao/rodada-N.json e relatorio-ia.md;
//  - apaga os rascunhos de teste e devolve o contador de numeração.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { criarClienteIA } from "../src/lib/ia/cliente";
import { lerConfigIA } from "../src/lib/ia/config";
import { criarExecutorFerramentas } from "../src/lib/ia/ferramentas";
import { mencionaAnexo } from "../src/lib/ia/texto-cliente";
import { montarOrcamento } from "../src/lib/ia/montar";
import { criarRepositorioIA } from "../src/lib/ia/repositorio-ia";
import { lerLinha, normalizarData } from "../src/lib/estoque/provisorio";

const PASTA = "dados/avaliacao";
const CAMBIO = 5.5; // US$ 1 = R$ 5,50 (estimativa)
const MAIN = new Set([
  "EMBUTIDO",
  "SPOT",
  "PLAFON",
  "PENDENTE",
  "ARANDELA",
  "TRILHO",
  "FITA LED",
  "PERFIL",
  "FONTE",
  "BALIZADOR",
  "ESPETO",
  "TRANSFORMADOR",
  "ABAJUR",
]);
const VALOR_AMBIENTE: Record<string, string> = {
  Sala: "sala",
  Cozinha: "cozinha",
  Quartos: "quartos",
  Banheiros: "banheiros",
  Varanda: "varanda",
  Fachada: "fachada",
  Loja: "loja",
};

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável ${nome} ausente no .env.local`);
  return v;
}
const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const rodada = Number(arg("--rodada") ?? 1);
const soRelatorio = process.argv.includes("--so-relatorio");
const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const usd = (n: number) => `US$ ${n.toFixed(4)}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

interface Pedido {
  indice: number;
  descricao: string;
  tipo_cliente: string;
  tipo_obra: { uso: string; estado: string };
  ambientes: string[];
  ambiente_outro?: string;
  ambientes_originais: Record<string, string>;
  linha: string;
  faixa_investimento: string | null;
  prazo: string;
  pedido_cliente: string;
  observacoes: string | null;
}

interface Produto {
  codigo: string;
  categoria: string | null;
  descricao: string;
  preco_unitario: number;
  atributos: { w?: number; k?: number; comprimento?: number } | null;
}

interface Resultado {
  indice: number;
  descricao: string;
  ok: boolean;
  erro?: string;
  itens?: number;
  avulsos?: number;
  descartados?: number;
  totalIA?: number;
  totalOriginal?: number;
  difTotalPct?: number | null;
  categoriaAmbientesTodas?: number; // 0-1
  categoriaAmbientesAlguma?: number;
  ambientesAvaliados?: number;
  codigosOriginais?: number;
  codigosIA?: number;
  exatos?: number;
  equivalentes?: number;
  precisao?: number;
  kitsOriginais?: number;
  kitsCompletos?: number;
  ambientesSemAnalise?: string[];
  itensSemMotivo?: number;
  analisesCitandoAnexoSemAnexo?: string[];
  possiveisInvencoes?: string[];
  custoUsd?: number;
  duracaoS?: number;
  tokensEntrada?: number;
  tokensSaida?: number;
  chamadasFerramenta?: number;
  exemploAnalises?: { ambiente: string; analise: string }[];
  exemploMotivos?: { item: string; motivo: string }[];
  pendencias?: number;
  detalhe?: { ia: string[]; original: string[]; avisos: string[]; pend: string[] };
  codigosInventadosGravados?: number;
}

function atributosParecidos(a: Produto, b: Produto): boolean {
  const wa = a.atributos?.w,
    wb = b.atributos?.w,
    ka = a.atributos?.k,
    kb = b.atributos?.k;
  if (wa !== undefined && wb !== undefined && Math.abs(wa - wb) > Math.max(1, wa * 0.3))
    return false;
  if (ka !== undefined && kb !== undefined && Math.abs(ka - kb) > 500) return false;
  return true;
}

/** Afirmações específicas que não aparecem no pedido (heurística, para revisar à mão). */
function possiveisInvencoes(texto: string, pedido: string): string[] {
  const base = pedido.toLowerCase();
  const achados: string[] = [];
  for (const m of texto.matchAll(
    /\b(\d+(?:[.,]\d+)?)\s*(m²|m2|metros? quadrados?|cm|metros?|m)\b/gi,
  )) {
    const numero = m[1];
    if (!base.includes(numero)) achados.push(`medida "${m[0]}"`);
  }
  for (const palavra of [
    "madeira",
    "mármore",
    "granito",
    "porcelanato",
    "azulejo",
    "concreto aparente",
    "tijolo",
    "cinza",
    "bege",
    "azul",
    "verde",
    "preto fosco",
    "dourado",
    "pé-direito alto",
    "pé-direito baixo",
    "janela",
    "luz natural abundante",
  ]) {
    if (texto.toLowerCase().includes(palavra) && !base.includes(palavra))
      achados.push(`"${palavra}"`);
  }
  return achados;
}

async function executar(): Promise<Resultado[]> {
  const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
  const opc = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, exigir("SUPABASE_SERVICE_ROLE_KEY"), opc);
  const aline = createClient(url, exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY"), opc);
  const login = await aline.auth.signInWithPassword({
    email: exigir("SEED_EMAIL_ALINE"),
    password: exigir("SEED_SENHA_INICIAL"),
  });
  if (login.error || !login.data.user)
    throw new Error(`Login da Aline falhou: ${login.error?.message}`);
  const alineId = login.data.user.id;

  const { pedidos } = JSON.parse(readFileSync(`${PASTA}/pedidos.json`, "utf8")) as {
    pedidos: Pedido[];
  };
  const reais = JSON.parse(readFileSync("dados/orcamentos-37-extraidos.json", "utf8")) as {
    date?: string;
    items?: string[][];
    total?: string;
  }[];
  const { data: catalogo } = await admin
    .from("produtos")
    .select("codigo, categoria, descricao, preco_unitario, atributos");
  const produto = new Map(
    (catalogo ?? []).map((p) => [
      p.codigo,
      { ...p, preco_unitario: Number(p.preco_unitario) } as Produto,
    ]),
  );

  const filtro = arg("--indices")?.split(",").map(Number);
  const lista = filtro ? pedidos.filter((p) => filtro.includes(p.indice)) : pedidos;
  const config = { ...lerConfigIA(), limiteDiario: 1000, maxGeracoesPorOrcamento: 99 };
  console.log(`Modelo: ${config.modelo} | rodada ${rodada} | ${lista.length} orçamentos`);

  const criados: string[] = [];
  const resultados: Resultado[] = [];

  async function limpar() {
    if (criados.length) {
      await admin.from("uso_ia").delete().in("orcamento_id", criados);
      await admin.from("orcamentos").delete().in("id", criados);
    }
    await admin.from("clientes").delete().like("nome", "TESTE AVALIACAO%");
    const { data: n } = await admin.from("orcamentos").select("numero").like("numero", "2026-%");
    await admin
      .from("orcamento_contador")
      .update({ ultimo: Math.max(0, ...(n ?? []).map((x) => Number(String(x.numero).slice(5)))) })
      .eq("ano", 2026);
  }

  try {
    for (const p of lista) {
      const original = reais[p.indice];
      const origLinhas = (original.items ?? [])
        .map((it, k) => {
          const l = lerLinha(it, normalizarData(original.date), k);
          return "ocorrencia" in l
            ? {
                codigo: l.ocorrencia.codigo,
                ambOriginal: it.length >= 6 ? it[3] : "?",
                qt: Number(it[0]),
              }
            : null;
        })
        .filter((x): x is { codigo: string; ambOriginal: string; qt: number } => x !== null);
      const rotulo = (a: string) =>
        p.ambientes_originais[a] ?? p.ambientes_originais["?"] ?? "Geral";

      const respostas: Record<string, unknown> = {
        versao: 1,
        teste_avaliacao: "true",
        cliente_nome: `TESTE AVALIACAO ${p.indice}`,
        cliente_whatsapp: `+55829000${String(1000 + p.indice).slice(-4)}`,
        tipo_cliente: p.tipo_cliente,
        ...(p.tipo_cliente === "arquiteto" ? { arquiteto_indicador: "Arquiteta (teste)" } : {}),
        tipo_obra: p.tipo_obra,
        ambientes: p.ambientes
          .map((a) => (a === "outro" ? "outro" : (VALOR_AMBIENTE[a] ?? a)))
          .filter(Boolean),
        ...(p.ambiente_outro ? { ambiente_outro: p.ambiente_outro } : {}),
        pedido_cliente: p.pedido_cliente,
        linha: p.linha,
        ...(p.faixa_investimento ? { faixa_investimento: p.faixa_investimento } : {}),
        prazo: p.prazo,
        ...(p.observacoes ? { observacoes: p.observacoes } : {}),
      };
      // Os ambientes do pedido já vêm como valores ("sala", "outro"); só normaliza maiúsculas.
      respostas.ambientes = p.ambientes.map((a) => a.toLowerCase());

      const cli = await aline
        .from("clientes")
        .insert({
          vendedora_id: alineId,
          nome: `TESTE AVALIACAO ${p.indice}`,
          whatsapp: respostas.cliente_whatsapp as string,
        })
        .select("id")
        .single();
      const orc = await aline
        .from("orcamentos")
        .insert({ vendedora_id: alineId, cliente_id: cli.data!.id, respostas })
        .select("id")
        .single();
      if (orc.error) throw new Error(orc.error.message);
      const id = orc.data.id as string;
      criados.push(id);

      process.stdout.write(`#${p.indice} ... `);
      const t0 = Date.now();
      const r = await montarOrcamento(
        {
          repo: criarRepositorioIA(aline, admin),
          ia: criarClienteIA(),
          executor: criarExecutorFerramentas(aline),
          config,
        },
        alineId,
        id,
      );
      if (!r.ok) {
        console.log(`FALHOU: ${r.erro}`);
        resultados.push({ indice: p.indice, descricao: p.descricao, ok: false, erro: r.erro });
        continue;
      }

      // ---- métricas
      const cat = (codigo: string | null) =>
        codigo ? (produto.get(codigo)?.categoria ?? null) : null;
      const grupos = new Map<string, { orig: Set<string>; ia: Set<string>; codsOrig: string[] }>();
      const grupo = (n: string) => {
        const k = n.trim().toLowerCase();
        if (!grupos.has(k)) grupos.set(k, { orig: new Set(), ia: new Set(), codsOrig: [] });
        return grupos.get(k)!;
      };
      for (const l of origLinhas) {
        const g = grupo(rotulo(l.ambOriginal));
        const c = cat(l.codigo);
        if (c && MAIN.has(c)) g.orig.add(c);
        g.codsOrig.push(l.codigo);
      }
      for (const i of r.itensMontados) {
        const c = cat(i.codigo);
        if (c && MAIN.has(c)) grupo(i.ambiente).ia.add(c);
      }
      const avaliaveis = [...grupos.values()].filter((g) => g.orig.size > 0);
      const todas = avaliaveis.filter((g) => [...g.orig].every((c) => g.ia.has(c))).length;
      const alguma = avaliaveis.filter((g) => [...g.orig].some((c) => g.ia.has(c))).length;

      const O = new Set(origLinhas.map((l) => l.codigo));
      const I = new Set(r.itensMontados.filter((i) => !i.avulso).map((i) => i.codigo!));
      const exatos = [...O].filter((c) => I.has(c)).length;
      const sobrasIA = [...I]
        .filter((c) => !O.has(c))
        .map((c) => produto.get(c))
        .filter((x): x is Produto => !!x);
      let equivalentes = 0;
      for (const co of [...O].filter((c) => !I.has(c))) {
        const po = produto.get(co);
        const idx = sobrasIA.findIndex(
          (pi) => po && pi.categoria === po.categoria && atributosParecidos(po, pi),
        );
        if (idx >= 0) {
          equivalentes++;
          sobrasIA.splice(idx, 1);
        }
      }

      // kits de fita
      let kitsOrig = 0,
        kitsOk = 0;
      for (const g of grupos.values()) {
        if (!g.orig.has("FITA LED")) continue;
        kitsOrig++;
        const completo =
          g.ia.has("FITA LED") &&
          (!g.orig.has("PERFIL") || g.ia.has("PERFIL")) &&
          (!g.orig.has("FONTE") || g.ia.has("FONTE"));
        if (completo) kitsOk++;
      }

      const textoPedido = `${p.pedido_cliente} ${p.observacoes ?? ""} ${p.ambientes.join(" ")} ${p.ambiente_outro ?? ""}`;
      const semAnalise = r.ambientesMontados.filter((a) => !a.analise.trim()).map((a) => a.nome);
      const semMotivo = r.itensMontados.filter((i) => !i.motivo_cliente.trim()).length;
      const citaAnexo = r.ambientesMontados
        .filter((a) => a.analise && mencionaAnexo(a.analise))
        .map((a) => `${a.nome}: ${a.analise}`);
      const invencoes = [
        ...r.ambientesMontados.flatMap((a) =>
          possiveisInvencoes(a.analise, textoPedido).map((x) => `análise de ${a.nome}: ${x}`),
        ),
        ...r.itensMontados.flatMap((i) =>
          possiveisInvencoes(i.motivo_cliente, textoPedido).map(
            (x) => `motivo de ${i.codigo ?? "avulso"}: ${x}`,
          ),
        ),
      ];

      const totalOriginal = Number(original.total ?? 0);
      const totalIA = r.totalCentavos / 100;
      const inventadosGravados = r.itensMontados.filter(
        (i) => !i.avulso && !produto.has(i.codigo!),
      ).length;
      const res: Resultado = {
        indice: p.indice,
        descricao: p.descricao,
        ok: true,
        itens: r.itens,
        avulsos: r.itensMontados.filter((i) => i.avulso).length,
        descartados: r.avisos.filter((a) => /descartado/i.test(a) && /não existe|inativo/i.test(a))
          .length,
        totalIA,
        totalOriginal,
        difTotalPct: totalOriginal > 0 ? ((totalIA - totalOriginal) / totalOriginal) * 100 : null,
        categoriaAmbientesTodas: avaliaveis.length ? todas / avaliaveis.length : undefined,
        categoriaAmbientesAlguma: avaliaveis.length ? alguma / avaliaveis.length : undefined,
        ambientesAvaliados: avaliaveis.length,
        codigosOriginais: O.size,
        codigosIA: I.size,
        exatos,
        equivalentes,
        precisao: I.size ? exatos / I.size : undefined,
        kitsOriginais: kitsOrig,
        kitsCompletos: kitsOk,
        ambientesSemAnalise: semAnalise,
        itensSemMotivo: semMotivo,
        analisesCitandoAnexoSemAnexo: citaAnexo,
        possiveisInvencoes: invencoes,
        custoUsd: r.custoUsd,
        duracaoS: r.duracaoMs / 1000,
        tokensEntrada: r.tokensEntrada,
        tokensSaida: r.tokensSaida,
        chamadasFerramenta: r.chamadasFerramenta,
        exemploAnalises: r.ambientesMontados
          .slice(0, 2)
          .map((a) => ({ ambiente: a.nome, analise: a.analise })),
        exemploMotivos: r.itensMontados
          .slice(0, 3)
          .map((i) => ({ item: i.descricao_congelada, motivo: i.motivo_cliente })),
        pendencias: r.pendencias.length,
        detalhe: {
          ia: r.itensMontados.map(
            (i) =>
              `${i.ambiente} | ${i.quantidade}x ${i.avulso ? "AVULSO" : i.codigo} | ${i.avulso ? "" : (produto.get(i.codigo!)?.categoria ?? "?")} | ${i.descricao_congelada}`,
          ),
          original: origLinhas.map(
            (l) =>
              `${rotulo(l.ambOriginal)} | ${l.qt}x ${l.codigo} | ${produto.get(l.codigo)?.categoria ?? "?"} | ${produto.get(l.codigo)?.descricao ?? ""}`,
          ),
          avisos: r.avisos,
          pend: r.pendencias,
        },
        codigosInventadosGravados: inventadosGravados,
      };
      resultados.push(res);
      console.log(
        `${r.itens} itens, ${usd(r.custoUsd)}, ${((Date.now() - t0) / 1000) | 0}s, exatos ${exatos}/${O.size}, total ${res.difTotalPct === null ? "n/d" : `${res.difTotalPct!.toFixed(0)}%`}`,
      );
    }
  } finally {
    await limpar();
    console.log("Rascunhos de teste apagados.");
  }
  return resultados;
}

// ---------------------------------------------------------------- relatório

const media = (xs: (number | undefined | null)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};
const soma = (xs: (number | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

function resumo(rs: Resultado[]) {
  const ok = rs.filter((r) => r.ok);
  const amb = soma(ok.map((r) => r.ambientesAvaliados));
  const ponderado = (campo: "categoriaAmbientesTodas" | "categoriaAmbientesAlguma") =>
    amb ? soma(ok.map((r) => (r[campo] ?? 0) * (r.ambientesAvaliados ?? 0))) / amb : NaN;
  const dentro30 = ok.filter(
    (r) => r.difTotalPct !== null && r.difTotalPct !== undefined && Math.abs(r.difTotalPct) <= 30,
  ).length;
  return {
    n: rs.length,
    ok: ok.length,
    categoriaTodas: ponderado("categoriaAmbientesTodas"),
    categoriaAlguma: ponderado("categoriaAmbientesAlguma"),
    recall: soma(ok.map((r) => r.exatos)) / Math.max(1, soma(ok.map((r) => r.codigosOriginais))),
    recallComEquiv:
      (soma(ok.map((r) => r.exatos)) + soma(ok.map((r) => r.equivalentes))) /
      Math.max(1, soma(ok.map((r) => r.codigosOriginais))),
    precisao: soma(ok.map((r) => r.exatos)) / Math.max(1, soma(ok.map((r) => r.codigosIA))),
    difMedia: media(ok.map((r) => r.difTotalPct)),
    difAbsMedia: media(
      ok.map((r) =>
        r.difTotalPct === null || r.difTotalPct === undefined ? undefined : Math.abs(r.difTotalPct),
      ),
    ),
    dentro30,
    avulsos: soma(ok.map((r) => r.avulsos)),
    descartados: soma(ok.map((r) => r.descartados)),
    inventadosGravados: soma(ok.map((r) => r.codigosInventadosGravados)),
    kits: soma(ok.map((r) => r.kitsCompletos)) / Math.max(1, soma(ok.map((r) => r.kitsOriginais))),
    kitsN: `${soma(ok.map((r) => r.kitsCompletos))}/${soma(ok.map((r) => r.kitsOriginais))}`,
    semAnalise: soma(ok.map((r) => r.ambientesSemAnalise?.length)),
    semMotivo: soma(ok.map((r) => r.itensSemMotivo)),
    citaAnexo: soma(ok.map((r) => r.analisesCitandoAnexoSemAnexo?.length)),
    invencoes: soma(ok.map((r) => r.possiveisInvencoes?.length)),
    custo: soma(ok.map((r) => r.custoUsd)),
    custoMedio: media(ok.map((r) => r.custoUsd)),
    tempoMedio: media(ok.map((r) => r.duracaoS)),
  };
}

function gerarRelatorio(): string {
  const arquivos = readdirSync(PASTA)
    .filter((f) => /^rodada-\d+\.json$/.test(f))
    .sort();
  const rodadas = arquivos.map((f) => ({
    n: Number(f.match(/\d+/)![0]),
    ...(JSON.parse(readFileSync(`${PASTA}/${f}`, "utf8")) as {
      modelo: string;
      resultados: Resultado[];
    }),
  }));
  if (rodadas.length === 0) return "Sem rodadas.";
  const ultima = rodadas.at(-1)!;
  const R = rodadas.map((r) => ({ n: r.n, modelo: r.modelo, s: resumo(r.resultados) }));
  const custoTotal = R.reduce((a, r) => a + r.s.custo, 0);

  const L: string[] = [];
  L.push("# Avaliação da IA com 10 orçamentos reais", "");
  L.push(
    `Modelo: \`${ultima.modelo}\`. Rodadas executadas: ${rodadas.length}. Custo total das avaliações: **${usd(custoTotal)}** (≈ ${moeda(custoTotal * CAMBIO)} a US$ 1 = R$ 5,50, estimativa).`,
  );
  if (custoTotal > 5) L.push("", `> Atenção: o custo total passou de US$ 5.`);
  L.push(
    "",
    "Metas: zero código inventado gravado; categoria certa em pelo menos 80% dos ambientes; total dentro de ±30% do original na maioria dos casos.",
    "",
  );

  L.push("## Antes e depois (resumo por rodada)", "");
  L.push(
    `| Métrica | ${R.map((r) => `Rodada ${r.n}`).join(" | ")} |`,
    `| --- | ${R.map(() => "---:").join(" | ")} |`,
  );
  const linha = (nome: string, f: (s: ReturnType<typeof resumo>) => string) =>
    L.push(`| ${nome} | ${R.map((r) => f(r.s)).join(" | ")} |`);
  linha("Orçamentos montados", (s) => `${s.ok}/${s.n}`);
  linha("Categoria certa por ambiente (todas as categorias)", (s) => pct(s.categoriaTodas));
  linha("Categoria certa por ambiente (pelo menos uma)", (s) => pct(s.categoriaAlguma));
  linha("Códigos exatos do original encontrados", (s) => pct(s.recall));
  linha("... contando equivalentes", (s) => pct(s.recallComEquiv));
  linha("Precisão (códigos da IA que estavam no original)", (s) => pct(s.precisao));
  linha(
    "Diferença média do total",
    (s) => `${s.difMedia >= 0 ? "+" : ""}${s.difMedia.toFixed(0)}%`,
  );
  linha("Diferença absoluta média do total", (s) => `${s.difAbsMedia.toFixed(0)}%`);
  linha("Orçamentos com total dentro de ±30%", (s) => `${s.dentro30}/${s.ok}`);
  linha("Kits de fita completos (perfil + fita + fonte)", (s) => `${pct(s.kits)} (${s.kitsN})`);
  linha("Itens avulsos", (s) => String(s.avulsos));
  linha("Códigos inventados descartados", (s) => String(s.descartados));
  linha("Códigos inventados GRAVADOS", (s) => String(s.inventadosGravados));
  linha("Ambientes sem análise", (s) => String(s.semAnalise));
  linha("Itens sem motivo", (s) => String(s.semMotivo));
  linha("Análises citando foto/planta sem anexo", (s) => String(s.citaAnexo));
  linha("Possíveis afirmações sem base (heurística)", (s) => String(s.invencoes));
  linha("Custo total", (s) => usd(s.custo));
  linha("Custo médio por orçamento (US$)", (s) => usd(s.custoMedio));
  linha("Custo médio por orçamento (R$, estimativa)", (s) => moeda(s.custoMedio * CAMBIO));
  linha("Tempo médio", (s) => `${s.tempoMedio.toFixed(0)} s`);

  for (const rod of rodadas) {
    L.push("", `## Rodada ${rod.n}: por orçamento`, "");
    L.push(
      "| # | Descrição | Itens | Total IA | Total original | Dif. | Cat. todas | Exatos | Equiv. | Avulsos | Descart. | Kits | Custo | Tempo |",
      "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const r of rod.resultados) {
      if (!r.ok) {
        L.push(`| ${r.indice} | ${r.descricao} | FALHOU: ${r.erro} |||||||||||| |`);
        continue;
      }
      L.push(
        `| ${r.indice} | ${r.descricao} | ${r.itens} | ${moeda(r.totalIA!)} | ${moeda(r.totalOriginal!)} | ${r.difTotalPct === null ? "n/d" : `${r.difTotalPct!.toFixed(0)}%`} | ${r.categoriaAmbientesTodas === undefined ? "n/d" : pct(r.categoriaAmbientesTodas)} | ${r.exatos}/${r.codigosOriginais} | ${r.equivalentes} | ${r.avulsos} | ${r.descartados} | ${r.kitsOriginais ? `${r.kitsCompletos}/${r.kitsOriginais}` : "-"} | ${usd(r.custoUsd!)} | ${r.duracaoS!.toFixed(0)} s |`,
      );
    }
  }

  const ult = ultima.resultados.filter((r) => r.ok);
  L.push("", "## Exemplos de análise do ambiente (rodada mais recente)", "");
  for (const r of ult
    .slice(0, 6)
    .flatMap((x) => (x.exemploAnalises ?? []).slice(0, 1).map((a) => ({ i: x.indice, ...a })))
    .slice(0, 3))
    L.push(`- **#${r.i} · ${r.ambiente}:** ${r.analise}`);
  L.push("", "## Exemplos de motivo por produto (rodada mais recente)", "");
  for (const r of ult
    .flatMap((x) => (x.exemploMotivos ?? []).slice(0, 1).map((m) => ({ i: x.indice, ...m })))
    .slice(0, 5))
    L.push(`- **#${r.i} · ${r.item}:** ${r.motivo}`);

  const alertas = ult.flatMap((r) => [
    ...(r.possiveisInvencoes ?? []).map((x) => `#${r.indice}: ${x}`),
    ...(r.analisesCitandoAnexoSemAnexo ?? []).map((x) => `#${r.indice} cita anexo sem anexo: ${x}`),
  ]);
  L.push("", "## Para revisar à mão (rodada mais recente)", "");
  L.push(
    alertas.length ? alertas.map((a) => `- ${a}`).join("\n") : "Nada marcado pela heurística.",
  );
  return L.join("\n") + "\n";
}

if (!soRelatorio) {
  const resultados = await executar();
  writeFileSync(
    `${PASTA}/rodada-${rodada}.json`,
    JSON.stringify({ modelo: lerConfigIA().modelo, resultados }, null, 2),
  );
  const s = resumo(resultados);
  console.log(
    `\nRodada ${rodada}: custo ${usd(s.custo)} (médio ${usd(s.custoMedio)}), categoria ${pct(s.categoriaTodas)}, exatos ${pct(s.recall)}, dif. total abs. ${s.difAbsMedia.toFixed(0)}%`,
  );
}
if (existsSync(`${PASTA}/rodada-${rodada}.json`) || soRelatorio) {
  writeFileSync(`${PASTA}/relatorio-ia.md`, gerarRelatorio());
  console.log(`Relatório: ${PASTA}/relatorio-ia.md`);
}
setTimeout(() => process.exit(process.exitCode ?? 0), 300);
await new Promise(() => undefined);
