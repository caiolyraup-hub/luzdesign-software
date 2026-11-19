/**
 * Trava dos testes contra a PRODUÇÃO (dia 14). Os testes (e2e, test:rls, matriz) rodam SOMENTE no
 * projeto Supabase `luz-design-testes`, com as chaves de `.env.test.local`. Se qualquer variável de
 * ambiente tiver, em qualquer parte do valor, o ref do projeto de produção, o teste falha logo no
 * começo, qualquer que seja o nome da variável. Não existe mais variável para liberar (o antigo
 * PERMITIR_TESTE_EM_PRODUCAO foi removido).
 */
export const REF_PRODUCAO = "xdrubtojofckgxilkttm";
export const ARQUIVO_ENV_TESTE = ".env.test.local";

/** Nomes das variáveis cujo valor contém o ref de produção (só os nomes: nunca imprime valor). */
export function variaveisComProducao(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return Object.entries(env)
    .filter(([, v]) => typeof v === "string" && v.includes(REF_PRODUCAO))
    .map(([nome]) => nome)
    .sort();
}

export function bancoEhProducao(url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): boolean {
  return url.includes(REF_PRODUCAO);
}

/** Lança se qualquer variável apontar para a produção. */
export function garantirTesteSeguro(env: Record<string, string | undefined> = process.env): void {
  const achadas = variaveisComProducao(env);
  if (achadas.length === 0) return;
  throw new Error(
    `TESTE RECUSADO: a variável ${achadas.join(", ")} aponta para o banco de PRODUÇÃO (${REF_PRODUCAO}). ` +
      `Os testes rodam só no projeto luz-design-testes, com as chaves de ${ARQUIVO_ENV_TESTE}. ` +
      "Não use .env.local nem exporte variáveis de produção ao rodar testes (ver docs/testes.md).",
  );
}

/** Carrega `.env.test.local` (e só ele) e confere a trava. Falha com instrução se o arquivo não existe. */
export function prepararAmbienteDeTeste(): void {
  try {
    process.loadEnvFile(ARQUIVO_ENV_TESTE);
  } catch {
    throw new Error(
      `TESTE RECUSADO: falta o arquivo ${ARQUIVO_ENV_TESTE} (chaves do projeto luz-design-testes). ` +
        "Crie o projeto de testes e rode `pnpm testes:ambiente` (ver docs/testes.md).",
    );
  }
  garantirTesteSeguro();
}
