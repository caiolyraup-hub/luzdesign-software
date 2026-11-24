import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FormAjustes, PercentualProprio } from "@/components/comissoes/AcoesComissoes";
import { lerPercentuais } from "@/lib/comissoes/carregar";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { EsqueletoLista } from "@/components/ui/Esqueleto";

const txt = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : String(n).replace(".", ",");

async function Conteudo() {
  await connection();
  const supabase = await criarClienteServidor();
  const [p, { data: arqs }, { data: vends }] = await Promise.all([
    lerPercentuais(supabase),
    supabase.from("arquitetos").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("usuarios").select("id, nome").eq("perfil", "vendedora").order("nome"),
  ]);
  return (
    <div className="space-y-6">
      <FormAjustes
        inicial={{
          arquitetoPadrao: txt(p.arquitetoPadrao),
          vendedoraPadrao: txt(p.vendedoraPadrao),
          vendedoraComArquiteto: txt(p.vendedoraComArquiteto),
        }}
      />
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Percentual próprio por vendedora</h2>
        {(vends ?? []).map((v) => (
          <PercentualProprio
            key={v.id as string}
            tipo="vendedora"
            id={v.id as string}
            nome={v.nome as string}
            inicial={txt(p.vendedoras?.[v.id as string])}
          />
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Percentual próprio por arquiteto</h2>
        <p className="text-base text-zinc-600">Em branco = usa o padrão do arquiteto.</p>
        {(arqs ?? []).map((a) => (
          <PercentualProprio
            key={a.id as string}
            tipo="arquiteto"
            id={a.id as string}
            nome={a.nome as string}
            inicial={txt(p.arquitetos?.[a.id as string])}
          />
        ))}
        {(arqs ?? []).length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum arquiteto cadastrado.</p>
        ) : null}
      </section>
      <p className="text-base text-zinc-600">
        Mudar um percentual não altera comissões já calculadas. Para refazer uma comissão a pagar,
        use Recalcular na tela de Comissões.
      </p>
      <Link
        href="/comissoes"
        className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
      >
        Voltar às comissões
      </Link>
    </div>
  );
}

export default function Page() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Ajustes de comissão</h1>
      <Suspense fallback={<EsqueletoLista />}>
        <Conteudo />
      </Suspense>
    </section>
  );
}
