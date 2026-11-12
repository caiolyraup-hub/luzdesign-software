"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  caminhoValido,
  ehTipoAnexo,
  extensaoDoMime,
  tiposPermitidos,
  validarArquivoAnexo,
} from "@/lib/orcamento/anexos";
import {
  CAMPOS_TEXTO_LIVRE,
  MAX_ANEXOS,
  VERSAO_RESPOSTAS,
  normalizarWhatsapp,
  perguntaDoPasso,
  schemaClienteNome,
  validarPergunta,
  type ErrosCampos,
  type Respostas,
  type TipoAnexo,
} from "@/lib/orcamento/perguntas";
import { resumoDoCliente, textoHistorico } from "@/lib/clientes/resumo";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Falha = { ok: false; erro: string; erros?: ErrosCampos };

const falha = (erro: string, erros?: ErrosCampos): Falha => ({ ok: false, erro, erros });

const ERRO_GENERICO = "Não foi possível salvar agora. Tente de novo.";

interface OrcamentoBasico {
  id: string;
  vendedora_id: string;
  cliente_id: string;
  status: string;
}

/** Carrega o orçamento sob RLS e confere que é rascunho da usuária logada. */
async function carregarRascunho(
  supabase: SupabaseClient,
  usuarioId: string,
  orcamentoId: string,
): Promise<OrcamentoBasico | null> {
  const { data } = await supabase
    .from("orcamentos")
    .select("id, vendedora_id, cliente_id, status")
    .eq("id", orcamentoId)
    .maybeSingle();
  if (!data || data.vendedora_id !== usuarioId || data.status !== "rascunho") return null;
  return data as OrcamentoBasico;
}

/** O cliente só é alterado se for usado apenas por este orçamento (clientes reaproveitados ficam intactos). */
async function clienteExclusivo(supabase: SupabaseClient, clienteId: string): Promise<boolean> {
  const { count } = await supabase
    .from("orcamentos")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", clienteId);
  return (count ?? 0) <= 1;
}

// ---------------------------------------------------------------- criar rascunho

/** Primeira resposta válida: cria o cliente (só com o nome) e o orçamento em rascunho. */
export async function criarRascunho(nome: string): Promise<{ ok: true; id: string } | Falha> {
  const usuario = await obterUsuarioAtual();
  const r = schemaClienteNome.safeParse({ cliente_nome: nome });
  if (!r.success)
    return falha(r.error.issues[0].message, { cliente_nome: r.error.issues[0].message });

  const supabase = await criarClienteServidor();
  const { data: cliente, error: erroCliente } = await supabase
    .from("clientes")
    .insert({ vendedora_id: usuario.id, nome: r.data.cliente_nome, tipo: "final" })
    .select("id")
    .single();
  if (erroCliente || !cliente) return falha(ERRO_GENERICO);

  const { data: orcamento, error: erroOrcamento } = await supabase
    .from("orcamentos")
    .insert({
      vendedora_id: usuario.id,
      cliente_id: cliente.id,
      respostas: { versao: VERSAO_RESPOSTAS, cliente_nome: r.data.cliente_nome },
    })
    .select("id")
    .single();
  if (erroOrcamento || !orcamento) {
    await supabase.from("clientes").delete().eq("id", cliente.id);
    return falha(ERRO_GENERICO);
  }
  return { ok: true, id: orcamento.id };
}

// ---------------------------------------------------------------- salvar respostas

export type RespostaSalvar =
  | Falha
  | {
      ok: true;
      respostas: Respostas;
      /** Passo 2: já existia um cliente com este WhatsApp e o orçamento passou a ser dele. */
      clienteVinculado?: { id: string; nome: string };
    };

/**
 * modo "avancar": valida a pergunta inteira e grava.
 * modo "rascunho": autosave de campos de texto livre (sem exigir a pergunta completa).
 */
