// Dia 11C: itens de orçamentos já montados cuja descrição congelada ainda tem fabricante, modelo ou
// referência. Corrige só a DESCRIÇÃO (nunca o preço) nos orçamentos ainda não enviados (rascunho e
// gerado); lista os já enviados para decisão da gerência (o PDF enviado não muda).
// Uso: pnpm itens:limpar-descricoes [--gravar]   (sem a opção, só mostra o que mudaria)
import { createClient } from "@supabase/supabase-js";
import { contemDadoDeFornecedor, limparDescricao } from "../src/lib/catalogo/limpar";

const gravar = process.argv.includes("--gravar");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: itens, error } = await admin
  .from("orcamento_itens")
  .select(
    "id, codigo, descricao_congelada, avulso, descricao_manual, orcamentos(numero, status), produtos(categoria)",
  );
if (error) throw error;
const { data: forn } = await admin.from("produtos_dados_fornecedor").select("fabricante");
const fabricantes = [...new Set((forn ?? []).map((f) => f.fabricante).filter(Boolean))] as string[];

type L = {
  id: string;
  codigo: string | null;
  descricao_congelada: string;
  avulso: boolean;
  descricao_manual: boolean | null;
  orcamentos: { numero: string; status: string } | { numero: string; status: string }[] | null;
  produtos: { categoria: string | null } | { categoria: string | null }[] | null;
};
const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);

let comDado = 0;
const corrigir: { id: string; numero: string; de: string; para: string }[] = [];
const enviados: { numero: string; status: string; texto: string }[] = [];
for (const l of (itens ?? []) as unknown as L[]) {
  if (!contemDadoDeFornecedor(l.descricao_congelada, fabricantes)) continue;
  comDado++;
  const o = um(l.orcamentos);
  const status = o?.status ?? "?";
  const avulsoOuManual = l.avulso || l.descricao_manual;
  if (["rascunho", "gerado"].includes(status) && !avulsoOuManual) {
    const cat = um(l.produtos)?.categoria ?? null;
    const para = limparDescricao(l.descricao_congelada, cat, { fabricantes }).comercial;
    corrigir.push({ id: l.id, numero: o?.numero ?? "?", de: l.descricao_congelada, para });
  } else {
    enviados.push({ numero: o?.numero ?? "?", status, texto: l.descricao_congelada });
  }
}

console.log(
  `${itens?.length ?? 0} itens; ${comDado} com fabricante, modelo ou referência na descrição.`,
);
console.log(`\nA corrigir (rascunho ou gerado, descrição do catálogo): ${corrigir.length}`);
for (const c of corrigir) console.log(`  ${c.numero}: ${c.de}  =>  ${c.para}`);
console.log(
  `\nSem correção automática (já enviados/fechados, avulsos ou descrição manual): ${enviados.length}`,
);
for (const e of enviados) console.log(`  ${e.numero} [${e.status}]: ${e.texto}`);

if (gravar) {
  for (const c of corrigir) {
    const r = await admin
      .from("orcamento_itens")
      .update({ descricao_congelada: c.para })
      .eq("id", c.id);
    if (r.error) throw r.error;
  }
  console.log(
    `\nGravado: ${corrigir.length} descrição(ões) corrigida(s). Nenhum preço foi alterado.`,
  );
} else console.log("\n(simulação: use --gravar para aplicar)");
