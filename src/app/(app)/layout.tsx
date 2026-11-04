import { Suspense } from "react";
import { BarraNavegacao } from "@/components/BarraNavegacao";
import { sair } from "@/lib/acoes-sessao";
import { obterUsuarioAtual } from "@/lib/sessao";

async function Moldura({ children }: { children: React.ReactNode }) {
  const usuario = await obterUsuarioAtual();
  return (
    <>
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2">
          <span className="text-base font-medium">{usuario.nome}</span>
          <form action={sair}>
            <button type="submit" className="min-h-11 px-3 text-base text-amber-700 underline">
              Sair
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">{children}</main>
      <BarraNavegacao perfil={usuario.perfil} />
    </>
  );
}

export default function LayoutApp({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<p className="px-4 pt-6 text-base">Carregando...</p>}>
      <Moldura>{children}</Moldura>
    </Suspense>
  );
}
