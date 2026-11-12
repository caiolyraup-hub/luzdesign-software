import { connection } from "next/server";
import { Suspense } from "react";
import { Duplicados, type ParDuplicado } from "@/components/clientes/Duplicados";
import { ListaClientes } from "@/components/clientes/ListaClientes";
import { lerFiltrosClientes, listarClientes } from "@/lib/clientes/listar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

async function Clientes({ searchParams }: Pick<PageProps<"/clientes">, "searchParams">) {
  await connection();
  const params = await searchParams;
  const usuario = await obterUsuarioAtual();
  const gerente = usuario.perfil === "gerente";
  const filtros = lerFiltrosClientes(params, { gerente });
  const supabase = await criarClienteServidor();

  // A vendedora só enxerga os próprios clientes (RLS); a gerência vê todos e filtra por vendedora.
  const [pagina, { data: vendedoras }, duplicados] = await Promise.all([
    listarClientes(supabase, filtros),
    gerente
      ? supabase.from("usuarios").select("id, nome").eq("perfil", "vendedora").order("nome")
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    gerente ? supabase.rpc("possiveis_duplicados") : Promise.resolve({ data: [] }),
  ]);
  if (!pagina) return <p role="alert">Não foi possível carregar os clientes.</p>;

  const urlParams: Record<string, string> = {
    ...(filtros.q ? { q: filtros.q } : {}),
    ...(filtros.vendedora ? { vendedora: filtros.vendedora } : {}),
  };

  return (
    <div className="space-y-4">
      <form method="get" role="search" className="space-y-3">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={filtros.q ?? ""}
            placeholder="Nome, WhatsApp ou arquiteto"
            aria-label="Buscar clientes"
            className="min-h-14 min-w-0 flex-1 rounded-lg border border-zinc-300 px-4 text-lg"
          />
          <button
            type="submit"
            className="min-h-14 shrink-0 rounded-lg bg-zinc-900 px-4 text-lg font-semibold text-white"
          >
            Buscar
          </button>
        </div>
        {gerente && (vendedoras ?? []).length > 0 ? (
          <label className="block space-y-1">
            <span className="text-base font-medium">Vendedora</span>
            <select
              name="vendedora"
              defaultValue={filtros.vendedora ?? ""}
              className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg"
            >
              <option value="">Todas</option>
              {(vendedoras ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </form>

      {gerente ? <Duplicados pares={(duplicados.data ?? []) as ParDuplicado[]} /> : null}

      <p role="status" className="text-lg text-zinc-700">
        <strong>{pagina.total}</strong> {pagina.total === 1 ? "cliente" : "clientes"}
      </p>
      <ListaClientes
        inicial={pagina.clientes}
        proximoInicial={pagina.proximo}
        params={urlParams}
        gerencia={gerente}
      />
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/clientes">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <Clientes searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
