"use server";

import { registrarErro } from "@/lib/erros/registrar";
import { criarClienteServidor } from "@/lib/supabase/servidor";

/** A tela caiu: grava rota e digest (a mensagem real fica escondida em produção). Nunca lança. */
export async function registrarErroDaTela(rota: string, digest: string | null) {
  let usuarioId: string | null = null;
  try {
    const supabase = await criarClienteServidor();
    const { data } = await supabase.auth.getClaims();
    usuarioId = (data?.claims.sub as string | undefined) ?? null;
  } catch {
    // sem sessão: segue sem usuário
  }
  await registrarErro({
    origem: "tela",
    rota,
    erro: "Erro de tela (error boundary)",
    digest,
    usuarioId,
  });
}
