"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS = [
  { href: "/", rotulo: "Início" },
  { href: "/orcamentos/novo", rotulo: "Novo" },
  { href: "/orcamentos", rotulo: "Orçamentos" },
  { href: "/meus-numeros", rotulo: "Números" },
  { href: "/gerencia", rotulo: "Gerência" },
];

function ativo(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/orcamentos")
    return pathname === "/orcamentos" || /^\/orcamentos\/(?!novo$)/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BarraNavegacao() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-3xl">
        {ITENS.map((item) => (
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
