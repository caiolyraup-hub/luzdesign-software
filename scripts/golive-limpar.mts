// Go-live: lista (SEM apagar) tudo o que é de teste. A execução real não existe hoje: fica para o
// dia 14, com o ok do dono do projeto. Uso: pnpm golive:limpar --simular
// Orçamentos do PILOTO (orcamentos.piloto = true) e o que depende deles nunca entram na lista.
import { createClient } from "@supabase/supabase-js";
import { selecionarLixoDeTeste } from "../src/lib/golive/selecao";

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

type OrcBanco = {
  id: string;
  numero: string;
  status: string;
  respostas: Record<string, unknown> | null;
  piloto: boolean;
  cliente_id: string;
  arquiteto_id: string | null;
  criado_em: string;
  clientes: { nome: string } | { nome: string }[] | null;
  usuarios: { nome: string } | { nome: string }[] | null;
};
const { data: orcs } = await admin
  .from("orcamentos")
  .select(
    "id, numero, status, respostas, piloto, cliente_id, arquiteto_id, criado_em, clientes(nome), usuarios(nome)",
  )
  .order("numero");
const { data: clientes } = await admin.from("clientes").select("id, nome, arquiteto_id");
const { data: arqs } = await admin.from("arquitetos").select("id, nome");
const orcsBanco = (orcs ?? []) as unknown as OrcBanco[];
const quem = new Map(orcsBanco.map((o) => [o.id, um(o.usuarios)?.nome ?? "?"]));
const nomeCliente = new Map(orcsBanco.map((o) => [o.id, um(o.clientes)?.nome ?? "?"]));

const sel = selecionarLixoDeTeste({
  orcamentos: orcsBanco.map((o) => ({
    id: o.id,
    numero: o.numero,
    cliente_id: o.cliente_id,
    arquiteto_id: o.arquiteto_id,
    piloto: o.piloto,
    respostas: o.respostas,
    cliente_nome: um(o.clientes)?.nome ?? null,
  })),
  clientes: clientes ?? [],
  arquitetos: arqs ?? [],
});

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
console.log(`Orçamentos de teste (${sel.orcamentos.length}):`);
for (const { o, motivos } of sel.orcamentos)
  console.log(`  ${o.numero} [${quem.get(o.id)}] — ${motivos.join("; ")}`);
console.log(`\nClientes de teste (${sel.clientes.length}):`);
for (const c of sel.clientes) console.log(`  ${c.nome}`);
console.log(`\nArquitetos de teste (${sel.arquitetos.length}):`);
for (const a of sel.arquitetos) console.log(`  ${a.nome}`);
console.log(
  `\nPROTEGIDOS, não entram na limpeza (piloto + o que depende deles): ${sel.protegidos.orcamentos.length} orçamento(s), ${sel.protegidos.clientes.length} cliente(s), ${sel.protegidos.arquitetos.length} arquiteto(s)`,
);
for (const o of sel.protegidos.orcamentos)
  console.log(`  ${o.numero} [${quem.get(o.id)}] cliente "${nomeCliente.get(o.id)}"`);
console.log(
  `\nContas de teste (${contas.length}) — a senha inicial é a mesma das quatro; trocar/remover no go-live:`,
);
for (const u of contas) console.log(`  ${u.nome} (${u.perfil}) ${u.email}`);
console.log(`\nProdutos suspeitos de teste (${produtosTeste?.length ?? 0}):`);
for (const p of produtosTeste ?? []) console.log(`  ${p.codigo} ${p.descricao}`);

// Orçamentos anteriores ao piloto (19/11/2026): todos são de contas de teste, mesmo sem marcador no nome.
const INICIO_PILOTO = new Date("2026-11-19T00:00:00-03:00").getTime();
const idsJaListados = new Set([
  ...sel.orcamentos.map(({ o }) => o.id),
  ...sel.protegidos.orcamentos.map((o) => o.id),
]);
const semMarcador = orcsBanco.filter(
  (o) => new Date(o.criado_em).getTime() < INICIO_PILOTO && !idsJaListados.has(o.id),
);
console.log(
  `\nOrçamentos criados ANTES do piloto, sem marcador de teste no nome (${semMarcador.length}) — confirmar com o dono; são das contas de teste:`,
);
for (const o of semMarcador)
  console.log(`  ${o.numero} [${o.status}] ${quem.get(o.id)} — cliente "${nomeCliente.get(o.id)}"`);

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
const existentes = new Set(orcsBanco.map((o) => o.id));
console.log(
  "\nArquivos no Storage (incluem órfãos de orçamentos já apagados; os de orçamento piloto ficam):",
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
  "\nOrdem no go-live (docs/go-live.md): criar as contas reais -> pnpm contas:transferir (piloto) -> conferir -> SÓ ENTÃO limpar: orçamentos -> clientes -> arquitetos de teste, reiniciar o contador e remover as contas de teste.",
);
