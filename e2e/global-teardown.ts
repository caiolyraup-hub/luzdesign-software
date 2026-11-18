import { createClient } from "@supabase/supabase-js";

/**
 * Fim da rodada de e2e: apaga os rastros que os testes deixam fora das tabelas de orçamento (cada
 * exportação é registrada em eventos_exportacao; a IA simulada registra uso_ia sem orçamento). Só
 * mexe no que foi criado DEPOIS do início da rodada (E2E_INICIO, definido no global-setup).
 */
export default async function globalTeardown() {
  const desde = process.env.E2E_INICIO;
  if (!desde || process.env.E2E_BASE_URL?.includes("vercel.app")) return;
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  await admin.from("eventos_exportacao").delete().gte("criado_em", desde);
  await admin.from("uso_ia").delete().gte("criado_em", desde).is("orcamento_id", null);
}
