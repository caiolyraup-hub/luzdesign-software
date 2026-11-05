import "server-only";
import { DEFINICOES_FERRAMENTAS, type ExecutorFerramentas } from "./ferramentas";
import { ESQUEMA_JSON_SAIDA } from "./esquema";

/** Pedaço da Responses API que usamos. O cliente `openai` real satisfaz esta forma; nos testes, um falso. */
export interface ItemRespostaIA {
  type: string;
  [chave: string]: unknown;
}

export interface RespostaIA {
  output: ItemRespostaIA[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

export interface ClienteIA {
  responses: {
    create(
      parametros: Record<string, unknown>,
      opcoes?: { timeout?: number; signal?: AbortSignal },
    ): Promise<RespostaIA>;
  };
}

export type ConteudoEntrada =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" }
  | { type: "input_file"; filename: string; file_data: string };

export interface OpcoesMotor {
  cliente: ClienteIA;
  modelo: string;
  instrucoes: string;
  conteudo: ConteudoEntrada[];
  executor: ExecutorFerramentas;
  maxRodadas: number;
  raciocinio?: "low" | "medium" | "high" | null;
  timeoutMs?: number;
  /** Aviso em cada passo, para a tela e os logs (opcional). */
  aoProgredir?: (evento: { rodada: number; ferramenta?: string }) => void;
}

export interface ResultadoMotor {
  /** Texto JSON final (ainda não validado). */
  textoFinal: string;
  tokensEntrada: number;
  tokensSaida: number;
  chamadasFerramenta: number;
  /** Chamadas à API feitas (rodadas com ferramenta + a final). */
  chamadasApi: number;
  /** Ferramentas chamadas, com o argumento bruto, para auditoria. */
  ferramentas: { nome: string; argumentos: string }[];
  /** A IA estourou o limite de rodadas e foi forçada a responder com o que tinha. */
  limiteRodadasAtingido: boolean;
}

function textoDaResposta(r: RespostaIA): string {
  if (typeof r.output_text === "string" && r.output_text.trim()) return r.output_text;
  const partes: string[] = [];
  for (const item of r.output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content as { type?: string; text?: string }[]) {
      if (c.type === "output_text" && typeof c.text === "string") partes.push(c.text);
    }
  }
  return partes.join("").trim();
}

/**
 * Laço de ferramentas: a IA pede buscas no catálogo, o servidor executa e devolve, até ela
 * responder no formato do esquema. No máximo `maxRodadas` rodadas com ferramenta; depois disso
 * a próxima chamada vem com tool_choice "none" e a IA responde com o que já tem.
 * Nada é guardado na OpenAI (store: false); o raciocínio criptografado volta a cada rodada.
 */
export async function executarMotor(o: OpcoesMotor): Promise<ResultadoMotor> {
  let entrada: unknown[] = [{ role: "user", content: o.conteudo }];
  let tokensEntrada = 0;
  let tokensSaida = 0;
  let chamadasFerramenta = 0;
  let chamadasApi = 0;
  let rodadasComFerramenta = 0;
  const ferramentas: { nome: string; argumentos: string }[] = [];

  for (;;) {
    const forcarResposta = rodadasComFerramenta >= o.maxRodadas;
    const parametros: Record<string, unknown> = {
      model: o.modelo,
      instructions: o.instrucoes,
      input: entrada,
      tools: DEFINICOES_FERRAMENTAS,
      tool_choice: forcarResposta ? "none" : "auto",
      parallel_tool_calls: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      text: {
        format: {
          type: "json_schema",
          name: "orcamento_luz_design",
          strict: true,
          schema: ESQUEMA_JSON_SAIDA,
        },
      },
    };
    if (o.raciocinio) parametros.reasoning = { effort: o.raciocinio };

    o.aoProgredir?.({ rodada: rodadasComFerramenta });
    const resposta = await o.cliente.responses.create(parametros, { timeout: o.timeoutMs });
    chamadasApi++;
    tokensEntrada += resposta.usage?.input_tokens ?? 0;
    tokensSaida += resposta.usage?.output_tokens ?? 0;

    const pedidos = resposta.output.filter((i) => i.type === "function_call") as (ItemRespostaIA & {
      name: string;
      arguments: string;
      call_id: string;
    })[];

    if (pedidos.length === 0) {
      const textoFinal = textoDaResposta(resposta);
      if (!textoFinal) throw new Error("A IA respondeu sem conteúdo.");
      return {
        textoFinal,
        tokensEntrada,
        tokensSaida,
        chamadasFerramenta,
        chamadasApi,
        ferramentas,
        limiteRodadasAtingido: forcarResposta,
      };
    }
    if (forcarResposta)
      throw new Error("A IA continuou pedindo ferramentas depois do limite de rodadas.");

    const saidas: unknown[] = [];
    for (const p of pedidos) {
      chamadasFerramenta++;
      ferramentas.push({ nome: p.name, argumentos: p.arguments });
      o.aoProgredir?.({ rodada: rodadasComFerramenta, ferramenta: p.name });
      const resultado = await o.executor(p.name, p.arguments);
      saidas.push({
        type: "function_call_output",
        call_id: p.call_id,
        output: JSON.stringify(resultado),
      });
    }
    entrada = [...entrada, ...resposta.output, ...saidas];
    rodadasComFerramenta++;
  }
}
