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
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
