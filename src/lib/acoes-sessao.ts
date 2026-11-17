"use server";

import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export interface EstadoLogin {
  erro: string | null;
}

export async function entrar(_anterior: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  if (!email || !senha) return { erro: "Informe e-mail e senha." };

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) {
    return {
      erro:
        error.status === 400
          ? "E-mail ou senha incorretos."
          : "Não foi possível entrar agora. Tente novamente.",
    };
  }
  // Conta nova (senha provisória): a primeira tela é a troca de senha.
  if ((data.user?.user_metadata as { trocar_senha?: boolean } | undefined)?.trocar_senha === true)
    redirect("/trocar-senha");
  redirect("/");
}

export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
