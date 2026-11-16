import { ehGerencia } from "@/lib/dominio";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { obterUsuarioAtual } from "@/lib/sessao";

async function Guarda({ children }: { children: React.ReactNode }) {
  const usuario = await obterUsuarioAtual();
  if (!ehGerencia(usuario.perfil)) redirect("/");
  return <>{children}</>;
}

export default function LayoutGerencia({ children }: LayoutProps<"/gerencia">) {
  return (
    <Suspense fallback={null}>
      <Guarda>{children}</Guarda>
    </Suspense>
  );
}
