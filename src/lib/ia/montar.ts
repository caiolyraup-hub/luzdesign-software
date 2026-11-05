import "server-only";
import { primeiroPassoPendente, type Respostas } from "../orcamento/perguntas";
import { estimarCustoUsd, type ConfigIA } from "./config";
import { schemaSaidaIA, type SaidaIA } from "./esquema";
import type { ExecutorFerramentas } from "./ferramentas";
import { INSTRUCOES_LOJA, montarTextoAtendimento } from "./instrucoes";
import { executarMotor, type ClienteIA, type ConteudoEntrada, type ResultadoMotor } from "./motor";
import {
  centavosParaReais,
  codigosCitados,
  normalizarSaida,
  type ItemMontado,
  type ProdutoCatalogo,
} from "./normalizar";

// ---------------------------------------------------------------- acesso ao banco (injetado)

export interface OrcamentoParaMontar {
  id: string;
  vendedora_id: string;
  status: string;
  respostas: Respostas;
}

export interface AnexoParaIA {
  tipo: string;
  nome: string;
  mime: string;
  dados: Uint8Array;
}

export interface FinalizacaoUso {
  status: "ok" | "erro";
  tokens_entrada: number;
  tokens_saida: number;
  custo_estimado: number;
  duracao_ms: number;
  chamadas_ferramenta: number;
  erro?: string;
  detalhes: Record<string, unknown>;
}

export interface MontagemGravada {
  geracoes: number;
  pendencias: string[];
  avisos: string[];
  resumo: string;
  modelo: string;
}

/** Banco separado da lógica para testar sem Supabase. A implementação real está em repositorio-ia.ts. */
export interface RepositorioIA {
  carregarOrcamento(id: string): Promise<OrcamentoParaMontar | null>;
  /** Montagens que contam no limite: ok, mais as em andamento recentes. */
  contarUso(filtro: { vendedoraId?: string; orcamentoId?: string; desde?: Date }): Promise<number>;
  existeEmAndamento(orcamentoId: string, desde: Date): Promise<boolean>;
  iniciarUso(dados: { orcamentoId: string; vendedoraId: string; modelo: string }): Promise<string>;
  finalizarUso(id: string, dados: FinalizacaoUso): Promise<void>;
  carregarAnexos(orcamentoId: string): Promise<AnexoParaIA[]>;
  buscarProdutosPorCodigo(codigos: string[]): Promise<Map<string, ProdutoCatalogo>>;
  /** Uma transação: troca os itens, grava total e resultado. */
  substituirItens(
    orcamentoId: string,
    itens: ItemMontado[],
    valorTotal: number,
    montagem: MontagemGravada,
  ): Promise<void>;
}

export interface DepsMontar {
  repo: RepositorioIA;
  ia: ClienteIA;
  executor: ExecutorFerramentas;
  config: ConfigIA;
  agora?: () => Date;
  /** Lê o texto de um PDF quando o modelo recusa o arquivo (opcional; padrão: unpdf). */
  extrairTextoPdf?: (dados: Uint8Array) => Promise<string>;
}

// ---------------------------------------------------------------- resultado

export type MotivoFalha =
  | "nao_encontrado"
  | "nao_rascunho"
  | "respostas_incompletas"
  | "limite_diario"
  | "limite_orcamento"
  | "em_andamento"
  | "ia";

export type ResultadoMontagem =
  | {
      ok: true;
      itens: number;
      totalCentavos: number;
      avisos: string[];
      pendencias: string[];
      resumo: string;
      geracoes: number;
      geracoesRestantes: number;
      custoUsd: number;
      custoConhecido: boolean;
      duracaoMs: number;
      tokensEntrada: number;
      tokensSaida: number;
      chamadasFerramenta: number;
      itensMontados: ItemMontado[];
    }
  | { ok: false; erro: string; motivo: MotivoFalha; podeTentarDeNovo: boolean };

const falha = (motivo: MotivoFalha, erro: string, podeTentarDeNovo = false): ResultadoMontagem => ({
  ok: false,
  erro,
  motivo,
  podeTentarDeNovo,
});

