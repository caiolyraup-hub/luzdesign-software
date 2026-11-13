import Link from "next/link";

const classe =
  "flex min-h-11 shrink-0 items-center rounded-lg border border-zinc-300 px-3 text-lg font-medium";

/** Atalhos para Clientes e Arquitetos (ficam no topo de Orçamentos, Equipe e Produtos). */
export function LinkClientes() {
  return (
    <div className="flex shrink-0 gap-2">
      <Link href="/clientes" className={classe}>
        Clientes
      </Link>
      <Link href="/arquitetos" className={classe}>
        Arquitetos
      </Link>
    </div>
  );
}
