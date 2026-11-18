// Resumo do dia do piloto (só lê o banco). Uso: pnpm piloto:resumo [AAAA-MM-DD]  (padrão: hoje em Maceió)
import { createClient } from "@supabase/supabase-js";
import { formatarResumo, hojeEmMaceio, type ResumoPiloto } from "../src/lib/piloto/resumo";

const dia = process.argv[2] ?? hojeEmMaceio();
if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
  console.error("Use a data no formato AAAA-MM-DD, por exemplo: pnpm piloto:resumo 2026-11-19");
  process.exit(2);
}
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const { data, error } = await admin.rpc("resumo_piloto", { p_dia: dia });
if (error) {
  console.error(`Falhou: ${error.message}`);
  process.exit(1);
}
console.log(formatarResumo(data as unknown as ResumoPiloto));
