/** Somente no navegador: recorta quadrado e reduz a foto do arquiteto (400 x 400, JPEG 0,8). */
import { LADO_FOTO, QUALIDADE_FOTO } from "./validacao";

export async function prepararFotoArquiteto(arquivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  const lado = Math.min(bitmap.width, bitmap.height);
  const sx = Math.round((bitmap.width - lado) / 2);
  const sy = Math.round((bitmap.height - lado) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = LADO_FOTO;
  canvas.height = LADO_FOTO;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
  ctx.drawImage(bitmap, sx, sy, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO);
  bitmap.close();

  const blob = await new Promise<Blob | null>((ok) =>
    canvas.toBlob(ok, "image/jpeg", QUALIDADE_FOTO),
  );
  if (!blob) throw new Error("jpeg");
  return blob;
}
