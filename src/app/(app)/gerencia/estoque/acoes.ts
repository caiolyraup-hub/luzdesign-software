"use server";

import { importar, previa } from "@/lib/estoque/importar";
import { lerPlanilha } from "@/lib/estoque/lerPlanilha";
import { prepararCarga, sugerirMapeamento } from "@/lib/estoque/mapeamento";
import { criarRepositorioSupabase } from "@/lib/estoque/repositorio-supabase";
import type {
  ErroLinha,
  Mapeamento,
  PreviaImportacao,
  ResumoImportacao,
} from "@/lib/estoque/tipos";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const TAMANHO_MAXIMO = 4 * 1024 * 1024;

type Falha = { ok: false; erro: string };

/** A escrita usa a service role, então o perfil é conferido aqui, no servidor, a cada chamada. */
async function exigirGerente() {
  const usuario = await obterUsuarioAtual();
  if (usuario.perfil !== "gerente") throw new Error("Apenas a gerência pode importar o estoque.");
  return usuario;
}

async function lerArquivoEnviado(formData: FormData) {
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0)
    throw new Error("Escolha um arquivo .xlsx ou .csv.");
  if (arquivo.size > TAMANHO_MAXIMO) throw new Error("Arquivo grande demais (máximo de 4 MB).");
  const planilha = await lerPlanilha({
    nome: arquivo.name,
    dados: new Uint8Array(await arquivo.arrayBuffer()),
  });
  if (planilha.colunas.length === 0) throw new Error("A planilha está vazia.");
  return { planilha, nome: arquivo.name };
}

function lerMapeamento(formData: FormData): Mapeamento {
  try {
    return JSON.parse(String(formData.get("mapeamento") ?? "{}")) as Mapeamento;
  } catch {
    throw new Error("Mapeamento inválido.");
  }
}

function mensagem(e: unknown): Falha {
  return { ok: false, erro: e instanceof Error ? e.message : "Erro inesperado." };
}

export type RespostaLeitura =
  | Falha
  | {
      ok: true;
      colunas: string[];
      amostra: Record<string, string>[];
      total: number;
      mapeamento: Mapeamento;
      mapeamentoSalvo: boolean;
    };

/** Passo 1: lê o arquivo e devolve colunas, 5 linhas de amostra e o mapeamento sugerido. */
export async function lerArquivo(formData: FormData): Promise<RespostaLeitura> {
  try {
    await exigirGerente();
    const { planilha } = await lerArquivoEnviado(formData);

    const supabase = await criarClienteServidor();
    const { data } = await supabase
      .from("estoque_mapeamentos")
      .select("colunas")
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    const salvo = (data?.colunas ?? null) as Mapeamento | null;
    return {
      ok: true,
      colunas: planilha.colunas,
      amostra: planilha.linhas.slice(0, 5),
      total: planilha.linhas.length,
      mapeamento: sugerirMapeamento(planilha.colunas, salvo),
      mapeamentoSalvo: salvo !== null,
    };
  } catch (e) {
    return mensagem(e);
  }
}

export type RespostaPrevia =
  | Falha
  | {
      ok: true;
      previa: PreviaImportacao;
      linhasLidas: number;
      totalErros: number;
      erros: ErroLinha[];
    };

/** Passo 3: o que a carga faria, sem gravar. */
export async function gerarPrevia(formData: FormData): Promise<RespostaPrevia> {
  try {
    await exigirGerente();
    const { planilha } = await lerArquivoEnviado(formData);
    const carga = prepararCarga(planilha.linhas, lerMapeamento(formData));
    const repo = criarRepositorioSupabase(criarClienteAdmin());
    return {
      ok: true,
      previa: await previa(repo, carga.produtos, carga.codigosVistos),
      linhasLidas: carga.linhasLidas,
      totalErros: carga.erros.length,
      erros: carga.erros.slice(0, 50),
    };
  } catch (e) {
    return mensagem(e);
  }
}

export type RespostaImportacao = Falha | { ok: true; resumo: ResumoImportacao };

/** Passo 4: grava, registra a carga em sync_estoque e salva o mapeamento. */
export async function confirmarImportacao(formData: FormData): Promise<RespostaImportacao> {
  try {
    await exigirGerente();
    const { planilha, nome } = await lerArquivoEnviado(formData);
    const mapeamento = lerMapeamento(formData);
    const carga = prepararCarga(planilha.linhas, mapeamento);

    const resumo = await importar(criarRepositorioSupabase(criarClienteAdmin()), carga.produtos, {
      origem: `planilha:${nome}`.slice(0, 120),
      linhasLidas: carga.linhasLidas,
      erros: carga.erros,
      codigosVistos: carga.codigosVistos,
      desativarAusentes: formData.get("desativarAusentes") === "on",
    });

    // Com a sessão da gerente: a RLS de estoque_mapeamentos também vale aqui.
    const supabase = await criarClienteServidor();
    await supabase.from("estoque_mapeamentos").insert({
      nome: `${nome} (${new Date().toLocaleDateString("pt-BR")})`.slice(0, 120),
      colunas: mapeamento,
    });

    return { ok: true, resumo };
  } catch (e) {
    return mensagem(e);
  }
}
