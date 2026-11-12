import type { SupabaseClient } from "@supabase/supabase-js";
import { adicionarDiasISO, hojeMaceioISO } from "../formatar";
import { linkWhatsapp, montarMensagemFollowup } from "./followup";
import { MENSAGEM_RENOVAR_PADRAO } from "./renovacao";
import { avisoValidade, STATUS_QUE_VENCEM, type AvisoValidade } from "./validade";

export interface DadosRenovar {
  id: string;
  numero: string;
  clienteNome: string;
  valorTotal: number;
  validade: string;
  aviso: AvisoValidade;
  linkWhatsapp: string;
}

interface Linha {
  id: string;
  numero: string;
  status: string;
  valor_total: number | string;
  validade: string | null;
  clientes:
    { nome: string; whatsapp: string | null } | { nome: string; whatsapp: string | null }[] | null;
}

const MENSAGEM_VENCE_LOGO =
  "Olá, {cliente}! Aqui é {vendedora}, da Luz Design. O orçamento nº {numero} está para vencer. Posso renovar para você?";

/**
 * Orçamentos da vendedora que já venceram ou vencem em até 1 dia (hoje ou amanhã), do mais antigo
 * ao mais novo. Calculado na leitura, pela sessão dela (RLS), com a regra única de vencimento.
 */
export async function paraRenovarDeHoje(
  supabase: SupabaseClient,
  vendedora: { id: string; nome: string },
  agora: Date = new Date(),
): Promise<DadosRenovar[]> {
  const hoje = hojeMaceioISO(agora);
  const { data } = await supabase
    .from("orcamentos")
    .select("id, numero, status, valor_total, validade, clientes(nome, whatsapp)")
    .eq("vendedora_id", vendedora.id)
    .in("status", [...STATUS_QUE_VENCEM])
    .not("validade", "is", null)
    .lte("validade", adicionarDiasISO(hoje, 1))
    .order("validade", { ascending: true });

  const lista: DadosRenovar[] = [];
  for (const l of (data ?? []) as unknown as Linha[]) {
    const aviso = avisoValidade(l.status, l.validade, hoje);
    if (!aviso || !l.validade) continue;
    const cliente = Array.isArray(l.clientes) ? l.clientes[0] : l.clientes;
    const nome = cliente?.nome ?? "Sem cliente";
    const modelo = aviso.tipo === "vencido" ? MENSAGEM_RENOVAR_PADRAO : MENSAGEM_VENCE_LOGO;
    lista.push({
      id: l.id,
      numero: l.numero,
      clienteNome: nome,
      valorTotal: Number(l.valor_total),
      validade: l.validade,
      aviso,
      linkWhatsapp: linkWhatsapp(
        cliente?.whatsapp,
        montarMensagemFollowup(modelo, {
          cliente: nome,
          numero: l.numero,
          vendedora: vendedora.nome,
        }),
      ),
    });
  }
  return lista;
}
