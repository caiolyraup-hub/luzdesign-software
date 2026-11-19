import { garantirTesteSeguro } from "../scripts/guarda-producao";

/**
 * Antes de qualquer e2e (dias 13 e 14):
 * 1. nenhuma variável pode apontar para a produção, e o SERVIDOR testado também não (um `pnpm dev`
 *    aberto antes com o .env.local seria reaproveitado): ver scripts/guarda-producao.ts;
 * 2. recusa rodar se o servidor testado chamaria a OpenAI de VERDE (custa dinheiro e grava textos no
 *    cache de descrições): NODE_ENV=production, ou servidor sem IA_SIMULADA=1.
 *    Para testes que comprovadamente não usam a IA (por exemplo, olhar o site no ar), defina
 *    E2E_SEM_IA=1.
 */
export default async function globalSetup() {
  garantirTesteSeguro();
  // Início da rodada: o teardown apaga só o que as exportações e a IA simulada gravaram a partir daqui.
  process.env.E2E_INICIO = new Date().toISOString();
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "E2E RECUSADO: NODE_ENV=production. Em produção a IA simulada fica desligada e o teste chamaria a OpenAI de verdade. Rode contra `pnpm dev` com IA_SIMULADA=1.",
    );
  }
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3210";
  let saude: { modo?: string; iaSimulada?: boolean; bancoProducao?: boolean } | null = null;
  try {
    saude = await (await fetch(`${base}/api/saude`, { cache: "no-store" })).json();
  } catch {
    // servidor ainda sem /api/saude (versão antiga): trata como não confiável
  }
  if (saude?.bancoProducao) {
    throw new Error(
      `E2E RECUSADO: o servidor ${base} está ligado ao banco de PRODUÇÃO. Pare esse servidor e deixe o Playwright subir o seu (ele usa .env.test.local).`,
    );
  }
  if (process.env.E2E_SEM_IA === "1") return;
  if (!saude?.iaSimulada) {
    throw new Error(
      `E2E RECUSADO: o servidor ${base} NÃO está com a IA simulada (modo: ${saude?.modo ?? "desconhecido"}). ` +
        "Os testes chamariam a OpenAI de verdade (custo) e gravariam no cache de descrições. " +
        "Suba `IA_SIMULADA=1 pnpm dev --port 3210`, ou defina E2E_SEM_IA=1 se este teste não usa a IA.",
    );
  }
}
