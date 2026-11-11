// Exemplo do kit de fita calculado com o catálogo real do banco (sem gravar nada).
import { createClient } from "@supabase/supabase-js";
import { calcularKit, type ProdutoKit } from "../src/lib/orcamento/kit-fita";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const { data } = await admin
  .from("produtos")
  .select("codigo, categoria, descricao, unidade, preco_unitario, atributos")
  .eq("ativo", true);
const todos: ProdutoKit[] = (data ?? []).map((p) => ({
  codigo: p.codigo,
  descricao: p.descricao,
  categoria: p.categoria,
  unidade: p.unidade,
  preco: Number(p.preco_unitario),
  atributos: p.atributos ?? {},
}));
const por = (c: string) => todos.find((p) => p.codigo === c)!;
const fontes = todos.filter((p) => p.categoria === "FONTE");

const casos: [number, string, string | null][] = [
  [5, "12222", "12086"],
  [4.3, "11208", "4321"],
  [20, "12222", "12086"],
  [8, "12520", null],
];
for (const [metros, fita, perfil] of casos) {
  const r = calcularKit({ metros, fita: por(fita), perfil: perfil ? por(perfil) : null, fontes });
  console.log(`\n${metros} m de ${por(fita).descricao} (cód. ${fita})`);
  console.log(`  fita:   ${r.fita.quantidade} ${por(fita).unidade}  (${r.fita.conta})`);
  if (r.perfil)
    console.log(
      `  perfil: ${r.perfil.quantidade} un  ${r.perfil.produto.descricao} (${r.perfil.conta})`,
    );
  if (r.fonte.tipo === "sugerida")
    console.log(
      `  fonte:  ${r.fonte.linha.quantidade} x ${r.fonte.linha.produto.descricao} (cód. ${r.fonte.linha.produto.codigo}) - ${r.fonte.linha.conta}`,
    );
  else console.log(`  fonte:  ${r.fonte.tipo}: ${"motivo" in r.fonte ? r.fonte.motivo : ""}`);
  if (r.avisos.length) console.log(`  avisos: ${r.avisos.join(" | ")}`);
}
