// Avaliação da Indicação da IA em 5 ambientes de dados/avaliacao/pedidos.json (chama a OpenAI de verdade
// e custa dinheiro; a meta é ficar abaixo de US$ 1 por rodada).
// Uso: pnpm ia:avaliar [--rodada N] [--casos cozinha-27,adega-2] [--so-relatorio]
// Para cada caso: cria um rascunho de teste como Aline, pede a indicação, compara com o orçamento real
// (categorias, códigos exatos e equivalentes, kits de fita, o que o arquiteto exigiu) e apaga o rascunho.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { criarClienteIA } from "../src/lib/ia/cliente";
import { lerConfigIA } from "../src/lib/ia/config";
import { criarExecutorFerramentas } from "../src/lib/ia/ferramentas";
import { pedirIndicacao } from "../src/lib/ia/indicacao";
import { criarRepositorioIA } from "../src/lib/ia/repositorio-ia";
import {
  criarRascunho,
  entrar,
  lerPedidos,
  limparTestes,
  linhasOriginais,
  moeda,
  usd,
} from "./ia-comum";

const PASTA = "dados/avaliacao";
const CAMBIO = 5.5; // US$ 1 = R$ 5,50 (estimativa)
const TETO_USD = 1;

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const rodada = Number(arg("--rodada") ?? 1);
const soRelatorio = process.argv.includes("--so-relatorio");
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

interface ResultadoCaso {
  id: string;
  descricao: string;
  ambiente: string;
  arquiteto: boolean;
  ok: boolean;
  erro?: string;
  sugestoes?: { codigo: string; categoria: string | null; quantidade: number; descricao: string }[];
  codigosInventados?: number;
  categoriasEsperadas?: string[];
  categoriasOk?: boolean;
  codigosOriginais?: number;
  exatos?: number;
  equivalentes?: number;
  kitCompleto?: boolean | null;
  exigenciasCumpridas?: number;
  exigenciasTotais?: number;
  resumo?: string;
  observacoes?: string[];
  custoUsd?: number;
  duracaoS?: number;
  consultas?: number;
}