export async function salvarResposta(
  orcamentoId: string,
  passo: number,
  entrada: Record<string, unknown>,
  modo: "avancar" | "rascunho",
): Promise<RespostaSalvar> {
  const usuario = await obterUsuarioAtual();
  const pergunta = perguntaDoPasso(passo);
  if (!pergunta) return falha("Pergunta inválida.");

  const supabase = await criarClienteServidor();
  const orcamento = await carregarRascunho(supabase, usuario.id, orcamentoId);
  if (!orcamento) return falha("Este orçamento não está mais disponível para edição.");

  const patch: Record<string, unknown> = {};
  if (modo === "avancar") {
    const v = validarPergunta(pergunta, entrada);
    if (!v.ok) return falha(Object.values(v.erros)[0] ?? "Confira a resposta.", v.erros);
    for (const campo of pergunta.campos) patch[campo] = v.valores[campo] ?? null;
  } else {
    for (const [campo, valor] of Object.entries(entrada)) {
      const max = CAMPOS_TEXTO_LIVRE[campo];
      if (!pergunta.campos.includes(campo) || max === undefined || typeof valor !== "string") {
        return falha("Campo não pode ser salvo automaticamente.");
      }
      patch[campo] = valor.trim().slice(0, max) || null;
    }
    if (Object.keys(patch).length === 0) return falha("Nada para salvar.");
  }

  const { data: respostas, error } = await supabase.rpc("mesclar_respostas", {
    p_orcamento: orcamentoId,
    p_patch: patch,
  });
  if (error || !respostas) return falha(ERRO_GENERICO);

  let clienteVinculado: { id: string; nome: string } | undefined;
  try {
    clienteVinculado = await sincronizarCliente(supabase, usuario.id, orcamento, patch);
  } catch {
    return falha("Respostas salvas, mas não foi possível atualizar o cadastro do cliente.");
  }

  const final = clienteVinculado
    ? ((
        await supabase.rpc("mesclar_respostas", {
          p_orcamento: orcamentoId,
          p_patch: { cliente_nome: clienteVinculado.nome },
        })
      ).data ?? respostas)
    : respostas;

  return { ok: true, respostas: final as Respostas, clienteVinculado };
}

/** Reflete nome, WhatsApp, tipo e arquiteto no cadastro do cliente (quando é só deste orçamento). */
async function sincronizarCliente(
  supabase: SupabaseClient,
  usuarioId: string,
  orcamento: OrcamentoBasico,
  patch: Record<string, unknown>,
): Promise<{ id: string; nome: string } | undefined> {
  const atual = orcamento.cliente_id;
  const whatsapp = typeof patch.cliente_whatsapp === "string" ? patch.cliente_whatsapp : null;

  // Mesmo WhatsApp = mesmo cliente: o orçamento passa a ser do cliente já cadastrado.
  if (whatsapp) {
    const { data: existente } = await supabase
      .from("clientes")
      .select("id, nome")
      .eq("vendedora_id", usuarioId)
      .eq("whatsapp", whatsapp)
      .maybeSingle();

    if (existente && existente.id !== atual) {
      const { error } = await supabase
        .from("orcamentos")
        .update({ cliente_id: existente.id })
        .eq("id", orcamento.id);
      if (error) throw error;
      // Cliente provisório (sem WhatsApp, sem outros orçamentos) não deve ficar para trás.
      const { count } = await supabase
        .from("orcamentos")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", atual);
      if ((count ?? 0) === 0) {
        await supabase.from("clientes").delete().eq("id", atual).is("whatsapp", null);
      }
      return { id: existente.id, nome: existente.nome };
    }
  }

  const campos: Record<string, unknown> = {};
  if (typeof patch.cliente_nome === "string") campos.nome = patch.cliente_nome;
  if (whatsapp) campos.whatsapp = whatsapp;
  if (typeof patch.tipo_cliente === "string") {
    campos.tipo = patch.tipo_cliente;
    campos.arquiteto_indicador = (patch.arquiteto_indicador as string | null | undefined) ?? null;
  }
  if (Object.keys(campos).length === 0) return undefined;

  if (await clienteExclusivo(supabase, atual)) {
    const { error } = await supabase.from("clientes").update(campos).eq("id", atual);
    if (error) throw error;
  } else if (whatsapp) {
    // Cliente compartilhado com outro orçamento e número diferente: cria um novo, sem mexer no antigo.
    const { data: nome } = await supabase
      .from("orcamentos")
      .select("respostas")
      .eq("id", orcamento.id)
      .single();
    const { data: novo, error } = await supabase
      .from("clientes")
      .insert({
        vendedora_id: usuarioId,
        nome: String((nome?.respostas as Respostas | null)?.cliente_nome ?? "Cliente"),
        whatsapp,
      })
      .select("id, nome")
      .single();
    if (error || !novo) throw error ?? new Error("cliente");
    await supabase.from("orcamentos").update({ cliente_id: novo.id }).eq("id", orcamento.id);
    return { id: novo.id, nome: novo.nome };
  }
  return undefined;
}

