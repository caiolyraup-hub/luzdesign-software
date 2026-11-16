"use server";

import { revalidatePath } from "next/cache";
import { contemDadoDeFornecedor } from "@/lib/catalogo/limpar";
import { ehGerencia } from "@/lib/dominio";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

/**
 * Gerência e dono editam a descrição comercial do produto. A edição é prioritária (carimba
 * `descricao_editada_em`: a importação do estoque não a sobrescreve). A RLS de `produtos` também
 * barra qualquer outro perfil.
 */
export async function editarDescricaoProduto(
  codigo: string,
  texto: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const usuario = await obterUsuarioAtual();
  if (!ehGerencia(usuario.perfil)) return { ok: false, erro: "Só a gerência edita produtos." };
  if (!/^\d{1,5}$/.test(codigo)) return { ok: false, erro: "Código inválido." };
  const d = texto.replace(/\s+/g, " ").trim();
  if (d.length < 3 || d.length > 200) return { ok: false, erro: "Use de 3 a 200 caracteres." };
  // O texto vai para o cliente: sem marca, fabricante, linha/modelo nem referência.
  if (contemDadoDeFornecedor(d))
    return {
      ok: false,
      erro: "Não coloque marca, modelo nem referência do fabricante na descrição.",
    };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("produtos")
    .update({ descricao: d, descricao_editada_em: new Date().toISOString() })
    .eq("codigo", codigo)
    .select("codigo");
  if (error || !data?.length)
    return { ok: false, erro: "Não foi possível salvar agora. Tente de novo." };
  revalidatePath("/produtos");
  return { ok: true };
}
