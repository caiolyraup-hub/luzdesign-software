import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Perfil } from "@/lib/dominio";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export interface UsuarioAtual {
  id: string;
  nome: string;
  perfil: Perfil;
}

/** Usuária logada (lida do banco, sob RLS). Redireciona para /login se não houver sessão. */
export const obterUsuarioAtual = cache(async (): Promise<UsuarioAtual> => {
  const supabase = await criarClienteServidor();
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims.sub;
  if (!id) redirect("/login");

  const { data } = await supabase
    .from("usuarios")
    .select("id, nome, perfil")
    .eq("id", id)
    .maybeSingle();
  // Autenticada no Auth, mas sem linha em usuarios: sem acesso.
  if (!data) redirect("/login?erro=sem-perfil");

  return data as UsuarioAtual;
});
