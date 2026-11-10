"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buscarProdutos, type ProdutoBusca } from "@/lib/estoque/buscar";
import {
  carregarItensRevisao,
  SELECT_ITENS,
  descricaoIdeal,
  paraItemRevisao,
  type LinhaItem,
} from "@/lib/orcamento/carregar-itens";
import {
  nomeAmbienteValido,
  normalizarQuantidade,
  type ItemRevisao,
  type OrigemItem,
} from "@/lib/orcamento/itens";
import { interpretarLista } from "@/lib/orcamento/lista-colada";
import { subtotalCentavos } from "@/lib/orcamento/totais";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Falha = { ok: false; erro: string };
const falha = (erro: string): Falha => ({ ok: false, erro });
const ERRO_GENERICO = "Não foi possível salvar agora. Tente de novo.";
const MAX_DESCRICAO = 300;

/** O que a tela precisa depois de cada alteração (o total vem recalculado do banco). */
export interface EstadoRevisao {
  itens: ItemRevisao[];
  valorTotal: number;
  ambientesExtras: string[];
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
  origem: OrigemItem;
  descricao_manual: boolean;
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
    return falha("Este orçamento já foi enviado e não pode mais ser alterado.");
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
  return {
    ok: true,
    estado: {
      itens,
      valorTotal: Number(total ?? 0),
      ambientesExtras: c.montagem?.ambientes_extras ?? [],
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
  /** Descrição que o item recebe: a padronizada (se ainda vale) ou a do catálogo. */
  descricao: string;
  unidade: "un" | "m";
  preco_unitario: number;
  ativo: boolean;
  categoria: string | null;
  marca: string | null;
}

const SELECT_PRODUTO =
  "codigo, descricao, unidade, preco_unitario, ativo, categoria, marca, produtos_descricao_formatada(descricao_formatada, descricao_origem)";

function paraProduto(linha: Record<string, unknown>): ProdutoCatalogo {
  const l = linha as unknown as Parameters<typeof descricaoIdeal>[0] & {
    codigo: string;
    unidade: "un" | "m";
    preco_unitario: number | string;
    ativo: boolean;
    categoria: string | null;
    marca: string | null;
  };
  return {
    codigo: l.codigo,
    descricao: descricaoIdeal(l),
    unidade: l.unidade,
    preco_unitario: Number(l.preco_unitario),
    ativo: l.ativo,
    categoria: l.categoria,
    marca: l.marca,
  };
}

async function lerProduto(c: Contexto, codigo: string): Promise<ProdutoCatalogo | null> {
  const { data } = await c.supabase
    .from("produtos")
    .select(SELECT_PRODUTO)
    .eq("codigo", codigo)
    .maybeSingle();
  return data ? paraProduto(data) : null;
}

async function lerProdutos(
  supabase: SupabaseClient,
  codigos: string[],
): Promise<Map<string, ProdutoCatalogo>> {
  const mapa = new Map<string, ProdutoCatalogo>();
  if (codigos.length === 0) return mapa;
  const { data } = await supabase.from("produtos").select(SELECT_PRODUTO).in("codigo", codigos);
  for (const l of data ?? []) {
    const p = paraProduto(l);
    mapa.set(p.codigo, p);
  }
  return mapa;
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

/** Busca no catálogo com a sessão da vendedora (RLS). Só produtos ativos. Código exato vem primeiro. */
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
    if (d.length < 2 || d.length > MAX_DESCRICAO)
      return falha("Descreva o item (2 a 300 caracteres).");
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

/**
 * Descrição de um item com código, escrita pela vendedora (texto curto) antes de gerar. Texto vazio
 * volta para a descrição padronizada do catálogo. O preço continua sendo o do catálogo.
 */
export async function editarDescricao(
  orcamentoId: string,
  itemId: string,
  texto: string,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const item = await lerItem(c, itemId);
  if (!item) return falha("Item não encontrado.");
  const d = texto.replace(/\s+/g, " ").trim();
  if (item.avulso) return alterarAvulso(orcamentoId, itemId, { descricao: d });

  if (d.length > MAX_DESCRICAO) return falha("Use até 300 caracteres na descrição.");
  const mudanca =
    d.length === 0
      ? { descricao_congelada: item.descricaoCatalogo ?? item.descricao, descricao_manual: false }
      : d.length < 2
        ? null
        : { descricao_congelada: d, descricao_manual: true };
  if (!mudanca) return falha("Descreva o item (2 a 300 caracteres).");
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
      descricao_manual: false,
      preco_unitario_congelado: produto.preco_unitario,
      avulso: false,
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
      origem: item.origem ?? "manual",
      descricao_manual: item.descricaoManual ?? false,
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
    if (!salvo.descricao_manual) descricao = produto.descricao;
    preco = produto.preco_unitario;
  }
  const origens: OrigemItem[] = ["manual", "lista_colada", "indicacao_ia", "montagem_ia"];
  const { error } = await c.supabase.from("orcamento_itens").insert({
    orcamento_id: orcamentoId,
    codigo: salvo.avulso ? null : salvo.codigo,
    descricao_congelada: descricao,
    preco_unitario_congelado: preco,
    quantidade: salvo.quantidade,
    ambiente: salvo.ambiente,
    avulso: salvo.avulso,
    origem: origens.includes(salvo.origem) ? salvo.origem : "manual",
    descricao_manual: Boolean(salvo.descricao_manual),
    ordem: salvo.ordem,
  });
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

/** Linha de produto a adicionar (o preço NUNCA vem do navegador). */
export interface LinhaAdicionar {
  codigo: string;
  quantidade: number;
}

/**
 * Adiciona produtos do catálogo a um ambiente: preço e descrição do catálogo, quantidade
 * validada. Se o produto já está no ambiente, soma na quantidade. Devolve avisos do que não coube.
 */
async function inserirProdutos(
  c: Contexto,
  ambiente: string,
  linhas: LinhaAdicionar[],
  origem: OrigemItem,
): Promise<{ ok: true; avisos: string[]; adicionados: number } | Falha> {
  const nome = nomeAmbienteValido(ambiente);
  if (!nome) return falha("Informe o ambiente.");
  if (linhas.length === 0) return falha("Nada para adicionar.");
  if (linhas.length > 200) return falha("Itens demais de uma vez (no máximo 200).");

  const codigos = [...new Set(linhas.map((l) => l.codigo))];
  if (!codigos.every((x) => codigoSchema.safeParse(x).success)) return falha("Código inválido.");
  const catalogo = await lerProdutos(c.supabase, codigos);
  const itens = await carregarItensRevisao(c.supabase, c.orcamentoId);
  let ordem = await proximaOrdem(c);
  const avisos: string[] = [];
  let adicionados = 0;

  for (const l of linhas) {
    const produto = catalogo.get(l.codigo);
    if (!produto || !produto.ativo) {
      avisos.push(`O produto ${l.codigo} não está disponível no catálogo.`);
      continue;
    }
    const q = normalizarQuantidade(produto.unidade, Number(l.quantidade));
    if (!q.ok) {
      avisos.push(`Produto ${l.codigo}: ${q.erro}`);
      continue;
    }
    const igual = itens.find(
      (i) => i.codigo === produto.codigo && i.ambiente.toLowerCase() === nome.toLowerCase(),
    );
    if (igual) {
      const soma = normalizarQuantidade(produto.unidade, igual.quantidade + q.valor);
      if (!soma.ok) {
        avisos.push(`Produto ${l.codigo}: ${soma.erro}`);
        continue;
      }
      const { error } = await c.supabase
        .from("orcamento_itens")
        .update({ quantidade: soma.valor })
        .eq("id", igual.id);
      if (error) return falha(ERRO_GENERICO);
      igual.quantidade = soma.valor;
    } else {
      const { data, error } = await c.supabase
        .from("orcamento_itens")
        .insert({
          orcamento_id: c.orcamentoId,
          codigo: produto.codigo,
          descricao_congelada: produto.descricao,
          preco_unitario_congelado: produto.preco_unitario,
          quantidade: q.valor,
          ambiente: nome,
          avulso: false,
          origem,
          ordem: ordem++,
        })
        .select("id")
        .single();
      if (error || !data) return falha(ERRO_GENERICO);
      itens.push({
        id: data.id,
        codigo: produto.codigo,
        descricao: produto.descricao,
        preco: produto.preco_unitario,
        quantidade: q.valor,
        ambiente: nome,
        avulso: false,
        justificativa: null,
        ordem: ordem - 1,
        marca: produto.marca,
        unidade: produto.unidade,
        produtoAtivo: true,
        precoCatalogo: produto.preco_unitario,
      });
    }
    adicionados++;
  }
  return { ok: true, avisos, adicionados };
}

export type RespostaAdicao =
  Falha | { ok: true; estado: EstadoRevisao; avisos: string[]; adicionados: number };

/** Adiciona UM produto do catálogo ao ambiente (busca). Soma se já está lá. */
export async function adicionarProduto(
  orcamentoId: string,
  ambiente: string,
  codigo: string,
  quantidade = 1,
): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const r = await inserirProdutos(c, ambiente, [{ codigo, quantidade }], "manual");
  if (!r.ok) return r;
  if (r.adicionados === 0) return falha(r.avisos[0] ?? "Esse produto não está disponível.");
  return estadoAtual(c);
}

/** Adiciona sugestões da Indicação da IA que a vendedora escolheu (origem = indicacao_ia). */
export async function adicionarSugestoes(
  orcamentoId: string,
  ambiente: string,
  linhas: LinhaAdicionar[],
): Promise<RespostaAdicao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const r = await inserirProdutos(c, ambiente, linhas, "indicacao_ia");
  if (!r.ok) return r;
  const e = await estadoAtual(c);
  if (!e.ok) return e;
  return { ok: true, estado: e.estado, avisos: r.avisos, adicionados: r.adicionados };
}

// ---------------------------------------------------------------- lista colada

export interface LinhaPrevia {
  linha: number;
  texto: string;
  codigo: string;
  /** Quantidade que vai entrar (já ajustada à unidade do produto). */
  quantidade: number;
  descricao: string;
  unidade: "un" | "m";
  precoUnitario: number;
  subtotalCentavos: number;
  aviso: string | null;
}

export interface PreviaLista {
  reconhecidas: LinhaPrevia[];
  /** Códigos que não existem no catálogo (ou estão inativos). */
  naoEncontradas: { linha: number; texto: string; codigo: string; motivo: string }[];
  naoEntendidas: { linha: number; texto: string; motivo: string }[];
  excedeu: boolean;
}

export type RespostaPrevia = Falha | { ok: true; previa: PreviaLista };

/** Confere a lista colada com o catálogo, sem gravar nada (determinístico, sem IA). */
export async function previaListaColada(texto: string): Promise<RespostaPrevia> {
  await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  if (texto.length > 20_000) return falha("Lista grande demais.");
  const { linhas, excedeu } = interpretarLista(texto);
  if (linhas.length === 0) return falha("Cole ao menos uma linha com o código do produto.");

  const codigos = [...new Set(linhas.flatMap((l) => (l.tipo === "reconhecida" ? [l.codigo] : [])))];
  const catalogo = await lerProdutos(supabase, codigos);

  const previa: PreviaLista = {
    reconhecidas: [],
    naoEncontradas: [],
    naoEntendidas: [],
    excedeu,
  };
  for (const l of linhas) {
    if (l.tipo === "nao_entendida") {
      previa.naoEntendidas.push({ linha: l.linha, texto: l.texto, motivo: l.motivo });
      continue;
    }
    const p = catalogo.get(l.codigo);
    if (!p || !p.ativo) {
      previa.naoEncontradas.push({
        linha: l.linha,
        texto: l.texto,
        codigo: l.codigo,
        motivo: p ? "Produto inativo." : "Código não encontrado no catálogo.",
      });
      continue;
    }
    const q = normalizarQuantidade(p.unidade, l.quantidade);
    if (!q.ok) {
      previa.naoEntendidas.push({ linha: l.linha, texto: l.texto, motivo: q.erro });
      continue;
    }
    let aviso: string | null = null;
    if (q.ajustada && p.unidade === "un") aviso = `Quantidade arredondada para ${q.valor}.`;
    else if (l.unidade && l.unidade !== p.unidade)
      aviso = `Este produto é vendido por ${p.unidade === "m" ? "metro" : "unidade"}.`;
    previa.reconhecidas.push({
      linha: l.linha,
      texto: l.texto,
      codigo: p.codigo,
      quantidade: q.valor,
      descricao: p.descricao,
      unidade: p.unidade,
      precoUnitario: p.preco_unitario,
      subtotalCentavos: subtotalCentavos(p.preco_unitario, q.valor),
      aviso,
    });
  }
  return { ok: true, previa };
}

/**
 * Confirma a lista colada: o servidor lê o texto de novo (não confia no que o navegador conferiu) e
 * adiciona as linhas reconhecidas com preço e descrição do catálogo, origem = lista_colada.
 */
export async function adicionarListaColada(
  orcamentoId: string,
  ambiente: string,
  texto: string,
): Promise<RespostaAdicao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  if (texto.length > 20_000) return falha("Lista grande demais.");
  const { linhas } = interpretarLista(texto);
  const validas = linhas.flatMap((l) =>
    l.tipo === "reconhecida" ? [{ codigo: l.codigo, quantidade: l.quantidade }] : [],
  );
  const r = await inserirProdutos(c, ambiente, validas, "lista_colada");
  if (!r.ok) return r;
  const e = await estadoAtual(c);
  if (!e.ok) return e;
  return { ok: true, estado: e.estado, avisos: r.avisos, adicionados: r.adicionados };
}