async function executar(): Promise<ResultadoCaso[]> {
  const { admin, aline, alineId } = await entrar();
  const { pedidos, indicacoes } = lerPedidos();
  const filtro = arg("--casos")?.split(",");
  const casos = filtro ? indicacoes.filter((c) => filtro.includes(c.id)) : indicacoes;
  const config = { ...lerConfigIA(), limiteDiario: 1000 };
  console.log(`Modelo: ${config.modelo} | rodada ${rodada} | ${casos.length} ambientes`);

  const { data: catalogo } = await admin
    .from("produtos")
    .select("codigo, categoria, atributos, ativo");
  const produto = new Map((catalogo ?? []).map((p) => [p.codigo as string, p]));

  const deps = {
    repo: criarRepositorioIA(aline, admin),
    ia: criarClienteIA(),
    executor: criarExecutorFerramentas(aline),
    config,
  };
  const criados: string[] = [];
  const resultados: ResultadoCaso[] = [];
  let acumulado = 0;

  try {
    for (const caso of casos) {
      if (acumulado > TETO_USD) {
        console.log(`Teto de ${usd(TETO_USD)} atingido: parei antes de ${caso.id}.`);
        break;
      }
      const pedido = pedidos.find((p) => p.indice === caso.indice)!;
      const arquiteto = Boolean(caso.pedido_arquiteto);
      const id = await criarRascunho(aline, alineId, pedido, caso.id, {
        arquiteto,
        pedidoCliente: caso.pedido_cliente,
      });
      criados.push(id);

      process.stdout.write(`${caso.id} ... `);
      const r = await pedirIndicacao(deps, alineId, {
        orcamentoId: id,
        ambiente: caso.ambiente,
        pedidoCliente: caso.pedido_cliente,
        pedidoArquiteto: caso.pedido_arquiteto,
        descricaoAmbiente: caso.descricao_ambiente,
        usarAnexos: false,
      });
      const base = { id: caso.id, descricao: caso.descricao, ambiente: caso.ambiente, arquiteto };
      if (!r.ok) {
        console.log(`FALHOU: ${r.erro}`);
        resultados.push({ ...base, ok: false, erro: r.erro });
        continue;
      }
      acumulado += r.custoUsd;

      const sugeridos = r.sugestoes.map((s) => s.codigo);
      const categorias = new Set(r.sugestoes.map((s) => s.categoria));
      const originais = linhasOriginais(pedido).filter(
        (l) => l.ambiente.toLowerCase() === caso.ambiente.toLowerCase(),
      );
      const codigosOriginais = [...new Set(originais.map((l) => l.codigo))];
      const exatos = codigosOriginais.filter((c) => sugeridos.includes(c)).length;
      // Equivalente: mesma categoria e mesma potência/temperatura (±30% e ±500 K) de um original que faltou.
      const sobras = r.sugestoes.filter((s) => !codigosOriginais.includes(s.codigo));
      let equivalentes = 0;
      for (const co of codigosOriginais.filter((c) => !sugeridos.includes(c))) {
        const po = produto.get(co);
        const idx = sobras.findIndex((s) => {
          const ps = produto.get(s.codigo);
          if (!po || !ps || po.categoria !== ps.categoria) return false;
          const wo = (po.atributos as { w?: number })?.w;
          const ws = (ps.atributos as { w?: number })?.w;
          const ko = (po.atributos as { k?: number })?.k;
          const ks = (ps.atributos as { k?: number })?.k;
          if (wo !== undefined && ws !== undefined && Math.abs(wo - ws) > Math.max(1, wo * 0.3))
            return false;
          if (ko !== undefined && ks !== undefined && Math.abs(ko - ks) > 500) return false;
          return true;
        });
        if (idx >= 0) {
          equivalentes++;
          sobras.splice(idx, 1);
        }
      }

      const temFita = caso.categorias_esperadas.includes("FITA LED");
      const exigenciasCumpridas = caso.exigencias.filter((e) =>
        r.sugestoes.some((s) => {
          const at = (produto.get(s.codigo)?.atributos ?? {}) as { w?: number; k?: number };
          return (
            s.categoria === e.categoria &&
            at.w !== undefined &&
            Math.abs(at.w - e.w) < 0.01 &&
            at.k === e.k
          );
        }),
      ).length;
      const descartados = r.avisos.filter((a) => /não existe|inativo/.test(a)).length;

      const res: ResultadoCaso = {
        ...base,
        ok: true,
        sugestoes: r.sugestoes.map((s) => ({
          codigo: s.codigo,
          categoria: s.categoria,
          quantidade: s.quantidade,
          descricao: s.descricao,
        })),
        codigosInventados: descartados,
        categoriasEsperadas: caso.categorias_esperadas,
        categoriasOk: caso.categorias_esperadas.every((c) => categorias.has(c)),
        codigosOriginais: codigosOriginais.length,
        exatos,
        equivalentes,
        kitCompleto: temFita
          ? ["FITA LED", "PERFIL", "FONTE"].every((c) => categorias.has(c))
          : null,
        exigenciasCumpridas,
        exigenciasTotais: caso.exigencias.length,
        resumo: r.resumo,
        observacoes: r.observacoes,
        custoUsd: r.custoUsd,
        duracaoS: r.duracaoMs / 1000,
        consultas: r.chamadasFerramenta,
      };
      resultados.push(res);
      console.log(
        `${r.sugestoes.length} sugestões, ${usd(r.custoUsd)}, ${res.duracaoS!.toFixed(0)}s, categorias ${res.categoriasOk ? "ok" : "FALTAM"}, exatos ${exatos}/${codigosOriginais.length}`,
      );
    }
  } finally {
    await limparTestes(admin, criados);
    console.log("Rascunhos de teste apagados.");
  }
  return resultados;
}

// ---------------------------------------------------------------- relatório

