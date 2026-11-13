import type { SupabaseClient } from "@supabase/supabase-js";
import { hojeMaceioISO } from "../formatar";
import { linkWhatsapp } from "../orcamento/followup";
import {
  mensagemAniversario,
  proximosAniversarios,
  type AniversarioArquiteto,
} from "./aniversario";

export interface CartaoAniversario {
  id: string;
  nome: string;
  dias: number;
  data: string;
  /** Link do WhatsApp com a mensagem padrão; null se o arquiteto não tem WhatsApp. */
  linkWhatsapp: string | null;
}

export const MENSAGEM_ANIVERSARIO_PADRAO =
  "Oi, {arquiteto}! Aqui é {vendedora}, da Luz Design. Passando para desejar um feliz aniversário, com muita saúde, projetos incríveis e boa luz em tudo!";

interface Linha extends AniversarioArquiteto {
  whatsapp: string | null;
}

/** Arquitetos que fazem aniversário hoje e nos próximos 7 dias (fuso de Maceió). */
export async function aniversariosDeHoje(
  supabase: SupabaseClient,
  vendedora: { nome: string },
  agora: Date = new Date(),
): Promise<CartaoAniversario[]> {
  const [{ data }, { data: cfg }] = await Promise.all([
    supabase
      .from("arquitetos")
      .select("id, nome, whatsapp, aniversario_dia, aniversario_mes")
      .eq("ativo", true)
      .not("aniversario_dia", "is", null),
    supabase.from("configuracoes_loja").select("mensagem_aniversario").limit(1).maybeSingle(),
  ]);
  const modelo = (cfg?.mensagem_aniversario as string | undefined) || MENSAGEM_ANIVERSARIO_PADRAO;
  return proximosAniversarios((data ?? []) as Linha[], hojeMaceioISO(agora), 7).map((p) => ({
    id: p.arquiteto.id,
    nome: p.arquiteto.nome,
    dias: p.dias,
    data: p.data,
    linkWhatsapp: p.arquiteto.whatsapp
      ? linkWhatsapp(
          p.arquiteto.whatsapp,
          mensagemAniversario(modelo, p.arquiteto.nome, vendedora.nome),
        )
      : null,
  }));
}
