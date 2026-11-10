import "server-only";
import OpenAI from "openai";
import { criarClienteIASimulado } from "./ia-simulada";
import type { ClienteIA } from "./motor";

export class ErroConfiguracaoIA extends Error {
  constructor() {
    super("OPENAI_API_KEY ausente");
    this.name = "ErroConfiguracaoIA";
  }
}

/** Cliente OpenAI (só no servidor). Uma tentativa extra em falha de rede; o resto é por nossa conta. */
export function criarClienteIA(chave = process.env.OPENAI_API_KEY): ClienteIA {
  // Só para os testes ponta a ponta; nunca vale em produção (nem na Vercel).
  if (process.env.IA_SIMULADA === "1" && process.env.NODE_ENV !== "production") {
    return criarClienteIASimulado();
  }
  if (!chave) throw new ErroConfiguracaoIA();
  return new OpenAI({ apiKey: chave, maxRetries: 1 }) as unknown as ClienteIA;
}
