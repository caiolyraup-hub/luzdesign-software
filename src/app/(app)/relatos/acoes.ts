"use server";

import { revalidatePath } from "next/cache";
import { ehGerencia } from "@/lib/dominio";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

/** Gerência e dono marcam o relato como resolvido (a RLS também barra qualquer outro perfil). */
export async function alterarStatusRelato(
  id: string,
  status: "aberto" | "resolvido",
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const usuario = await obterUsuarioAtual();
  if (!ehGerencia(usuario.perfil)) return { ok: false, erro: "Só a gerência resolve relatos." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, erro: "Relato inválido." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("relatos_piloto")
    .update({
      status,
      resolvido_em: status === "resolvido" ? new Date().toISOString() : null,
      resolvido_por: status === "resolvido" ? usuario.id : null,
    })
    .eq("id", id)
    .select("id");
  if (error || !data?.length)
    return { ok: false, erro: "Não foi possível salvar agora. Tente de novo." };
  revalidatePath("/relatos");
  return { ok: true };
}
