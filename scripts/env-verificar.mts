// Valida o .env.local (ou, com --teste, o .env.test.local do projeto luz-design-testes) sem imprimir
// valores: variáveis obrigatórias presentes e cada linha no formato que a CLI do Supabase e o Next
// aceitam. Com --teste, nada pode apontar para a produção. Uso: pnpm env:verificar [--teste]
import { readFileSync } from "node:fs";
import { REF_PRODUCAO } from "./guarda-producao";

const TESTE = process.argv.includes("--teste");
const ARQUIVO = TESTE ? ".env.test.local" : ".env.local";

const OBRIGATORIAS_TESTE = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_TESTE_REF",
  "SUPABASE_TESTE_DB_PASSWORD",
  "OPENAI_API_KEY",
  "IA_SIMULADA",
  "SEED_EMAIL_ALINE",
  "SEED_EMAIL_KELY",
  "SEED_EMAIL_GERENCIA",
  "SEED_EMAIL_DONO",
  "SEED_SENHA_INICIAL",
];
const OBRIGATORIAS_PRODUCAO = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "SEED_EMAIL_ALINE",
  "SEED_EMAIL_KELY",
  "SEED_EMAIL_GERENCIA",
  "SEED_EMAIL_DONO",
  "SEED_SENHA_INICIAL",
];
const OBRIGATORIAS = TESTE ? OBRIGATORIAS_TESTE : OBRIGATORIAS_PRODUCAO;
const OPCIONAIS_PILOTO = TESTE
  ? []
  : ["REAL_EMAIL_ALINE", "REAL_EMAIL_KELY", "REAL_EMAIL_GERENCIA", "REAL_EMAIL_DONO"];

let texto: string;
try {
  texto = readFileSync(ARQUIVO, "utf8");
} catch {
  console.error(
    `  ERRO: ${ARQUIVO} não existe.${TESTE ? " Crie o projeto luz-design-testes e rode pnpm testes:ambiente (docs/testes.md)." : ""}`,
  );
  process.exit(1);
}
if (TESTE && texto.includes(REF_PRODUCAO))
  console.error(
    `  ERRO: ${ARQUIVO} contém o ref do projeto de PRODUÇÃO. Os testes só podem usar o luz-design-testes.`,
  );
const problemas: string[] = [];
const avisos: string[] = [];
const vistas = new Map<string, number>();

texto.split(/\r?\n/).forEach((linha, i) => {
  const n = i + 1;
  if (linha.trim() === "" || linha.trimStart().startsWith("#")) return;
  if (/^\s*export\s/.test(linha)) {
    problemas.push(`linha ${n}: remova "export" (a CLI do Supabase não aceita).`);
    return;
  }
  const m = /^([^=]*)=(.*)$/.exec(linha);
  if (!m) {
    problemas.push(`linha ${n}: falta o "=".`);
    return;
  }
  const [, nome, valor] = m;
  // A CLI só aceita letras, números e "_" no nome (um "-" derruba a leitura do arquivo inteiro).
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome))
    problemas.push(`linha ${n}: nome de variável inválido "${nome}" (use só letras, números e _).`);
  if (/^\s|\s$/.test(nome)) problemas.push(`linha ${n}: espaço ao redor do nome "${nome.trim()}".`);
  if (/^\s+\S/.test(valor)) avisos.push(`linha ${n} (${nome}): espaço depois do "=".`);
  const aspas = valor.trim()[0];
  if ((aspas === '"' || aspas === "'") && !valor.trim().endsWith(aspas))
    problemas.push(`linha ${n} (${nome}): aspas não fechadas.`);
  if (!/^["']/.test(valor.trim()) && /\s#/.test(valor))
    avisos.push(`linha ${n} (${nome}): " #" no valor vira comentário; use aspas.`);
  vistas.set(nome.trim(), (vistas.get(nome.trim()) ?? 0) + (valor.trim() === "" ? 0 : 1));
});

if (TESTE && texto.includes(REF_PRODUCAO)) problemas.push("aponta para a produção");
for (const nome of OBRIGATORIAS)
  if (!vistas.get(nome)) problemas.push(`variável obrigatória ausente ou vazia: ${nome}`);
for (const nome of OPCIONAIS_PILOTO)
  if (!vistas.get(nome))
    avisos.push(`para as contas reais (pnpm usuarios:reais) preencha: ${nome}`);
for (const [nome, n] of vistas) if (n > 1) avisos.push(`variável repetida: ${nome}`);

for (const a of avisos) console.log(`  aviso: ${a}`);
for (const p of problemas) console.error(`  ERRO: ${p}`);
if (problemas.length) {
  console.error(`\n${ARQUIVO} com ${problemas.length} problema(s).`);
  process.exit(1);
}
console.log(`${ARQUIVO} ok (${vistas.size} variáveis; nenhum valor foi impresso).`);
