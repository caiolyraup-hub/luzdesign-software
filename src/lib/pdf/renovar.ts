import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adicionarDiasISO, hojeMaceioISO } from "../formatar";
import { carregarItensRevisao } from "../orcamento/carregar-itens";
import { ambientesDasRespostas, type ItemRevisao } from "../orcamento/itens";
import type { ModoRenovacao } from "../orcamento/renovacao";
import { motivosBloqueioGerar } from "../orcamento/totais";
import { STATUS_QUE_VENCEM } from "../orcamento/validade";
import type { Respostas } from "../orcamento/perguntas";
import { montarDadosPdf, type ConfigPdf, type DadosPdf, type LojaPdf } from "./dados";

export interface DepsRenovar {
  /** Sessão de quem renova (dona ou gerente): a RLS vale para ler orçamento, itens e catálogo. */
  sessao: SupabaseClient;
  /**
   * Cliente só para guardar os arquivos no Storage na pasta da DONA (a gerente não escreve lá pela
   * política do bucket). O servidor só o usa depois de conferir quem pode renovar.
   */
  armazenamento: SupabaseClient;
  renderizar: (dados: DadosPdf) => Promise<Uint8Array>;
  gerarPlanilha: (dados: DadosPdf) => Promise<Uint8Array>;
  agora?: () => Date;
}

export type ResultadoRenovar =
  | { ok: true; versao: number; validade: string; totalCentavos: number }
  | { ok: false; erro: string; bloqueios?: string[] };

const falha = (erro: string, bloqueios?: string[]): ResultadoRenovar => ({
  ok: false,
  erro,
  bloqueios,
});

function mensagemDoBanco(mensagem: string): ResultadoRenovar {
  if (mensagem.includes("SEM_PERMISSAO"))
    return falha("Só a dona do orçamento ou a gerência pode renovar.");
  if (mensagem.includes("ORCAMENTO_NAO_RENOVAVEL"))
    return falha("Este orçamento já foi fechado ou perdido: reabra-o antes de renovar.");
  if (mensagem.includes("PRODUTO_INATIVO"))
    return falha(
      "Um produto saiu do catálogo. Troque ou remova o item (Editar e enviar nova versão).",
    );
  if (mensagem.includes("AVULSO_SEM_PRECO"))
    return falha("Defina o preço dos itens avulsos antes de renovar.");
  if (mensagem.includes("TOTAL_DIVERGENTE"))
    return falha("Um preço mudou no estoque agora há pouco. Confira a prévia e tente de novo.");
  if (mensagem.includes("VERSAO_DIVERGENTE"))
    return falha("Este orçamento foi alterado em outro lugar. Recarregue a tela e tente de novo.");
  return falha("Não foi possível renovar o orçamento agora. Tente de novo.");
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
  usuarios: { nome: string } | { nome: string }[] | null;
}

/**
 * Renova a validade com uma nova versão (PDF + XLSX): `atualizar` põe o preço atual do catálogo nos
 * itens com código; `manter` deixa os preços congelados. As descrições já congeladas ficam como estão
 * (sem IA). Os arquivos vão ao Storage e só então a função SQL `renovar_validade` grava tudo numa
 * transação (volta para `gerado` sem apagar as datas de envio e marca a versão como renovação).
 */
export async function renovarOrcamento(
  deps: DepsRenovar,
  usuario: { id: string; perfil: string },
  orcamentoId: string,
  modo: ModoRenovacao,
): Promise<ResultadoRenovar> {
  const { sessao } = deps;
  const agora = deps.agora?.() ?? new Date();

  const { data: orc } = await sessao
    .from("orcamentos")
    .select(
      "id, numero, vendedora_id, status, pdf_versao, respostas, montagem, endereco, clientes(nome, whatsapp, arquiteto_indicador), usuarios(nome)",
    )
    .eq("id", orcamentoId)
    .maybeSingle();
  const o = orc as unknown as LinhaOrcamento | null;
  if (!o || (o.vendedora_id !== usuario.id && usuario.perfil !== "gerente"))
    return falha("Orçamento não encontrado.");
  if (!(STATUS_QUE_VENCEM as readonly string[]).includes(o.status))
    return falha("Este orçamento não pode ser renovado no status atual.");

  const { data: cfg } = await sessao
    .from("configuracoes_loja")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (!cfg) return falha("Os dados da loja não estão configurados. Avise a gerência.");

  const itensBanco = await carregarItensRevisao(sessao, orcamentoId);
  const bloqueios = motivosBloqueioGerar(
    itensBanco.map((i) => ({
      avulso: i.avulso,
      preco_unitario: i.preco,
      produtoAtivo: i.produtoAtivo,
      descricao: i.descricao,
    })),
  );
  if (bloqueios.length > 0) return falha(bloqueios[0], bloqueios);

  // Atualizar: item com código leva o preço atual do catálogo. Manter: fica o preço congelado.
  const itens: ItemRevisao[] = itensBanco.map((i) =>
    modo === "atualizar" && !i.avulso && i.precoCatalogo !== null
      ? { ...i, preco: i.precoCatalogo }
      : i,
  );
  const ambientes = [
    ...ambientesDasRespostas(o.respostas ?? {}),
    ...(o.montagem?.ambientes_extras ?? []),
  ];

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
  const dona = Array.isArray(o.usuarios) ? o.usuarios[0] : o.usuarios;

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
    vendedora: dona?.nome ?? "Luz Design",
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
    return falha("Não foi possível montar o PDF e a planilha agora. Tente de novo.");
  }

  const base = `${o.vendedora_id}/${orcamentoId}/${o.numero}-v${versao}`;
  const caminho = `${base}.pdf`;
  const caminhoXlsx = `${base}.xlsx`;
  const { error: erroPdf } = await deps.armazenamento.storage
    .from("pdfs")
    .upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (erroPdf) return falha("Não foi possível guardar o PDF agora. Tente de novo.");
  const { error: erroXlsx } = await deps.armazenamento.storage
    .from("pdfs")
    .upload(caminhoXlsx, planilha, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
  if (erroXlsx) return falha("Não foi possível guardar a planilha agora. Tente de novo.");

  const { error } = await sessao.rpc("renovar_validade", {
    p_orcamento: orcamentoId,
    p_pdf_caminho: caminho,
    p_xlsx_caminho: caminhoXlsx,
    p_versao: versao,
    p_total_esperado: totalCentavos / 100,
    p_validade: validade,
    p_manter_precos: modo === "manter",
  });
  if (error) return mensagemDoBanco(error.message);

  return { ok: true, versao, validade, totalCentavos };
}
