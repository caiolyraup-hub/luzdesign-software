"use server";

import { redirect } from "next/navigation";
import { validarSenhaNova } from "@/lib/senha";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export interface EstadoTrocaSenha {
  erro: string | null;
}

/** Primeiro login: troca a senha provisória e libera o resto do sistema (tira a marca trocar_senha). */
export async function trocarSenha(
  _anterior: EstadoTrocaSenha,
  formData: FormData,
): Promise<EstadoTrocaSenha> {
  const nova = String(formData.get("nova") ?? "");
  const confirmacao = String(formData.get("confirmacao") ?? "");
  const erro = validarSenhaNova(nova, confirmacao);
  if (erro) return { erro };

  const supabase = await criarClienteServidor();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) redirect("/login");

  const { error } = await supabase.auth.updateUser({
    password: nova,
    data: { trocar_senha: false },
  });
  if (error) {
    return {
      erro: /different|same/i.test(error.message)
        ? "A senha nova precisa ser diferente da provisória."
        : "Não foi possível trocar a senha agora. Confira a internet e tente de novo.",
    };
  }
  // Renova o token para que a marca nova valha já na próxima página.
  await supabase.auth.refreshSession();
  redirect("/");
}
