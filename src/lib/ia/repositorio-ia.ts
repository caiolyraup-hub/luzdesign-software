import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { respostasComCliente } from "../orcamento/respostas";
import type { ProdutoCatalogo } from "./normalizar";
import type {
  AnexoParaIA,
  FinalizacaoUso,
  MontagemGravada,
  OrcamentoParaMontar,
  RepositorioIA,
} from "./montar";
import type { ItemMontado } from "./normalizar";

function checar(contexto: string, erro: { message: string } | null) {
  if (erro) throw new Error(`${contexto}: ${erro.message}`);
}

/**
 * Banco real. `sessao` é o cliente da própria vendedora (RLS vale em orçamento, anexos, produtos e
 * na gravação dos itens). `admin` (service role) só escreve e conta em uso_ia, que ela não lê.
 */
export function criarRepositorioIA(sessao: SupabaseClient, admin: SupabaseClient): RepositorioIA {
  return {
    async carregarOrcamento(id) {
      const { data } = await sessao
        .from("orcamentos")
        .select("id, vendedora_id, status, respostas, clientes(nome, whatsapp)")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      const cliente = Array.isArray(data.clientes) ? data.clientes[0] : data.clientes;
      return {
        id: data.id,
        vendedora_id: data.vendedora_id,
        status: data.status,
        respostas: respostasComCliente(data.respostas, cliente),
      } satisfies OrcamentoParaMontar;
    },

    async contarUso({ vendedoraId, orcamentoId, desde }) {
      const recente = new Date(Date.now() - 10 * 60_000).toISOString();
      let q = admin
        .from("uso_ia")
        .select("id", { count: "exact", head: true })
        .or(`status.eq.ok,and(status.eq.em_andamento,criado_em.gte.${recente})`);
      if (vendedoraId) q = q.eq("vendedora_id", vendedoraId);
      if (orcamentoId) q = q.eq("orcamento_id", orcamentoId);
      if (desde) q = q.gte("criado_em", desde.toISOString());
      const { count, error } = await q;
      checar("Contar uso da IA", error);
      return count ?? 0;
    },

    async existeEmAndamento(orcamentoId, desde) {
      const { count, error } = await admin
        .from("uso_ia")
        .select("id", { count: "exact", head: true })
        .eq("orcamento_id", orcamentoId)
        .eq("status", "em_andamento")
        .gte("criado_em", desde.toISOString());
      checar("Conferir montagem em andamento", error);
      return (count ?? 0) > 0;
    },

    async iniciarUso({ orcamentoId, vendedoraId, modelo }) {
      const { data, error } = await admin
        .from("uso_ia")
        .insert({
          orcamento_id: orcamentoId,
          vendedora_id: vendedoraId,
          modelo,
          status: "em_andamento",
        })
        .select("id")
        .single();
      checar("Registrar uso da IA", error);
      return data!.id as string;
    },

    async finalizarUso(id, dados: FinalizacaoUso) {
      const { error } = await admin.from("uso_ia").update(dados).eq("id", id);
      checar("Finalizar uso da IA", error);
    },

    async carregarAnexos(orcamentoId): Promise<AnexoParaIA[]> {
      const { data, error } = await sessao
        .from("anexos")
        .select("tipo, nome_original, mime_type, caminho_storage")
        .eq("orcamento_id", orcamentoId)
        .order("criado_em");
      checar("Ler anexos", error);

      const resultado: AnexoParaIA[] = [];
      for (const a of data ?? []) {
        const { data: arquivo, error: erroArquivo } = await sessao.storage
          .from("anexos")
          .download(a.caminho_storage);
        if (erroArquivo || !arquivo) continue; // anexo ilegível não derruba a montagem
        resultado.push({
          tipo: a.tipo,
          nome: a.nome_original ?? "anexo",
          mime: a.mime_type ?? arquivo.type,
          dados: new Uint8Array(await arquivo.arrayBuffer()),
        });
      }
      return resultado;
    },

    async buscarProdutosPorCodigo(codigos) {
      const mapa = new Map<string, ProdutoCatalogo>();
      if (codigos.length === 0) return mapa;
      const { data, error } = await sessao
        .from("produtos")
        .select("codigo, descricao, unidade, preco_unitario, ativo")
        .in("codigo", codigos);
      checar("Ler produtos", error);
      for (const p of data ?? []) {
        mapa.set(p.codigo, {
          codigo: p.codigo,
          descricao: p.descricao,
          unidade: p.unidade,
          preco_unitario: Number(p.preco_unitario),
          ativo: p.ativo,
        });
      }
      return mapa;
    },

    async substituirItens(
      orcamentoId,
      itens: ItemMontado[],
      valorTotal: number,
      montagem: MontagemGravada,
    ) {
      const { error } = await sessao.rpc("substituir_itens_orcamento", {
        p_orcamento: orcamentoId,
        p_itens: itens,
        p_valor_total: valorTotal,
        p_montagem: montagem,
      });
      checar("Gravar itens do orçamento", error);
    },
  };
}
