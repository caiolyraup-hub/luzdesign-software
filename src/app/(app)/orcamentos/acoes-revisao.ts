"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buscarProdutos, type ProdutoBusca } from "@/lib/estoque/buscar";
import {
  carregarItensRevisao,
  SELECT_ITENS,
  paraItemRevisao,
  type LinhaItem,
} from "@/lib/orcamento/carregar-itens";
import { nomeAmbienteValido, normalizarQuantidade, type ItemRevisao } from "@/lib/orcamento/itens";
import { MAX_ANALISE, MAX_MOTIVO } from "@/lib/ia/esquema";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Falha = { ok: false; erro: string };
const falha = (erro: string): Falha => ({ ok: false, erro });
const ERRO_GENERICO = "Não foi possível salvar agora. Tente de novo.";

/** O que a tela precisa depois de cada alteração (o total vem recalculado do banco). */
export interface EstadoRevisao {
  itens: ItemRevisao[];
  valorTotal: number;
  ambientesExtras: string[];
  /** Análise de cada ambiente (texto para o cliente). */
  analises: AnaliseRevisao[];
  mostrarAnalise: boolean;
}

export interface AnaliseRevisao {
  nome: string;
  analise: string;
  anexosUsados: string[];
}

export type RespostaRevisao = Falha | { ok: true; estado: EstadoRevisao };
export type RespostaRemocao = Falha | { ok: true; estado: EstadoRevisao; desfazer: ItemSalvo };

/** Dados para recriar um item removido ("Desfazer"). */
export interface ItemSalvo {
  codigo: string | null;
  descricao_congelada: string;
  preco_unitario_congelado: number;
  quantidade: number;
  ambiente: string;
  avulso: boolean;
  justificativa: string | null;
  motivo_cliente?: string | null;
  ordem: number;
}

interface Contexto {
  supabase: SupabaseClient;
  orcamentoId: string;
  montagem: { ambientes_extras?: string[] } | null;
}

/** Só a dona edita, e só em rascunho ou gerado (a partir de enviado a edição é bloqueada). */
async function abrirContexto(orcamentoId: string): Promise<Contexto | Falha> {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("orcamentos")
    .select("id, vendedora_id, status, montagem")
    .eq("id", orcamentoId)
    .maybeSingle();
  if (!data || data.vendedora_id !== usuario.id) return falha("Orçamento não encontrado.");
  if (data.status !== "rascunho" && data.status !== "gerado") {
    return falha("Este orçamento não pode mais ser alterado.");
  }
  return { supabase, orcamentoId, montagem: data.montagem as Contexto["montagem"] };
}

const eFalha = (c: Contexto | Falha): c is Falha => "ok" in c;

/** Recalcula o total no banco e devolve o estado atual da tela. */
async function estadoAtual(c: Contexto): Promise<RespostaRevisao> {
  const { data: total, error } = await c.supabase.rpc("recalcular_total_orcamento", {
    p_orcamento: c.orcamentoId,
  });
  if (error) return falha(ERRO_GENERICO);
  const itens = await carregarItensRevisao(c.supabase, c.orcamentoId);
  const [{ data: ambientes }, { data: flag }] = await Promise.all([
    c.supabase
      .from("orcamento_ambientes")
      .select("nome, analise, anexos_usados")
      .eq("orcamento_id", c.orcamentoId)
      .order("ordem"),
    c.supabase.from("orcamentos").select("mostrar_analise_pdf").eq("id", c.orcamentoId).single(),
  ]);
  return {
    ok: true,
    estado: {
      itens,
      valorTotal: Number(total ?? 0),
      ambientesExtras: c.montagem?.ambientes_extras ?? [],
      analises: (ambientes ?? []).map((a) => ({
        nome: a.nome,
        analise: a.analise ?? "",
        anexosUsados: a.anexos_usados ?? [],
      })),
      mostrarAnalise: flag?.mostrar_analise_pdf ?? true,
    },
  };
}

async function lerItem(c: Contexto, itemId: string): Promise<ItemRevisao | null> {
  const { data } = await c.supabase
    .from("orcamento_itens")
    .select(SELECT_ITENS)
    .eq("id", itemId)
    .eq("orcamento_id", c.orcamentoId)
    .maybeSingle();
  return data ? paraItemRevisao(data as unknown as LinhaItem) : null;
}

