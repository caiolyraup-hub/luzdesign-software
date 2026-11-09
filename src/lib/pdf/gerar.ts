import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adicionarDiasISO, hojeMaceioISO } from "../formatar";
import { carregarItensRevisao } from "../orcamento/carregar-itens";
import { ambientesDasRespostas, type ItemRevisao } from "../orcamento/itens";
import type { Respostas } from "../orcamento/perguntas";
import { motivosBloqueioGerar, totaisDoOrcamento } from "../orcamento/totais";
import {
  montarDadosPdf,
  type AnaliseAmbiente,
  type ConfigPdf,
  type DadosPdf,
  type LojaPdf,
} from "./dados";

export interface DepsGerarPdf {
  /** Cliente Supabase da PRÓPRIA vendedora: a RLS vale (orçamento, itens, Storage). */
  sessao: SupabaseClient;
  /** Gera os bytes do PDF. Em produção, `renderizarPdf`; nos testes, qualquer coisa. */
  renderizar: (dados: DadosPdf) => Promise<Uint8Array>;
  agora?: () => Date;
}

export type MotivoFalhaPdf =
  | "nao_encontrado"
  | "nao_editavel"
  | "bloqueado"
  | "sem_configuracao"
  | "preco_mudou"
  | "versao"
  | "falha";

export type ResultadoGerarPdf =
  | {
      ok: true;
      versao: number;
      caminho: string;
      totalCentavos: number;
      aVistaCentavos: number;
      validade: string;
    }
  | { ok: false; motivo: MotivoFalhaPdf; erro: string; bloqueios?: string[] };

const falha = (motivo: MotivoFalhaPdf, erro: string, bloqueios?: string[]): ResultadoGerarPdf => ({
  ok: false,
  motivo,
  erro,
  bloqueios,
});

/** Mensagens da função SQL gerar_orcamento -> texto para a vendedora. */
function mensagemDoBanco(mensagem: string): ResultadoGerarPdf {
  if (mensagem.includes("AVULSO_SEM_PRECO"))
    return falha("bloqueado", "Defina o preço dos itens avulsos antes de gerar o PDF.");
  if (mensagem.includes("SEM_ITENS"))
    return falha("bloqueado", "Adicione ao menos um item antes de gerar o PDF.");
  if (mensagem.includes("PRODUTO_INATIVO"))
    return falha("bloqueado", "Um produto saiu do catálogo. Troque o produto e tente de novo.");
  if (mensagem.includes("TOTAL_DIVERGENTE"))
    return falha("preco_mudou", "Um preço mudou no estoque agora há pouco. Tente gerar de novo.");
  if (mensagem.includes("VERSAO_DIVERGENTE"))
    return falha(
      "versao",
      "Este orçamento foi alterado em outro lugar. Recarregue a tela e tente de novo.",
    );
  if (mensagem.includes("ORCAMENTO_NAO_EDITAVEL"))
    return falha("nao_editavel", "Este orçamento não pode mais ser alterado.");
  return falha("falha", "Não foi possível gerar o PDF agora. Tente de novo.");
}

interface LinhaOrcamento {
  id: string;
  numero: string;
  vendedora_id: string;
  status: string;
  pdf_versao: number;
  mostrar_analise_pdf: boolean;
  respostas: Respostas | null;
  montagem: { ambientes_extras?: string[] } | null;
  clientes:
    | { nome: string; whatsapp: string | null; arquiteto_indicador: string | null }
    | { nome: string; whatsapp: string | null; arquiteto_indicador: string | null }[]
    | null;
}

/** Item com o preço e a descrição que serão congelados: sempre os do catálogo. */
function congelar(itens: ItemRevisao[]): ItemRevisao[] {
  return itens.map((i) =>
    i.avulso || i.precoCatalogo === null
      ? i
      : { ...i, preco: i.precoCatalogo, descricao: i.descricaoCatalogo ?? i.descricao },
  );
}

/**
 * Gera uma versão do PDF: relê o catálogo, calcula tudo, renderiza, envia ao Storage (bucket
 * privado `pdfs`) e só então grava o congelamento, o status `gerado` e o caminho numa transação
 * (função SQL gerar_orcamento). Se a gravação falhar, nada fica marcado como gerado.
 */
