"use server";

import { lerFiltrosClientes, listarClientes, type CartaoCliente } from "@/lib/clientes/listar";
import { VERSAO_RESPOSTAS } from "@/lib/orcamento/perguntas";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Falha = { ok: false; erro: string };
const falha = (erro: string): Falha => ({ ok: false, erro });
const ERRO_GENERICO = "Não foi possível salvar agora. Tente de novo.";
const MAX_OBSERVACOES = 1000;

/** "Ver mais" da lista de clientes (cursor). Os filtros são relidos e validados aqui; a RLS decide. */
export async function carregarMaisClientes(
  params: Record<string, string>,
  cursor: string,
): Promise<Falha | { ok: true; clientes: CartaoCliente[]; proximo: string | null }> {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const filtros = lerFiltrosClientes(params, { gerente: usuario.perfil === "gerente" });
  const pagina = await listarClientes(
    supabase,
    filtros,
    /^[^|]{0,200}\|[0-9a-f-]{36}$/i.test(cursor) ? cursor : null,
  );
  if (!pagina) return falha("Não foi possível carregar mais clientes.");
  return { ok: true, clientes: pagina.clientes, proximo: pagina.proximo };
}

/** Notas do cliente (texto curto), só pela dona (a RLS também garante). Nunca vão à OpenAI. */
export async function salvarObservacoes(
  clienteId: string,
  texto: string,
): Promise<Falha | { ok: true }> {
  const usuario = await obterUsuarioAtual();
  const limpo = texto.replace(/\r\n/g, "\n").trim();
  if (limpo.length > MAX_OBSERVACOES) return falha(`Use até ${MAX_OBSERVACOES} caracteres.`);
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("clientes")
    .update({ observacoes: limpo === "" ? null : limpo })
    .eq("id", clienteId)
    .eq("vendedora_id", usuario.id)
    .select("id");
  if (error) return falha(ERRO_GENERICO);
  if (!data?.length) return falha("Só a dona do cliente pode alterar as notas.");
  return { ok: true };
}

/**
 * "Novo orçamento para este cliente": cria o rascunho já com nome, WhatsApp, tipo e arquiteto do
 * cadastro (as perguntas 1 a 3 ficam respondidas e o formulário abre na primeira que faltar).
 */
export async function novoOrcamentoParaCliente(
  clienteId: string,
): Promise<Falha | { ok: true; id: string }> {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const { data: c } = await supabase
    .from("clientes")
    .select("id, vendedora_id, nome, whatsapp, tipo, arquiteto_indicador")
    .eq("id", clienteId)
    .maybeSingle();
  if (!c || c.vendedora_id !== usuario.id) return falha("Cliente não encontrado.");

  const arquiteto = (c.arquiteto_indicador as string | null)?.trim() || null;
  const respostas: Record<string, unknown> = {
    versao: VERSAO_RESPOSTAS,
    cliente_nome: c.nome,
    ...(c.whatsapp ? { cliente_whatsapp: c.whatsapp } : {}),
    tipo_cliente: c.tipo,
    ...(arquiteto
      ? {
          arquiteto_indicador: arquiteto,
          ...(c.tipo === "arquiteto" ? {} : { indicacao_arquiteto: true }),
        }
      : c.tipo === "arquiteto"
        ? {}
        : { indicacao_arquiteto: false }),
  };
  const { data: o, error } = await supabase
    .from("orcamentos")
    .insert({ vendedora_id: usuario.id, cliente_id: c.id, respostas })
    .select("id")
    .single();
  if (error || !o) return falha("Não foi possível criar o orçamento agora. Tente de novo.");
  return { ok: true, id: o.id as string };
}

/** Junta dois clientes da mesma vendedora (só a gerência; a função SQL confere de novo). */
export async function juntarClientes(
  manterId: string,
  removerId: string,
): Promise<Falha | { ok: true; movidos: number }> {
  const usuario = await obterUsuarioAtual();
  if (usuario.perfil !== "gerente") return falha("Só a gerência junta clientes.");
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("juntar_clientes", {
    p_manter: manterId,
    p_remover: removerId,
  });
  if (error) {
    if (error.message.includes("VENDEDORAS_DIFERENTES"))
      return falha("Só dá para juntar clientes da mesma vendedora.");
    if (error.message.includes("CLIENTE_NAO_ENCONTRADO"))
      return falha("Um dos clientes não existe mais. Recarregue a tela.");
    return falha("Não foi possível juntar agora. Tente de novo.");
  }
  return { ok: true, movidos: Number((data as { movidos?: number })?.movidos ?? 0) };
}
