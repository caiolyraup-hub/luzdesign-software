"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** "Relatar problema" no cabeçalho de todos os perfis: leva a tela atual junto. */
export function LinkRelatar() {
  const pathname = usePathname();
  if (pathname === "/relatar") return null;
  return (
    <Link
      href={`/relatar?tela=${encodeURIComponent(pathname)}`}
      className="min-h-11 px-3 py-2 text-base text-zinc-700 underline"
    >
      Relatar problema
    </Link>
  );
}
