import type { SupabaseClient } from "@supabase/supabase-js";
import { paraRpc, type FiltrosLista } from "../orcamento/filtros-lista";
import {
  TAMANHO_LOTE,
  type EventoExport,
  type FonteExportacao,
  type ItemExport,
  type OrcamentoExport,
} from "./planilha";

/** O PostgREST devolve no máximo 1.000 linhas por consulta: lê em páginas até acabar. */
const PAGINA = 1000;
/** Trava de segurança: 1.000 lotes de 100 = 100 mil orçamentos. */
const MAX_LOTES = 1000;

async function lerTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error("Falha ao ler os dados da exportação.");
    const linhas = (data ?? []) as T[];
    saida.push(...linhas);
    if (linhas.length < PAGINA) return saida;
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

/**
 * Lê da base o que a exportação precisa, sempre com a sessão de quem exporta (RLS): não existe um
 * segundo caminho de acesso. Os orçamentos vêm da mesma função SQL da lista (`listar_orcamentos`),
 * em lotes de 100 por cursor e sem as contagens; itens e eventos vêm por lote, na hora de escrever.
 */
export async function carregarFonteExportacao(
  supabase: SupabaseClient,
  filtros: FiltrosLista,
  opcoes: { incluirTeste: boolean },
): Promise<FonteExportacao> {
  const orcamentos: OrcamentoExport[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_LOTES; i++) {
    const { data, error } = await supabase.rpc("listar_orcamentos", {
      p: {
        ...paraRpc(filtros, { cursor, limite: TAMANHO_LOTE }),
        incluir_teste: opcoes.incluirTeste,
        sem_contagem: true,
      },
    });
    if (error || !data) throw new Error("Falha ao ler os orçamentos da exportação.");
    const j = data as { itens: Record<string, unknown>[]; proximo: string | null };
    for (const l of j.itens) {
      orcamentos.push({
        id: String(l.id),
        numero: String(l.numero),
        vendedora_id: String(l.vendedora_id),
        vendedora_nome: txt(l.vendedora_nome),
        cliente_id: String(l.cliente_id),
        cliente_nome: txt(l.cliente_nome),
        cliente_whatsapp: txt(l.cliente_whatsapp),
        cliente_tipo: txt(l.cliente_tipo),
        arquiteto_indicador: txt(l.arquiteto_indicador),
        endereco: txt(l.endereco),
        status: String(l.status),
        valor_total: Number(l.valor_total),
        valor_fechado: num(l.valor_fechado),
        motivo_perda: txt(l.motivo_perda),
        criado_em: String(l.criado_em),
        gerado_em: txt(l.gerado_em),
        enviado_em: txt(l.enviado_em),
        ultimo_envio_em: txt(l.ultimo_envio_em),
        fechado_em: txt(l.fechado_em),
        perdido_em: txt(l.perdido_em),
        validade: txt(l.validade),
        pdf_versao: Number(l.pdf_versao ?? 0),
      });
    }
    cursor = j.proximo;
    if (!cursor) break;
  }

  const itens = async (ids: string[]): Promise<ItemExport[]> => {
    const linhas = await lerTudo<{
      orcamento_id: string;
      ambiente: string | null;
      codigo: string | null;
      descricao_congelada: string;
      preco_unitario_congelado: number | string;
      quantidade: number | string;
      avulso: boolean;
      origem: string | null;
      ordem: number;
      produtos: { unidade: string } | { unidade: string }[] | null;
    }>((de, ate) =>
      supabase
        .from("orcamento_itens")
        .select(
          "orcamento_id, ambiente, codigo, descricao_congelada, preco_unitario_congelado, quantidade, avulso, origem, ordem, produtos(unidade)",
        )
        .in("orcamento_id", ids)
        .order("orcamento_id")
        .order("ordem")
        .order("id")
        .range(de, ate),
    );
    return linhas.map((l) => {
      const p = Array.isArray(l.produtos) ? l.produtos[0] : l.produtos;
      return {
        orcamento_id: l.orcamento_id,
        ambiente: l.ambiente,
        codigo: l.avulso ? null : l.codigo,
        descricao: l.descricao_congelada,
        quantidade: Number(l.quantidade),
        unidade: p?.unidade ?? "un",
        preco_unitario: Number(l.preco_unitario_congelado),
        avulso: l.avulso,
        origem: l.origem,
      };
    });
  };

  const eventos = async (ids: string[]): Promise<EventoExport[]> => {
    const linhas = await lerTudo<{
      orcamento_id: string;
      de_status: string | null;
      para_status: string;
      criado_em: string;
      usuarios: { nome: string } | { nome: string }[] | null;
    }>((de, ate) =>
      supabase
        .from("eventos")
        .select("orcamento_id, de_status, para_status, criado_em, usuarios(nome)")
        .in("orcamento_id", ids)
        .order("orcamento_id")
        .order("criado_em")
        .order("id")
        .range(de, ate),
    );
    return linhas.map((l) => ({
      orcamento_id: l.orcamento_id,
      de_status: l.de_status,
      para_status: l.para_status,
      criado_em: l.criado_em,
      quem: (Array.isArray(l.usuarios) ? l.usuarios[0] : l.usuarios)?.nome ?? null,
    }));
  };

  return { orcamentos, itens, eventos };
}
