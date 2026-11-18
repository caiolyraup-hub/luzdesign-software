// Go-live: lista (SEM apagar) tudo o que é de teste. A execução real não existe hoje: fica para o
// dia 14, com o ok do dono do projeto. Uso: pnpm golive:limpar --simular
import { createClient } from "@supabase/supabase-js";
import { clienteEhDeTeste as ehTeste } from "../src/lib/orcamento/eh-teste";

if (!process.argv.includes("--simular")) {
  console.error(
    "Só existe a simulação (pnpm golive:limpar --simular). A execução real será criada no dia 14, com autorização.",
  );
  process.exit(2);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const um = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type Orc = {
  id: string;
  numero: string;
  status: string;
  respostas: Record<string, unknown> | null;
  clientes: { nome: string } | { nome: string }[] | null;
  usuarios: { nome: string } | { nome: string }[] | null;
};
const { data: orcs } = await admin
  .from("orcamentos")
  .select("id, numero, status, respostas, clientes(nome), usuarios(nome)")
  .order("numero");

const testeOrc: { o: Orc; motivo: string }[] = [];
for (const o of (orcs ?? []) as unknown as Orc[]) {
  const cli = um(o.clientes)?.nome ?? null;
  const r = o.respostas ?? {};
  const motivos = [
    r.teste === true || r.teste === "true" ? "respostas.teste" : "",
    r.teste_rls === "true" ? "respostas.teste_rls" : "",
    r.teste_ia ? "respostas.teste_ia" : "",
    ehTeste(cli) ? `cliente "${cli}"` : "",
    /^(COM|ARQ|CLIENTE) (E2E|RLS)/i.test(cli ?? "") ? `cliente de teste automatizado "${cli}"` : "",
    o.numero === "2026-0005" ? "orçamento 2026-0005 (guardado de propósito até o go-live)" : "",
  ].filter(Boolean);
  if (motivos.length) testeOrc.push({ o, motivo: motivos.join("; ") });
}

const { data: clientes } = await admin.from("clientes").select("id, nome, vendedora_id");
const testeCli = (clientes ?? []).filter(
  (c) => ehTeste(c.nome) || /^(COM|ARQ|CLIENTE) (E2E|RLS)/i.test(c.nome),
);
const { data: arqs } = await admin.from("arquitetos").select("id, nome");
const testeArq = (arqs ?? []).filter((a) => /teste|e2e|rls/i.test(a.nome));
const { data: usuarios } = await admin.from("usuarios").select("id, nome, email, perfil");
const emailsSeed = ["ALINE", "KELY", "GERENCIA", "DONO"]
  .map((k) => (process.env[`SEED_EMAIL_${k}`] ?? "").toLowerCase())
  .filter(Boolean);
const contas = (usuarios ?? []).filter((u) => emailsSeed.includes(String(u.email).toLowerCase()));
const { data: produtosTeste } = await admin
  .from("produtos")
  .select("codigo, descricao")
  .or("descricao.ilike.%teste%,codigo.like.9999%");

console.log("SIMULAÇÃO do go-live: nada foi apagado.\n");
console.log(`Orçamentos de teste (${testeOrc.length}):`);
for (const { o, motivo } of testeOrc)
  console.log(`  ${o.numero} [${o.status}] ${um(o.usuarios)?.nome ?? "?"} — ${motivo}`);
console.log(`\nClientes de teste (${testeCli.length}):`);
for (const c of testeCli) console.log(`  ${c.nome}`);
console.log(`\nArquitetos de teste (${testeArq.length}):`);
for (const a of testeArq) console.log(`  ${a.nome}`);
console.log(
  `\nContas de teste (${contas.length}) — a senha inicial é a mesma das quatro; trocar/remover no go-live:`,
);
for (const u of contas) console.log(`  ${u.nome} (${u.perfil}) ${u.email}`);
console.log(`\nProdutos suspeitos de teste (${produtosTeste?.length ?? 0}):`);
for (const p of produtosTeste ?? []) console.log(`  ${p.codigo} ${p.descricao}`);
// Orçamentos anteriores ao piloto (19/11/2026): todos são de contas de teste, mesmo sem marcador no nome.
const INICIO_PILOTO = "2026-11-19T00:00:00-03:00";
const idsMarcados = new Set(testeOrc.map(({ o }) => o.id));
const { data: antigos } = await admin
  .from("orcamentos")
  .select("id, numero, status, criado_em, clientes(nome), usuarios(nome)")
  .lt("criado_em", INICIO_PILOTO)
  .order("numero");
const semMarcador = (antigos ?? []).filter((o) => !idsMarcados.has(o.id));
console.log(
  `\nOrçamentos criados ANTES do piloto, sem marcador de teste no nome (${semMarcador.length}) — confirmar com o dono; são das contas de teste:`,
);
for (const o of semMarcador)
  console.log(
    `  ${o.numero} [${o.status}] ${um(o.usuarios as unknown as { nome: string } | null)?.nome ?? "?"} — cliente "${um(o.clientes as unknown as { nome: string } | null)?.nome ?? "?"}"`,
  );
const { data: usoIa } = await admin.from("uso_ia").select("id");
console.log(
  `\nRegistros de uso da IA (uso_ia): ${(usoIa ?? []).length} (custos dos testes; zerar o painel de custo no go-live)`,
);
const { data: expo } = await admin.from("eventos_exportacao").select("id");
console.log(
  `Auditoria de exportações (eventos_exportacao) de contas de teste: ${(expo ?? []).length}`,
);

async function arquivos(bucket: string, pasta = ""): Promise<string[]> {
  const { data } = await admin.storage.from(bucket).list(pasta, { limit: 1000 });
  const saida: string[] = [];
  for (const o of data ?? []) {
    if (o.id) saida.push(`${pasta}${o.name}`);
    else saida.push(...(await arquivos(bucket, `${pasta}${o.name}/`)));
  }
  return saida;
}
const { data: todosOrc } = await admin.from("orcamentos").select("id");
const existentes = new Set((todosOrc ?? []).map((o) => o.id));
console.log(
  "\nArquivos no Storage (todos anteriores ao piloto; incluem órfãos de orçamentos já apagados):",
);
for (const b of ["anexos", "pdfs", "arquitetos", "relatos"]) {
  const lista = await arquivos(b);
  const orfaos =
    b === "anexos" || b === "pdfs" ? lista.filter((c) => !existentes.has(c.split("/")[1])) : [];
  console.log(
    `  ${b}: ${lista.length} arquivo(s)${orfaos.length ? `, ${orfaos.length} órfão(s) (sem orçamento): ${orfaos.join(", ")}` : ""}`,
  );
}
const { data: cache } = await admin.from("produtos_descricao_formatada").select("codigo");
console.log(
  `\nCache de descrições da IA (produtos_descricao_formatada): ${(cache ?? []).length} linha(s), geradas por testes com a IA real; são refeitas sozinhas (limpar é opcional).`,
);

console.log(
  "\nO que a execução real do dia 14 deve fazer (precisa de autorização): apagar os itens acima na ordem",
);
console.log(
  "orçamentos -> clientes -> arquitetos de teste, reiniciar o contador de numeração e trocar as senhas das contas.",
);
