import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { respostasComCliente } from "../orcamento/respostas";
import type {
  AnexoParaIA,
  DescricaoFormatada,
  OrcamentoParaIA,
  ProdutoCatalogo,
  RepositorioIA,
} from "./comum";

function checar(contexto: string, erro: { message: string } | null) {
  if (erro) throw new Error(`${contexto}: ${erro.message}`);
}

/**
 * Banco real. `sessao` é o cliente da própria vendedora (RLS vale em orçamento, anexos, produtos e
 * indicações). `admin` (service role) só conta e registra uso_ia (ela não lê) e grava as
 * descrições padronizadas (só o servidor escreve nessa tabela).
 */
export function criarRepositorioIA(sessao: SupabaseClient, admin: SupabaseClient): RepositorioIA {
  return {
    async carregarOrcamento(id) {
      const { data } = await sessao
        .from("orcamentos")
        .select(
          "id, vendedora_id, status, respostas, clientes(nome, whatsapp, arquiteto_indicador)",
        )
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      const cliente = Array.isArray(data.clientes) ? data.clientes[0] : data.clientes;
      return {
        id: data.id,
        vendedora_id: data.vendedora_id,
        status: data.status,
        respostas: respostasComCliente(data.respostas, cliente),
      } satisfies OrcamentoParaIA;
    },

    async contarUso({ vendedoraId, desde }) {
      const recente = new Date(Date.now() - 10 * 60_000).toISOString();
      const { count, error } = await admin
        .from("uso_ia")
        .select("id", { count: "exact", head: true })
        .or(`status.eq.ok,and(status.eq.em_andamento,criado_em.gte.${recente})`)
        .eq("vendedora_id", vendedoraId)
        .gte("criado_em", desde.toISOString());
      checar("Contar uso da IA", error);
      return count ?? 0;
    },

    async existeEmAndamento(orcamentoId, tipo, desde) {
      const { count, error } = await admin
        .from("uso_ia")
        .select("id", { count: "exact", head: true })
        .eq("orcamento_id", orcamentoId)
        .eq("tipo", tipo)
        .eq("status", "em_andamento")
        .gte("criado_em", desde.toISOString());
      checar("Conferir uso em andamento", error);
      return (count ?? 0) > 0;
    },

    async iniciarUso({ orcamentoId, vendedoraId, modelo, tipo }) {
      const { data, error } = await admin
        .from("uso_ia")
        .insert({
          orcamento_id: orcamentoId,
          vendedora_id: vendedoraId,
          modelo,
          status: "em_andamento",
          tipo,
        })
        .select("id")
        .single();
      checar("Registrar uso da IA", error);
      return data!.id as string;
    },

    async finalizarUso(id, dados) {
      const { error } = await admin.from("uso_ia").update(dados).eq("id", id);
      checar("Finalizar uso da IA", error);
    },

    async carregarAnexos(orcamentoId): Promise<AnexoParaIA[]> {
      const { data, error } = await sessao
        .from("anexos")
        .select("id, tipo, nome_original, mime_type, caminho_storage")
        .eq("orcamento_id", orcamentoId)
        .order("criado_em");
      checar("Ler anexos", error);

      const resultado: AnexoParaIA[] = [];
      for (const a of data ?? []) {
        const { data: arquivo, error: erroArquivo } = await sessao.storage
          .from("anexos")
          .download(a.caminho_storage);
        if (erroArquivo || !arquivo) continue; // anexo ilegível não derruba o pedido
        resultado.push({
          id: a.id,
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
        .select("codigo, descricao, unidade, preco_unitario, ativo, categoria, atualizado_em")
        .in("codigo", codigos);
      checar("Ler produtos", error);
      for (const p of data ?? []) {
        mapa.set(p.codigo, {
          codigo: p.codigo,
          descricao: p.descricao,
          unidade: p.unidade,
          preco_unitario: Number(p.preco_unitario),
          ativo: p.ativo,
          categoria: p.categoria,
          atualizado_em: p.atualizado_em,
        });
      }
      return mapa;
    },

    async itensDoAmbiente(orcamentoId, ambiente) {
      const { data, error } = await sessao
        .from("orcamento_itens")
        .select("codigo, descricao_congelada, quantidade, ambiente")
        .eq("orcamento_id", orcamentoId)
        .order("ordem");
      checar("Ler itens do ambiente", error);
      return (data ?? [])
        .filter((i) => (i.ambiente ?? "").trim().toLowerCase() === ambiente.trim().toLowerCase())
        .map((i) => ({
          codigo: i.codigo,
          descricao: i.descricao_congelada,
          quantidade: Number(i.quantidade),
        }));
    },

    async salvarIndicacao(d) {
      const { error } = await sessao.from("indicacoes_ia").insert({
        orcamento_id: d.orcamentoId,
        vendedora_id: d.vendedoraId,
        ambiente: d.ambiente,
        pedido_cliente: d.pedidoCliente,
        pedido_arquiteto: d.pedidoArquiteto,
        descricao_ambiente: d.descricaoAmbiente,
        usou_anexos: d.usouAnexos,
        resposta: d.resposta,
      });
      checar("Guardar a indicação", error);
    },

    async descricoesFormatadas(codigos) {
      const mapa = new Map<string, DescricaoFormatada>();
      if (codigos.length === 0) return mapa;
      const { data, error } = await sessao
        .from("produtos_descricao_formatada")
        .select("codigo, descricao_formatada, descricao_origem")
        .in("codigo", codigos);
      checar("Ler descrições padronizadas", error);
      for (const d of data ?? []) mapa.set(d.codigo, d);
      return mapa;
    },

    async salvarDescricoesFormatadas(linhas) {
      if (linhas.length === 0) return;
      const { error } = await admin
        .from("produtos_descricao_formatada")
        .upsert(linhas, { onConflict: "codigo" });
      checar("Guardar descrições padronizadas", error);
    },
  };
}
