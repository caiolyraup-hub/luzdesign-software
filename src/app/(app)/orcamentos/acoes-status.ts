"use server";

import {
  MOTIVOS_PERDA,
  STATUS_ORCAMENTO,
  type MotivoPerda,
  type StatusOrcamento,
} from "@/lib/dominio";
import { hojeMaceioISO } from "@/lib/formatar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaStatus = { ok: true; status: StatusOrcamento } | { ok: false; erro: string };

/** Mensagens das funções SQL de status -> texto para a usuária. */
const ERROS: Record<string, string> = {
  ORCAMENTO_NAO_ENCONTRADO: "Orçamento não encontrado.",
  SEM_PERMISSAO: "Você não pode alterar este orçamento.",
  MESMO_STATUS: "O orçamento já está nesse status.",
  TRANSICAO_INVALIDA: "Essa mudança de status não é permitida a partir do status atual.",
  MOTIVO_OBRIGATORIO: "Escolha o motivo da perda.",
  VALOR_INVALIDO: "Informe o valor da venda (maior que zero).",
  DATA_FUTURA: "A data do envio não pode ser no futuro.",
  DATA_ANTES_DE_GERADO: "A data do envio não pode ser antes de o orçamento ser gerado.",
};

function erroDoBanco(mensagem: string): string {
  const codigo = Object.keys(ERROS).find((c) => mensagem.includes(c));
  return codigo ? ERROS[codigo] : "Não foi possível mudar o status agora. Tente de novo.";
}

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
  if (error) return { ok: false, erro: erroDoBanco(error.message) };
  return { ok: true, status: para };
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Marquei como enviado", com a data do envio (padrão: hoje; aceita dias anteriores, não futuro
 * nem antes de gerado). O primeiro envio grava enviado_em; os seguintes só mudam ultimo_envio_em,
 * que é de onde contam os follow-ups.
 */
export async function marcarEnviado(orcamentoId: string, data?: string): Promise<RespostaStatus> {
  await obterUsuarioAtual();
  if (data !== undefined && !DATA_ISO.test(data)) return { ok: false, erro: "Data inválida." };
  if (data !== undefined && data > hojeMaceioISO()) return { ok: false, erro: ERROS.DATA_FUTURA };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("marcar_enviado", {
    p_orcamento: orcamentoId,
    p_data: data ?? null,
  });
  if (error) return { ok: false, erro: erroDoBanco(error.message) };
  return { ok: true, status: "enviado" };
}

/** "Fiz o follow-up": enviado vira D+5; D+5 vira D+10. Um toque, sem pedir mais nada. */
export async function registrarFollowup(orcamentoId: string): Promise<RespostaStatus> {
  await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", orcamentoId)
    .maybeSingle();
  if (!data) return { ok: false, erro: ERROS.ORCAMENTO_NAO_ENCONTRADO };
  const proximo: Partial<Record<string, StatusOrcamento>> = {
    enviado: "followup_d5",
    followup_d5: "followup_d10",
  };
  const para = proximo[data.status];
  if (!para) return { ok: false, erro: ERROS.TRANSICAO_INVALIDA };
  return mudarStatus(orcamentoId, para);
}

/**
 * "Editar e enviar nova versão": volta para gerado sem apagar as datas de envio e libera a edição
 * dos produtos. Só a dona.
 */
export async function reabrirParaEdicao(orcamentoId: string): Promise<RespostaStatus> {
  await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("reabrir_para_edicao", { p_orcamento: orcamentoId });
  if (error) return { ok: false, erro: erroDoBanco(error.message) };
  return { ok: true, status: "gerado" };
}
