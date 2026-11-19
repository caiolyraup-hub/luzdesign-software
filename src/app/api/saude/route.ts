import { connection } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Saúde e versão no ar. Pública e SEM dado sensível: commit curto, data do build, última migration
 * aplicada e `ok`. Serve ao `pnpm deploy:conferir` (compara com o HEAD local e com o repositório).
 */
export async function GET() {
  await connection();
  let migration: string | null = null;
  let ok = true;
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase.rpc("ultima_migration");
    if (error) ok = false;
    else migration = (data as string | null) ?? null;
  } catch {
    ok = false;
  }
  return Response.json(
    {
      ok,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
      build: process.env.BUILD_DATA ?? null,
      migration,
      // Para os testes recusarem servidor que chamaria a OpenAI de verdade.
      modo: process.env.NODE_ENV,
      // Os e2e recusam um servidor ligado ao banco de produção (scripts/guarda-producao.ts).
      bancoProducao: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("xdrubtojofckgxilkttm"),
      iaSimulada: process.env.IA_SIMULADA === "1" && process.env.NODE_ENV !== "production",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
