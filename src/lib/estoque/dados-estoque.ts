// Dados que só a PLANILHA DO ESTOQUE mostra (nunca o PDF do cliente): fabricante, referência, modelo,
// tamanho e voltagem. Fabricante e referência ficam numa tabela que a vendedora não lê pela RLS; quem
// gera o documento lê no servidor, com a service role, e só os códigos do próprio orçamento. Custo não
// é lido.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DadosEstoque {
  fabricante: string;
  referencia: string;
  modelo: string;
  tamanho: string;
  voltagem: string;
}

export type MapaEstoque = Map<string, DadosEstoque>;

/** Voltagem escrita na descrição ("220V", "24 V", "BIVOLT"); vazio quando não consta. */
export function extrairVoltagem(...textos: (string | null | undefined)[]): string {
  const achadas = new Set<string>();
  for (const t of textos) {
    if (!t) continue;
    if (/\bBI-?VOLT\b/i.test(t)) achadas.add("Bivolt");
    for (const m of t.matchAll(/(?<![\d.,])(12|24|48|110|127|220)\s?V(?![A-Z0-9])/gi))
      achadas.add(`${m[1]}V`);
  }
  return [...achadas].join(" / ");
}

export function textoTamanho(atributos: unknown): string {
  const c = (atributos as { comprimento?: unknown } | null)?.comprimento;
  return typeof c === "number" && c > 0 ? `${String(c).replace(".", ",")} m` : "";
}

export async function lerDadosEstoque(
  servidor: SupabaseClient,
  codigos: string[],
): Promise<MapaEstoque> {
  const mapa: MapaEstoque = new Map();
  const unicos = [...new Set(codigos)];
  if (unicos.length === 0) return mapa;
  const [produtos, fornecedor] = await Promise.all([
    servidor.from("produtos").select("codigo, descricao, atributos").in("codigo", unicos),
    servidor
      .from("produtos_dados_fornecedor")
      .select("codigo, fabricante, referencia_fabricante, modelo, descricao_fornecedor")
      .in("codigo", unicos),
  ]);
  const erro = produtos.error ?? fornecedor.error;
  if (erro) throw new Error(`Ler dados do estoque: ${erro.message}`);
  const porCodigo = new Map((fornecedor.data ?? []).map((f) => [f.codigo as string, f]));
  for (const p of produtos.data ?? []) {
    const f = porCodigo.get(p.codigo as string);
    mapa.set(p.codigo as string, {
      fabricante: f?.fabricante ?? "",
      referencia: f?.referencia_fabricante ?? "",
      modelo: f?.modelo ?? "",
      tamanho: textoTamanho(p.atributos),
      voltagem: extrairVoltagem(f?.descricao_fornecedor, p.descricao as string),
    });
  }
  return mapa;
}
