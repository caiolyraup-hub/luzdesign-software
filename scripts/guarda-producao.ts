/**
 * Trava dos testes contra a PRODUÇÃO (dia 13). Os testes (e2e e test:rls) usam o `.env.local`, que
 * aponta para o mesmo Supabase do sistema. Até 18/11 isso é aceitável (ainda não há dado real). A
 * partir do início do piloto (19/11/2026, 00:00 em Maceió) cada teste recusa rodar, a não ser que
 * `PERMITIR_TESTE_EM_PRODUCAO=1` esteja definido de propósito, para ninguém sujar o banco ou o
 * cache enquanto a Aline e a Kely usam o sistema.
 */
export const REF_PRODUCAO = "xdrubtojofckgxilkttm";
export const INICIO_DO_PILOTO = new Date("2026-11-19T00:00:00-03:00");

export function bancoEhProducao(url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): boolean {
  return url.includes(REF_PRODUCAO);
}

export function garantirTesteSeguro(agora: Date = new Date()): void {
  if (!bancoEhProducao()) return;
  if (agora < INICIO_DO_PILOTO) return;
  if (process.env.PERMITIR_TESTE_EM_PRODUCAO === "1") return;
  throw new Error(
    "TESTE RECUSADO: o piloto já começou e este teste gravaria no banco de PRODUÇÃO (dados reais da loja). " +
      "Rode os testes contra um banco de testes ou, se for mesmo necessário e você sabe o que apaga, " +
      "defina PERMITIR_TESTE_EM_PRODUCAO=1.",
  );
}