interface ProdutoCatalogo {
  codigo: string;
  descricao: string;
  unidade: "un" | "m";
  preco_unitario: number;
  ativo: boolean;
}

async function lerProduto(c: Contexto, codigo: string): Promise<ProdutoCatalogo | null> {
  const { data } = await c.supabase
    .from("produtos")
    .select("codigo, descricao, unidade, preco_unitario, ativo")
    .eq("codigo", codigo)
    .maybeSingle();
  return data
    ? { ...(data as ProdutoCatalogo), preco_unitario: Number(data.preco_unitario) }
    : null;
}

async function proximaOrdem(c: Contexto): Promise<number> {
  const { data } = await c.supabase
    .from("orcamento_itens")
    .select("ordem")
    .eq("orcamento_id", c.orcamentoId)
    .order("ordem", { ascending: false })
    .limit(1);
  return (data?.[0]?.ordem ?? -1) + 1;
}

const codigoSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}$/, "Código inválido.");
const precoSchema = z
  .number()
  .finite()
  .min(0, "O preço não pode ser negativo.")
  .max(10_000_000, "Preço grande demais.");

// ---------------------------------------------------------------- busca

export type RespostaBusca = Falha | { ok: true; produtos: ProdutoBusca[] };

/** Busca no catálogo com a sessão da vendedora (RLS). Só produtos ativos. */
export async function buscarProdutosRevisao(texto: string): Promise<RespostaBusca> {
  await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  try {
    return {
      ok: true,
      produtos: await buscarProdutos(supabase, { texto: texto.slice(0, 120), limite: 20 }),
    };
  } catch {
    return falha("Não foi possível buscar agora.");
  }
}

// ---------------------------------------------------------------- itens

