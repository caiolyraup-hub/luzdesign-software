// Compara o que está no ar com o repositório: commit da rota /api/saude x HEAD local, e a última
// migration aplicada no banco x as migrations do repositório. Uso: pnpm deploy:conferir
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

const URL_SITE = process.env.SITE_URL ?? "https://luzdesign-software.vercel.app";
const head = execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
const sujo = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
const noRemoto = execSync("git rev-parse --short=7 @{u}", { encoding: "utf8" }).trim();
const locais = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.split("_")[0])
  .sort();

let falhas = 0;
const ver = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "ok  " : "ERRO"} ${msg}`);
  if (!ok) falhas++;
};

console.log(
  `\nRepositório: HEAD ${head}${sujo ? " (com alterações não commitadas)" : ""}; origin ${noRemoto}`,
);
ver(head === noRemoto, "HEAD local está enviado ao GitHub");

let saude: { ok: boolean; commit: string; build: string | null; migration: string | null } | null =
  null;
try {
  const r = await fetch(`${URL_SITE}/api/saude`, { cache: "no-store" });
  saude = r.ok ? await r.json() : null;
  if (!saude) console.log(`  /api/saude respondeu ${r.status}`);
} catch (e) {
  console.log(`  não consegui abrir ${URL_SITE}/api/saude: ${(e as Error).message}`);
}
console.log(
  `No ar (${URL_SITE}): ${saude ? `commit ${saude.commit}, build ${saude.build}, migration ${saude.migration}` : "sem resposta"}`,
);
ver(Boolean(saude?.ok), "rota /api/saude responde ok");
ver(saude?.commit === head, `commit no ar = HEAD local (${saude?.commit ?? "?"} x ${head})`);

const ultimaLocal = locais[locais.length - 1];
ver(
  saude?.migration === ultimaLocal,
  `última migration no ar = última do repositório (${saude?.migration ?? "?"} x ${ultimaLocal})`,
);

try {
  const saida = execSync("npx --no-install supabase migration list --remote", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const json = JSON.parse(saida.split("\n").find((l) => l.startsWith("{")) ?? "{}") as {
    migrations?: { local: string; remote: string }[];
  };
  const pendentes = (json.migrations ?? []).filter((m) => m.local && !m.remote).map((m) => m.local);
  const soRemoto = (json.migrations ?? []).filter((m) => !m.local && m.remote).map((m) => m.remote);
  ver(
    pendentes.length === 0,
    `todas as migrations do repositório estão aplicadas${pendentes.length ? ` (faltam: ${pendentes.join(", ")})` : ""}`,
  );
  ver(
    soRemoto.length === 0,
    `nenhuma migration só no banco${soRemoto.length ? ` (${soRemoto.join(", ")})` : ""}`,
  );
} catch (e) {
  ver(false, `supabase migration list --remote falhou: ${(e as Error).message.split("\n")[0]}`);
}

console.log(
  falhas
    ? `\n${falhas} divergência(s).`
    : "\nTudo conferido: o que está no ar é o que está no repositório.",
);
process.exit(falhas ? 1 : 0);
