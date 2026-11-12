import Link from "next/link";

/** Atalho para a lista de clientes (fica no topo de Orçamentos, Equipe e Produtos). */
export function LinkClientes() {
  return (
    <Link
      href="/clientes"
      className="flex min-h-11 shrink-0 items-center rounded-lg border border-zinc-300 px-4 text-lg font-medium"
    >
      Clientes
    </Link>
  );
}
