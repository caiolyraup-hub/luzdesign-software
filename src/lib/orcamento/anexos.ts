import { MAX_BYTES_ANEXO, MIME_ANEXO_ACEITOS, TIPOS_ANEXO, type TipoAnexo } from "./perguntas";

const EXTENSAO_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export function extensaoDoMime(mime: string): string | null {
  return EXTENSAO_POR_MIME[mime] ?? null;
}

export function ehTipoAnexo(valor: unknown): valor is TipoAnexo {
  return typeof valor === "string" && (TIPOS_ANEXO as readonly string[]).includes(valor);
}

/** Erro de validação de um arquivo que a vendedora quer enviar; null se está ok. */
export function validarArquivoAnexo(arquivo: { mime: string; tamanho: number }): string | null {
  if (!MIME_ANEXO_ACEITOS.includes(arquivo.mime)) {
    return "Tipo de arquivo não aceito. Use JPG, PNG, WEBP, HEIC ou PDF.";
  }
  if (arquivo.tamanho <= 0) return "O arquivo está vazio.";
  if (arquivo.tamanho > MAX_BYTES_ANEXO) return "O arquivo passa de 10 MB.";
  return null;
}

/** Tipo sugerido pelo formato do arquivo; a vendedora pode trocar com um toque. */
export function tipoSugerido(mime: string): TipoAnexo {
  return mime === "application/pdf" ? "pdf" : "foto";
}

/** PDF só pode ser "pdf" ou "planta"; imagem pode ser foto, planta ou print. */
export function tiposPermitidos(mime: string): TipoAnexo[] {
  return mime === "application/pdf" ? ["pdf", "planta"] : ["foto", "planta", "print"];
}

/** O caminho de um anexo deve ser {vendedora_id}/{orcamento_id}/{uuid}.{ext}. */
export function caminhoValido(caminho: string, vendedoraId: string, orcamentoId: string): boolean {
  const prefixo = `${vendedoraId}/${orcamentoId}/`;
  if (!caminho.startsWith(prefixo)) return false;
  return /^[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf)$/.test(caminho.slice(prefixo.length));
}
