// Dia 12B: gera PDF e XLSX com o CATÁLOGO INTEIRO (banco real) e procura qualquer fabricante,
// modelo ou referência do fornecedor no texto. Nenhum pode aparecer. Uso: pnpm test:rls
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import type { ItemRevisao } from "../src/lib/orcamento/itens";
import { montarDadosPdf } from "../src/lib/pdf/dados";
import { renderizarPdf } from "../src/lib/pdf/renderizar";
import { gerarPlanilhaOrcamento } from "../src/lib/planilha/orcamento";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
type F = { fabricante: string | null; referencia_fabricante: string | null; modelo: string | null };
const { data } = await admin
  .from("produtos")
  .select(
    "codigo, categoria, descricao, unidade, preco_unitario, produtos_dados_fornecedor(fabricante, referencia_fabricante, modelo)",
  )
  .order("codigo");
const produtos = data ?? [];
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// O que NÃO pode aparecer: fabricantes, modelos e referências (cada parte da referência).
const proibidos = new Set<string>();
for (const p of produtos) {
  const f = (
    Array.isArray(p.produtos_dados_fornecedor)
      ? p.produtos_dados_fornecedor[0]
      : p.produtos_dados_fornecedor
  ) as F | null;
  for (const v of [f?.fabricante, f?.modelo])
    for (const t of (v ?? "").split(" / ")) if (norm(t).length >= 2) proibidos.add(norm(t));
  for (const t of (f?.referencia_fabricante ?? "").split(" / "))
    if (norm(t).length >= 4) proibidos.add(norm(t));
}
// O código interno é público (aparece no PDF): se um número de referência for igual a um código interno
// (acontece com o 4321), ele não pode ser tratado como vazamento.
for (const p of produtos) proibidos.delete(norm(p.codigo));
// Termos que são características mantidas de propósito (revisão do dia 12) e valores só numéricos.
for (const ok of ["DEEP", "SQUARE", "FENDA"]) proibidos.delete(ok);

const achar = (texto: string) => {
  const achados = new Set<string>();
  for (const bruto of texto.split(/\s+/)) {
    const t = norm(bruto);
    if (t && proibidos.has(t)) achados.add(t);
  }
  return [...achados];
};

const itens: ItemRevisao[] = produtos.map((p, i) => ({
  id: `i${i}`,
  codigo: p.codigo,
  descricao: p.descricao,
  preco: Number(p.preco_unitario),
  quantidade: 1,
  ambiente: i % 2 ? "Sala" : "Cozinha",
  avulso: false,
  justificativa: null,
  ordem: i,
  marca: null,
  categoria: p.categoria,
  unidade: p.unidade as "un" | "m",
  produtoAtivo: true,
  precoCatalogo: Number(p.preco_unitario),
}));

let pdfs = 0;
for (let i = 0; i < itens.length; i += 40) {
  const dados = montarDadosPdf({
    loja: {
      nome_fantasia: "Luz Design",
      razao_social: null,
      cnpj: null,
      endereco: null,
      telefone: null,
      whatsapp: null,
      instagram: null,
      site: null,
    },
    config: { validade_dias: 7, desconto_avista_pct: 10, linhas_rodape: "Mercadoria frágil" },
    numero: "2026-9999",
    versao: 1,
    cliente: { nome: "Cliente Catálogo", whatsapp: null, arquiteto: null },
    vendedora: "Aline",
    itens: itens.slice(i, i + 40),
  });
  const pdf = await renderizarPdf(dados, null);
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), {
    mergePages: true,
  });
  const a = achar(text);
  if (a.length)
    console.log(
      text
        .split(" ")
        .map((t, k, arr) =>
          norm(t) === a[0] ? arr.slice(Math.max(0, k - 5), k + 3).join(" ") : null,
        )
        .filter(Boolean),
    );
  assert.deepEqual(a, [], `PDF (lote ${i / 40 + 1}) mostra dado do fornecedor: ${a.join(", ")}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    Buffer.from(await gerarPlanilhaOrcamento(dados, null)) as unknown as ExcelJS.Buffer,
  );
  const celulas: string[] = [];
  // Só texto: células numéricas (preços, quantidades, totais) podem coincidir com um número de referência.
  wb.eachSheet((ws) =>
    ws.eachRow((r) =>
      r.eachCell((c) => {
        const v = (c.value as { result?: unknown } | null)?.result ?? c.value;
        if (typeof v === "string") celulas.push(v);
      }),
    ),
  );
  const x = achar(celulas.join(" "));
  assert.deepEqual(x, [], `XLSX (lote ${i / 40 + 1}) mostra dado do fornecedor: ${x.join(", ")}`);
  pdfs++;
}
console.log(
  `\nCatálogo inteiro: ${produtos.length} produtos em ${pdfs} PDF e XLSX; ${proibidos.size} termos de fornecedor procurados; nenhum apareceu.`,
);
