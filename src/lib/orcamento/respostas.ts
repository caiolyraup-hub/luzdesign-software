import { normalizarWhatsapp, type Respostas } from "./perguntas";

/**
 * Rascunhos antigos (ou do seed) podem não ter tudo em `respostas`: completa nome e WhatsApp
 * pelo cadastro do cliente. O que já está em `respostas` vale mais.
 */
export function respostasComCliente(
  respostas: Respostas | null | undefined,
  cliente: { nome?: string | null; whatsapp?: string | null } | null | undefined,
): Respostas {
  const doCliente: Respostas = {};
  if (cliente?.nome) doCliente.cliente_nome = cliente.nome;
  const zap = cliente?.whatsapp ? normalizarWhatsapp(cliente.whatsapp) : null;
  if (zap) doCliente.cliente_whatsapp = zap;
  return { ...doCliente, ...(respostas ?? {}) };
}
