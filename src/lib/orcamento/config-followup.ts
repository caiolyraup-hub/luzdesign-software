import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONFIG_FOLLOWUP_PADRAO,
  MENSAGEM_D10_PADRAO,
  MENSAGEM_D5_PADRAO,
  type ConfigFollowup,
} from "./followup";

export interface ConfigFollowupCompleta extends ConfigFollowup {
  mensagemD5: string;
  mensagemD10: string;
}

/** Dias e mensagens do follow-up (configuracoes_loja); sem a linha, valem os padrões. */
export async function lerConfigFollowup(supabase: SupabaseClient): Promise<ConfigFollowupCompleta> {
  const { data } = await supabase
    .from("configuracoes_loja")
    .select("followup_d5_dias, followup_d10_dias, mensagem_d5, mensagem_d10")
    .eq("id", true)
    .maybeSingle();
  return {
    d5Dias: data?.followup_d5_dias ?? CONFIG_FOLLOWUP_PADRAO.d5Dias,
    d10Dias: data?.followup_d10_dias ?? CONFIG_FOLLOWUP_PADRAO.d10Dias,
    mensagemD5: data?.mensagem_d5 ?? MENSAGEM_D5_PADRAO,
    mensagemD10: data?.mensagem_d10 ?? MENSAGEM_D10_PADRAO,
  };
}