// ---------------------------------------------------------------- avulso, ambientes e preços

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
  if (d.length < 2 || d.length > MAX_DESCRICAO)
    return falha("Descreva o item (2 a 300 caracteres).");
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
    descricao_manual: true,
    ordem: await proximaOrdem(c),
  });
  if (error) return falha(ERRO_GENERICO);
  return estadoAtual(c);
}

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

/** Traz para os itens com código o preço atual do catálogo (e a descrição, se não foi escrita à mão). */
export async function atualizarPrecos(orcamentoId: string): Promise<RespostaRevisao> {
  const c = await abrirContexto(orcamentoId);
  if (eFalha(c)) return c;
  const itens = await carregarItensRevisao(c.supabase, orcamentoId);
  for (const i of itens) {
    if (i.avulso || i.precoCatalogo === null) continue;
    const novaDescricao = i.descricaoManual ? i.descricao : (i.descricaoCatalogo ?? i.descricao);
    if (
      Math.round(i.precoCatalogo * 100) === Math.round(i.preco * 100) &&
      novaDescricao === i.descricao
    )
      continue;
    const { error } = await c.supabase
      .from("orcamento_itens")
      .update({ preco_unitario_congelado: i.precoCatalogo, descricao_congelada: novaDescricao })
      .eq("id", i.id);
    if (error) return falha(ERRO_GENERICO);
  }
  return estadoAtual(c);
}
