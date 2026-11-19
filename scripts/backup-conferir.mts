// Confere um backup: arquivos pelo manifesto e RESTAURAÇÃO num Postgres local em memória (PGlite),
// comparando contagens e os totais dos orçamentos por status. Uso: pnpm backup:conferir <pasta>
import { readdirSync } from "node:fs";
import { conferirBackup } from "../src/lib/backup/conferir";
import { criarBancoLocal } from "../src/lib/testes/banco-local";

const pasta = process.argv[2];
if (!pasta) {
  console.error("Uso: pnpm backup:conferir dados/backups/AAAA-MM-DD-HHMM");
  process.exit(2);
}
const ultimaDoRepositorio = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.split("_")[0])
  .sort()
  .at(-1)!;
const r = await conferirBackup(pasta, criarBancoLocal, ultimaDoRepositorio);
for (const l of r.linhas) console.log(`  ${l.ok ? "ok  " : "ERRO"} ${l.texto}`);
console.log(
  r.ok ? "\nBackup conferido: restaura inteiro e os totais batem." : "\nBACKUP COM PROBLEMA.",
);
process.exit(r.ok ? 0 : 1);
