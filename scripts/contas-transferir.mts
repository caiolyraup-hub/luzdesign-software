// Go-live: passa os orçamentos do PILOTO de uma conta (a de teste) para a conta real e tudo que
// depende deles (cliente, itens, anexos, eventos, IA, comissões e caminhos do Storage), numa
// transação. HOJE SÓ EXISTE A SIMULAÇÃO: conta o que seria movido e não altera nada.
// Uso: pnpm contas:transferir --de <email da conta de teste> --para <email da conta real> --simular
import { createClient } from "@supabase/supabase-js";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
if (!process.argv.includes("--simular")) {
  console.error(
    "Só existe a simulação (--simular). A execução real será ligada no go-live, com o ok do dono.",
  );
  process.exit(2);
}
const de = arg("de");
const para = arg("para");
if (!de || !para) {
  console.error("Uso: pnpm contas:transferir --de <email teste> --para <email real> --simular");
  process.exit(2);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
async function idDe(email: string): Promise<{ id: string; nome: string }> {
  const { data } = await admin
    .from("usuarios")
    .select("id, nome")
    .ilike("email", email)
    .maybeSingle();
  if (!data) {
    console.error(`Conta não encontrada na tabela usuarios: ${email}`);
    process.exit(1);
  }
  return data;
}
const origem = await idDe(de);
const destino = await idDe(para);

const { data, error } = await admin.rpc("transferir_piloto", {
  p_de: origem.id,
  p_para: destino.id,
  p_executar: false,
});
if (error) {
  console.error(`Não foi possível simular: ${error.message}`);
  process.exit(1);
}
const r = data as {
  antes: Record<string, number>;
  depois: Record<string, number>;
  arquivos: { de: string; para: string }[];
};
console.log(`SIMULAÇÃO: ${origem.nome} (${de}) -> ${destino.nome} (${para}). Nada foi alterado.\n`);
console.log("Seria movido (contagem antes):");
for (const [k, v] of Object.entries(r.antes)) console.log(`  ${k.padEnd(28)} ${v}`);
console.log(`\nArquivos do Storage a mover (${r.arquivos.length}):`);
for (const a of r.arquivos) console.log(`  ${a.de}\n    -> ${a.para}`);
console.log(
  "\nA execução real fará: mover os arquivos no Storage, chamar transferir_piloto(executar), conferir a contagem depois e só então liberar a limpeza.",
);
