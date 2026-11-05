/** Somente no navegador: reduz fotos antes do envio. */

export const LADO_MAXIMO = 2000;
export const QUALIDADE_JPEG = 0.8;

export interface ArquivoPronto {
  blob: Blob;
  mime: string;
}

/** Alguns navegadores deixam o tipo vazio em HEIC; a extensão resolve. */
export function mimeDoArquivo(arquivo: File): string {
  if (arquivo.type) return arquivo.type;
  const ext = arquivo.name.split(".").pop()?.toLowerCase();
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "";
}

/**
 * Imagens: lado maior até 2000 px, JPEG com qualidade 0,8 (HEIC vira JPEG quando o navegador sabe
 * ler). Se não der para decodificar, o arquivo original segue como está. PDF segue como está.
 */
export async function prepararArquivo(arquivo: File): Promise<ArquivoPronto> {
  const mime = mimeDoArquivo(arquivo);
  if (!mime.startsWith("image/")) return { blob: arquivo, mime };

  try {
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));

    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#ffffff"; // PNG com transparência vira JPEG sobre branco
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();

    const blob = await new Promise<Blob | null>((ok) =>
      canvas.toBlob(ok, "image/jpeg", QUALIDADE_JPEG),
    );
    if (!blob) throw new Error("toBlob");
    return { blob, mime: "image/jpeg" };
  } catch {
    return { blob: arquivo, mime };
  }
}
