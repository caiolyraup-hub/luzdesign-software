// Cria (ou atualiza) as 3 contas no Supabase Auth e as linhas em public.usuarios.
// Uso: pnpm usuarios   (lê .env.local)
import { createClient } from "@supabase/supabase-js";

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável ${nome} ausente no .env.local`);
  return valor;
}

const admin = createClient(
  exigir("NEXT_PUBLIC_SUPABASE_URL"),
  exigir("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const senha = exigir("SEED_SENHA_INICIAL");
const contas = [
  { nome: "Aline", email: exigir("SEED_EMAIL_ALINE"), perfil: "vendedora" },
  { nome: "Kely", email: exigir("SEED_EMAIL_KELY"), perfil: "vendedora" },
  { nome: "Gerência", email: exigir("SEED_EMAIL_GERENCIA"), perfil: "gerente" },
] as const;

async function acharPorEmail(email: string) {
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw error;
    const achado = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (achado) return achado;
    if (data.users.length < 200) return null;
  }
}

for (const conta of contas) {
  let usuario = await acharPorEmail(conta.email);
  if (usuario) {
    console.log(`= ${conta.nome}: já existe no Auth (${conta.email})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: conta.email,
      password: senha,
      email_confirm: true,
    });
    if (error) throw error;
    usuario = data.user;
    console.log(`+ ${conta.nome}: criada no Auth (${conta.email})`);
  }

  const { error } = await admin
    .from("usuarios")
    .upsert({ id: usuario.id, nome: conta.nome, email: conta.email, perfil: conta.perfil });
  if (error) throw error;
}
console.log("Pronto.");
