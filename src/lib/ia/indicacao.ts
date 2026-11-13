import "server-only";
import { censurarFornecedor } from "../catalogo/limpar";
import { nomeAmbienteValido, normalizarQuantidade } from "../orcamento/itens";
import { subtotalCentavos } from "../orcamento/totais";
import {
  conteudoDosAnexos,
  extrairTextoPdfPadrao,
  inicioDoDiaMaceio,
  mensagemAmigavelErro,
  recusouArquivo,
  type DepsIA,
  type DetalheAnexoEnviado,
  type MotivoFalha,
  type ProdutoCatalogo,
} from "./comum";
import { estimarCustoUsd } from "./config";
import {
  ESQUEMA_JSON_INDICACAO,
  MAX_SUGESTOES,
  schemaIndicacaoIA,
  type SaidaIndicacao,
} from "./esquema";
import { INSTRUCOES_INDICACAO, montarTextoIndicacao } from "./instrucoes-indicacao";
import { executarMotor, type ResultadoMotor } from "./motor";

const MAX_TEXTO = 4000;
const MINUTOS_EM_ANDAMENTO = 10;

export interface PedidoIndicacao {
  orcamentoId: string;
  ambiente: string;
  pedidoCliente: string;
  pedidoArquiteto: string;
  descricaoAmbiente: string;
  usarAnexos: boolean;
}

/** Sugestão já validada: tudo que não é a decisão da IA (descrição, preço) vem do banco. */
export interface SugestaoValida {
  codigo: string;
  descricao: string;
  categoria: string | null;
  unidade: "un" | "m";
  quantidade: number;
  /** Motivo interno e curto, para a vendedora. */
  motivo: string;
  precoUnitario: number;
  subtotalCentavos: number;
  /** O produto já está neste ambiente (adicionar soma na quantidade). */
  jaNoAmbiente: boolean;
}

export interface IndicacaoGuardada {
  resumo: string;
  sugestoes: SugestaoValida[];
  observacoes: string[];
  avisos: string[];
}

export type ResultadoIndicacao =
  | ({
      ok: true;
      custoUsd: number;
      custoConhecido: boolean;
      duracaoMs: number;
      tokensEntrada: number;
      tokensSaida: number;
      chamadasFerramenta: number;
      anexosEnviados: DetalheAnexoEnviado[];
    } & IndicacaoGuardada)
  | { ok: false; erro: string; motivo: MotivoFalha; podeTentarDeNovo: boolean };

const falha = (
  motivo: MotivoFalha,
  erro: string,
  podeTentarDeNovo = false,
): ResultadoIndicacao => ({
  ok: false,
  erro,
  motivo,
  podeTentarDeNovo,
});

/** Códigos citados pela IA (para o servidor reler no banco). */
export function codigosSugeridos(saida: SaidaIndicacao): string[] {
  return [...new Set(saida.sugestoes.map((s) => s.codigo).filter(Boolean))];
}

/**
 * Valida a saída da IA no servidor. Regra central: descrição, unidade e preço vêm SEMPRE do
 * catálogo; código inexistente ou inativo é descartado com aviso; `un` arredonda para cima; o mesmo
 * código aparece uma vez (as quantidades somam). Nada aqui grava item.
 */
