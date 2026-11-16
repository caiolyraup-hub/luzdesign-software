// Dia 12B: planilha para a gerência revisar as descrições comerciais (fora do git).
// Uma linha por produto: original, comercial nova, o que foi removido, grupo de duplicadas e sugestão.
// Uso: pnpm catalogo:revisar   -> dados/revisao-descricoes.xlsx
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { limparDescricao } from "../src/lib/catalogo/limpar";
import { COR_DESTAQUE } from "../src/lib/pdf/tema";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
type F = {
  fabricante: string | null;
  referencia_fabricante: string | null;
  modelo: string | null;
  descricao_fornecedor: string | null;
};
const { data } = await admin
  .from("produtos")
  .select(
    "codigo, categoria, descricao, preco_unitario, ativo, descricao_editada_em, produtos_dados_fornecedor(fabricante, referencia_fabricante, modelo, descricao_fornecedor)",
  )
  .order("codigo");

const linhas = (data ?? []).map((p) => {
  const f = (
    Array.isArray(p.produtos_dados_fornecedor)
      ? p.produtos_dados_fornecedor[0]
      : p.produtos_dados_fornecedor
  ) as F | null;
  const original = f?.descricao_fornecedor ?? p.descricao;
  const r = limparDescricao(original, p.categoria, { fabricantes: [f?.fabricante] });
  return { p, f, original, r };
});
const grupos = new Map<string, string[]>();
for (const l of linhas)
  grupos.set(l.p.descricao, [...(grupos.get(l.p.descricao) ?? []), l.p.codigo]);
const numeroDoGrupo = new Map<string, number>();
[...grupos].filter(([, v]) => v.length > 1).forEach(([k], i) => numeroDoGrupo.set(k, i + 1));

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Descrições", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = [
  { header: "Código", key: "codigo", width: 9 },
  { header: "Categoria", key: "categoria", width: 14 },
  { header: "Descrição original (fornecedor)", key: "original", width: 38 },
  { header: "Descrição comercial (atual)", key: "nova", width: 34 },
  { header: "Removido: fabricante", key: "fab", width: 16 },
  { header: "Removido: referência", key: "ref", width: 22 },
  { header: "Removido: modelo", key: "mod", width: 14 },
  { header: "Preço", key: "preco", width: 11, style: { numFmt: '"R$" #,##0.00' } },
  { header: "Duplicada? (grupo)", key: "dup", width: 14 },
  { header: "Editada à mão", key: "ed", width: 12 },
  { header: "Sugestão / decisão da gerência", key: "sug", width: 60 },
];
ws.getRow(1).eachCell((c) => {
  c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  c.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: `FF${COR_DESTAQUE.replace("#", "").toUpperCase()}` },
  };
});
for (const { p, f, original, r } of linhas) {
  const g = numeroDoGrupo.get(p.descricao);
  const iguaisNoFornecedor =
    linhas.filter((x) => x.p.descricao === p.descricao && x.original === original).length > 1;
  const row = ws.addRow({
    codigo: p.codigo,
    categoria: p.categoria ?? "",
    original,
    nova: p.descricao,
    fab: f?.fabricante ?? r.fabricantes.join(", "),
    ref: f?.referencia_fabricante ?? r.referencias.join(" / "),
    mod: f?.modelo ?? r.modelos.join(" / "),
    preco: Number(p.preco_unitario),
    dup: g ? `Grupo ${g}` : "",
    ed: p.descricao_editada_em ? "sim" : "",
    sug: g
      ? iguaisNoFornecedor
        ? "Mesma descrição também no fornecedor: provável código duplicado. Verifique se um dos códigos pode ser desativado."
        : "Só a referência/linha do fabricante diferencia estes produtos; nenhuma característica técnica os separa. Gerência decide o texto (Produtos > Editar descrição)."
      : "",
  });
  if (g)
    row.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    });
}
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
mkdirSync("dados", { recursive: true });
await wb.xlsx.writeFile("dados/revisao-descricoes.xlsx");
console.log(
  `dados/revisao-descricoes.xlsx: ${linhas.length} produtos; ${numeroDoGrupo.size} grupos de descrição repetida.`,
);
for (const [d, n] of numeroDoGrupo)
  console.log(`  Grupo ${n}: ${d} -> ${grupos.get(d)!.join(", ")}`);
