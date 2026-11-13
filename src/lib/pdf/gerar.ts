import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adicionarDiasISO, hojeMaceioISO } from "../formatar";
import { carregarItensRevisao } from "../orcamento/carregar-itens";
import { ambientesDasRespostas, type ItemRevisao } from "../orcamento/itens";
import type { Respostas } from "../orcamento/perguntas";
import { motivosBloqueioGerar, totaisDoOrcamento } from "../orcamento/totais";
import { montarDadosPdf, type ConfigPdf, type DadosPdf, type LojaPdf } from "./dados";

/** Resultado da padronização de texto (feita pela IA, só texto). Qualquer falha cai no catálogo. */
export interface TextosPadronizados {
  /** código -> descrição final (padronizada, ou a do catálogo). */
  descricoes: Map<string, string>;
  /** nome do ambiente -> nome padronizado (só os que mudaram). */
  ambientes: Map<string, string>;
}

export interface DepsGerarOrcamento {
  /** Cliente Supabase da PRÓPRIA vendedora: a RLS vale (orçamento, itens, Storage). */
  sessao: SupabaseClient;
  /** Gera os bytes do PDF. Em produção, `renderizarPdf`; nos testes, qualquer coisa. */
  renderizar: (dados: DadosPdf) => Promise<Uint8Array>;
  /** Gera os bytes da planilha XLSX (mesmos dados do PDF). */
  gerarPlanilha: (dados: DadosPdf) => Promise<Uint8Array>;
  /**
   * Padroniza descrição dos produtos e nome dos ambientes (opcional). Nunca bloqueia: se faltar
   * ou falhar, valem a descrição do catálogo e o nome digitado.
   */
  padronizar?: (entrada: {
    produtos: {
      codigo: string;
      categoria?: string | null;
      descricao: string;
      atualizado_em?: string;
    }[];
    ambientes: string[];
  }) => Promise<TextosPadronizados>;
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

export type ResultadoGerarOrcamento =
  | {
      ok: true;
      versao: number;
      caminho: string;
      caminhoXlsx: string;
      totalCentavos: number;
      aVistaCentavos: number;
      validade: string;
    }
  | { ok: false; motivo: MotivoFalhaPdf; erro: string; bloqueios?: string[] };

const falha = (
  motivo: MotivoFalhaPdf,
  erro: string,
  bloqueios?: string[],
): ResultadoGerarOrcamento => ({
  ok: false,
  motivo,
  erro,
  bloqueios,
});

/** Mensagens da função SQL gerar_orcamento -> texto para a vendedora. */
function mensagemDoBanco(mensagem: string): ResultadoGerarOrcamento {
  if (mensagem.includes("AVULSO_SEM_PRECO"))
    return falha("bloqueado", "Defina o preço dos itens avulsos antes de gerar o orçamento.");
  if (mensagem.includes("SEM_ITENS"))
    return falha("bloqueado", "Adicione ao menos um item antes de gerar o orçamento.");
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
  return falha("falha", "Não foi possível gerar o orçamento agora. Tente de novo.");
}

interface LinhaOrcamento {
  id: string;
  numero: string;
  vendedora_id: string;
  status: string;
  pdf_versao: number;
  endereco: string | null;
  respostas: Respostas | null;
  montagem: { ambientes_extras?: string[] } | null;
  clientes:
    | { nome: string; whatsapp: string | null; arquiteto_indicador: string | null }
    | { nome: string; whatsapp: string | null; arquiteto_indicador: string | null }[]
    | null;
}

/**
 * Item com o preço e a descrição que serão congelados. O preço é SEMPRE o do catálogo. A descrição
 * é a que a vendedora escreveu (se escreveu), senão a padronizada, senão a do catálogo.
 */
function congelar(itens: ItemRevisao[], textos: Map<string, string>): ItemRevisao[] {
  return itens.map((i) => {
    if (i.avulso || i.precoCatalogo === null) return i;
    const descricao = i.descricaoManual
      ? i.descricao
      : (textos.get(i.codigo ?? "") ?? i.descricaoCatalogo ?? i.descricao);
    return { ...i, preco: i.precoCatalogo, descricao };
  });
}

/**
 * Gera uma versão do orçamento (PDF + planilha XLSX): relê o catálogo, padroniza o texto (IA, só
 * texto, nunca bloqueia), calcula tudo, renderiza os dois arquivos, envia ao Storage (bucket
 * privado `pdfs`) e só então grava o congelamento, o status `gerado` e os caminhos numa transação
 * (função SQL gerar_orcamento). Se a gravação falhar, nada fica marcado como gerado.
 */
export async function gerarOrcamento(
  deps: DepsGerarOrcamento,
  usuario: { id: string; nome: string },
  orcamentoId: string,
): Promise<ResultadoGerarOrcamento> {
  const { sessao } = deps;
  const agora = deps.agora?.() ?? new Date();

  const { data: orc } = await sessao
    .from("orcamentos")
    .select(
      "id, numero, vendedora_id, status, pdf_versao, respostas, montagem, endereco, clientes(nome, whatsapp, arquiteto_indicador)",
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

  // Ambientes na ordem da tela: os das perguntas, depois os acrescentados à mão.
  const ambientesBase = [
    ...ambientesDasRespostas(o.respostas ?? {}),
    ...(o.montagem?.ambientes_extras ?? []),
  ];

  // Padronização de texto (só texto): descrição dos produtos e nome dos ambientes.
  let textos: TextosPadronizados = { descricoes: new Map(), ambientes: new Map() };
  if (deps.padronizar) {
    try {
      const codigos = [
        ...new Set(
          itensBanco
            .filter((i) => !i.avulso && !i.descricaoManual && i.codigo)
            .map((i) => i.codigo!),
        ),
      ];
      const { data: produtos } = codigos.length
        ? await sessao
            .from("produtos")
            .select("codigo, categoria, descricao, atualizado_em")
            .in("codigo", codigos)
        : { data: [] };
      const nomes = [
        ...new Set([...ambientesBase, ...itensBanco.map((i) => i.ambiente)].filter(Boolean)),
      ];
      textos = await deps.padronizar({
        produtos: (produtos ?? []).map((p) => ({
          codigo: p.codigo as string,
          categoria: p.categoria as string | null,
          descricao: p.descricao as string,
          atualizado_em: p.atualizado_em as string,
        })),
        ambientes: nomes,
      });
    } catch {
      // A padronização nunca bloqueia: ficam as descrições do catálogo.
    }
  }

  const itens = congelar(itensBanco, textos.descricoes).map((i) => ({
    ...i,
    ambiente: textos.ambientes.get(i.ambiente) ?? i.ambiente,
  }));
  const ambientes = ambientesBase.map((a) => textos.ambientes.get(a) ?? a);

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

  const dados = montarDadosPdf({
    loja,
    config,
    numero: o.numero,
    versao,
    cliente: {
      nome: cliente?.nome ?? "Cliente",
      whatsapp: cliente?.whatsapp ?? null,
      arquiteto: cliente?.arquiteto_indicador ?? null,
      endereco: o.endereco ?? null,
    },
    vendedora: usuario.nome,
    itens,
    ambientes,
    agora,
  });
  const totalCentavos = dados.totais.totalCentavos;
  const validade = adicionarDiasISO(hojeMaceioISO(agora), config.validade_dias);

  let pdf: Uint8Array;
  let planilha: Uint8Array;
  try {
    [pdf, planilha] = await Promise.all([deps.renderizar(dados), deps.gerarPlanilha(dados)]);
  } catch {
    return falha("falha", "Não foi possível montar o PDF e a planilha agora. Tente de novo.");
  }

  // Descrição final no item, antes de congelar (o banco não reescreve descrição).
  for (const i of itens) {
    if (i.avulso || i.descricaoManual || !i.codigo) continue;
    const original = itensBanco.find((x) => x.id === i.id);
    if (original && original.descricao === i.descricao) continue;
    const { error } = await sessao
      .from("orcamento_itens")
      .update({ descricao_congelada: i.descricao })
      .eq("id", i.id)
      .eq("orcamento_id", orcamentoId);
    if (error) return falha("falha", "Não foi possível guardar o orçamento agora. Tente de novo.");
  }

  const base = `${usuario.id}/${orcamentoId}/${o.numero}-v${versao}`;
  const caminho = `${base}.pdf`;
  const caminhoXlsx = `${base}.xlsx`;
  const { error: erroPdf } = await sessao.storage
    .from("pdfs")
    .upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (erroPdf) return falha("falha", "Não foi possível guardar o PDF agora. Tente de novo.");
  const { error: erroXlsx } = await sessao.storage.from("pdfs").upload(caminhoXlsx, planilha, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (erroXlsx) return falha("falha", "Não foi possível guardar a planilha agora. Tente de novo.");

  const { error } = await sessao.rpc("gerar_orcamento", {
    p_orcamento: orcamentoId,
    p_pdf_caminho: caminho,
    p_versao: versao,
    p_total_esperado: totalCentavos / 100,
    p_validade: validade,
    p_xlsx_caminho: caminhoXlsx,
  });
  if (error) return mensagemDoBanco(error.message);

  return {
    ok: true,
    versao,
    caminho,
    caminhoXlsx,
    totalCentavos,
    aVistaCentavos: totaisDoOrcamento(
      itens.map((i) => ({ preco_unitario: i.preco, quantidade: i.quantidade })),
      config.desconto_avista_pct,
    ).aVistaCentavos,
    validade,
  };
}
