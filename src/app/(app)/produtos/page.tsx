import { Suspense } from "react";
import { buscarProdutos } from "@/lib/estoque/buscar";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

async function Lista({ searchParams }: Pick<PageProps<"/produtos">, "searchParams">) {
  const { q } = await searchParams;
  const texto = (Array.isArray(q) ? q[0] : q) ?? "";

  const supabase = await criarClienteServidor();
  let produtos;
  try {
    produtos = await buscarProdutos(supabase, { texto, limite: 50 });
  } catch {
    return <p role="alert">Não foi possível buscar os produtos.</p>;
  }

  if (produtos.length === 0) {
    return <p className="text-lg text-zinc-600">Nenhum produto encontrado.</p>;
  }

  return (
    <>
      <p className="text-base text-zinc-600">
        {produtos.length === 50
          ? "Mostrando os 50 melhores resultados."
          : `${produtos.length} produto(s).`}
      </p>
      <ul className="divide-y divide-zinc-200">
        {produtos.map((p) => (
          <li key={p.codigo} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-lg font-medium">{p.descricao}</p>
              <p className="text-base text-zinc-600">
                Cód. {p.codigo}
                {p.categoria ? ` · ${p.categoria}` : ""}
                {p.marca ? ` · ${p.marca}` : ""}
              </p>
            </div>
            <p className="shrink-0 text-lg font-semibold">
              {moeda.format(p.preco_unitario)}
              <span className="text-base font-normal text-zinc-600">/{p.unidade}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Page({ searchParams }: PageProps<"/produtos">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Produtos</h1>
      <form action="/produtos" method="get" className="flex gap-2">
        <input
          name="q"
          type="search"
          placeholder="Código, descrição, marca..."
          aria-label="Buscar produto"
          className="min-h-14 min-w-0 flex-1 rounded-lg border border-zinc-300 px-4 text-lg"
        />
        <button
          type="submit"
          className="min-h-14 rounded-lg bg-amber-700 px-5 text-lg font-semibold text-white"
        >
          Buscar
        </button>
      </form>
      <Suspense fallback={<p className="text-zinc-600">Buscando...</p>}>
        <Lista searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
