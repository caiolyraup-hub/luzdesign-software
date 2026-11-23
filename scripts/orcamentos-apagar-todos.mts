// Apaga TODOS os orçamentos (e o que depende deles) para a loja começar do zero (dia 15).
// Sem --executar só SIMULA. Para executar: backup conferido da última hora, decisões explícitas
// (--clientes e --contador) e a confirmação digitada ("SIM", e "SIM PILOTO" se houver piloto).
//
//   pnpm orcamentos:apagar-todos                       simulação
//   pnpm orcamentos:apagar-todos --executar --backup <pasta> --clientes=apagar|manter --contador=reiniciar|manter [--piloto]
//
// O banco inteiro sai numa transação (função apagar_todos_orcamentos); os arquivos do Storage saem
// depois, e o que falhar fica listado. Catálogo, estoque, usuários, arquitetos, configurações,
// percentuais de comissão, relatos e erros nunca são tocados.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { conferirBackup } from "../src/lib/backup/conferir";
import type { Manifesto } from "../src/lib/backup/nucleo";
import { validarBackupFresco } from "../src/lib/limpeza/backup-fresco";
import { criarBancoLocal } from "../src/lib/testes/banco-local";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const valor = (n: string) =>
  args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ??
  (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);

const executar = flag("executar");
const incluirPiloto = flag("piloto");
const clientes = valor("clientes"); // apagar | manter
const contador = valor("contador"); // reiniciar | manter
const pastaBackup = valor("backup");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const projeto = new URL(url).host.split(".")[0];
const admin: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

type Resultado = {
  executado: boolean;
  orcamentos: { id: string; vendedora_id: string; numero: string }[];
  clientes_sem_orcamento: { id: string; nome: string }[];
  antes: Record<string, number | string> & {
    orcamentos: number;
    orcamentos_piloto: number;
    por_status: Record<string, number>;
    por_vendedora: Record<string, number>;
    contador: Record<string, number>;
  };
  depois: Record<string, number | string | Record<string, number>>;
  fica: Record<string, number>;
};

async function chamar(exec: boolean): Promise<Resultado> {
  const { data, error } = await admin.rpc("apagar_todos_orcamentos", {
    p_executar: exec,
    p_incluir_piloto: incluirPiloto,
    p_apagar_clientes: clientes === "apagar",
    p_reiniciar_contador: contador === "reiniciar",
  });
  if (error) throw new Error(`apagar_todos_orcamentos: ${error.message}`);
  return data as Resultado;
}

/** Arquivos do Storage das pastas <vendedora>/<orcamento>/ (anexos e PDFs/XLSX). */
async function arquivosDoStorage(orcs: Resultado["orcamentos"]) {
  const lista: { bucket: string; caminho: string; bytes: number }[] = [];
  for (const o of orcs)
    for (const bucket of ["anexos", "pdfs"]) {
      const pasta = `${o.vendedora_id}/${o.id}`;
      const { data } = await admin.storage.from(bucket).list(pasta, { limit: 1000 });
      for (const f of data ?? [])
        if (f.id)
          lista.push({
            bucket,
            caminho: `${pasta}/${f.name}`,
            bytes: Number((f.metadata as { size?: number } | null)?.size ?? 0),
          });
    }
  return lista;
}

const fmt = (o: object) =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ") || "—";
const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;

function mostrar(r: Resultado, arquivos: Awaited<ReturnType<typeof arquivosDoStorage>>) {
  const a = r.antes;
  console.log(
    `\n${r.executado ? "EXECUTADO" : "SIMULAÇÃO"} — projeto ${projeto}${r.executado ? "" : " (nada foi apagado)"}`,
  );
  console.log(
    `\nOrçamentos que saem: ${a.orcamentos} · valor total R$ ${Number(a.valor_total).toFixed(2)}`,
  );
  console.log(`  por status: ${fmt(a.por_status)}`);
  console.log(`  por vendedora: ${fmt(a.por_vendedora)}`);
  console.log(
    `  DO PILOTO (piloto = true): ${a.orcamentos_piloto}${incluirPiloto ? " (incluídos)" : " (ficam: use --piloto para incluí-los)"}`,
  );
  console.log("\nLinhas que saem, por tabela:");
  for (const t of [
    "orcamento_itens",
    "orcamento_ambientes",
    "anexos",
    "eventos",
    "indicacoes_ia",
    "comissoes",
    "uso_ia_do_orcamento",
    "eventos_exportacao",
  ])
    console.log(`  ${t.padEnd(22)} ${a[t]}`);
  const total = arquivos.reduce((s, f) => s + f.bytes, 0);
  console.log(
    `\nArquivos do Storage que saem: ${arquivos.length} (${kb(total)}) — anexos ${arquivos.filter((f) => f.bucket === "anexos").length}, pdfs/xlsx ${arquivos.filter((f) => f.bucket === "pdfs").length}`,
  );
  console.log(`\nClientes que ficariam sem nenhum orçamento: ${r.clientes_sem_orcamento.length}`);
  for (const c of r.clientes_sem_orcamento) console.log(`  - ${c.nome}`);
  console.log(`Contador de numeração hoje: ${fmt(a.contador)}`);
  console.log("\nO que FICA (não pode mudar):");
  console.log(`  ${fmt(r.fica)}`);
  if (r.executado) console.log(`\nDepois: ${fmt(r.depois)}`);
}