export function validarSugestoes(
  saida: SaidaIndicacao,
  catalogo: Map<string, ProdutoCatalogo>,
  existentes: { codigo: string | null }[] = [],
): { sugestoes: SugestaoValida[]; avisos: string[] } {
  const avisos: string[] = [];
  const jaNoAmbiente = new Set(existentes.map((e) => e.codigo).filter(Boolean));
  const porCodigo = new Map<string, SugestaoValida>();

  for (const s of saida.sugestoes) {
    const produto = catalogo.get(s.codigo);
    if (!produto) {
      avisos.push(`Código ${s.codigo || "(vazio)"} não existe no catálogo e foi descartado.`);
      continue;
    }
    if (!produto.ativo) {
      avisos.push(`O produto ${s.codigo} está inativo e foi descartado.`);
      continue;
    }
    const q = normalizarQuantidade(produto.unidade, Number(s.quantidade));
    if (!q.ok) {
      avisos.push(`Quantidade inválida para o produto ${s.codigo}; sugestão descartada.`);
      continue;
    }
    if (q.ajustada && produto.unidade === "un") {
      avisos.push(
        `Quantidade do produto ${s.codigo} arredondada para ${q.valor} (unidade inteira).`,
      );
    }
    const atual = porCodigo.get(s.codigo);
    if (atual) {
      const soma = normalizarQuantidade(produto.unidade, atual.quantidade + q.valor);
      if (soma.ok) {
        atual.quantidade = soma.valor;
        atual.subtotalCentavos = subtotalCentavos(produto.preco_unitario, soma.valor);
      }
      continue;
    }
    porCodigo.set(s.codigo, {
      codigo: produto.codigo,
      descricao: produto.descricao,
      categoria: produto.categoria ?? null,
      unidade: produto.unidade,
      quantidade: q.valor,
      motivo: censurarFornecedor(s.motivo).slice(0, 300),
      precoUnitario: produto.preco_unitario,
      subtotalCentavos: subtotalCentavos(produto.preco_unitario, q.valor),
      jaNoAmbiente: jaNoAmbiente.has(produto.codigo),
    });
  }

  const sugestoes = [...porCodigo.values()];
  if (sugestoes.length > MAX_SUGESTOES) {
    avisos.push(
      `A IA sugeriu mais de ${MAX_SUGESTOES} produtos; mostrei os ${MAX_SUGESTOES} primeiros.`,
    );
  }
  return { sugestoes: sugestoes.slice(0, MAX_SUGESTOES), avisos };
}

/**
 * Indicação da IA: sugere produtos do catálogo para UM ambiente. NUNCA grava item: devolve as
 * sugestões validadas e guarda o histórico em `indicacoes_ia`; a vendedora toca em Adicionar.
 * Limite diário e registro em uso_ia valem; erro de API não conta no limite.
 */
