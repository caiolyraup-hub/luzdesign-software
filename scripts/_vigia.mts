// Vigia temporário: sai quando surgir relato, erro, orçamento do piloto ou login das contas, ou às 18:00 de Maceió.
import { createClient } from "@supabase/supabase-js";

const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const hora = () => Number(new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(11, 16).replace(":", ""));
const inicio = new Date().toISOString();
let ultimoLoginVisto = "";
for (;;) {
  const { data: r } = await a.from("relatos_piloto").select("criado_em,mensagem,tela");
  const { data: e } = await a.from("erros_app").select("criado_em,origem,rota,mensagem");
  const { data: o } = await a.from("orcamentos").select("numero,status,piloto").gte("criado_em", "2026-11-19T03:00:00Z");
  const { data: u } = await a.auth.admin.listUsers({ perPage: 50 });
  const logins = (u?.users ?? [])
    .filter((x) => /\+(aline|kely)@/.test(x.email ?? "") && (x.last_sign_in_at ?? "") > inicio)
    .map((x) => `${x.email?.split("@")[0]} ${x.last_sign_in_at}`);
  const sinal = JSON.stringify({ r: r?.length, e: e?.length, o: o?.length, logins });
  if ((r?.length ?? 0) + (e?.length ?? 0) + (o?.length ?? 0) > 0 || (logins.length > 0 && sinal !== ultimoLoginVisto)) {
    console.log("NOVIDADE NO PILOTO", new Date().toISOString());
    console.log(JSON.stringify({ relatos: r, erros: e, orcamentos: o, logins }, null, 1));
    process.exit(0);
  }
  if (hora() >= 1800) {
    console.log("18:00 chegou; nada novo no piloto.");
    process.exit(0);
  }
  await new Promise((res) => setTimeout(res, 240_000));
}