// ---------------------------------------------------------------- cliente pelo WhatsApp

export type RespostaCliente =
  | Falha
  | {
      ok: true;
      normalizado: string;
      /** Cliente já cadastrado, com o histórico dele ("3 orçamentos, 1 fechado, último em 04/11"). */
      encontrado: { id: string; nome: string; historico: string } | null;
    };

/** Procura cliente da própria vendedora com este WhatsApp (a RLS já limita às dela). */
export async function procurarCliente(
  orcamentoId: string,
  bruto: string,
): Promise<RespostaCliente> {
  const usuario = await obterUsuarioAtual();
  const normalizado = normalizarWhatsapp(bruto);
  if (!normalizado) return falha("WhatsApp inválido.");

  const supabase = await criarClienteServidor();
  const orcamento = await carregarRascunho(supabase, usuario.id, orcamentoId);
  if (!orcamento) return falha("Este orçamento não está mais disponível para edição.");

  const { data } = await supabase
    .from("clientes")
    .select("id, nome")
    .eq("vendedora_id", usuario.id)
    .eq("whatsapp", normalizado)
    .neq("id", orcamento.cliente_id)
    .maybeSingle();
  if (!data) return { ok: true, normalizado, encontrado: null };
  const { data: orcs } = await supabase
    .from("orcamentos")
    .select("status, valor_total, valor_fechado, criado_em")
    .eq("cliente_id", data.id);
  const r = resumoDoCliente(
    (orcs ?? []).map((o) => ({
      status: o.status as string,
      valor_total: Number(o.valor_total),
      valor_fechado: o.valor_fechado === null ? null : Number(o.valor_fechado),
      criado_em: o.criado_em as string,
    })),
  );
  return {
    ok: true,
    normalizado,
    encontrado: { id: data.id, nome: data.nome, historico: textoHistorico(r) },
  };
}

// ---------------------------------------------------------------- anexos

export interface AnexoView {
  id: string;
  tipo: TipoAnexo;
  nome_original: string | null;
  mime_type: string | null;
  /** URL assinada para exibir (expira em 1 h). */
  url: string | null;
}

const VALIDADE_URL_SEGUNDOS = 3600;

export type RespostaPreparoUpload = Falha | { ok: true; caminho: string; token: string };

