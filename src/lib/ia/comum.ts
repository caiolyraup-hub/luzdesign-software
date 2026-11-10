import "server-only";
import type { Respostas } from "../orcamento/perguntas";
import type { ConfigIA } from "./config";
import type { ExecutorFerramentas } from "./ferramentas";
import type { ClienteIA, ConteudoEntrada } from "./motor";

// ---------------------------------------------------------------- acesso ao banco (injetado)

/** O que o servidor sabe de um produto do catálogo (relido do banco, nunca da IA). */
export interface ProdutoCatalogo {
  codigo: string;
  descricao: string;
  unidade: "un" | "m";
  preco_unitario: number;
  ativo: boolean;
  categoria?: string | null;
  /** Para saber se a descrição padronizada ainda vale. */
  atualizado_em?: string;
}

export interface OrcamentoParaIA {
  id: string;
  vendedora_id: string;
  status: string;
  /** Respostas do formulário COM o nome do cliente: só para o servidor limpar os textos antes de enviar. */
  respostas: Respostas;
}

export interface AnexoParaIA {
  id: string;
  tipo: string;
  nome: string;
  mime: string;
  dados: Uint8Array;
}

export type TipoUsoIA = "indicacao" | "formatacao";

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

/** Banco separado da lógica para testar sem Supabase. A implementação real está em repositorio-ia.ts. */
export interface RepositorioIA {
  carregarOrcamento(id: string): Promise<OrcamentoParaIA | null>;
  /** Usos que contam no limite: ok, mais os em andamento recentes. */
  contarUso(filtro: { vendedoraId: string; desde: Date }): Promise<number>;
  existeEmAndamento(orcamentoId: string, tipo: TipoUsoIA, desde: Date): Promise<boolean>;
  iniciarUso(dados: {
    orcamentoId: string;
    vendedoraId: string;
    modelo: string;
    tipo: TipoUsoIA;
  }): Promise<string>;
  finalizarUso(id: string, dados: FinalizacaoUso): Promise<void>;
  carregarAnexos(orcamentoId: string): Promise<AnexoParaIA[]>;
  buscarProdutosPorCodigo(codigos: string[]): Promise<Map<string, ProdutoCatalogo>>;
  /** Itens que já estão num ambiente (a Indicação não repete o que já foi escolhido). */
  itensDoAmbiente(
    orcamentoId: string,
    ambiente: string,
  ): Promise<{ codigo: string | null; descricao: string; quantidade: number }[]>;
  salvarIndicacao(dados: {
    orcamentoId: string;
    vendedoraId: string;
    ambiente: string;
    pedidoCliente: string | null;
    pedidoArquiteto: string | null;
    descricaoAmbiente: string | null;
    usouAnexos: boolean;
    resposta: unknown;
  }): Promise<void>;
  /** Descrições padronizadas já guardadas. */
  descricoesFormatadas(codigos: string[]): Promise<Map<string, DescricaoFormatada>>;
  salvarDescricoesFormatadas(linhas: DescricaoFormatadaNova[]): Promise<void>;
}

export interface DescricaoFormatada {
  codigo: string;
  descricao_formatada: string;
  /** A descrição do catálogo da qual a formatação saiu. */
  descricao_origem: string;
}

export interface DescricaoFormatadaNova extends DescricaoFormatada {
  origem_atualizado_em: string;
}

export interface DepsIA {
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
  "nao_encontrado" | "nao_editavel" | "entrada_invalida" | "limite_diario" | "em_andamento" | "ia";

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
  return "Não foi possível usar a IA agora.";
}

// ---------------------------------------------------------------- anexos -> entrada da IA

const MIME_IMAGEM_IA = ["image/jpeg", "image/png", "image/webp"];
const LIMITE_TOTAL_BYTES = 30 * 1024 * 1024;

const base64 = (dados: Uint8Array) => Buffer.from(dados).toString("base64");

export interface DetalheAnexoEnviado {
  id: string;
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
          id: a.id,
          nome: a.nome,
          tipo: a.tipo,
          enviado_como: "ignorado",
          motivo: "limite de tamanho total",
        });
        continue;
      }
      bytes += a.dados.length;
      conteudo.push({ type: "input_text", text: `Anexo id=${a.id} (${a.tipo}): ${a.nome}` });
      conteudo.push({
        type: "input_image",
        image_url: `data:${a.mime};base64,${base64(a.dados)}`,
        detail: "auto",
      });
      detalhes.push({ id: a.id, nome: a.nome, tipo: a.tipo, enviado_como: "imagem" });
    } else if (a.mime === "application/pdf") {
      if (pdfComoTexto) {
        try {
          const texto = (await extrairTextoPdf(a.dados)).trim().slice(0, 30_000);
          if (texto) {
            conteudo.push({
              type: "input_text",
              text: `Texto do PDF anexo id=${a.id} (${a.tipo}) ${a.nome}:\n${texto}`,
            });
            detalhes.push({ id: a.id, nome: a.nome, tipo: a.tipo, enviado_como: "pdf_texto" });
          } else {
            detalhes.push({
              id: a.id,
              nome: a.nome,
              tipo: a.tipo,
              enviado_como: "ignorado",
              motivo: "PDF sem texto",
            });
          }
        } catch {
          detalhes.push({
            id: a.id,
            nome: a.nome,
            tipo: a.tipo,
            enviado_como: "ignorado",
            motivo: "falha ao ler o PDF",
          });
        }
      } else if (bytes + a.dados.length > LIMITE_TOTAL_BYTES) {
        detalhes.push({
          id: a.id,
          nome: a.nome,
          tipo: a.tipo,
          enviado_como: "ignorado",
          motivo: "limite de tamanho total",
        });
      } else {
        bytes += a.dados.length;
        conteudo.push({ type: "input_text", text: `Anexo id=${a.id} (${a.tipo}): ${a.nome}` });
        conteudo.push({
          type: "input_file",
          filename: a.nome.endsWith(".pdf") ? a.nome : `${a.nome}.pdf`,
          file_data: `data:application/pdf;base64,${base64(a.dados)}`,
        });
        detalhes.push({ id: a.id, nome: a.nome, tipo: a.tipo, enviado_como: "pdf_arquivo" });
      }
    } else {
      detalhes.push({
        id: a.id,
        nome: a.nome,
        tipo: a.tipo,
        enviado_como: "ignorado",
        motivo: `formato ${a.mime} não lido pela IA`,
      });
    }
  }
  return { conteudo, detalhes };
}

export async function extrairTextoPdfPadrao(dados: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(dados));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Erro da API que sugere que o modelo não aceitou o PDF como arquivo. */
export function recusouArquivo(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  const texto = e instanceof Error ? e.message : "";
  return status === 400 && /input_file|file_data|pdf|file/i.test(texto);
}
