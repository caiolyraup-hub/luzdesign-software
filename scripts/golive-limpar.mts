// Go-live: lista (SEM apagar) tudo o que é de teste. A execução real não existe hoje: fica para o
// dia 14, com o ok do dono do projeto. Uso: pnpm golive:limpar --simular
import { createClient } from "@supabase/supabase-js";

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
const ehTeste = (nome: string | null | undefined) => /^teste([^a-zà-ú]|$)/i.test(nome ?? "");
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
console.log(
  "\nO que a execução real do dia 14 deve fazer (precisa de autorização): apagar os itens acima na ordem",
);
console.log(
  "orçamentos -> clientes -> arquitetos de teste, reiniciar o contador de numeração e trocar as senhas das contas.",
);