const MINUTOS_EM_ANDAMENTO = 10;

/** Início do dia em Maceió (UTC-3, sem horário de verão). */
export function inicioDoDiaMaceio(agora: Date): Date {
  const deslocado = new Date(agora.getTime() - 3 * 3600 * 1000);
  const dia = deslocado.toISOString().slice(0, 10);
  return new Date(`${dia}T00:00:00-03:00`);
}

/** Mensagem amigável para um erro da API ou da validação (o detalhe técnico vai só para uso_ia). */
export function mensagemAmigavelErro(e: unknown): string {
  const status = (e as { status?: number })?.status;
  const nome = (e as { name?: string })?.name ?? "";
  const texto = e instanceof Error ? e.message : String(e);
  if (/timeout|timed out|abort/i.test(nome + texto)) return "A IA demorou demais para responder.";
  if (status === 429) return "A IA está com muitas solicitações agora. Tente de novo em instantes.";
  if (status === 401 || status === 403)
    return "A IA não está configurada corretamente. Avise a gerência.";
  if (status === 404 || (/model/i.test(texto) && status === 400))
    return "O modelo de IA não está disponível. Avise a gerência.";
  if (e instanceof SyntaxError || /resposta inválida|esquema/i.test(texto))
    return "A IA devolveu uma resposta inválida.";
  return "Não foi possível montar o orçamento agora.";
}

// ---------------------------------------------------------------- anexos -> entrada da IA

const MIME_IMAGEM_IA = ["image/jpeg", "image/png", "image/webp"];
const LIMITE_TOTAL_BYTES = 30 * 1024 * 1024;

const base64 = (dados: Uint8Array) => Buffer.from(dados).toString("base64");

export interface DetalheAnexoEnviado {
  nome: string;
  tipo: string;
  enviado_como: "imagem" | "pdf_arquivo" | "pdf_texto" | "ignorado";
  motivo?: string;
}

/** Monta o conteúdo da entrada: imagens como imagem, PDFs como arquivo (ou texto) e avisos do que ficou de fora. */
export async function conteudoDosAnexos(
  anexos: AnexoParaIA[],
  pdfComoTexto: boolean,
  extrairTextoPdf: (dados: Uint8Array) => Promise<string>,
): Promise<{ conteudo: ConteudoEntrada[]; detalhes: DetalheAnexoEnviado[] }> {
  const conteudo: ConteudoEntrada[] = [];
  const detalhes: DetalheAnexoEnviado[] = [];
  let bytes = 0;

  for (const a of anexos) {
    if (MIME_IMAGEM_IA.includes(a.mime)) {
      if (bytes + a.dados.length > LIMITE_TOTAL_BYTES) {
        detalhes.push({
          nome: a.nome,
          tipo: a.tipo,
          enviado_como: "ignorado",
          motivo: "limite de tamanho total",
        });
        continue;
      }
      bytes += a.dados.length;
      conteudo.push({ type: "input_text", text: `Anexo (${a.tipo}): ${a.nome}` });
      conteudo.push({
        type: "input_image",
        image_url: `data:${a.mime};base64,${base64(a.dados)}`,
        detail: "auto",
      });
      detalhes.push({ nome: a.nome, tipo: a.tipo, enviado_como: "imagem" });
    } else if (a.mime === "application/pdf") {
      if (pdfComoTexto) {
        try {
          const texto = (await extrairTextoPdf(a.dados)).trim().slice(0, 30_000);
          if (texto) {
            conteudo.push({
              type: "input_text",
              text: `Texto do PDF anexo (${a.tipo}) ${a.nome}:\n${texto}`,
            });
            detalhes.push({ nome: a.nome, tipo: a.tipo, enviado_como: "pdf_texto" });
          } else {
            detalhes.push({
              nome: a.nome,
              tipo: a.tipo,
              enviado_como: "ignorado",
              motivo: "PDF sem texto",
            });
          }
        } catch {
          detalhes.push({
            nome: a.nome,
            tipo: a.tipo,
            enviado_como: "ignorado",
            motivo: "falha ao ler o PDF",
          });
        }
      } else if (bytes + a.dados.length > LIMITE_TOTAL_BYTES) {
        detalhes.push({
          nome: a.nome,
          tipo: a.tipo,
          enviado_como: "ignorado",
          motivo: "limite de tamanho total",
        });
      } else {
        bytes += a.dados.length;
        conteudo.push({ type: "input_text", text: `Anexo (${a.tipo}): ${a.nome}` });
        conteudo.push({
          type: "input_file",
          filename: a.nome.endsWith(".pdf") ? a.nome : `${a.nome}.pdf`,
          file_data: `data:application/pdf;base64,${base64(a.dados)}`,
        });
        detalhes.push({ nome: a.nome, tipo: a.tipo, enviado_como: "pdf_arquivo" });
      }
    } else {
      detalhes.push({
        nome: a.nome,
        tipo: a.tipo,
        enviado_como: "ignorado",
        motivo: `formato ${a.mime} não lido pela IA`,
      });
    }
  }
  return { conteudo, detalhes };
}

