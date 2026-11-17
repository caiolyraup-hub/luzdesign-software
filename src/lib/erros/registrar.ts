import "server-only";
import { criarClienteAdmin } from "../supabase/admin";
import { limparMensagemErro, limparRota } from "./limpar";

/** Grava um erro em `erros_app` (chave de serviço). NUNCA lança: registrar erro não pode causar outro. */
export async function registrarErro(e: {
  origem: "servidor" | "tela";
  rota?: string | null;
  erro: unknown;
  digest?: string | null;
  usuarioId?: string | null;
}): Promise<void> {
  try {
    await criarClienteAdmin()
      .from("erros_app")
      .insert({
        origem: e.origem,
        rota: limparRota(e.rota),
        mensagem: limparMensagemErro(e.erro),
        digest: e.digest?.slice(0, 80) ?? null,
        usuario_id: e.usuarioId ?? null,
      });
  } catch {
    // silencioso de propósito
  }
}
