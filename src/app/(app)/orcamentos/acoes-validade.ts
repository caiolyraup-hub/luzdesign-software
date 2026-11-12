"use server";

import { gerarPlanilhaOrcamento } from "@/lib/planilha/orcamento";
import { carregarLogo, renderizarPdf } from "@/lib/pdf/renderizar";
import { renovarOrcamento } from "@/lib/pdf/renovar";
import { carregarItensRevisao } from "@/lib/orcamento/carregar-itens";
import {
  compararPrecos,
  MODOS_RENOVACAO,
  resumirRenovacao,
  type DiferencaItem,
  type ModoRenovacao,
  type ResumoRenovacao,
} from "@/lib/orcamento/renovacao";
import { STATUS_QUE_VENCEM } from "@/lib/orcamento/validade";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaPrevia =
  | { ok: false; erro: string }
  | { ok: true; diferencas: DiferencaItem[]; resumo: ResumoRenovacao; validadeDias: number };

/**
 * Prévia da renovação: compara o preço congelado de cada item com o preço atual do catálogo. Não
 * grava nada. Só a dona e a gerência (a RLS já limita o que cada uma lê).
 */
export async function previaRenovacao(orcamentoId: string): Promise<RespostaPrevia> {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("id, status, vendedora_id")
    .eq("id", orcamentoId)
    .maybeSingle();
  if (!orc || (orc.vendedora_id !== usuario.id && usuario.perfil !== "gerente"))
    return { ok: false, erro: "Orçamento não encontrado." };
  if (!(STATUS_QUE_VENCEM as readonly string[]).includes(orc.status))
    return { ok: false, erro: "Este orçamento não pode ser renovado no status atual." };

  const itens = await carregarItensRevisao(supabase, orcamentoId);
  const codigos = [...new Set(itens.filter((i) => !i.avulso && i.codigo).map((i) => i.codigo!))];
  const [{ data: estoques }, { data: cfg }] = await Promise.all([
    codigos.length
      ? supabase.from("produtos").select("codigo, estoque_disponivel").in("codigo", codigos)
      : Promise.resolve({ data: [] as { codigo: string; estoque_disponivel: number | null }[] }),
    supabase.from("configuracoes_loja").select("validade_dias").eq("id", true).maybeSingle(),
  ]);
  const estoque = new Map(
    (estoques ?? []).map((e) => [
      e.codigo as string,
      e.estoque_disponivel === null ? null : Number(e.estoque_disponivel),
    ]),
  );

  const diferencas = compararPrecos(
    itens.map((i) => ({
      id: i.id,
      codigo: i.codigo,
      descricao: i.descricao,
      ambiente: i.ambiente,
      quantidade: i.quantidade,
      precoCongelado: i.preco,
      precoCatalogo: i.precoCatalogo,
      produtoAtivo: i.produtoAtivo !== false,
      avulso: i.avulso,
      estoque: i.codigo ? (estoque.get(i.codigo) ?? null) : null,
    })),
  );
  return {
    ok: true,
    diferencas,
    resumo: resumirRenovacao(diferencas),
    validadeDias: cfg?.validade_dias ?? 7,
  };
}

export type RespostaRenovar =
  { ok: true; versao: number } | { ok: false; erro: string; bloqueios?: string[] };

/**
 * Renova a validade com uma nova versão (PDF e XLSX). `modo`: "atualizar" (preço atual do catálogo) ou
 * "manter" (preços congelados). Roda com a sessão de quem pediu; a dona e a gerência podem.
 */
export async function renovarValidade(
  orcamentoId: string,
  modo: ModoRenovacao,
): Promise<RespostaRenovar> {
  if (!(MODOS_RENOVACAO as readonly string[]).includes(modo))
    return { ok: false, erro: "Escolha como renovar." };
  const usuario = await obterUsuarioAtual();
  const sessao = await criarClienteServidor();
  try {
    const logo = await carregarLogo();
    const r = await renovarOrcamento(
      {
        sessao,
        armazenamento: criarClienteAdmin(),
        renderizar: (dados) => renderizarPdf(dados, logo),
        gerarPlanilha: (dados) => gerarPlanilhaOrcamento(dados, logo),
      },
      { id: usuario.id, perfil: usuario.perfil },
      orcamentoId,
      modo,
    );
    if (!r.ok) return { ok: false, erro: r.erro, bloqueios: r.bloqueios };
    return { ok: true, versao: r.versao };
  } catch {
    return { ok: false, erro: "Não foi possível renovar o orçamento agora. Tente de novo." };
  }
}
