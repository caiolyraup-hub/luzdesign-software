// Dia 11C: limpa o catálogo real. Depois da migration 20261113000500 (que copia marca e descrição para
// produtos_dados_fornecedor), este script extrai referência e modelo, grava a descrição comercial limpa
// em produtos.descricao, limpa os apelidos e apaga o cache de descrições formatadas pela IA.
// Idempotente: parte sempre de descricao_fornecedor. Uso: pnpm catalogo:proteger [--sem-gravar]
import { createClient } from "@supabase/supabase-js";
import { limparDescricao } from "../src/lib/catalogo/limpar";

const gravar = !process.argv.includes("--sem-gravar");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: produtos, error } = await admin
  .from("produtos")
  .select(
    "codigo, categoria, descricao, produtos_dados_fornecedor(fabricante, descricao_fornecedor, atributos_fornecedor)",
  )
  .order("codigo");
if (error) throw error;

type F = {
  fabricante: string | null;
  descricao_fornecedor: string | null;
  atributos_fornecedor: { apelidos_originais?: string[] };
};
const fab = (p: { produtos_dados_fornecedor: unknown }) =>
  (Array.isArray(p.produtos_dados_fornecedor)
    ? p.produtos_dados_fornecedor[0]
    : p.produtos_dados_fornecedor) as F | null;

const fabricantes = [
  ...new Set((produtos ?? []).map((p) => fab(p)?.fabricante).filter(Boolean)),
] as string[];
const comuns = new Map<string, string[]>();
let alterados = 0;
const exemplos: string[] = [];

for (const p of produtos ?? []) {
  const f = fab(p);
  const original = f?.descricao_fornecedor ?? p.descricao;
  const r = limparDescricao(original, p.categoria, { fabricantes });
  comuns.set(r.comercial, [...(comuns.get(r.comercial) ?? []), p.codigo]);
  if (exemplos.length < 15 && r.comercial !== original)
    exemplos.push(`${p.codigo}: ${original}  =>  ${r.comercial}`);
  if (r.comercial !== p.descricao) alterados++;
  if (!gravar) continue;

  const apelidosOriginais = f?.atributos_fornecedor?.apelidos_originais ?? [];
  const apelidos = [
    ...new Set(
      apelidosOriginais.map((a) => limparDescricao(a, p.categoria, { fabricantes }).comercial),
    ),
  ].filter((a) => a && a !== r.comercial);
  const up = await admin.from("produtos_dados_fornecedor").upsert(
    {
      codigo: p.codigo,
      fabricante: f?.fabricante ?? r.fabricantes[0] ?? null,
      referencia_fabricante: r.referencias.join(" / ") || null,
      modelo: r.modelos.join(" / ") || null,
      descricao_fornecedor: original,
      atributos_fornecedor: f?.atributos_fornecedor ?? {},
    },
    { onConflict: "codigo" },
  );
  if (up.error) throw up.error;
  const d = await admin.from("produtos").update({ descricao: r.comercial }).eq("codigo", p.codigo);
  if (d.error) throw d.error;
  await admin.from("produto_apelidos").delete().eq("codigo", p.codigo);
  if (apelidos.length) {
    const a = await admin
      .from("produto_apelidos")
      .insert(apelidos.map((texto) => ({ codigo: p.codigo, texto })));
    if (a.error) throw a.error;
  }
}

if (gravar) {
  const c = await admin.from("produtos_descricao_formatada").delete().neq("codigo", "");
  if (c.error) throw c.error;
}

console.log(
  `${produtos?.length} produtos; ${alterados} com descrição alterada${gravar ? " (gravado)" : " (simulação)"}.`,
);
console.log("\n15 exemplos (antes => depois):");
for (const e of exemplos) console.log(" ", e);
const dup = [...comuns].filter(([, v]) => v.length > 1);
console.log(`\nDescrições comerciais iguais em mais de um código (${dup.length}):`);
for (const [k, v] of dup) console.log(" ", k, "->", v.join(", "));