const soma = (xs: (number | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

function resumo(rs: ResultadoCaso[]) {
  const ok = rs.filter((r) => r.ok);
  const exig = soma(ok.map((r) => r.exigenciasTotais));
  const kits = ok.filter((r) => r.kitCompleto !== null && r.kitCompleto !== undefined);
  return {
    ok: ok.length,
    n: rs.length,
    categorias: ok.filter((r) => r.categoriasOk).length,
    exatos: soma(ok.map((r) => r.exatos)),
    equivalentes: soma(ok.map((r) => r.equivalentes)),
    originais: soma(ok.map((r) => r.codigosOriginais)),
    inventados: soma(ok.map((r) => r.codigosInventados)),
    kitsOk: kits.filter((r) => r.kitCompleto).length,
    kitsN: kits.length,
    exigCumpridas: soma(ok.map((r) => r.exigenciasCumpridas)),
    exigTotais: exig,
    custo: soma(ok.map((r) => r.custoUsd)),
    custoMedio: ok.length ? soma(ok.map((r) => r.custoUsd)) / ok.length : 0,
    tempoMedio: ok.length ? soma(ok.map((r) => r.duracaoS)) / ok.length : 0,
  };
}

function gerarRelatorio(): string {
  const rodadas = readdirSync(PASTA)
    .filter((f) => /^rodada-\d+\.json$/.test(f))
    .sort()
    .map((f) => ({
      n: Number(f.match(/\d+/)![0]),
      ...(JSON.parse(readFileSync(`${PASTA}/${f}`, "utf8")) as {
        modelo: string;
        resultados: ResultadoCaso[];
      }),
    }));
  if (rodadas.length === 0) return "Sem rodadas.";
  const ultima = rodadas.at(-1)!;
  const R = rodadas.map((r) => ({ n: r.n, s: resumo(r.resultados) }));
  const custoTotal = R.reduce((a, r) => a + r.s.custo, 0);

  const L: string[] = [];
  L.push("# Avaliação da Indicação da IA (5 ambientes)", "");
  L.push(
    `Modelo: \`${ultima.modelo}\`. Rodadas: ${rodadas.length}. Custo total: **${usd(custoTotal)}** (≈ ${moeda(custoTotal * CAMBIO)} a US$ 1 = R$ 5,50, estimativa).`,
  );
  if (custoTotal > TETO_USD) L.push("", `> Atenção: o custo passou do teto de ${usd(TETO_USD)}.`);
  L.push(
    "",
    "A IA só sugere; a vendedora adiciona. O relatório do dia 7 (montagem completa) está em `relatorio-ia-montagem-dia7.md`.",
    "",
    "## Resumo por rodada",
    "",
  );
  L.push(
    `| Métrica | ${R.map((r) => `Rodada ${r.n}`).join(" | ")} |`,
    `| --- | ${R.map(() => "---:").join(" | ")} |`,
  );
  const linha = (nome: string, f: (s: ReturnType<typeof resumo>) => string) =>
    L.push(`| ${nome} | ${R.map((r) => f(r.s)).join(" | ")} |`);
  linha("Indicações obtidas", (s) => `${s.ok}/${s.n}`);
  linha("Códigos inventados descartados", (s) => String(s.inventados));
  linha("Ambientes com as categorias certas", (s) => `${s.categorias}/${s.ok}`);
  linha(
    "Códigos exatos do orçamento real",
    (s) => `${s.exatos}/${s.originais} (${pct(s.exatos / Math.max(1, s.originais))})`,
  );
  linha("... contando equivalentes", (s) =>
    pct((s.exatos + s.equivalentes) / Math.max(1, s.originais)),
  );
  linha("Kits de fita completos (perfil + fita + fonte)", (s) => `${s.kitsOk}/${s.kitsN}`);
  linha(
    "Exigências do arquiteto respeitadas (fita certa)",
    (s) => `${s.exigCumpridas}/${s.exigTotais}`,
  );
  linha("Custo total", (s) => usd(s.custo));
  linha(
    "Custo médio por indicação",
    (s) => `${usd(s.custoMedio)} (≈ ${moeda(s.custoMedio * CAMBIO)})`,
  );
  linha("Tempo médio", (s) => `${s.tempoMedio.toFixed(0)} s`);

  for (const rod of rodadas) {
    L.push("", `## Rodada ${rod.n}: por ambiente`, "");
    L.push(
      "| Caso | Ambiente | Arquiteto | Sugestões | Categorias | Exatos | Equiv. | Kit | Exigências | Inventados | Custo | Tempo |",
      "| --- | --- | :-: | ---: | :-: | ---: | ---: | :-: | ---: | ---: | ---: | ---: |",
    );
    for (const r of rod.resultados) {
      if (!r.ok) {
        L.push(
          `| ${r.id} | ${r.ambiente} | ${r.arquiteto ? "sim" : "não"} | FALHOU: ${r.erro} |||||||||`,
        );
        continue;
      }
      L.push(
        `| ${r.id} | ${r.ambiente} | ${r.arquiteto ? "sim" : "não"} | ${r.sugestoes!.length} | ${r.categoriasOk ? "ok" : "faltam"} | ${r.exatos}/${r.codigosOriginais} | ${r.equivalentes} | ${r.kitCompleto === null ? "-" : r.kitCompleto ? "ok" : "incompleto"} | ${r.exigenciasTotais ? `${r.exigenciasCumpridas}/${r.exigenciasTotais}` : "-"} | ${r.codigosInventados} | ${usd(r.custoUsd!)} | ${r.duracaoS!.toFixed(0)} s |`,
      );
    }
  }

  L.push("", "## Sugestões da rodada mais recente", "");
  for (const r of ultima.resultados.filter((x) => x.ok)) {
    L.push(`### ${r.id} · ${r.ambiente}${r.arquiteto ? " (pedido do arquiteto)" : ""}`, "");
    L.push(`${r.descricao}`, "", `Resumo da IA: ${r.resumo}`, "");
    for (const s of r.sugestoes!) {
      L.push(`- ${s.quantidade} × ${s.codigo} (${s.categoria ?? "-"}) ${s.descricao}`);
    }
    if (r.observacoes?.length) L.push("", ...r.observacoes.map((o) => `> ${o}`));
    L.push("");
  }
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
    `\nRodada ${rodada}: custo ${usd(s.custo)} (médio ${usd(s.custoMedio)}), categorias ${s.categorias}/${s.ok}, exatos ${s.exatos}/${s.originais}, inventados ${s.inventados}`,
  );
}
if (existsSync(`${PASTA}/rodada-${rodada}.json`) || soRelatorio) {
  writeFileSync(`${PASTA}/relatorio-ia.md`, gerarRelatorio());
  console.log(`Relatório: ${PASTA}/relatorio-ia.md`);
}
setTimeout(() => process.exit(process.exitCode ?? 0), 300);
await new Promise(() => undefined);
