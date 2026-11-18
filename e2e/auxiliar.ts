import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Guarda as linhas do cache de descrições (produtos_descricao_formatada) dos códigos usados pelo teste,
 * apaga-as para o teste ser determinístico e devolve a função que as RESTAURA no fim. Nada do que já
 * existia no cache se perde.
 */
export async function guardarCacheDescricoes(admin: SupabaseClient, codigos: string[]) {
  const { data } = await admin
    .from("produtos_descricao_formatada")
    .select("*")
    .in("codigo", codigos);
  const salvas = data ?? [];
  if (salvas.length)
    await admin.from("produtos_descricao_formatada").delete().in("codigo", codigos);
  return async () => {
    // o que o teste (IA simulada) gravou sai; o que já existia volta exatamente como estava
    await admin.from("produtos_descricao_formatada").delete().in("codigo", codigos);
    if (salvas.length) await admin.from("produtos_descricao_formatada").insert(salvas);
  };
}
