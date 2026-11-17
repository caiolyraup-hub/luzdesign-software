/**
 * Regra de "cliente de teste" (a mesma de `orcamento_eh_teste` no banco, dia 9): o NOME do cliente
 * começa com a palavra inteira "teste" (maiúsculas ou minúsculas, seguida de espaço, pontuação ou
 * fim do texto). Nomes que só CONTÊM ou começam com letras parecidas ("Testa", "Celeste",
 * "Contestado", "Testemunha") são clientes reais e entram nos números.
 */
export function clienteEhDeTeste(nome: string | null | undefined): boolean {
  // Sem trim: o banco também compara o nome como está (a regra tem de ser idêntica nos dois).
  return /^teste(?!\p{L})/iu.test(nome ?? "");
}

/** Nomes usados nos testes: [nome, é de teste?]. Compartilhada entre o teste unitário e o de SQL. */
export const NOMES_PARA_REGRA_DE_TESTE: [string, boolean][] = [
  ["TESTE", true],
  ["Teste", true],
  ["teste", true],
  ["TESTE Cliente A de Aline", true],
  ["teste-2", true],
  ["Teste_3", true],
  ["Teste, o cliente", true],
  ["Testa", false],
  ["Testa Ferro Construções", false],
  ["Celeste", false],
  ["Celeste Almeida", false],
  ["Contestado", false],
  ["Testemunha", false],
  ["Testeira Lima", false],
  ["Atestado Engenharia", false],
  ["João Teste Silva", false],
  ["Maria Latteste", false],
];
