import { Suspense } from "react";
import { LinkClientes } from "@/components/orcamento/LinkClientes";
import { connection } from "next/server";
import { EditarDescricao } from "@/components/produtos/EditarDescricao";
import { ehGerencia } from "@/lib/dominio";
import { buscarProdutos } from "@/lib/estoque/buscar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

async function Lista({ searchParams }: Pick<PageProps<"/produtos">, "searchParams">) {
  await connection(); // a sessão depende da requisição: fora do prerender
  const { q } = await searchParams;
  const texto = (Array.isArray(q) ? q[0] : q) ?? "";

  const supabase = await criarClienteServidor();
  const usuario = await obterUsuarioAtual();
  const gerencia = ehGerencia(usuario.perfil);
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
          <li key={p.codigo} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-lg font-medium">{p.descricao}</p>
              <p className="text-base text-zinc-600">
                Cód. {p.codigo}
                {p.categoria ? ` · ${p.categoria}` : ""}
                {p.marca ? ` · ${p.marca}` : ""}
              </p>
              {gerencia ? <EditarDescricao codigo={p.codigo} descricao={p.descricao} /> : null}
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

const dataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Maceio",
});

/** De onde veio o catálogo (só a gerência vê): "Catálogo provisório, 158 produtos, importado em 06/11". */
async function Procedencia() {
  await connection();
  const usuario = await obterUsuarioAtual();
  if (!ehGerencia(usuario.perfil)) return null;
  const supabase = await criarClienteServidor();
  const [{ data: carga }, { count }] = await Promise.all([
    supabase
      .from("sync_estoque")
      .select("origem, iniciado_em, terminado_em")
      .not("terminado_em", "is", null)
      .order("terminado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("produtos").select("codigo", { count: "exact", head: true }).eq("ativo", true),
  ]);
  const provisorio = !carga || String(carga.origem).startsWith("provisorio");
  const quando = carga ? dataBR.format(new Date(carga.terminado_em ?? carga.iniciado_em)) : null;
  return (
    <p role="note" className="rounded-lg bg-amber-50 p-3 text-base text-zinc-800">
      {provisorio ? "Catálogo provisório" : `Catálogo importado (${carga?.origem})`}, {count ?? 0}{" "}
      produtos
      {quando ? `, importado em ${quando}` : ""}.
      {provisorio ? " A planilha real do estoque ainda vai substituir estes dados." : ""}
    </p>
  );
}

export default function Page({ searchParams }: PageProps<"/produtos">) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Produtos</h1>
        <LinkClientes />
      </div>
      <Suspense fallback={null}>
        <Procedencia />
      </Suspense>
      <form action="/produtos" method="get" className="flex gap-2">
        <input
          name="q"
          type="search"
          placeholder="Código ou descrição..."
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
