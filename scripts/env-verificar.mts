// Valida o .env.local sem imprimir valores: variáveis obrigatórias presentes e cada linha no formato
// que a CLI do Supabase e o Next aceitam. Uso: pnpm env:verificar
import { readFileSync } from "node:fs";

const OBRIGATORIAS = [
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
const OPCIONAIS_PILOTO = [
  "REAL_EMAIL_ALINE",
  "REAL_EMAIL_KELY",
  "REAL_EMAIL_GERENCIA",
  "REAL_EMAIL_DONO",
];

const texto = readFileSync(".env.local", "utf8");
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

for (const nome of OBRIGATORIAS)
  if (!vistas.get(nome)) problemas.push(`variável obrigatória ausente ou vazia: ${nome}`);
for (const nome of OPCIONAIS_PILOTO)
  if (!vistas.get(nome))
    avisos.push(`para as contas reais (pnpm usuarios:reais) preencha: ${nome}`);
for (const [nome, n] of vistas) if (n > 1) avisos.push(`variável repetida: ${nome}`);

for (const a of avisos) console.log(`  aviso: ${a}`);
for (const p of problemas) console.error(`  ERRO: ${p}`);
if (problemas.length) {
  console.error(`\n.env.local com ${problemas.length} problema(s).`);
  process.exit(1);
}
console.log(`.env.local ok (${vistas.size} variáveis; nenhum valor foi impresso).`);
