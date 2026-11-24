import type { SupabaseClient } from "@supabase/supabase-js";
import { precisaRegistrarEnvio } from "./envio";

export interface ParaRegistrarEnvio {
  id: string;
  numero: string;
  clienteNome: string;
  valorTotal: number;
  geradoEm: string;
}

interface Linha {
  id: string;
  numero: string;
  status: string;
  valor_total: number | string;
  gerado_em: string | null;
  enviado_em: string | null;
  clientes: { nome: string } | { nome: string }[] | null;
}

/** Gerados há mais de 1 dia sem envio registrado, do mais antigo ao mais novo (pela sessão: RLS). */
export async function paraRegistrarEnvio(
  supabase: SupabaseClient,
  vendedora: { id: string },
  agora: Date = new Date(),
): Promise<ParaRegistrarEnvio[]> {
  const { data } = await supabase
    .from("orcamentos")
    .select("id, numero, status, valor_total, gerado_em, enviado_em, clientes(nome)")
    .eq("vendedora_id", vendedora.id)
    .eq("status", "gerado")
    .is("enviado_em", null);
  return ((data ?? []) as unknown as Linha[])
    .filter((l) =>
      precisaRegistrarEnvio(
        { status: l.status, geradoEm: l.gerado_em, enviadoEm: l.enviado_em },
        agora,
      ),
    )
    .map((l) => ({
      id: l.id,
      numero: l.numero,
      clienteNome: (Array.isArray(l.clientes) ? l.clientes[0] : l.clientes)?.nome ?? "Sem cliente",
      valorTotal: Number(l.valor_total),
      geradoEm: l.gerado_em as string,
    }))
    .sort((a, b) => a.geradoEm.localeCompare(b.geradoEm));
}
