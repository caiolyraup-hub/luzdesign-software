import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Renova a sessão do Supabase e manda quem não está logado para /login. */
export async function proxy(request: NextRequest) {
  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesParaGravar) {
          cookiesParaGravar.forEach(({ name, value }) => request.cookies.set(name, value));
          resposta = NextResponse.next({ request });
          cookiesParaGravar.forEach(({ name, value, options }) =>
            resposta.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const logada = Boolean(data?.claims);
  const emLogin = request.nextUrl.pathname === "/login";
  const comErro = request.nextUrl.searchParams.has("erro");

  if (!logada && !emLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (logada && emLogin && !comErro) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // /gerencia/*: redirect HTTP de verdade para quem não é gerente (o layout também confere,
  // mas redirect dentro de Suspense chega como 200). A barreira real continua sendo a RLS.
  if (logada && request.nextUrl.pathname.startsWith("/gerencia")) {
    const { data: perfil } = await supabase
      .from("usuarios")
      .select("perfil")
      .eq("id", data!.claims.sub)
      .maybeSingle();
    if (perfil?.perfil !== "gerente") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return resposta;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
