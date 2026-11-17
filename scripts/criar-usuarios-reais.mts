// Contas REAIS do piloto/go-live. Lê REAL_EMAIL_ALINE, REAL_EMAIL_KELY, REAL_EMAIL_GERENCIA e
// REAL_EMAIL_DONO do .env.local, gera uma senha provisória DIFERENTE por pessoa e a mostra UMA vez só
// no terminal. Cada conta nasce com "trocar a senha no primeiro login" (o sistema leva para
// /trocar-senha antes de qualquer tela).
//
// Seguro por padrão: sem --criar, só mostra o que faria (sem senhas, sem tocar no banco).
// Uso: pnpm usuarios:reais            (simulação)
//      pnpm usuarios:reais --criar    (cria no Supabase configurado no .env.local)
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável ${nome} ausente no .env.local`);
  return v;
}
const SEM_AMBIGUOS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function senhaProvisoria(): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += SEM_AMBIGUOS[randomInt(SEM_AMBIGUOS.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

const contas = [
  { nome: "Aline", var: "REAL_EMAIL_ALINE", perfil: "vendedora" },
  { nome: "Kely", var: "REAL_EMAIL_KELY", perfil: "vendedora" },
  { nome: "Gerência", var: "REAL_EMAIL_GERENCIA", perfil: "gerente" },
  { nome: "Seu Filipe", var: "REAL_EMAIL_DONO", perfil: "dono" },
] as const;

const criar = process.argv.includes("--criar");
const faltando = contas.filter((c) => !process.env[c.var]).map((c) => c.var);
if (faltando.length) {
  console.error(`Preencha no .env.local: ${faltando.join(", ")}`);
  process.exit(1);
}
const emails = contas.map((c) => process.env[c.var]!.trim().toLowerCase());
if (new Set(emails).size !== emails.length) {
  console.error("Os e-mails reais precisam ser todos diferentes.");
  process.exit(1);
}
if (emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
  console.error("Algum e-mail em REAL_EMAIL_* é inválido.");
  process.exit(1);
}

const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
console.log(`Projeto: ${url}`);
if (!criar) {
  console.log("\nSIMULAÇÃO (nada foi criado). Faria:");
  contas.forEach((c, i) =>
    console.log(
      `  ${c.nome} (${c.perfil}) <${emails[i]}> com senha provisória própria e troca obrigatória`,
    ),
  );
  console.log("\nPara criar de verdade: pnpm usuarios:reais --criar");
  process.exit(0);
}

const admin = createClient(url, exigir("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});
async function acharPorEmail(email: string) {
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw error;
    const achado = data.users.find((u) => u.email?.toLowerCase() === email);
    if (achado) return achado;
    if (data.users.length < 200) return null;
  }
}

const entregas: { nome: string; email: string; senha: string }[] = [];
for (const [i, conta] of contas.entries()) {
  const email = emails[i];
  if (await acharPorEmail(email)) {
    console.log(`= ${conta.nome}: já existe (${email}); não foi alterada.`);
    continue;
  }
  const senha = senhaProvisoria();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { trocar_senha: true },
  });
  if (error || !data.user) throw error ?? new Error("falha ao criar");
  const up = await admin
    .from("usuarios")
    .upsert({ id: data.user.id, nome: conta.nome, email, perfil: conta.perfil });
  if (up.error) throw up.error;
  entregas.push({ nome: conta.nome, email, senha });
}

console.log(
  "\n=== SENHAS PROVISÓRIAS (aparecem só agora; cada pessoa troca no primeiro login) ===",
);
for (const e of entregas) console.log(`${e.nome.padEnd(11)} ${e.email.padEnd(34)} ${e.senha}`);
if (entregas.length === 0) console.log("(nenhuma conta nova)");
