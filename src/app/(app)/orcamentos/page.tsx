import Link from "next/link";
import { Suspense } from "react";
import { BadgeStatus } from "@/components/BadgeStatus";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

interface Linha {
  id: string;
  numero: string;
  status: string;
  valor_total: number;
  atualizado_em: string;
  clientes: { nome: string } | { nome: string }[] | null;
}

function nomeCliente(l: Linha) {
  const c = Array.isArray(l.clientes) ? l.clientes[0] : l.clientes;
  return c?.nome ?? "Sem cliente";
}

async function Lista() {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  // "Meus orçamentos": o filtro é só para a tela; quem protege os dados é a RLS.
  const { data, error } = await supabase
    .from("orcamentos")
    .select("id, numero, status, valor_total, atualizado_em, clientes(nome)")
    .eq("vendedora_id", usuario.id)
    .order("atualizado_em", { ascending: false });

  if (error) return <p role="alert">Não foi possível carregar os orçamentos.</p>;
  const linhas = (data ?? []) as unknown as Linha[];
  if (linhas.length === 0) {
    return (
      <p className="text-lg text-zinc-600">Nenhum orçamento ainda. Toque em Novo para começar.</p>
    );
  }

  const rascunhos = linhas.filter((l) => l.status === "rascunho");
  const demais = linhas.filter((l) => l.status !== "rascunho");

  return (
    <div className="space-y-8">
      {rascunhos.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Rascunhos</h2>
          <ul className="space-y-3">
            {rascunhos.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-4"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-lg font-medium">{nomeCliente(l)}</p>
                  <p className="text-base text-zinc-600">
                    {l.numero} · {formatarDataHora(l.atualizado_em)}
                  </p>
                  <BadgeStatus status={l.status} />
                </div>
                <Link
                  href={`/orcamentos/${l.id}/editar`}
                  className="flex min-h-14 shrink-0 items-center rounded-lg bg-amber-700 px-5 text-lg font-semibold text-white"
                >
                  Continuar
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {demais.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Orçamentos</h2>
          <ul className="space-y-3">
            {demais.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/orcamentos/${l.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-4"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-lg font-medium">{nomeCliente(l)}</p>
                    <p className="text-base text-zinc-600">
                      {l.numero} · {formatarDataHora(l.atualizado_em)}
                    </p>
                    <BadgeStatus status={l.status} />
                  </div>
                  <p className="shrink-0 text-lg font-semibold">
                    {formatarMoeda(Number(l.valor_total))}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
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
