// Simulação de restauração de um backup no projeto de TESTES (luz-design-testes). Só lê: mostra, tabela
// por tabela, o que entraria e o que já existe lá. A restauração real na PRODUÇÃO não existe, de
// propósito. Uso: pnpm backup:restaurar <pasta> --simular
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { TABELAS, type Manifesto } from "../src/lib/backup/nucleo";
import { prepararAmbienteDeTeste } from "./guarda-producao";

const pasta = process.argv[2];
if (!pasta || !process.argv.includes("--simular")) {
  console.error(
    "Uso: pnpm backup:restaurar <pasta> --simular. Só existe a simulação, contra o projeto de testes; restaurar na produção não existe.",
  );
  process.exit(2);
}
prepararAmbienteDeTeste(); // recusa qualquer variável que aponte para a produção
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !chave) {
  console.error("Faltam as chaves do projeto de testes em .env.test.local (pnpm testes:ambiente).");
  process.exit(1);
}
const admin = createClient(url, chave, { auth: { persistSession: false } });
const m = JSON.parse(readFileSync(path.join(pasta, "manifesto.json"), "utf8")) as Manifesto;
const { data: migracaoAlvo } = await admin.rpc("ultima_migration");

console.log(
  `SIMULAÇÃO: restaurar ${pasta} (backup de ${m.criado_em}, migration ${m.ultima_migration}) em ${new URL(url).host}. Nada será gravado.\n`,
);
console.log(
  `migration do destino: ${migracaoAlvo ?? "?"}${migracaoAlvo && m.ultima_migration && migracaoAlvo < m.ultima_migration ? "  <- ATRASADA em relação ao backup" : ""}\n`,
);
let problemas = 0;
for (const { nome } of TABELAS) {
  const { count } = await admin.from(nome).select("*", { count: "exact", head: true });
  const entra = m.tabelas[nome]?.linhas ?? 0;
  const jaTem = count ?? 0;
  if (jaTem > 0) problemas++;
  console.log(
    `  ${nome.padEnd(34)} entrariam ${String(entra).padStart(5)} · já existem ${String(jaTem).padStart(5)}${jaTem > 0 ? "  (conflito: restaurar exige destino vazio)" : ""}`,
  );
}
const arquivos = Object.entries(m.storage)
  .map(([b, i]) => `${b}: ${i.arquivos}`)
  .join(" · ");
console.log(`\nArquivos do Storage que entrariam: ${arquivos}`);
console.log(
  problemas
    ? `\n${problemas} tabela(s) do destino não estão vazias: uma restauração real começaria limpando o projeto de testes.`
    : "\nDestino vazio: a restauração entraria sem conflito.",
);
