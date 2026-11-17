"use server";

import { revalidatePath } from "next/cache";
import { limparMensagemErro } from "@/lib/erros/limpar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Resposta = { ok: true } | { ok: false; erro: string };
const ERRO = "Não conseguimos enviar agora. Confira a internet e tente de novo.";

/**
 * "Relatar problema" do piloto: grava o relato (e a foto da tela, se houver) com a sessão de quem
 * enviou. A RLS garante que o relato é da própria pessoa; a foto vai para a pasta dela no bucket
 * privado `relatos`.
 */
export async function enviarRelato(formData: FormData): Promise<Resposta> {
  const usuario = await obterUsuarioAtual();
  const mensagem = String(formData.get("mensagem") ?? "").trim();
  const tela =
    String(formData.get("tela") ?? "")
      .split("?")[0]
      .slice(0, 200) || null;
  if (mensagem.length < 5)
    return { ok: false, erro: "Conte o que aconteceu (pelo menos algumas palavras)." };
  if (mensagem.length > 2000) return { ok: false, erro: "Use até 2000 caracteres." };

  const supabase = await criarClienteServidor();
  let fotoPath: string | null = null;
  const foto = formData.get("foto");
  if (foto instanceof File && foto.size > 0) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(foto.type) ||
      foto.size > 3 * 1024 * 1024
    )
      return { ok: false, erro: "A foto precisa ser JPG, PNG ou WEBP de até 3 MB." };
    const ext = foto.type === "image/png" ? "png" : foto.type === "image/webp" ? "webp" : "jpg";
    const caminho = `${usuario.id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage
      .from("relatos")
      .upload(caminho, Buffer.from(await foto.arrayBuffer()), { contentType: foto.type });
    if (!up.error) fotoPath = caminho; // sem a foto o relato segue valendo
  }

  const { error } = await supabase
    .from("relatos_piloto")
    .insert({ usuario_id: usuario.id, tela, mensagem, foto_path: fotoPath });
  if (error) {
    console.error("relato:", limparMensagemErro(error.message));
    return { ok: false, erro: ERRO };
  }
  revalidatePath("/relatos");
  return { ok: true };
}
