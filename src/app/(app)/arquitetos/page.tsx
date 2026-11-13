import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar } from "@/components/arquitetos/Avatar";
import { NovoArquiteto } from "@/components/arquitetos/AcoesArquiteto";
import { listarArquitetos } from "@/lib/arquitetos/servidor";
import { textoAniversario } from "@/lib/arquitetos/validacao";
import { formatarMoeda } from "@/lib/formatar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

async function Arquitetos({ searchParams }: Pick<PageProps<"/arquitetos">, "searchParams">) {
  await connection();
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 80);
  const usuario = await obterUsuarioAtual();
  const gerente = usuario.perfil === "gerente";
  const inativos = gerente && params.inativos === "1";
  const supabase = await criarClienteServidor();
  const lista = await listarArquitetos(supabase, { q, inativos });
  if (!lista) return <p role="alert">Não foi possível carregar os arquitetos.</p>;

  return (
    <div className="space-y-4">
      <form method="get" role="search" className="space-y-3">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Nome ou escritório"
            aria-label="Buscar arquitetos"
            className="min-h-14 min-w-0 flex-1 rounded-lg border border-zinc-300 px-4 text-lg"
          />
          <button
            type="submit"
            className="min-h-14 shrink-0 rounded-lg bg-zinc-900 px-4 text-lg font-semibold text-white"
          >
            Buscar
          </button>
        </div>
        {gerente ? (
          <label className="flex min-h-11 items-center gap-2 text-lg">
            <input
              type="checkbox"
              name="inativos"
              value="1"
              defaultChecked={inativos}
              className="h-6 w-6"
            />
            Mostrar desativados
          </label>
        ) : null}
      </form>

      <NovoArquiteto />

      <p role="status" className="text-lg text-zinc-700">
        <strong>{lista.length}</strong> {lista.length === 1 ? "arquiteto(a)" : "arquitetos"}
      </p>

      <ul className="space-y-3">
        {lista.map((a) => (
          <li key={a.id} className="rounded-lg border border-zinc-200 bg-white p-4">
            <Link href={`/arquitetos/${a.id}`} className="flex items-start gap-3">
              <Avatar nome={a.nome} url={a.foto_url} tamanho={56} />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block truncate text-xl font-semibold">
                  {a.nome}
                  {!a.ativo ? (
                    <span className="ml-2 text-base text-zinc-600">(desativado)</span>
                  ) : null}
                </span>
                {a.escritorio ? (
                  <span className="block truncate text-lg text-zinc-600">{a.escritorio}</span>
                ) : null}
                {a.aniversario_dia ? (
                  <span className="block text-base text-zinc-600">
                    Aniversário: {textoAniversario(a.aniversario_dia, a.aniversario_mes)}
                  </span>
                ) : null}
                <span className="block text-lg text-zinc-700">
                  {a.indicados} {a.indicados === 1 ? "indicação" : "indicações"} · {a.fechados}{" "}
                  {a.fechados === 1 ? "fechada" : "fechadas"} · {formatarMoeda(a.vendido)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {lista.length === 0 ? (
        <p className="text-lg text-zinc-600">Nenhum arquiteto(a) encontrado.</p>
      ) : null}
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/arquitetos">) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Arquitetos</h1>
      <Suspense fallback={<p className="text-lg text-zinc-600">Carregando...</p>}>
        <Arquitetos searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
