/** Regras da senha nova (primeiro login). Pura: usada na tela, na ação do servidor e nos testes. */
export const MIN_SENHA = 10;

export function validarSenhaNova(nova: string, confirmacao: string): string | null {
  if (nova.length < MIN_SENHA) return `Use pelo menos ${MIN_SENHA} caracteres.`;
  if (nova.length > 72) return "Use no máximo 72 caracteres.";
  if (!/[A-Za-zÀ-ÿ]/.test(nova) || !/\d/.test(nova)) return "Misture letras e números.";
  if (/^(.)\1+$/.test(nova)) return "Escolha uma senha menos óbvia.";
  if (nova !== confirmacao) return "As duas senhas precisam ser iguais.";
  return null;
}
