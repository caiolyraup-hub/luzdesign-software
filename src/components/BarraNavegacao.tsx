"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Perfil } from "@/lib/dominio";

const ITENS_VENDEDORA = [
  { href: "/", rotulo: "Início" },
  { href: "/orcamentos/novo", rotulo: "Novo" },
  { href: "/orcamentos", rotulo: "Orçamentos" },
  { href: "/meus-numeros", rotulo: "Números" },
  { href: "/produtos", rotulo: "Produtos" },
];

const ITENS_GERENTE = [
  { href: "/", rotulo: "Início" },
  { href: "/gerencia", rotulo: "Painel" },
  { href: "/gerencia/estoque", rotulo: "Estoque" },
  { href: "/produtos", rotulo: "Produtos" },
  { href: "/gerencia/configuracoes", rotulo: "Ajustes" },
];

function ativo(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/orcamentos")
    return pathname === "/orcamentos" || /^\/orcamentos\/(?!novo$)/.test(pathname);
  if (href === "/gerencia") return pathname === "/gerencia";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BarraNavegacao({ perfil }: { perfil: Perfil }) {
  const pathname = usePathname();
  const itens = perfil === "gerente" ? ITENS_GERENTE : ITENS_VENDEDORA;
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-3xl">
        {itens.map((item) => (
          <li key={item.href} className="flex-1">
            <Link
              href={item.href}
              aria-current={ativo(pathname, item.href) ? "page" : undefined}
              className="flex min-h-14 items-center justify-center px-1 text-base aria-[current=page]:font-semibold aria-[current=page]:text-amber-700"
            >
              {item.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
