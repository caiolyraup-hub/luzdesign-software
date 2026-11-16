import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ehDono } from "@/lib/dominio";
import { obterUsuarioAtual } from "@/lib/sessao";

// Só o dono. Para os outros perfis a rota não existe: 404 (o proxy responde 404 de verdade; este
// guarda é a segunda barreira, e a RLS das tabelas é a terceira).
async function Guarda({ children }: { children: React.ReactNode }) {
  const usuario = await obterUsuarioAtual();
  if (!ehDono(usuario.perfil)) notFound();
  return <>{children}</>;
}

export default function LayoutComissoes({ children }: LayoutProps<"/comissoes">) {
  return (
    <Suspense fallback={null}>
      <Guarda>{children}</Guarda>
    </Suspense>
  );
}
