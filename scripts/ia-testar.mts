// Teste REAL da IA (chama a OpenAI e custa dinheiro; centavos de dólar). Uso: pnpm ia:testar [--caso id]
//  1. confirma que o modelo existe na conta;
//  2. pede uma Indicação da IA para 1 ambiente de 1 dos 37 orçamentos reais (sem nome de cliente);
//  3. padroniza a descrição de 10 códigos (formatação, só texto) e mostra o antes e o depois.
// Cria um rascunho de teste como Aline e apaga tudo no fim.
import OpenAI from "openai";
import { criarClienteIA } from "../src/lib/ia/cliente";
import { lerConfigIA } from "../src/lib/ia/config";
import { criarExecutorFerramentas } from "../src/lib/ia/ferramentas";
import { formatarTextos } from "../src/lib/ia/formatacao";
import { pedirIndicacao } from "../src/lib/ia/indicacao";
import { criarRepositorioIA } from "../src/lib/ia/repositorio-ia";
import {
  criarRascunho,
  entrar,
  exigir,
  lerPedidos,
  limparTestes,
  linhasOriginais,
  moeda,
  usd,
} from "./ia-comum";

const config = lerConfigIA();
console.log(`Modelo configurado: ${config.modelo}`);
exigir("OPENAI_API_KEY");

// ---- 1. O modelo existe nesta conta?
try {
  await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1 }).models.retrieve(
    config.modelo,
  );
  console.log("Modelo encontrado na conta.");
} catch (e) {
  console.error(
    `Não consegui confirmar o modelo "${config.modelo}" (HTTP ${(e as { status?: number }).status ?? "?"}).`,
  );
  process.exit(1);
}

const { admin, aline, alineId } = await entrar();
const { pedidos, indicacoes } = lerPedidos();
const idCaso = process.argv.includes("--caso")
  ? process.argv[process.argv.indexOf("--caso") + 1]
  : null;
const caso = indicacoes.find((c) => c.id === idCaso) ?? indicacoes[0];
const pedido = pedidos.find((p) => p.indice === caso.indice)!;
const criados: string[] = [];

try {
  const repo = criarRepositorioIA(aline, admin);
  const deps = {
    repo,
    ia: criarClienteIA(),
    executor: criarExecutorFerramentas(aline),
    config: { ...config, limiteDiario: 1000 },
  };
  const id = await criarRascunho(aline, alineId, pedido, caso.id, {
    arquiteto: Boolean(caso.pedido_arquiteto),
    pedidoCliente: caso.pedido_cliente,
  });
  criados.push(id);

  // ---- 2. Indicação da IA
  console.log(`\n== Indicação da IA: ${caso.descricao}`);
  console.log(`Ambiente: ${caso.ambiente}\nCliente: ${caso.pedido_cliente}`);
  if (caso.pedido_arquiteto) console.log(`Arquiteto: ${caso.pedido_arquiteto}`);
  const r = await pedirIndicacao(deps, alineId, {
    orcamentoId: id,
    ambiente: caso.ambiente,
    pedidoCliente: caso.pedido_cliente,
    pedidoArquiteto: caso.pedido_arquiteto,
    descricaoAmbiente: caso.descricao_ambiente,
    usarAnexos: false,
  });
  if (!r.ok) {
    console.error(`FALHOU: ${r.erro}`);
    process.exitCode = 1;
  } else {
    console.log(`\nResumo: ${r.resumo}`);
    console.log("Sugestões:");
    for (const s of r.sugestoes) {
      console.log(
        `  ${String(s.quantidade).padStart(5)} ${s.unidade}  ${s.codigo}  ${s.categoria ?? "-"}  ${s.descricao}  (${moeda(s.subtotalCentavos / 100)})`,
      );
      if (s.motivo) console.log(`         ↳ ${s.motivo}`);
    }
    if (r.observacoes.length) console.log(`Observações:\n  - ${r.observacoes.join("\n  - ")}`);
    if (r.avisos.length)
      console.log(`Avisos (validação no servidor):\n  - ${r.avisos.join("\n  - ")}`);
    const descartados = r.avisos.filter((a) => /não existe|inativo/.test(a)).length;
    console.log(
      `\n${r.sugestoes.length} sugestões válidas, ${descartados} código(s) inventado(s) descartado(s), ` +
        `${usd(r.custoUsd)}, ${(r.duracaoMs / 1000).toFixed(0)} s, ${r.chamadasFerramenta} consultas ao catálogo.`,
    );
    const { data: itens } = await aline.from("orcamento_itens").select("id").eq("orcamento_id", id);
    console.log(`Itens gravados no orçamento pela IA: ${itens?.length ?? 0} (tem de ser 0).`);
    if ((itens?.length ?? 0) > 0) process.exitCode = 1;
  }

  // ---- 3. Formatação de 10 códigos (só texto)
  console.log("\n== Formatação (descrição comercial) de 10 códigos");
  const codigos = [
    ...new Set(linhasOriginais(pedido).map((l) => l.codigo)),
    ...(r.ok ? r.sugestoes.map((s) => s.codigo) : []),
  ].slice(0, 10);
  const { data: produtos } = await aline
    .from("produtos")
    .select("codigo, categoria, descricao, atualizado_em")
    .in("codigo", codigos);
  await admin.from("produtos_descricao_formatada").delete().in("codigo", codigos); // mede a chamada de verdade
  const f = await formatarTextos(deps, alineId, id, {
    produtos: (produtos ?? []).map((p) => ({
      codigo: p.codigo,
      descricao: p.descricao,
      categoria: p.categoria,
      atualizado_em: p.atualizado_em,
    })),
    ambientes: ["sala", "COZINHA", "Quarto casal"],
  });
  for (const p of produtos ?? []) {
    console.log(`  ${p.codigo}  ${p.descricao}\n         → ${f.descricoes.get(p.codigo)}`);
  }
  console.log(
    `Ambientes: ${[...f.ambientes].map(([a, b]) => `${a} → ${b}`).join(", ") || "(sem mudança)"}`,
  );
  if (f.avisos.length) console.log(`Avisos:\n  - ${f.avisos.join("\n  - ")}`);
  const mudadas = (produtos ?? []).filter((p) => f.descricoes.get(p.codigo) !== p.descricao).length;
  console.log(`${mudadas}/${produtos?.length ?? 0} descrições padronizadas, ${usd(f.custoUsd)}.`);
} finally {
  await limparTestes(admin, criados);
  console.log("\nRascunho de teste apagado.");
}
setTimeout(() => process.exit(process.exitCode ?? 0), 300);
await new Promise(() => undefined);
