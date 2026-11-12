// Gera dados/exemplo-exportacao.xlsx com dados FICTÍCIOS (sem tocar no banco) para ver o visual.
import fs from "node:fs";
import { dadosSinteticos } from "../src/lib/exportacao/dados-sinteticos";
import { escreverExportacao } from "../src/lib/exportacao/planilha";

fs.mkdirSync("dados", { recursive: true });
const saida = fs.createWriteStream("dados/exemplo-exportacao.xlsx");
const fim = new Promise<void>((ok, erro) => {
  saida.on("finish", ok);
  saida.on("error", erro);
});
const t0 = Date.now();
const c = await escreverExportacao(dadosSinteticos(150, 6), saida, {
  exportadoPor: "Gerência (exemplo)",
  exportadoEm: new Date(),
  filtros: ["Todos", "Dados fictícios de exemplo"],
  incluiuTeste: false,
  gerencia: true,
});
await fim;
console.log(`dados/exemplo-exportacao.xlsx: ${JSON.stringify(c)} em ${Date.now() - t0} ms`);
