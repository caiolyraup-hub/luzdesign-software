"use server";

import { revalidatePath } from "next/cache";
import { lerPercentual } from "@/lib/comissoes/calculo";
import { ehDono } from "@/lib/dominio";
import { hojeMaceioISO } from "@/lib/formatar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Falha = { ok: false; erro: string };
const falha = (erro: string): Falha => ({ ok: false, erro });
const ERRO = "Não foi possível salvar agora. Tente de novo.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Só o dono. A RLS das tabelas também barra; aqui a resposta é clara e nada é gravado. */
async function exigirDono() {
  const usuario = await obterUsuarioAtual();
  if (!ehDono(usuario.perfil)) return null;
  return { usuario, supabase: await criarClienteServidor() };
}

const NEGADO = "Só o dono acessa as comissões.";

export async function salvarAjustes(entrada: {
  arquitetoPadrao: string;
  vendedoraPadrao: string;
  vendedoraComArquiteto: string;
}): Promise<Falha | { ok: true }> {
  const c = await exigirDono();
  if (!c) return falha(NEGADO);
  const a = lerPercentual(entrada.arquitetoPadrao);
  const v = lerPercentual(entrada.vendedoraPadrao);
  const va = lerPercentual(entrada.vendedoraComArquiteto);
  if (a === undefined || v === undefined || va === undefined)
    return falha("Use percentuais de 0 a 30, com até 2 casas (ex.: 5 ou 7,5).");
  const { data, error } = await c.supabase
    .from("configuracoes_comissao")
    .update({
      percentual_arquiteto_padrao: a,
      percentual_vendedora_padrao: v,
      percentual_vendedora_com_arquiteto: va,
    })
    .eq("id", true)
    .select("id");
  if (error || !data?.length) return falha(ERRO);
  revalidatePath("/comissoes");
  return { ok: true };
}

/** Percentual próprio de um arquiteto ou de uma vendedora; vazio remove (volta ao padrão). */
export async function salvarPercentualProprio(
  tipo: "arquiteto" | "vendedora",
  beneficiarioId: string,
  texto: string,
): Promise<Falha | { ok: true }> {
  const c = await exigirDono();
  if (!c) return falha(NEGADO);
  if (!UUID.test(beneficiarioId)) return falha("Beneficiário inválido.");
  const pct = lerPercentual(texto);
  if (pct === undefined) return falha("Use um percentual de 0 a 30, com até 2 casas.");
  const tabela =
    tipo === "arquiteto" ? "comissoes_arquiteto_percentual" : "comissoes_vendedora_percentual";
  const coluna = tipo === "arquiteto" ? "arquiteto_id" : "vendedora_id";
  const r =
    pct === null
      ? await c.supabase.from(tabela).delete().eq(coluna, beneficiarioId)
      : await c.supabase
          .from(tabela)
          .upsert(
            { [coluna]: beneficiarioId, percentual: pct, vigente_desde: hojeMaceioISO() },
            { onConflict: coluna },
          );
  if (r.error) return falha(ERRO);
  revalidatePath("/comissoes/ajustes");
  return { ok: true };
}

export async function marcarPagas(
  ids: string[],
  data: string,
): Promise<Falha | { ok: true; pagas: number }> {
  const c = await exigirDono();
  if (!c) return falha(NEGADO);
  if (ids.length === 0 || ids.length > 200 || !ids.every((i) => UUID.test(i)))
    return falha("Escolha as comissões a pagar.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > hojeMaceioISO())
    return falha("Informe a data do pagamento (não pode ser no futuro).");
  const { data: r, error } = await c.supabase
    .from("comissoes")
    .update({ status: "paga", paga_em: data })
    .in("id", ids)
    .eq("status", "a_pagar")
    .select("id");
  if (error) return falha(ERRO);
  revalidatePath("/comissoes");
  return { ok: true, pagas: r?.length ?? 0 };
}

export async function desfazerPagamento(id: string): Promise<Falha | { ok: true }> {
  const c = await exigirDono();
  if (!c) return falha(NEGADO);
  if (!UUID.test(id)) return falha("Comissão inválida.");
  const { data, error } = await c.supabase
    .from("comissoes")
    .update({ status: "a_pagar", paga_em: null })
    .eq("id", id)
    .eq("status", "paga")
    .select("id");
  if (error || !data?.length) return falha(ERRO);
  revalidatePath("/comissoes");
  return { ok: true };
}

export async function salvarObservacao(id: string, texto: string): Promise<Falha | { ok: true }> {
  const c = await exigirDono();
  if (!c) return falha(NEGADO);
  const t = texto.trim();
  if (!UUID.test(id) || t.length > 500) return falha("Observação inválida (até 500 caracteres).");
  const { error } = await c.supabase
    .from("comissoes")
    .update({ observacao: t || null, revisar: false })
    .eq("id", id);
  if (error) return falha(ERRO);
  revalidatePath("/comissoes");
  return { ok: true };
}

export async function recalcular(id: string): Promise<Falha | { ok: true }> {
  const c = await exigirDono();
  if (!c) return falha(NEGADO);
  if (!UUID.test(id)) return falha("Comissão inválida.");
  const { error } = await c.supabase.rpc("recalcular_comissao", { p_id: id });
  if (error) {
    if (error.message.includes("SEM_PERCENTUAL"))
      return falha("Defina o percentual em Ajustes de comissão.");
    if (error.message.includes("SO_A_PAGAR"))
      return falha("Só dá para recalcular o que ainda está a pagar.");
    return falha(ERRO);
  }
  revalidatePath("/comissoes");
  return { ok: true };
}

export async function calcularAnteriores(gravar: boolean): Promise<
  | Falha
  | {
      ok: true;
      gravado: boolean;
      linhas: number;
      itens: {
        orcamento: string;
        tipo: string;
        percentual: number;
        valor: number;
        competencia: string;
      }[];
    }
> {
  const c = await exigirDono();
  if (!c) return falha(NEGADO);
  const { data, error } = await c.supabase.rpc("calcular_fechamentos_anteriores", {
    p_gravar: gravar,
  });
  if (error || !data) return falha(ERRO);
  const r = data as { gravado: boolean; linhas: number; itens: never[] };
  if (gravar) revalidatePath("/comissoes");
  return { ok: true, gravado: r.gravado, linhas: Number(r.linhas), itens: r.itens };
}
