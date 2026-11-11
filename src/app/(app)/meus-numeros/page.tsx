import { connection } from "next/server";
import { Suspense } from "react";
import { PainelVendedora } from "@/components/numeros/PainelVendedora";
import { SeletorPeriodo } from "@/components/numeros/SeletorPeriodo";
import { hojeMaceioISO } from "@/lib/formatar";
import { carregarMetricas, carregarSerieSemanal } from "@/lib/metricas/carregar";
import { resolverPeriodo } from "@/lib/metricas/periodo";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Numeros({ searchParams }: Pick<PageProps<"/meus-numeros">, "searchParams">) {
  await connection();
  const params = await searchParams;
  const periodo = resolverPeriodo({
    periodo: um(params.periodo),
    de: um(params.de),
    ate: um(params.ate),
  });
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();

  // A função SQL é security invoker: a RLS garante que só entram os orçamentos da própria vendedora.
  const [metricas, serie] = await Promise.all([
    carregarMetricas(supabase, periodo, usuario.id),
    carregarSerieSemanal(supabase, periodo, usuario.id),
  ]);

  return (
    <div className="space-y-6">
      <SeletorPeriodo base="/meus-numeros" periodo={periodo} hoje={hojeMaceioISO()} />
      {metricas ? (
        <PainelVendedora
          m={metricas.vendedoras[0] ?? { ...metricas.total, nome: usuario.nome }}
          periodo={periodo}
          serie={serie}
        />
      ) : (
        <p role="alert" className="text-lg">
          Não foi possível carregar os números agora. Tente de novo.
        </p>
      )}
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/meus-numeros">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Meus números</h1>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <Numeros searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
