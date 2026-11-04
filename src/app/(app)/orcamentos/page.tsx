import { Suspense } from "react";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

async function Lista() {
  const supabase = await criarClienteServidor();
  // Sem filtro de propósito: quem limita o resultado é a RLS.
  const { data, error } = await supabase
    .from("orcamentos")
    .select("id, numero, status, valor_total, clientes(nome)")
    .order("numero");

  if (error) return <p role="alert">Não foi possível carregar os orçamentos.</p>;
  if (!data?.length) return <p className="text-zinc-600">Nenhum orçamento ainda.</p>;

  return (
    <ul className="divide-y divide-zinc-200">
      {data.map((o) => {
        const cliente = Array.isArray(o.clientes) ? o.clientes[0] : o.clientes;
        return (
          <li key={o.id} className="py-3">
            <p className="font-medium">
              {o.numero} · {cliente?.nome ?? "Sem cliente"}
            </p>
            <p className="text-zinc-600">
              {o.status} · {moeda.format(Number(o.valor_total))}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export default function Page() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Meus orçamentos</h1>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <Lista />
      </Suspense>
    </section>
  );
}
