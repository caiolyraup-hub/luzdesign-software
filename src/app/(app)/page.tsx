import Link from "next/link";
import { Suspense } from "react";
import { CartaoFollowup } from "@/components/orcamento/CartaoFollowup";
import { formatarDataHora } from "@/lib/formatar";
import { followupsDeHoje } from "@/lib/orcamento/followups-hoje";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

interface Rascunho {
  id: string;
  numero: string;
  atualizado_em: string;
  clientes: { nome: string } | { nome: string }[] | null;
}

async function FollowupsDeHoje() {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const cartoes = await followupsDeHoje(supabase, usuario);
  if (cartoes.length === 0) return null;
  return (
    <section aria-label="Follow-ups de hoje" className="space-y-3">
      <h2 className="text-xl font-semibold">Follow-ups de hoje ({cartoes.length})</h2>
      <ul className="space-y-3">
        {cartoes.map((c) => (
          <CartaoFollowup key={c.id} d={c} />
        ))}
      </ul>
    </section>
  );
}

async function RascunhosParaTerminar() {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("orcamentos")
    .select("id, numero, atualizado_em, clientes(nome)")
    .eq("vendedora_id", usuario.id)
    .eq("status", "rascunho")
    .order("atualizado_em", { ascending: false })
    .limit(3);
  const rascunhos = (data ?? []) as unknown as Rascunho[];

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Rascunhos para terminar</h2>
      {rascunhos.length === 0 ? (
        <p className="text-lg text-zinc-600">
          Nenhum rascunho. Toque em Novo orçamento para começar.
        </p>
      ) : (
        <ul className="space-y-3">
          {rascunhos.map((r) => {
            const cliente = Array.isArray(r.clientes) ? r.clientes[0] : r.clientes;
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-lg font-medium">{cliente?.nome ?? "Sem cliente"}</p>
                  <p className="text-base text-zinc-600">
                    {r.numero} · {formatarDataHora(r.atualizado_em)}
                  </p>
                </div>
                <Link
                  href={`/orcamentos/${r.id}/editar`}
                  className="flex min-h-14 shrink-0 items-center rounded-lg bg-amber-700 px-5 text-lg font-semibold text-white"
                >
                  Continuar
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Para hoje</h1>
      <Link
        href="/orcamentos/novo"
        className="flex min-h-14 items-center justify-center rounded-lg bg-amber-700 text-lg font-semibold text-white"
      >
        Novo orçamento
      </Link>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <FollowupsDeHoje />
      </Suspense>
      <Suspense fallback={null}>
        <RascunhosParaTerminar />
      </Suspense>
    </div>
  );
}
