import { formatarDataBR } from "../formatar";

/** Nome de arquivo seguro para Windows, macOS e WhatsApp (sem caracteres inválidos). */
export function nomeSeguro(bruto: string, max = 80): string {
  const limpo = bruto
    .replace(/[<>:"/\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return limpo.slice(0, max).trim();
}

/** DD.MM.AA a partir de uma data ISO (fuso de Maceió). */
export function dataCurtaPontos(iso: string): string {
  const [dia, mes, ano] = formatarDataBR(iso).split("/");
  return `${dia}.${mes}.${(ano ?? "").slice(-2)}`;
}

/**
 * Nome dos arquivos baixados, no costume da loja: "NOME DO CLIENTE DD.MM.AA.pdf" (e .xlsx).
 * Se o nome do cliente não sobrar nada utilizável, usa o número do orçamento.
 */
export function nomeArquivoOrcamento(
  clienteNome: string | null | undefined,
  geradoEmIso: string | null | undefined,
  numero: string,
  extensao: "pdf" | "xlsx",
  versao?: number,
): string {
  const nome = nomeSeguro(clienteNome ?? "") || `Orcamento ${numero}`;
  const data = geradoEmIso ? ` ${dataCurtaPontos(geradoEmIso)}` : "";
  const sufixo = versao && versao > 1 ? ` v${versao}` : "";
  return `${nome}${data}${sufixo}.${extensao}`;
}
