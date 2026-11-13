"use server";

import { revalidatePath } from "next/cache";
import { BUCKET_FOTOS, listarArquitetos, type CartaoArquiteto } from "@/lib/arquitetos/servidor";
import { MAX_BYTES_FOTO, validarArquiteto } from "@/lib/arquitetos/validacao";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Falha = { ok: false; erro: string; erros?: Record<string, string> };
const falha = (erro: string, erros?: Record<string, string>): Falha => ({ ok: false, erro, erros });
const ERRO_GENERICO = "Não foi possível salvar agora. Tente de novo.";

const camposDe = (f: FormData) =>
  Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string"));

function arquivoDaFoto(f: FormData): File | null {
  const foto = f.get("foto");
  return foto instanceof File && foto.size > 0 ? foto : null;
}

/** Foto já reduzida no navegador (JPEG 400x400). O servidor só confere tipo e tamanho. */
function conferirFoto(foto: File): string | null {
  if (foto.type !== "image/jpeg") return "A foto precisa ser JPEG.";
  if (foto.size > MAX_BYTES_FOTO) return "A foto ficou grande demais. Tente outra.";
  return null;
}

/**
 * Grava a foto com a chave de serviço (o bucket não tem política para o cliente). A permissão é
 * conferida antes: a gerência sempre; a vendedora só no arquiteto que ela mesma criou.
 */
async function gravarFoto(arquitetoId: string, foto: File): Promise<string | null> {
  const admin = criarClienteAdmin();
  const caminho = `${arquitetoId}/${crypto.randomUUID()}.jpg`;
  const { error } = await admin.storage
    .from(BUCKET_FOTOS)
    .upload(caminho, Buffer.from(await foto.arrayBuffer()), { contentType: "image/jpeg" });
  if (error) return null;
  const { data: antes } = await admin
    .from("arquitetos")
    .select("foto_path")
    .eq("id", arquitetoId)
    .single();
  const { error: erroUpdate } = await admin
    .from("arquitetos")
    .update({ foto_path: caminho })
    .eq("id", arquitetoId);
  if (erroUpdate) {
    await admin.storage.from(BUCKET_FOTOS).remove([caminho]);
    return null;
  }
  if (antes?.foto_path) await admin.storage.from(BUCKET_FOTOS).remove([antes.foto_path]);
  return caminho;
}

// ---------------------------------------------------------------- criar (qualquer usuária)

export async function criarArquiteto(
  formData: FormData,
): Promise<Falha | { ok: true; id: string; nome: string }> {
  const usuario = await obterUsuarioAtual();
  const v = validarArquiteto(camposDe(formData));
  if (!v.ok) return falha(Object.values(v.erros)[0], v.erros);
  const foto = arquivoDaFoto(formData);
  if (foto) {
    const erroFoto = conferirFoto(foto);
    if (erroFoto) return falha(erroFoto, { foto: erroFoto });
  }

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("arquitetos")
    .insert({ ...v.dados, criado_por: usuario.id })
    .select("id, nome")
    .single();
  if (error || !data) return falha(ERRO_GENERICO);
  if (foto) await gravarFoto(data.id as string, foto); // sem foto o cadastro continua valendo
  revalidatePath("/arquitetos");
  return { ok: true, id: data.id as string, nome: data.nome as string };
}

/** Busca do seletor do formulário: poucos resultados, com a foto já assinada. */
export async function buscarArquitetos(q: string): Promise<CartaoArquiteto[]> {
  await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const lista = await listarArquitetos(supabase, { q: q.trim().slice(0, 80) });
  return (lista ?? []).slice(0, 30);
}

// ---------------------------------------------------------------- editar (gerência)

async function exigirGerencia(): Promise<Falha | null> {
  const usuario = await obterUsuarioAtual();
  return usuario.perfil === "gerente" ? null : falha("Só a gerência altera arquitetos.");
}

export async function editarArquiteto(
  id: string,
  formData: FormData,
): Promise<Falha | { ok: true }> {
  const negado = await exigirGerencia();
  if (negado) return negado;
  const v = validarArquiteto(camposDe(formData));
  if (!v.ok) return falha(Object.values(v.erros)[0], v.erros);
  const foto = arquivoDaFoto(formData);
  if (foto) {
    const erroFoto = conferirFoto(foto);
    if (erroFoto) return falha(erroFoto, { foto: erroFoto });
  }

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("arquitetos")
    .update(v.dados)
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return falha(ERRO_GENERICO);
  if (foto && !(await gravarFoto(id, foto))) return falha("Dados salvos, mas a foto não subiu.");
  revalidatePath("/arquitetos");
  revalidatePath(`/arquitetos/${id}`);
  return { ok: true };
}

export async function removerFotoArquiteto(id: string): Promise<Falha | { ok: true }> {
  const negado = await exigirGerencia();
  if (negado) return negado;
  const admin = criarClienteAdmin();
  const { data } = await admin.from("arquitetos").select("foto_path").eq("id", id).single();
  if (!data?.foto_path) return { ok: true };
  await admin.from("arquitetos").update({ foto_path: null }).eq("id", id);
  await admin.storage.from(BUCKET_FOTOS).remove([data.foto_path as string]);
  revalidatePath(`/arquitetos/${id}`);
  return { ok: true };
}

export async function alterarAtivoArquiteto(
  id: string,
  ativo: boolean,
): Promise<Falha | { ok: true }> {
  const negado = await exigirGerencia();
  if (negado) return negado;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("arquitetos")
    .update({ ativo })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return falha(ERRO_GENERICO);
  const usuario = await obterUsuarioAtual();
  // Auditoria: só o servidor grava (a tabela não tem política de escrita).
  await criarClienteAdmin()
    .from("eventos_arquiteto")
    .insert({ arquiteto_id: id, tipo: ativo ? "reativou" : "desativou", usuario_id: usuario.id });
  revalidatePath("/arquitetos");
  revalidatePath(`/arquitetos/${id}`);
  return { ok: true };
}

export async function juntarArquitetos(
  manterId: string,
  removerId: string,
): Promise<Falha | { ok: true; orcamentos: number; clientes: number }> {
  const negado = await exigirGerencia();
  if (negado) return negado;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("juntar_arquitetos", {
    p_manter: manterId,
    p_remover: removerId,
  });
  if (error)
    return falha(
      error.message.includes("diferentes") ? "Escolha dois arquitetos diferentes." : ERRO_GENERICO,
    );
  const r = data as { orcamentos?: number; clientes?: number; foto_removida?: string | null };
  if (r.foto_removida)
    await criarClienteAdmin().storage.from(BUCKET_FOTOS).remove([r.foto_removida]);
  revalidatePath("/arquitetos");
  return { ok: true, orcamentos: Number(r.orcamentos ?? 0), clientes: Number(r.clientes ?? 0) };
}