/** Valida e devolve uma URL assinada de envio. A RLS do Storage vale na criação da URL. */
export async function prepararUpload(
  orcamentoId: string,
  arquivo: { mime: string; tamanho: number },
): Promise<RespostaPreparoUpload> {
  const usuario = await obterUsuarioAtual();
  const invalido = validarArquivoAnexo(arquivo);
  if (invalido) return falha(invalido);

  const supabase = await criarClienteServidor();
  const orcamento = await carregarRascunho(supabase, usuario.id, orcamentoId);
  if (!orcamento) return falha("Este orçamento não está mais disponível para edição.");

  const { count } = await supabase
    .from("anexos")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", orcamentoId);
  if ((count ?? 0) >= MAX_ANEXOS) return falha(`Limite de ${MAX_ANEXOS} anexos por orçamento.`);

  const caminho = `${usuario.id}/${orcamentoId}/${crypto.randomUUID()}.${extensaoDoMime(arquivo.mime)}`;
  const { data, error } = await supabase.storage.from("anexos").createSignedUploadUrl(caminho);
  if (error || !data) return falha("Não foi possível preparar o envio.");
  return { ok: true, caminho, token: data.token };
}

export type RespostaRegistroAnexo = Falha | { ok: true; anexo: AnexoView };

/** Depois do envio direto ao Storage: confere o arquivo e grava a linha em anexos. */
export async function registrarAnexo(
  orcamentoId: string,
  dados: { caminho: string; tipo: string; nome: string; mime: string },
): Promise<RespostaRegistroAnexo> {
  const usuario = await obterUsuarioAtual();
  if (!caminhoValido(dados.caminho, usuario.id, orcamentoId))
    return falha("Caminho de arquivo inválido.");
  if (!ehTipoAnexo(dados.tipo) || !tiposPermitidos(dados.mime).includes(dados.tipo)) {
    return falha("Tipo de anexo inválido para este arquivo.");
  }

  const supabase = await criarClienteServidor();
  const orcamento = await carregarRascunho(supabase, usuario.id, orcamentoId);
  if (!orcamento) return falha("Este orçamento não está mais disponível para edição.");

  const { data: existe } = await supabase.storage.from("anexos").exists(dados.caminho);
  if (!existe) return falha("O arquivo não chegou ao servidor. Tente de novo.");

  const { data, error } = await supabase
    .from("anexos")
    .insert({
      orcamento_id: orcamentoId,
      caminho_storage: dados.caminho,
      tipo: dados.tipo,
      nome_original: dados.nome.slice(0, 200),
      mime_type: dados.mime,
    })
    .select("id")
    .single();

  if (error || !data) {
    await supabase.storage.from("anexos").remove([dados.caminho]);
    return falha(
      /Limite de 4/.test(error?.message ?? "")
        ? `Limite de ${MAX_ANEXOS} anexos por orçamento.`
        : ERRO_GENERICO,
    );
  }

  const { data: url } = await supabase.storage
    .from("anexos")
    .createSignedUrl(dados.caminho, VALIDADE_URL_SEGUNDOS);
  return {
    ok: true,
    anexo: {
      id: data.id,
      tipo: dados.tipo,
      nome_original: dados.nome,
      mime_type: dados.mime,
      url: url?.signedUrl ?? null,
    },
  };
}

export type RespostaRemocao = Falha | { ok: true };

/** Apaga o arquivo do Storage e a linha em anexos. */
export async function removerAnexo(anexoId: string): Promise<RespostaRemocao> {
  await obterUsuarioAtual();
  const supabase = await criarClienteServidor();

  const { data: anexo } = await supabase
    .from("anexos")
    .select("id, caminho_storage, orcamentos(status)")
    .eq("id", anexoId)
    .maybeSingle();
  if (!anexo) return falha("Anexo não encontrado.");

  const orc = anexo.orcamentos as { status: string } | { status: string }[] | null;
  const status = Array.isArray(orc) ? orc[0]?.status : orc?.status;
  if (status !== "rascunho") return falha("Este orçamento não está mais em rascunho.");

  const { error: erroStorage } = await supabase.storage
    .from("anexos")
    .remove([anexo.caminho_storage]);
  if (erroStorage) return falha("Não foi possível apagar o arquivo.");

  const { error } = await supabase.from("anexos").delete().eq("id", anexoId);
  if (error) return falha("Não foi possível remover o anexo.");
  return { ok: true };
}
