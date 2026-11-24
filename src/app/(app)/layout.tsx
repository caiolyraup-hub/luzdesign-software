import Image from "next/image";
import { Suspense } from "react";
import { ProvedorToast } from "@/components/ui/Toast";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { BarraNavegacao } from "@/components/BarraNavegacao";
import { LinkRelatar } from "@/components/relatos/LinkRelatar";
import { ehGerencia } from "@/lib/dominio";
import Link from "next/link";
import { sair } from "@/lib/acoes-sessao";
import { aniversariosDeHoje } from "@/lib/arquitetos/aniversarios-hoje";
import { followupsDeHoje } from "@/lib/orcamento/followups-hoje";
import { paraRenovarDeHoje } from "@/lib/orcamento/para-renovar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

async function Moldura({ children }: { children: React.ReactNode }) {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  // O badge do Início soma os follow-ups vencidos e os orçamentos para renovar.
  const [followups, renovar, aniversarios] = await Promise.all([
    followupsDeHoje(supabase, usuario),
    paraRenovarDeHoje(supabase, usuario),
    aniversariosDeHoje(supabase, usuario),
  ]);
  // Aniversário só entra no badge no próprio dia.
  const vencidos =
    followups.length + renovar.length + aniversarios.filter((a) => a.dias === 0).length;
  return (
    <>
      <header className="vidro sticky top-0 z-20 rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2">
          <span className="flex items-center gap-2 text-base font-medium">
            <Image
              src="/marca/logo-quadrado.jpg"
              alt="Luz Design"
              width={32}
              height={32}
              className="size-8 rounded-md"
            />
            {usuario.nome}
          </span>
          <div className="flex items-center">
            <LinkRelatar />
            {ehGerencia(usuario.perfil) ? (
              <Link
                href="/relatos"
                className="min-h-11 px-3 py-2 text-base text-zinc-700 underline"
              >
                Relatos
              </Link>
            ) : null}
          </div>
          <form action={sair}>
            <button type="submit" className="min-h-11 px-3 text-base text-amber-700 underline">
              Sair
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">{children}</main>
      <BarraNavegacao perfil={usuario.perfil} followupsVencidos={vencidos} />
    </>
  );
}

export default function LayoutApp({ children }: LayoutProps<"/">) {
  return (
    <ProvedorToast>
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-3xl px-4 pt-6">
            <EsqueletoLista />
          </div>
        }
      >
        <Moldura>{children}</Moldura>
      </Suspense>
    </ProvedorToast>
  );
}
