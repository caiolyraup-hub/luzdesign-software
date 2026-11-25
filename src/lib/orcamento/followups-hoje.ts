import type { SupabaseClient } from "@supabase/supabase-js";
import type { DadosFollowup } from "@/components/orcamento/CartaoFollowup";
import { lerConfigFollowup } from "./config-followup";
import {
  followupDeHoje,
  linkWhatsapp,
  montarMensagemFollowup,
  proximoContato,
  textoPrazoFollowup,
} from "./followup";

interface Linha {
  id: string;
  numero: string;
  status: string;
  valor_total: number | string;
  ultimo_envio_em: string | null;
  clientes:
    { nome: string; whatsapp: string | null } | { nome: string; whatsapp: string | null }[] | null;
}

/**
 * Follow-ups que vencem hoje ou já venceram para uma vendedora, do mais atrasado para o mais novo.
 * Calculado na leitura (sem cron), pela sessão dela (RLS).
 */
export async function followupsDeHoje(
  supabase: SupabaseClient,
  vendedora: { id: string; nome: string },
  agora: Date = new Date(),
): Promise<DadosFollowup[]> {
  const [{ data }, config] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, numero, status, valor_total, ultimo_envio_em, clientes(nome, whatsapp)")
      .eq("vendedora_id", vendedora.id)
      .in("status", ["enviado", "followup_d5", "followup_d10"]),
    lerConfigFollowup(supabase),
  ]);

  return ((data ?? []) as unknown as Linha[])
    .map((l) => {
      const f = followupDeHoje({
        status: l.status,
        ultimoEnvioEm: l.ultimo_envio_em,
        agora,
        config,
      });
      if (!f) return null;
      const cliente = Array.isArray(l.clientes) ? l.clientes[0] : l.clientes;
      const nome = cliente?.nome ?? "Sem cliente";
      const modelo = f.etapa === "D+10" ? config.mensagemD10 : config.mensagemD5;
      const mensagem = montarMensagemFollowup(modelo, {
        cliente: nome,
        numero: l.numero,
        vendedora: vendedora.nome,
      });
      return {
        dados: {
          id: l.id,
          numero: l.numero,
          clienteNome: nome,
          valorTotal: Number(l.valor_total),
          etapa: f.etapa,
          prazo: textoPrazoFollowup(f),
          atrasado: f.diasAtraso > 0,
          sugerirPerdido: f.sugerirPerdido,
          linkWhatsapp: linkWhatsapp(cliente?.whatsapp, mensagem),
        } satisfies DadosFollowup,
        atraso: f.diasAtraso,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.atraso - a.atraso)
    .map((x) => x.dados);
}

export interface ContatoFuturo {
  id: string;
  numero: string;
  clienteNome: string;
  valorTotal: number;
  contato: NonNullable<ReturnType<typeof proximoContato>>;
}

/** Contatos que ainda vão vencer, do mais próximo para o mais distante (os de hoje ficam em cima). */
export async function proximosContatos(
  supabase: SupabaseClient,
  vendedora: { id: string },
  agora: Date = new Date(),
): Promise<ContatoFuturo[]> {
  const [{ data }, config] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, numero, status, valor_total, ultimo_envio_em, clientes(nome, whatsapp)")
      .eq("vendedora_id", vendedora.id)
      .in("status", ["enviado", "followup_d5", "followup_d10"]),
    lerConfigFollowup(supabase),
  ]);
  return ((data ?? []) as unknown as Linha[])
    .flatMap((l) => {
      const contato = proximoContato({
        status: l.status,
        ultimoEnvioEm: l.ultimo_envio_em,
        agora,
        config,
      });
      if (!contato || contato.diasAtraso >= 0) return [];
      const cliente = Array.isArray(l.clientes) ? l.clientes[0] : l.clientes;
      return [
        {
          id: l.id,
          numero: l.numero,
          clienteNome: cliente?.nome ?? "Sem cliente",
          valorTotal: Number(l.valor_total),
          contato,
        },
      ];
    })
    .sort((a, b) => a.contato.venceEm.localeCompare(b.contato.venceEm));
}