export async function pedirIndicacao(
  deps: DepsIA,
  usuarioId: string,
  pedido: PedidoIndicacao,
): Promise<ResultadoIndicacao> {
  const { repo, config } = deps;
  const agora = (deps.agora ?? (() => new Date()))();
  const t0 = Date.now();

  const ambiente = nomeAmbienteValido(pedido.ambiente);
  if (!ambiente) return falha("entrada_invalida", "Escolha o ambiente (até 60 caracteres).");
  const cliente = pedido.pedidoCliente.trim();
  const arquiteto = pedido.pedidoArquiteto.trim();
  const descricao = pedido.descricaoAmbiente.trim();
  if (!cliente && !arquiteto && !descricao) {
    return falha(
      "entrada_invalida",
      "Conte o que o cliente pediu, o que o arquiteto pediu ou como é o ambiente.",
    );
  }
  if ([cliente, arquiteto, descricao].some((t) => t.length > MAX_TEXTO)) {
    return falha("entrada_invalida", `Use até ${MAX_TEXTO} caracteres em cada campo.`);
  }

  const orcamento = await repo.carregarOrcamento(pedido.orcamentoId);
  if (!orcamento || orcamento.vendedora_id !== usuarioId) {
    return falha("nao_encontrado", "Orçamento não encontrado.");
  }
  if (orcamento.status !== "rascunho" && orcamento.status !== "gerado") {
    return falha("nao_editavel", "Este orçamento não pode mais ser alterado.");
  }

  const usoDoDia = await repo.contarUso({
    vendedoraId: usuarioId,
    desde: inicioDoDiaMaceio(agora),
  });
  if (usoDoDia >= config.limiteDiario) {
    return falha(
      "limite_diario",
      `Você chegou ao limite de ${config.limiteDiario} usos da IA hoje. Volte amanhã ou fale com a gerência.`,
    );
  }
  const desde = new Date(agora.getTime() - MINUTOS_EM_ANDAMENTO * 60_000);
  if (await repo.existeEmAndamento(pedido.orcamentoId, "indicacao", desde)) {
    return falha("em_andamento", "Já existe uma indicação em andamento. Aguarde terminar.");
  }

  const usoId = await repo.iniciarUso({
    orcamentoId: pedido.orcamentoId,
    vendedoraId: usuarioId,
    modelo: config.modelo,
    tipo: "indicacao",
  });
  let motor: ResultadoMotor | null = null;
  let anexosEnviados: DetalheAnexoEnviado[] = [];

  try {
    const itensExistentes = await repo.itensDoAmbiente(pedido.orcamentoId, ambiente);
    const texto = montarTextoIndicacao({
      respostas: orcamento.respostas,
      ambiente,
      pedidoCliente: cliente,
      pedidoArquiteto: arquiteto,
      descricaoAmbiente: descricao,
      itensExistentes,
    });
    const anexos = pedido.usarAnexos ? await repo.carregarAnexos(pedido.orcamentoId) : [];
    const extrair = deps.extrairTextoPdf ?? extrairTextoPdfPadrao;

    const chamar = async (pdfComoTexto: boolean) => {
      const c = await conteudoDosAnexos(anexos, pdfComoTexto, extrair);
      anexosEnviados = c.detalhes;
      return executarMotor({
        cliente: deps.ia,
        modelo: config.modelo,
        instrucoes: INSTRUCOES_INDICACAO,
        conteudo: [{ type: "input_text", text: texto }, ...c.conteudo],
        executor: deps.executor,
        maxRodadas: config.maxRodadasFerramentas,
        raciocinio: config.raciocinio,
        timeoutMs: config.timeoutChamadaMs,
        esquema: ESQUEMA_JSON_INDICACAO,
        nomeEsquema: "indicacao_luz_design",
      });
    };

    try {
      motor = await chamar(false);
    } catch (e) {
      // O modelo não aceitou o PDF como arquivo: tenta de novo mandando o texto extraído.
      if (anexos.some((a) => a.mime === "application/pdf") && recusouArquivo(e)) {
        motor = await chamar(true);
      } else throw e;
    }

    let saida: SaidaIndicacao;
    try {
      saida = schemaIndicacaoIA.parse(JSON.parse(motor.textoFinal));
    } catch {
      throw new Error("Resposta inválida da IA (esquema).");
    }

    const catalogo = await repo.buscarProdutosPorCodigo(codigosSugeridos(saida));
    const { sugestoes, avisos } = validarSugestoes(saida, catalogo, itensExistentes);
    const resultado: IndicacaoGuardada = {
      resumo: censurarFornecedor(saida.resumo).slice(0, 1200),
      sugestoes,
      observacoes: saida.observacoes.map((o) => censurarFornecedor(o)).filter(Boolean),
      avisos,
    };

    // O histórico é um extra: se não gravar, a vendedora ainda vê as sugestões.
    await repo
      .salvarIndicacao({
        orcamentoId: pedido.orcamentoId,
        vendedoraId: usuarioId,
        ambiente,
        pedidoCliente: cliente || null,
        pedidoArquiteto: arquiteto || null,
        descricaoAmbiente: descricao || null,
        usouAnexos: pedido.usarAnexos && anexosEnviados.some((a) => a.enviado_como !== "ignorado"),
        resposta: resultado,
      })
      .catch(() => undefined);

    const { custo, conhecido } = estimarCustoUsd(config, motor.tokensEntrada, motor.tokensSaida);
    const duracaoMs = Date.now() - t0;
    await repo.finalizarUso(usoId, {
      status: "ok",
      tokens_entrada: motor.tokensEntrada,
      tokens_saida: motor.tokensSaida,
      custo_estimado: custo,
      duracao_ms: duracaoMs,
      chamadas_ferramenta: motor.chamadasFerramenta,
      detalhes: {
        tipo: "indicacao",
        ambiente,
        anexos: anexosEnviados,
        avisos,
        sugestoes: sugestoes.length,
        ferramentas: motor.ferramentas,
        chamadas_api: motor.chamadasApi,
        custo_conhecido: conhecido,
      },
    });

    return {
      ok: true,
      ...resultado,
      custoUsd: custo,
      custoConhecido: conhecido,
      duracaoMs,
      tokensEntrada: motor.tokensEntrada,
      tokensSaida: motor.tokensSaida,
      chamadasFerramenta: motor.chamadasFerramenta,
      anexosEnviados,
    };
  } catch (e) {
    await repo
      .finalizarUso(usoId, {
        status: "erro",
        tokens_entrada: motor?.tokensEntrada ?? 0,
        tokens_saida: motor?.tokensSaida ?? 0,
        custo_estimado: 0,
        duracao_ms: Date.now() - t0,
        chamadas_ferramenta: motor?.chamadasFerramenta ?? 0,
        erro: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        detalhes: { tipo: "indicacao", ambiente, anexos: anexosEnviados },
      })
      .catch(() => undefined);
    return falha("ia", mensagemAmigavelErro(e), true);
  }
}
