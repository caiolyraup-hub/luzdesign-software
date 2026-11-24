// Converte um PDF em PNG (pdf.js dentro do Chromium do Playwright). Uso: tsx scripts/_pdf_img.mts <pdf> <prefixo>
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
const [pdf, prefixo] = process.argv.slice(2);
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 900, height: 1200 } })).newPage();
await page.setContent("<html><body style='margin:0;background:#fff'><div id='p'></div></body></html>");
await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" });
const n = await page.evaluate(async (b64) => {
  // @ts-expect-error pdfjsLib vem do script
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const doc = await lib.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 1.2 });
    const cv = document.createElement("canvas");
    cv.width = vp.width; cv.height = vp.height; cv.id = `pg${i}`; cv.style.display = "block";
    document.getElementById("p")!.appendChild(cv);
    await pg.render({ canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
  }
  return doc.numPages as number;
}, readFileSync(pdf).toString("base64"));
for (let i = 1; i <= n; i++) await page.locator(`#pg${i}`).screenshot({ path: `${prefixo}-${i}.png` });
console.log(`${n} página(s)`);
await b.close();
