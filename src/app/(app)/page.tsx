import Link from "next/link";
import { Suspense } from "react";
import { CartaoOrcamento, type DadosCartao } from "@/components/orcamento/CartaoOrcamento";
import { formatarDataHora } from "@/lib/formatar";
import { followupDevido } from "@/lib/orcamento/status";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

interface Rascunho {
  id: string;
  numero: string;
  atualizado_em: string;
  clientes: { nome: string } | { nome: string }[] | null;
}

async function FollowupsParaFazer() {
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("orcamentos")
    .select(
      "id, numero, status, valor_total, valor_fechado, motivo_perda, atualizado_em, enviado_em, status_em, clientes(nome)",
    )
    .eq("vendedora_id", usuario.id)
    .in("status", ["enviado", "followup_d5"]);
  const cartoes: DadosCartao[] = (
    (data ?? []) as unknown as {
      id: string;
      numero: string;
      status: string;
      valor_total: number | string;
      valor_fechado: number | string | null;
      motivo_perda: string | null;
      atualizado_em: string;
      enviado_em: string | null;
      status_em: string | null;
      clientes: { nome: string } | { nome: string }[] | null;
    }[]
  )
    .filter((l) =>
      followupDevido({ status: l.status, enviadoEm: l.enviado_em, statusEm: l.status_em }),
    )
    .map((l) => ({
      id: l.id,
      numero: l.numero,
      status: l.status,
      clienteNome: (Array.isArray(l.clientes) ? l.clientes[0] : l.clientes)?.nome ?? "Sem cliente",
      valorTotal: Number(l.valor_total),
      valorFechado: null,
      motivoPerda: null,
      atualizadoEm: l.atualizado_em,
      enviadoEm: l.enviado_em,
      statusEm: l.status_em,
    }));
  if (cartoes.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Follow-ups para fazer ({cartoes.length})</h2>
      <ul className="space-y-3">
        {cartoes.map((c) => (
          <CartaoOrcamento key={c.id} d={c} podeAgir />
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
        <FollowupsParaFazer />
      </Suspense>
      <Suspense fallback={null}>
        <RascunhosParaTerminar />
      </Suspense>
    </div>
  );
}
