import "server-only";
import OpenAI from "openai";
import type { ClienteIA } from "./motor";

export class ErroConfiguracaoIA extends Error {
  constructor() {
    super("OPENAI_API_KEY ausente");
    this.name = "ErroConfiguracaoIA";
  }
}

/** Cliente OpenAI (só no servidor). Uma tentativa extra em falha de rede; o resto é por nossa conta. */
export function criarClienteIA(chave = process.env.OPENAI_API_KEY): ClienteIA {
  if (!chave) throw new ErroConfiguracaoIA();
  return new OpenAI({ apiKey: chave, maxRetries: 1 }) as unknown as ClienteIA;
}
