// Gera dados/guia-vendedora.pdf (1 a 2 páginas, visual cobre da loja) a partir de docs/guia-vendedora.md.
// Reduz a letra aos poucos até caber em no máximo 2 páginas. Uso: pnpm guia:pdf
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { lerGuiaMarkdown, renderizarGuia } from "../src/lib/pdf/guia";

const blocos = lerGuiaMarkdown(readFileSync("docs/guia-vendedora.md", "utf8"));
const logo = existsSync("public/marca/logo.png")
  ? { data: readFileSync("public/marca/logo.png"), format: "png" as const }
  : existsSync("public/marca/logo.jpg")
    ? { data: readFileSync("public/marca/logo.jpg"), format: "jpg" as const }
    : null;

for (const tamanho of [10, 9.5, 9, 8.5, 8]) {
  const pdf = await renderizarGuia(blocos, logo, tamanho);
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { totalPages, text } = await extractText(doc, { mergePages: true });
  if (totalPages <= 2) {
    mkdirSync("dados", { recursive: true });
    writeFileSync("dados/guia-vendedora.pdf", pdf);
    console.log(
      `dados/guia-vendedora.pdf: ${totalPages} página(s), letra ${tamanho} pt, ${(pdf.length / 1024).toFixed(0)} KB`,
    );
    console.log(`texto extraído: ${text.replace(/\s+/g, " ").length} caracteres`);
    process.exit(0);
  }
  console.log(`letra ${tamanho} pt: ${totalPages} páginas, reduzindo...`);
}
console.error("Não coube em 2 páginas mesmo com letra 8 pt: encurte o guia.");
process.exit(1);
