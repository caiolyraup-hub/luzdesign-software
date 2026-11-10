import "server-only";

export interface ConfigIA {
  modelo: string;
  /** Montagens por vendedora por dia (fuso de Maceió). */
  limiteDiario: number;
  /** Montagens bem-sucedidas por orçamento. */
  maxGeracoesPorOrcamento: number;
  /** Rodadas de ferramentas por montagem; depois disso a IA tem de responder com o que tem. */
  maxRodadasFerramentas: number;
  /** US$ por milhão de tokens, para estimar custo. Sem valor, o custo estimado fica 0. */
  precoEntradaUsdMtok: number | null;
  precoSaidaUsdMtok: number | null;
  /** Esforço de raciocínio (opcional): low, medium ou high. */
  raciocinio: "low" | "medium" | "high" | null;
  /** Tempo máximo de cada chamada à API, em ms. */
  timeoutChamadaMs: number;
}

export const MODELO_PADRAO = "gpt-5.6-sol";

function inteiroPositivo(bruto: string | undefined, padrao: number): number {
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : padrao;
}

function numeroOpcional(bruto: string | undefined): number | null {
  if (bruto === undefined || bruto.trim() === "") return null;
  const n = Number(bruto.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Lê as variáveis de ambiente (sem a chave; ela só é lida ao criar o cliente). */
export function lerConfigIA(env: Record<string, string | undefined> = process.env): ConfigIA {
  const raciocinio = env.IA_RACIOCINIO;
  return {
    modelo: env.OPENAI_MODEL?.trim() || MODELO_PADRAO,
    limiteDiario: inteiroPositivo(env.IA_LIMITE_DIARIO_VENDEDORA, 20),
    maxGeracoesPorOrcamento: inteiroPositivo(env.IA_MAX_GERACOES_POR_ORCAMENTO, 3),
    maxRodadasFerramentas: 8,
    precoEntradaUsdMtok: numeroOpcional(env.IA_PRECO_ENTRADA_USD_MTOK),
    precoSaidaUsdMtok: numeroOpcional(env.IA_PRECO_SAIDA_USD_MTOK),
    raciocinio:
      raciocinio === "low" || raciocinio === "medium" || raciocinio === "high" ? raciocinio : null,
    timeoutChamadaMs: 120_000,
  };
}

/** Custo estimado em US$ (0 se os preços por milhão de tokens não foram informados). */
export function estimarCustoUsd(
  config: Pick<ConfigIA, "precoEntradaUsdMtok" | "precoSaidaUsdMtok">,
  tokensEntrada: number,
  tokensSaida: number,
): { custo: number; conhecido: boolean } {
  if (config.precoEntradaUsdMtok === null || config.precoSaidaUsdMtok === null) {
    return { custo: 0, conhecido: false };
  }
  const custo =
    (tokensEntrada * config.precoEntradaUsdMtok + tokensSaida * config.precoSaidaUsdMtok) /
    1_000_000;
  return { custo: Math.round(custo * 10_000) / 10_000, conhecido: true };
}
