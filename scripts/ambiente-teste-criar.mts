// Prepara o projeto Supabase de TESTES (`luz-design-testes`) para os testes automáticos:
// chaves em .env.test.local, todas as migrations, cadastro público fechado, as 4 contas de teste e os
// 158 produtos provisórios. Nunca toca a produção (recusa o ref de produção).
// Pré-requisito: o projeto já existir (docs/testes.md). Uso: pnpm testes:ambiente [--ref <ref>]
// Pode rodar de novo à vontade (as etapas são idempotentes).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ARQUIVO_ENV_TESTE, REF_PRODUCAO } from "./guarda-producao";

const NOME_PROJETO = "luz-design-testes";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function supabase(args: string[]): string {
  return execFileSync(npx, ["--no-install", "supabase", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}
function json(saida: string): unknown {
  const linha = saida
    .split("\n")
    .find((l) => l.trimStart().startsWith("{") || l.trimStart().startsWith("["));
  return JSON.parse(linha ?? "null");
}
function lerEnv(): Record<string, string> {
  if (!existsSync(ARQUIVO_ENV_TESTE)) return {};
  const saida: Record<string, string> = {};
  for (const linha of readFileSync(ARQUIVO_ENV_TESTE, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(linha);
    if (m) saida[m[1]] = m[2];
  }
  return saida;
}
function gravarEnv(env: Record<string, string>) {
  writeFileSync(
    ARQUIVO_ENV_TESTE,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
  );
}
const passo = (t: string) => console.log(`\n== ${t}`);

/** Acha as chaves anon e service_role numa resposta da CLI (formato antigo ou novo). */
export function extrairChaves(resposta: unknown): { anon?: string; servico?: string } {
  const lista = Array.isArray(resposta)
    ? resposta
    : ((resposta as { keys?: unknown[]; api_keys?: unknown[] })?.keys ??
      (resposta as { api_keys?: unknown[] })?.api_keys ??
      []);
  let anon: string | undefined;
  let servico: string | undefined;
  for (const k of lista as Record<string, unknown>[]) {
    const nome = String(k.name ?? k.id ?? "").toLowerCase();
    const valor = String(k.api_key ?? k.key ?? "");
    if (!valor) continue;
    if (nome === "anon" || nome.includes("publishable")) anon ??= valor;
    if (nome === "service_role" || nome.includes("secret")) servico ??= valor;
  }
  return { anon, servico };
}

// ------------------------------------------------------------------ projeto
const env = lerEnv();
const argRef = process.argv.includes("--ref")
  ? process.argv[process.argv.indexOf("--ref") + 1]
  : undefined;
passo("Procurando o projeto de testes");
let ref = argRef ?? env.SUPABASE_TESTE_REF;
if (!ref) {
  const projetos = (
    json(supabase(["projects", "list"])) as {
      projects: { ref: string; name: string; status: string }[];
    }
  ).projects;
  const achado = projetos.find((p) => p.name === NOME_PROJETO);
  if (!achado) {
    console.error(
      `Não existe projeto "${NOME_PROJETO}" nesta conta. Crie-o (docs/testes.md) e rode de novo.`,
    );
    process.exit(1);
  }
  ref = achado.ref;
}
if (ref === REF_PRODUCAO) {
  console.error("RECUSADO: esse é o projeto de PRODUÇÃO.");
  process.exit(1);
}
console.log(`projeto de testes: ${ref}`);
if (!env.SUPABASE_TESTE_DB_PASSWORD)
  env.SUPABASE_TESTE_DB_PASSWORD = randomBytes(18).toString("base64url");

// ------------------------------------------------------------------ chaves
passo("Chaves e .env.test.local");
const url = `https://${ref}.supabase.co`;
let chaves = extrairChaves(
  json(supabase(["projects", "api-keys", `--remote=${ref}`, "--reveal", "-o", "json"])),
);
if (!chaves.anon || !chaves.servico) {
  console.error(
    "Não consegui ler as chaves pela CLI. Copie anon e service_role do painel para .env.test.local.",
  );
  chaves = { anon: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, servico: env.SUPABASE_SERVICE_ROLE_KEY };
}
const senhaContas = env.SEED_SENHA_INICIAL ?? `Teste-${randomBytes(9).toString("base64url")}-1`;
const novo: Record<string, string> = {
  SUPABASE_TESTE_REF: ref,
  SUPABASE_TESTE_DB_PASSWORD: env.SUPABASE_TESTE_DB_PASSWORD,
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: chaves.anon ?? "",
  SUPABASE_SERVICE_ROLE_KEY: chaves.servico ?? "",
  // Nunca a chave da OpenAI de verdade: os testes usam a IA simulada.
  OPENAI_API_KEY: "sk-simulada-nao-use",
  OPENAI_MODEL: env.OPENAI_MODEL ?? "gpt-5.6-sol",
  IA_SIMULADA: "1",
  SEED_EMAIL_ALINE: env.SEED_EMAIL_ALINE ?? "aline.teste@example.com",
  SEED_EMAIL_KELY: env.SEED_EMAIL_KELY ?? "kely.teste@example.com",
  SEED_EMAIL_GERENCIA: env.SEED_EMAIL_GERENCIA ?? "gerencia.teste@example.com",
  SEED_EMAIL_DONO: env.SEED_EMAIL_DONO ?? "dono.teste@example.com",
  SEED_SENHA_INICIAL: senhaContas,
};
gravarEnv(novo);
if (Object.values(novo).some((v) => v.includes(REF_PRODUCAO))) {
  console.error("RECUSADO: algum valor aponta para a produção.");
  process.exit(1);
}
console.log(`${ARQUIVO_ENV_TESTE} gravado (fora do git; nenhum valor impresso).`);

// ------------------------------------------------------------------ banco
passo("Migrations");
console.log(
  supabase(["db", "push", `--remote=${ref}`, "--yes"])
    .split("\n")
    .slice(-3)
    .join("\n"),
);
passo("Cadastro público fechado");
console.log(
  supabase(["config", "push", `--remote=${ref}`, "--yes"])
    .split("\n")
    .slice(-2)
    .join("\n"),
);

function filho(script: string) {
  execFileSync(
    pnpm,
    [
      "exec",
      "tsx",
      "--tsconfig",
      "tsconfig.scripts.json",
      `--env-file=${ARQUIVO_ENV_TESTE}`,
      script,
    ],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
}
passo("Contas de teste");
filho("scripts/criar-usuarios.mts");
passo("Dados fictícios do seed (clientes e orçamentos TESTE)");
supabase(["db", "query", `--remote=${ref}`, "-f", "supabase/seed.sql"]);
console.log("seed aplicado");
passo("Catálogo provisório (158 produtos)");
filho("scripts/catalogo-provisorio.mts");

console.log("\nPronto. Confira com: pnpm env:verificar --teste");