export async function gerarPdfOrcamento(
  deps: DepsGerarPdf,
  usuario: { id: string; nome: string },
  orcamentoId: string,
): Promise<ResultadoGerarPdf> {
  const { sessao } = deps;
  const agora = deps.agora?.() ?? new Date();

  const { data: orc } = await sessao
    .from("orcamentos")
    .select(
      "id, numero, vendedora_id, status, pdf_versao, mostrar_analise_pdf, respostas, montagem, clientes(nome, whatsapp, arquiteto_indicador)",
    )
    .eq("id", orcamentoId)
    .maybeSingle();
  const o = orc as unknown as LinhaOrcamento | null;
  if (!o || o.vendedora_id !== usuario.id)
    return falha("nao_encontrado", "Orçamento não encontrado.");
  if (o.status !== "rascunho" && o.status !== "gerado") {
    return falha("nao_editavel", "Este orçamento não pode mais ser alterado.");
  }

  const { data: cfg } = await sessao
    .from("configuracoes_loja")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (!cfg)
    return falha("sem_configuracao", "Os dados da loja não estão configurados. Avise a gerência.");

  const itensBanco = await carregarItensRevisao(sessao, orcamentoId);
  const bloqueios = motivosBloqueioGerar(
    itensBanco.map((i) => ({
      avulso: i.avulso,
      preco_unitario: i.preco,
      produtoAtivo: i.produtoAtivo,
      descricao: i.descricao,
    })),
  );
  if (bloqueios.length > 0) return falha("bloqueado", bloqueios[0], bloqueios);

  const itens = congelar(itensBanco);
  const versao = o.pdf_versao + 1;
  const config: ConfigPdf = {
    validade_dias: cfg.validade_dias,
    desconto_avista_pct: Number(cfg.desconto_avista_pct),
    linhas_rodape: cfg.linhas_rodape ?? "",
  };
  const loja: LojaPdf = {
    nome_fantasia: cfg.nome_fantasia,
    razao_social: cfg.razao_social,
    cnpj: cfg.cnpj,
    endereco: cfg.endereco,
    telefone: cfg.telefone,
    whatsapp: cfg.whatsapp,
    instagram: cfg.instagram,
    site: cfg.site,
  };
  const cliente = Array.isArray(o.clientes) ? o.clientes[0] : o.clientes;

  // Ambientes na ordem da revisão: os das perguntas, depois os acrescentados à mão.
  const ambientes = [
    ...ambientesDasRespostas(o.respostas ?? {}),
    ...(o.montagem?.ambientes_extras ?? []),
  ];

  const analises = o.mostrar_analise_pdf ? await carregarAnalises(sessao, orcamentoId) : [];

  const dados = montarDadosPdf({
    analises,
    mostrarAnalise: o.mostrar_analise_pdf,
    loja,
    config,
    numero: o.numero,
    versao,
    cliente: {
      nome: cliente?.nome ?? "Cliente",
      whatsapp: cliente?.whatsapp ?? null,
      arquiteto: cliente?.arquiteto_indicador ?? null,
    },
    vendedora: usuario.nome,
    itens,
    ambientes,
    agora,
  });
  const totalCentavos = dados.totais.totalCentavos;
  const validade = adicionarDiasISO(hojeMaceioISO(agora), config.validade_dias);

  let bytes: Uint8Array;
  try {
    bytes = await deps.renderizar(dados);
  } catch {
    return falha("falha", "Não foi possível montar o PDF agora. Tente de novo.");
  }

  const caminho = `${usuario.id}/${orcamentoId}/${o.numero}-v${versao}.pdf`;
  const { error: erroUpload } = await sessao.storage
    .from("pdfs")
    .upload(caminho, bytes, { contentType: "application/pdf", upsert: true });
  if (erroUpload) return falha("falha", "Não foi possível guardar o PDF agora. Tente de novo.");

  const { error } = await sessao.rpc("gerar_orcamento", {
    p_orcamento: orcamentoId,
    p_pdf_caminho: caminho,
    p_versao: versao,
    p_total_esperado: totalCentavos / 100,
    p_validade: validade,
  });
  if (error) return mensagemDoBanco(error.message);

  return {
    ok: true,
    versao,
    caminho,
    totalCentavos,
    aVistaCentavos: totaisDoOrcamento(
      itens.map((i) => ({ preco_unitario: i.preco, quantidade: i.quantidade })),
      config.desconto_avista_pct,
    ).aVistaCentavos,
    validade,
  };
}

/** Análises dos ambientes (texto) e, quando a análise se baseou numa foto, a miniatura dela. */
async function carregarAnalises(
  sessao: SupabaseClient,
  orcamentoId: string,
): Promise<AnaliseAmbiente[]> {
  const { data: ambientes } = await sessao
    .from("orcamento_ambientes")
    .select("nome, analise, anexos_usados")
    .eq("orcamento_id", orcamentoId)
    .order("ordem");
  const lista = (ambientes ?? []) as {
    nome: string;
    analise: string | null;
    anexos_usados: string[] | null;
  }[];

  const ids = [...new Set(lista.flatMap((a) => a.anexos_usados ?? []))];
  const anexos = new Map<string, { mime_type: string | null; caminho_storage: string }>();
  if (ids.length > 0) {
    const { data } = await sessao
      .from("anexos")
      .select("id, mime_type, caminho_storage")
      .in("id", ids);
    for (const a of data ?? []) anexos.set(a.id, a);
  }

  const resultado: AnaliseAmbiente[] = [];
  for (const a of lista) {
    // No máximo uma miniatura por ambiente: a primeira foto (JPG ou PNG) usada na análise. PDF não vira miniatura.
    const foto = (a.anexos_usados ?? [])
      .map((id) => ({ id, ...anexos.get(id) }))
      .find((x) => x.mime_type === "image/jpeg" || x.mime_type === "image/png");
    let miniatura: AnaliseAmbiente["miniatura"] = null;
    if (foto?.caminho_storage) {
      const { data } = await sessao.storage.from("anexos").download(foto.caminho_storage);
      if (data)
        miniatura = {
          data: new Uint8Array(await data.arrayBuffer()),
          format: foto.mime_type === "image/png" ? "png" : "jpg",
        };
    }
    resultado.push({ nome: a.nome, analise: a.analise, miniatura });
  }
  return resultado;
}
