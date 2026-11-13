import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { criarClienteAdmin } from "../supabase/admin";

export const BUCKET_FOTOS = "arquitetos";
/** URLs assinadas das fotos duram poucos minutos (é dado pessoal). */
export const VALIDADE_URL_FOTO_SEGUNDOS = 300;

export interface CartaoArquiteto {
  id: string;
  nome: string;
  escritorio: string | null;
  whatsapp: string | null;
  email: string | null;
  aniversario_dia: number | null;
  aniversario_mes: number | null;
  aniversario_ano: number | null;
  ativo: boolean;
  indicados: number;
  fechados: number;
  vendido: number;
  /** URL assinada (curta duração) ou null quando não há foto. */
  foto_url: string | null;
}

interface LinhaLista extends Omit<CartaoArquiteto, "foto_url"> {
  foto_path: string | null;
}

/** URLs assinadas das fotos, pelo servidor (o bucket é privado e não tem política para o cliente). */
export async function urlsDasFotos(caminhos: (string | null)[]): Promise<Map<string, string>> {
  const validos = [...new Set(caminhos.filter((c): c is string => Boolean(c)))];
  const mapa = new Map<string, string>();
  if (validos.length === 0) return mapa;
  const { data } = await criarClienteAdmin()
    .storage.from(BUCKET_FOTOS)
    .createSignedUrls(validos, VALIDADE_URL_FOTO_SEGUNDOS);
  for (const u of data ?? []) if (u.path && u.signedUrl) mapa.set(u.path, u.signedUrl);
  return mapa;
}

/** Lista com números (a RLS limita os números de orçamentos à vendedora) e fotos já assinadas. */
export async function listarArquitetos(
  supabase: SupabaseClient,
  opcoes: { q?: string; inativos?: boolean } = {},
): Promise<CartaoArquiteto[] | null> {
  const { data, error } = await supabase.rpc("listar_arquitetos", {
    p: { ...(opcoes.q ? { q: opcoes.q } : {}), ...(opcoes.inativos ? { inativos: true } : {}) },
  });
  if (error || !Array.isArray(data)) return null;
  const linhas = data as unknown as LinhaLista[];
  const fotos = await urlsDasFotos(linhas.map((l) => l.foto_path));
  return linhas.map(({ foto_path, ...resto }) => ({
    ...resto,
    indicados: Number(resto.indicados),
    fechados: Number(resto.fechados),
    vendido: Number(resto.vendido),
    foto_url: foto_path ? (fotos.get(foto_path) ?? null) : null,
  }));
}
