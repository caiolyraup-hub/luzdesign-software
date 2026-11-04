import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente com service role: ignora a RLS. Só para código de servidor que realmente
 * precise (ex.: gravar uso_ia, sync_estoque). Nunca usar para montar telas.
 */
export function criarClienteAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