async function extrairTextoPdfPadrao(dados: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(dados));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Erro da API que sugere que o modelo não aceitou o PDF como arquivo. */
function recusouArquivo(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  const texto = e instanceof Error ? e.message : "";
  return status === 400 && /input_file|file_data|pdf|file/i.test(texto);
}

// ---------------------------------------------------------------- montagem

export async function montarOrcamento(
  deps: DepsMontar,
  usuarioId: string,
  orcamentoId: string,
): Promise<ResultadoMontagem> {
  const { repo, config } = deps;
  const agora = deps.agora ?? (() => new Date());
  const t0 = Date.now();

  // 1. O orçamento é da vendedora, está em rascunho e tem as obrigatórias respondidas.
  const orcamento = await repo.carregarOrcamento(orcamentoId);
  if (!orcamento || orcamento.vendedora_id !== usuarioId) {
    return falha("nao_encontrado", "Orçamento não encontrado.");
  }
  if (orcamento.status !== "rascunho") {
    return falha("nao_rascunho", "Este orçamento já não está em rascunho.");
  }
  const pendente = primeiroPassoPendente(orcamento.respostas);
  if (pendente !== null) {
    return falha(
      "respostas_incompletas",
      "Faltam respostas obrigatórias. Complete as perguntas antes de montar.",
    );
  }

  // 2. Limites (contados em uso_ia). Estourou: não chama a API.
  const ate = agora();
  const usoDoDia = await repo.contarUso({ vendedoraId: usuarioId, desde: inicioDoDiaMaceio(ate) });
  if (usoDoDia >= config.limiteDiario) {
    return falha(
      "limite_diario",
      `Você chegou ao limite de ${config.limiteDiario} montagens com IA hoje. Volte amanhã ou fale com a gerência.`,
    );
  }
  const usoDoOrcamento = await repo.contarUso({ orcamentoId });
  if (usoDoOrcamento >= config.maxGeracoesPorOrcamento) {
    return falha(
      "limite_orcamento",
      `Este orçamento já usou as ${config.maxGeracoesPorOrcamento} montagens permitidas. Ajuste os itens à mão ou crie outro orçamento.`,
    );
  }
  const limiteEmAndamento = new Date(ate.getTime() - MINUTOS_EM_ANDAMENTO * 60_000);
  if (await repo.existeEmAndamento(orcamentoId, limiteEmAndamento)) {
    return falha(
      "em_andamento",
      "Já existe uma montagem em andamento para este orçamento. Aguarde terminar.",
    );
  }

  // 3. Registra o início (conta no limite enquanto roda) e chama a IA.
  const usoId = await repo.iniciarUso({
    orcamentoId,
    vendedoraId: usuarioId,
    modelo: config.modelo,
  });
  let motor: ResultadoMotor | null = null;
  let anexosEnviados: DetalheAnexoEnviado[] = [];

  const terminarComErro = async (e: unknown): Promise<ResultadoMontagem> => {
    await repo
      .finalizarUso(usoId, {
        status: "erro",
        tokens_entrada: motor?.tokensEntrada ?? 0,
        tokens_saida: motor?.tokensSaida ?? 0,
        custo_estimado: 0,
        duracao_ms: Date.now() - t0,
        chamadas_ferramenta: motor?.chamadasFerramenta ?? 0,
        erro: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        detalhes: { anexos: anexosEnviados },
      })
      .catch(() => undefined);
    return falha("ia", mensagemAmigavelErro(e), true);
  };

  try {
    const anexos = await repo.carregarAnexos(orcamentoId);
    const extrair = deps.extrairTextoPdf ?? extrairTextoPdfPadrao;
    const textoAtendimento = montarTextoAtendimento(orcamento.respostas);

    const chamar = async (pdfComoTexto: boolean) => {
      const anexosConteudo = await conteudoDosAnexos(anexos, pdfComoTexto, extrair);
      anexosEnviados = anexosConteudo.detalhes;
      return executarMotor({
        cliente: deps.ia,
        modelo: config.modelo,
        instrucoes: INSTRUCOES_LOJA,
        conteudo: [{ type: "input_text", text: textoAtendimento }, ...anexosConteudo.conteudo],
        executor: deps.executor,
        maxRodadas: config.maxRodadasFerramentas,
        raciocinio: config.raciocinio,
        timeoutMs: config.timeoutChamadaMs,
      });
    };

    try {
      motor = await chamar(false);
    } catch (e) {
      // O modelo não aceitou o PDF como arquivo: tenta de novo mandando o texto extraído.
      if (anexos.some((a) => a.mime === "application/pdf") && recusouArquivo(e))
        motor = await chamar(true);
      else throw e;
    }

    // 4. Valida a saída e normaliza no servidor (preço sempre do catálogo).
    let saida: SaidaIA;
    try {
      saida = schemaSaidaIA.parse(JSON.parse(motor.textoFinal));
    } catch {
      throw new Error("Resposta inválida da IA (esquema).");
    }

    const catalogo = await repo.buscarProdutosPorCodigo(codigosCitados(saida));
    const normalizado = normalizarSaida(saida, catalogo);
    if (normalizado.itens.length === 0) {
      throw new Error("Resposta inválida da IA: nenhum item aproveitável.");
    }

    // 5. Grava tudo de uma vez; erro aqui não deixa itens pela metade (a função SQL é uma transação).
    const geracoes = usoDoOrcamento + 1;
    const montagem: MontagemGravada = {
      geracoes,
      pendencias: saida.pendencias,
      avisos: normalizado.avisos,
      resumo: saida.resumo_para_vendedora,
      modelo: config.modelo,
    };
    await repo.substituirItens(
      orcamentoId,
      normalizado.itens,
      centavosParaReais(normalizado.totalCentavos),
      montagem,
    );

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
        anexos: anexosEnviados,
        avisos: normalizado.avisos,
        ferramentas: motor.ferramentas,
        chamadas_api: motor.chamadasApi,
        limite_rodadas_atingido: motor.limiteRodadasAtingido,
        custo_conhecido: conhecido,
      },
    });

    return {
      ok: true,
      itens: normalizado.itens.length,
      totalCentavos: normalizado.totalCentavos,
      avisos: normalizado.avisos,
      pendencias: saida.pendencias,
      resumo: saida.resumo_para_vendedora,
      geracoes,
      geracoesRestantes: Math.max(0, config.maxGeracoesPorOrcamento - geracoes),
      custoUsd: custo,
      custoConhecido: conhecido,
      duracaoMs,
      tokensEntrada: motor.tokensEntrada,
      tokensSaida: motor.tokensSaida,
      chamadasFerramenta: motor.chamadasFerramenta,
      itensMontados: normalizado.itens,
    };
  } catch (e) {
    return terminarComErro(e);
  }
}
