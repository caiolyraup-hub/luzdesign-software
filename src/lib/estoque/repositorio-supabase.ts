import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinhaProduto, ProdutoExistente, RepositorioEstoque } from "./importar";

const PAGINA = 1000;

function falhar(contexto: string, erro: { message: string } | null) {
  if (erro) throw new Error(`${contexto}: ${erro.message}`);
}

/**
 * Repositório sobre Supabase. Quem chama já checou que a usuária é gerente;
 * sync_estoque só aceita escrita do service role, então use o cliente admin.
 */
export function criarRepositorioSupabase(supabase: SupabaseClient): RepositorioEstoque {
  return {
    async listarExistentes() {
      const mapa = new Map<string, ProdutoExistente>();
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await supabase
          .from("produtos")
          .select(
            "codigo, descricao, preco_unitario, categoria, marca, unidade, estoque_disponivel, ativo",
          )
          .order("codigo")
          .range(de, de + PAGINA - 1);
        falhar("Ler produtos", error);
        for (const p of data ?? []) {
          mapa.set(p.codigo, {
            descricao: p.descricao,
            preco_unitario: Number(p.preco_unitario),
            categoria: p.categoria,
            marca: p.marca,
            unidade: p.unidade,
            estoque_disponivel: p.estoque_disponivel === null ? null : Number(p.estoque_disponivel),
            ativo: p.ativo,
          });
        }
        if (!data || data.length < PAGINA) break;
      }
      return mapa;
    },

    async gravarProdutos(linhas: LinhaProduto[]) {
      const { error } = await supabase.from("produtos").upsert(linhas, { onConflict: "codigo" });
      falhar("Gravar produtos", error);
    },

    async gravarApelidos(linhas) {
      const { error } = await supabase
        .from("produto_apelidos")
        .upsert(linhas, { onConflict: "codigo,texto", ignoreDuplicates: true });
      falhar("Gravar apelidos", error);
    },

    async desativar(codigos) {
      const { error } = await supabase
        .from("produtos")
        .update({ ativo: false })
        .in("codigo", codigos);
      falhar("Desativar produtos", error);
    },

    async iniciarSync(origem) {
      const { data, error } = await supabase
        .from("sync_estoque")
        .insert({ origem })
        .select("id")
        .single();
      falhar("Registrar carga", error);
      return data!.id as string;
    },

    async finalizarSync(id, dados) {
      const { error } = await supabase
        .from("sync_estoque")
        .update({ ...dados, terminado_em: new Date().toISOString() })
        .eq("id", id);
      falhar("Finalizar carga", error);
    },
  };
}
