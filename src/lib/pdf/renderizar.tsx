import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Font, renderToBuffer } from "@react-pdf/renderer";
import type { DadosPdf } from "./dados";
import { DocumentoOrcamento, type LogoPdf } from "./documento";

// Sem hifenização automática: palavras de produto ("EMBUTIDO", códigos) nunca são cortadas.
Font.registerHyphenationCallback((palavra) => [palavra]);

/** Logo em public/marca (PNG ou JPG). Sem logo, o PDF usa o nome da loja escrito. SVG não é lido pelo PDF. */
export async function carregarLogo(): Promise<LogoPdf | null> {
  // Caminhos literais de propósito: assim o rastreio da Vercel inclui só public/marca (ver next.config.ts).
  const raiz = process.cwd();
  try {
    return { data: await readFile(path.join(raiz, "public", "marca", "logo.png")), format: "png" };
  } catch {
    // tenta JPG
  }
  try {
    return { data: await readFile(path.join(raiz, "public", "marca", "logo.jpg")), format: "jpg" };
  } catch {
    return null;
  }
}

/** Gera o PDF (A4) e devolve os bytes. Roda em função serverless (sem navegador). */
export async function renderizarPdf(dados: DadosPdf, logo?: LogoPdf | null): Promise<Buffer> {
  const logoFinal = logo === undefined ? await carregarLogo() : logo;
  return renderToBuffer(<DocumentoOrcamento dados={dados} logo={logoFinal} />);
}
