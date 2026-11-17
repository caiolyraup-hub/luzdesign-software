/**
 * Mensagem de erro segura para gravar: sem e-mails, sem números longos (telefone, CPF, CNPJ) e com
 * tamanho limitado. Erros de tela nunca carregam dado do cliente.
 */
export function limparMensagemErro(bruta: unknown): string {
  const texto =
    bruta instanceof Error ? `${bruta.name}: ${bruta.message}` : String(bruta ?? "erro");
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/\+?\(?\d[\d\s()./-]{6,}\d/g, "[número]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

/** Só o caminho, sem a query string (que pode ter nome de cliente em filtros). */
export function limparRota(rota: string | null | undefined): string | null {
  if (!rota) return null;
  return rota.split("?")[0].slice(0, 200);
}