export async function alterarQuantidade(
  orcamentoId: string,
  itemId: string,
  quantidade: number,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const item = await lerItem(c, itemId);
  if (!item) return falha("Item não encontrado.");
  const q = normalizarQuantidade(item.unidade, quantidade, item.avulso);
  if (!q.ok) return falha(q.erro);

  const { error } = await c.supabase
    .from("orcamento_itens")
    .update({ quantidade: q.valor })
    .eq("id", itemId);
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

/** Só item avulso tem descrição e preço editáveis. Item com código leva sempre o preço do catálogo. */
export async function alterarAvulso(
  orcamentoId: string,
  itemId: string,
  campos: { descricao?: string; preco?: number },
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const item = await lerItem(c, itemId);
  if (!item) return falha("Item não encontrado.");
  if (!item.avulso) return falha("O preço de um produto do catálogo não pode ser editado.");

  const mudanca: Record<string, unknown> = {};
  if (campos.descricao !== undefined) {
    const d = campos.descricao.trim();
    if (d.length < 2 || d.length > 300) return falha("Descreva o item (2 a 300 caracteres).");
    mudanca.descricao_congelada = d;
  }
  if (campos.preco !== undefined) {
    const p = precoSchema.safeParse(campos.preco);
    if (!p.success) return falha(p.error.issues[0].message);
    mudanca.preco_unitario_congelado = Math.round(p.data * 100) / 100;
  }
  if (Object.keys(mudanca).length === 0) return estadoAtual(c);

  const { error } = await c.supabase.from("orcamento_itens").update(mudanca).eq("id", itemId);
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

/** Troca o produto mantendo quantidade e ambiente. Preço e descrição vêm do catálogo. */
export async function trocarProduto(
  orcamentoId: string,
  itemId: string,
  codigo: string,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const cod = codigoSchema.safeParse(codigo);
  if (!cod.success) return falha(cod.error.issues[0].message);
  const item = await lerItem(c, itemId);
  if (!item) return falha("Item não encontrado.");
  const produto = await lerProduto(c, cod.data);
  if (!produto || !produto.ativo) return falha("Esse produto não está disponível no catálogo.");

  const q = normalizarQuantidade(produto.unidade, item.quantidade);
  const { error } = await c.supabase
    .from("orcamento_itens")
    .update({
      codigo: produto.codigo,
      descricao_congelada: produto.descricao,
      preco_unitario_congelado: produto.preco_unitario,
      avulso: false,
      // O motivo escrito para o produto antigo não vale para o novo.
      motivo_cliente: null,
      quantidade: q.ok ? q.valor : 1,
    })
    .eq("id", itemId);
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

export async function mudarAmbiente(
  orcamentoId: string,
  itemId: string,
  ambiente: string,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const nome = nomeAmbienteValido(ambiente);
  if (!nome) return falha("Informe o nome do ambiente (até 60 caracteres).");
  const { error } = await c.supabase
    .from("orcamento_itens")
    .update({ ambiente: nome, ordem: await proximaOrdem(c) })
    .eq("id", itemId)
    .eq("orcamento_id", orcamentoId);
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

export async function removerItem(orcamentoId: string, itemId: string): Promise<RespostaRemocao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const item = await lerItem(c, itemId);
  if (!item) return falha("Item não encontrado.");

  const { error } = await c.supabase
    .from("orcamento_itens")
    .delete()
    .eq("id", itemId)
    .eq("orcamento_id", orcamentoId);
  if (error) return falha(ERRO_GENERICO);
  const r = await estadoAtual(c);
  if (!r.ok) return r;
  return {
    ok: true,
    estado: r.estado,
    desfazer: {
      codigo: item.codigo,
      descricao_congelada: item.descricao,
      preco_unitario_congelado: item.preco,
      quantidade: item.quantidade,
      ambiente: item.ambiente,
      avulso: item.avulso,
      justificativa: item.justificativa,
      motivo_cliente: item.motivo ?? null,
      ordem: item.ordem,
    },
  };
}

/** Desfazer remoção: recria o item. Item com código volta com o preço atual do catálogo. */
export async function restaurarItem(
  orcamentoId: string,
  salvo: ItemSalvo,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;

  let { descricao_congelada: descricao, preco_unitario_congelado: preco } = salvo;
  if (!salvo.avulso && salvo.codigo) {
    const produto = await lerProduto(c, salvo.codigo);
    if (!produto || !produto.ativo)
      return falha("Esse produto não está mais disponível no catálogo.");
    descricao = produto.descricao;
    preco = produto.preco_unitario;
  }
  const { error } = await c.supabase.from("orcamento_itens").insert({
    orcamento_id: orcamentoId,
    codigo: salvo.avulso ? null : salvo.codigo,
    descricao_congelada: descricao,
    preco_unitario_congelado: preco,
    quantidade: salvo.quantidade,
    ambiente: salvo.ambiente,
    avulso: salvo.avulso,
    justificativa: salvo.justificativa,
    motivo_cliente: salvo.motivo_cliente ?? null,
    ordem: salvo.ordem,
  });
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

/** Adiciona um produto do catálogo ao ambiente. Se já está lá, soma na quantidade. */
export async function adicionarProduto(
  orcamentoId: string,
  ambiente: string,
  codigo: string,
  quantidade = 1,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const nome = nomeAmbienteValido(ambiente);
  if (!nome) return falha("Informe o ambiente.");
  const cod = codigoSchema.safeParse(codigo);
  if (!cod.success) return falha(cod.error.issues[0].message);
  const produto = await lerProduto(c, cod.data);
  if (!produto || !produto.ativo) return falha("Esse produto não está disponível no catálogo.");
  const q = normalizarQuantidade(produto.unidade, quantidade);
  if (!q.ok) return falha(q.erro);

  const itens = await carregarItensRevisao(c.supabase, orcamentoId);
  const igual = itens.find(
    (i) => i.codigo === produto.codigo && i.ambiente.toLowerCase() === nome.toLowerCase(),
  );
  if (igual) {
    const soma = normalizarQuantidade(produto.unidade, igual.quantidade + q.valor);
    if (!soma.ok) return falha(soma.erro);
    const { error } = await c.supabase
      .from("orcamento_itens")
      .update({ quantidade: soma.valor })
      .eq("id", igual.id);
    if (error) return falha(ERRO_GENERICO);
  } else {
    const { error } = await c.supabase.from("orcamento_itens").insert({
      orcamento_id: orcamentoId,
      codigo: produto.codigo,
      descricao_congelada: produto.descricao,
      preco_unitario_congelado: produto.preco_unitario,
      quantidade: q.valor,
      ambiente: nome,
      avulso: false,
      ordem: await proximaOrdem(c),
    });
    if (error) return falha(ERRO_GENERICO);
  }
  return estadoAtual(c);
}

/** Item avulso: descrição, quantidade e preço manual (0 = "preço a definir"). */
export async function adicionarAvulso(
  orcamentoId: string,
  ambiente: string,
  descricao: string,
  quantidade: number,
  preco: number,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const nome = nomeAmbienteValido(ambiente);
  if (!nome) return falha("Informe o ambiente.");
  const d = descricao.trim();
  if (d.length < 2 || d.length > 300) return falha("Descreva o item (2 a 300 caracteres).");
  const q = normalizarQuantidade("un", quantidade, true);
  if (!q.ok) return falha(q.erro);
  const p = precoSchema.safeParse(preco);
  if (!p.success) return falha(p.error.issues[0].message);

  const { error } = await c.supabase.from("orcamento_itens").insert({
    orcamento_id: orcamentoId,
    codigo: null,
    descricao_congelada: d,
    preco_unitario_congelado: Math.round(p.data * 100) / 100,
    quantidade: q.valor,
    ambiente: nome,
    avulso: true,
    ordem: await proximaOrdem(c),
  });
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

// ---------------------------------------------------------------- ambientes e preços

export async function adicionarAmbiente(
  orcamentoId: string,
  nomeBruto: string,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const nome = nomeAmbienteValido(nomeBruto);
  if (!nome) return falha("Informe o nome do ambiente (até 60 caracteres).");

  const extras = c.montagem?.ambientes_extras ?? [];
  if (!extras.some((e) => e.toLowerCase() === nome.toLowerCase())) {
    const montagem = { ...(c.montagem ?? {}), ambientes_extras: [...extras, nome] };
    const { error } = await c.supabase
      .from("orcamentos")
      .update({ montagem })
      .eq("id", orcamentoId);
    if (error) return falha(ERRO_GENERICO);
    c.montagem = montagem;
  }
  return estadoAtual(c);
}

/** Traz para os itens com código o preço e a descrição atuais do catálogo. */
export async function atualizarPrecos(orcamentoId: string): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const itens = await carregarItensRevisao(c.supabase, orcamentoId);
  for (const i of itens) {
    if (i.avulso || i.precoCatalogo === null) continue;
    if (
      Math.round(i.precoCatalogo * 100) === Math.round(i.preco * 100) &&
      i.descricaoCatalogo === i.descricao
    )
      continue;
    const { error } = await c.supabase
      .from("orcamento_itens")
      .update({
        preco_unitario_congelado: i.precoCatalogo,
        descricao_congelada: i.descricaoCatalogo ?? i.descricao,
      })
      .eq("id", i.id);
    if (error) return falha(ERRO_GENERICO);
  }
  return estadoAtual(c);
}

// ---------------------------------------------------------------- textos para o cliente

/** Motivo curto de um produto, para o cliente (vai no PDF). Vazio apaga. */
export async function salvarMotivo(
  orcamentoId: string,
  itemId: string,
  texto: string,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const limpo = texto.replace(/s+/g, " ").trim();
  if (limpo.length > MAX_MOTIVO) return falha(`Use até ${MAX_MOTIVO} caracteres no motivo.`);
  const { error } = await c.supabase
    .from("orcamento_itens")
    .update({ motivo_cliente: limpo || null })
    .eq("id", itemId)
    .eq("orcamento_id", orcamentoId);
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

/** Análise de um ambiente (texto para o cliente). Vazio apaga o texto. */
export async function salvarAnalise(
  orcamentoId: string,
  ambiente: string,
  texto: string,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const nome = nomeAmbienteValido(ambiente);
  if (!nome) return falha("Informe o ambiente.");
  const limpo = texto.replace(/[ 	]+/g, " ").trim();
  if (limpo.length > MAX_ANALISE) return falha(`Use até ${MAX_ANALISE} caracteres na análise.`);

  const { data: existentes } = await c.supabase
    .from("orcamento_ambientes")
    .select("id, nome")
    .eq("orcamento_id", orcamentoId);
  const atual = (existentes ?? []).find((a) => a.nome.trim().toLowerCase() === nome.toLowerCase());
  const { error } = atual
    ? await c.supabase
        .from("orcamento_ambientes")
        .update({ analise: limpo || null })
        .eq("id", atual.id)
    : await c.supabase.from("orcamento_ambientes").insert({
        orcamento_id: orcamentoId,
        nome,
        ordem: (existentes ?? []).length,
        analise: limpo || null,
      });
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

/** Liga ou desliga análise e motivos no PDF. */
export async function alternarMostrarAnalise(
  orcamentoId: string,
  mostrar: boolean,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const { error } = await c.supabase
    .from("orcamentos")
    .update({ mostrar_analise_pdf: mostrar })
    .eq("id", orcamentoId);
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}
