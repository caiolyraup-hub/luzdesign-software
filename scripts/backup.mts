// Backup do banco e do Storage da PRODUÇÃO, sem Docker e sem pg_dump (só leitura).
// Uso: pnpm backup   ->  dados/backups/AAAA-MM-DD-HHMM/ (fora do git)
// Rode fora do horário de uso (depois das 18h durante o piloto). Depois: pnpm backup:conferir <pasta>
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { fonteSupabase } from "../src/lib/backup/fonte-supabase";
import { fazerBackup } from "../src/lib/backup/nucleo";

const agora = new Date(Date.now() - 3 * 3600 * 1000).toISOString(); // Maceió = UTC-3
const carimbo = `${agora.slice(0, 10)}-${agora.slice(11, 13)}${agora.slice(14, 16)}`;
const pasta = `dados/backups/${carimbo}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const commit = (() => {
  try {
    return execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "?";
  }
})();

console.log(`Backup de ${new URL(url).host} em ${pasta} ...`);
const m = await fazerBackup({
  fonte: fonteSupabase(admin),
  pasta,
  projeto: new URL(url).host.split(".")[0],
  commit,
  aoProgredir: (t) => console.log(t),
});
const linhas = Object.values(m.tabelas).reduce((s, t) => s + t.linhas, 0);
const arquivos = Object.values(m.storage).reduce((s, b) => s + b.arquivos, 0);
console.log(
  `\nPronto: ${Object.keys(m.tabelas).length} tabelas (${linhas} linhas), ${arquivos} arquivo(s) no Storage.`,
);
console.log(`Manifesto: ${pasta}/manifesto.json`);
console.log(`Confira com: pnpm backup:conferir ${pasta}`);