// ------------------------------------------------------------------ simulação
const sim = await chamar(false);
const arquivos = await arquivosDoStorage(sim.orcamentos);
mostrar(sim, arquivos);
if (!executar) {
  console.log(
    "\nPara executar: rode de novo com --executar --backup <pasta> --clientes=apagar|manter --contador=reiniciar|manter",
  );
  process.exit(0);
}

// ------------------------------------------------------------------ execução
const faltas: string[] = [];
if (clientes !== "apagar" && clientes !== "manter") faltas.push("--clientes=apagar|manter");
if (contador !== "reiniciar" && contador !== "manter") faltas.push("--contador=reiniciar|manter");
if (!pastaBackup) faltas.push("--backup <pasta do backup conferido>");
if (faltas.length) {
  console.error(`\nFalta decidir/informar: ${faltas.join(", ")}.`);
  process.exit(2);
}

// 1) backup recente, do mesmo banco, com os mesmos orçamentos, e que restaura inteiro
const manifesto = JSON.parse(
  readFileSync(path.join(pastaBackup!, "manifesto.json"), "utf8"),
) as Manifesto;
const { count: totalAgora } = await admin
  .from("orcamentos")
  .select("*", { count: "exact", head: true });
const problemas = validarBackupFresco(manifesto, {
  agora: new Date(),
  orcamentosAgora: totalAgora ?? -1,
  projetoAgora: projeto,
});
if (problemas.length) {
  console.error("\nBACKUP RECUSADO:\n  - " + problemas.join("\n  - "));
  process.exit(1);
}
const ultimaMigration = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.split("_")[0])
  .sort()
  .at(-1)!;
const conf = await conferirBackup(pastaBackup!, criarBancoLocal, ultimaMigration);
if (!conf.ok) {
  console.error("\nBACKUP COM PROBLEMA (backup:conferir falhou):");
  for (const l of conf.linhas.filter((x) => !x.ok)) console.error(`  ERRO ${l.texto}`);
  process.exit(1);
}
console.log(`\nBackup ${pastaBackup} conferido agora (restaura inteiro, totais batem).`);

// 2) confirmações digitadas
const rl = createInterface({ input: process.stdin, output: process.stdout });
const r1 = (
  await rl.question(
    `\nIsto APAGA ${sim.antes.orcamentos} orçamento(s) de ${projeto} (clientes: ${clientes}, contador: ${contador}). Digite SIM para continuar: `,
  )
).trim();
if (r1 !== "SIM") {
  console.log("Cancelado. Nada foi apagado.");
  process.exit(1);
}
if (sim.antes.orcamentos_piloto > 0) {
  const r2 = (
    await rl.question(
      `${sim.antes.orcamentos_piloto} orçamento(s) são do PILOTO (clientes de verdade). Digite SIM PILOTO para apagá-los também: `,
    )
  ).trim();
  if (r2 !== "SIM PILOTO") {
    console.log("Cancelado. Nada foi apagado.");
    process.exit(1);
  }
}
rl.close();

// 3) banco (uma transação) e depois Storage
const res = await chamar(true);
const falhas: string[] = [];
for (const bucket of ["anexos", "pdfs"]) {
  const caminhos = arquivos.filter((f) => f.bucket === bucket).map((f) => f.caminho);
  for (let i = 0; i < caminhos.length; i += 100) {
    const lote = caminhos.slice(i, i + 100);
    const { error } = await admin.storage.from(bucket).remove(lote);
    if (error) falhas.push(...lote.map((c) => `${bucket}/${c} (${error.message})`));
  }
}
mostrar(res, arquivos);
const mudou = Object.keys(sim.fica).filter((k) => res.fica[k] !== sim.fica[k]);
console.log(
  mudou.length
    ? `\nATENÇÃO: o que deveria ficar mudou: ${mudou.join(", ")}`
    : "\nO que deveria ficar não mudou.",
);
console.log(
  falhas.length
    ? `\nArquivos que NÃO saíram do Storage (${falhas.length}):\n  ${falhas.join("\n  ")}`
    : "\nArquivos do Storage removidos.",
);

const registro = `# Limpeza dos orçamentos — ${new Date().toISOString()}

- Projeto: ${projeto}
- Backup conferido antes: ${pastaBackup}
- Opções: clientes=${clientes}, contador=${contador}, piloto incluído=${incluirPiloto}

## Antes (o que saiu)
${JSON.stringify(sim.antes, null, 2)}

## Depois
${JSON.stringify(res.depois, null, 2)}

## Ficou (antes -> depois)
${JSON.stringify({ antes: sim.fica, depois: res.fica }, null, 2)}

## Storage
${arquivos.length} arquivo(s) previstos; falhas: ${falhas.length}
${falhas.map((f) => `- ${f}`).join("\n")}
`;
writeFileSync("dados/limpeza-2026-11-23.md", registro);
console.log("\nRegistro: dados/limpeza-2026-11-23.md");
process.exit(mudou.length || falhas.length ? 1 : 0);
