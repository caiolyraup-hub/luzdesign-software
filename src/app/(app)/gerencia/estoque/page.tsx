import Link from "next/link";
import { Suspense } from "react";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { Importador } from "./importador";

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Maceio",
});

interface ErroGravado {
  linha?: number;
  mensagem?: string;
}

async function UltimaCarga() {
  const supabase = await criarClienteServidor();
  const [{ data: carga }, { count: ativos }, { count: total }] = await Promise.all([
    supabase
      .from("sync_estoque")
      .select("iniciado_em, terminado_em, origem, linhas_lidas, linhas_gravadas, erros")
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("produtos").select("codigo", { count: "exact", head: true }).eq("ativo", true),
    supabase.from("produtos").select("codigo", { count: "exact", head: true }),
  ]);

  const erros = (carga?.erros ?? []) as ErroGravado[];

  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 p-4">
      <h2 className="text-xl font-semibold">Última carga</h2>
      {carga ? (
        <>
          <p className="text-lg">
            {dataHora.format(new Date(carga.terminado_em ?? carga.iniciado_em))}
          </p>
          <p className="text-base text-zinc-600">Origem: {carga.origem}</p>
          <p className="text-base">
            {carga.linhas_gravadas} gravadas de {carga.linhas_lidas} lidas · {erros.length} erro(s)
          </p>
          {erros.length > 0 ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-lg text-amber-700 underline">
                Ver erros
              </summary>
              <ul className="space-y-1 text-base">
                {erros.slice(0, 100).map((e, i) => (
                  <li key={i}>
                    {e.linha ? `Linha ${e.linha}: ` : ""}
                    {e.mensagem}
                  </li>
                ))}
                {erros.length > 100 ? (
                  <li className="text-zinc-600">... e mais {erros.length - 100}.</li>
                ) : null}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <p className="text-lg text-zinc-600">Nenhuma carga feita ainda.</p>
      )}
      <p className="text-base text-zinc-600">
        {ativos ?? 0} produtos ativos de {total ?? 0}.{" "}
        <Link href="/produtos" className="text-amber-700 underline">
          Ver produtos
        </Link>
      </p>
    </section>
  );
}

export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Estoque</h1>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <UltimaCarga />
      </Suspense>
      <Importador />
    </div>
  );
}
