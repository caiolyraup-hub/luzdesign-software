"use server";

import {
  MOTIVOS_PERDA,
  STATUS_ORCAMENTO,
  type MotivoPerda,
  type StatusOrcamento,
} from "@/lib/dominio";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaStatus = { ok: true; status: StatusOrcamento } | { ok: false; erro: string };

/** Mensagens da função SQL mudar_status_orcamento -> texto para a usuária. */
const ERROS: Record<string, string> = {
  ORCAMENTO_NAO_ENCONTRADO: "Orçamento não encontrado.",
  SEM_PERMISSAO: "Você não pode alterar este orçamento.",
  MESMO_STATUS: "O orçamento já está nesse status.",
  TRANSICAO_INVALIDA: "Essa mudança de status não é permitida a partir do status atual.",
  MOTIVO_OBRIGATORIO: "Escolha o motivo da perda.",
  VALOR_INVALIDO: "Informe o valor da venda (maior que zero).",
};

/**
 * Muda o status do orçamento (follow-up, fechado, perdido, reabrir). Vale para a dona e para a
 * gerência; quem decide é a RLS e a função do banco, que também valida a sequência e registra o evento.
 */
export async function mudarStatus(
  orcamentoId: string,
  para: StatusOrcamento,
  extra: { valorFechado?: number; motivo?: MotivoPerda } = {},
): Promise<RespostaStatus> {
  await obterUsuarioAtual();
  if (!STATUS_ORCAMENTO.includes(para)) return { ok: false, erro: "Status inválido." };
  if (para === "perdido" && (!extra.motivo || !MOTIVOS_PERDA.includes(extra.motivo))) {
    return { ok: false, erro: ERROS.MOTIVO_OBRIGATORIO };
  }
  if (para === "fechado" && extra.valorFechado !== undefined) {
    if (
      !Number.isFinite(extra.valorFechado) ||
      extra.valorFechado <= 0 ||
      extra.valorFechado > 100_000_000
    ) {
      return { ok: false, erro: ERROS.VALOR_INVALIDO };
    }
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("mudar_status_orcamento", {
    p_orcamento: orcamentoId,
    p_para: para,
    p_valor_fechado: para === "fechado" ? (extra.valorFechado ?? null) : null,
    p_motivo: para === "perdido" ? (extra.motivo ?? null) : null,
  });
  if (error) {
    const codigo = Object.keys(ERROS).find((c) => error.message.includes(c));
    return {
      ok: false,
      erro: codigo ? ERROS[codigo] : "Não foi possível mudar o status agora. Tente de novo.",
    };
  }
  return { ok: true, status: para };
}
