import { createBrowserClient } from "@supabase/ssr";

/** Cliente do navegador: usa só a anon key; o acesso é limitado pela RLS. */
export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
