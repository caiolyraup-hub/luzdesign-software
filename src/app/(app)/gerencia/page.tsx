import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CartaoOrcamento, type DadosCartao } from "@/components/orcamento/CartaoOrcamento";
import { FILTROS, FiltrosStatus, filtroPorId } from "@/components/orcamento/FiltrosStatus";
import { followupDevido } from "@/lib/orcamento/status";
import { criarClienteServidor } from "@/lib/supabase/servidor";

interface Linha {
  id: string;
  numero: string;
  status: string;
  vendedora_id: string;
  valor_total: number | string;
  valor_fechado: number | string | null;
  motivo_perda: string | null;
  atualizado_em: string;
  enviado_em: string | null;
  status_em: string | null;
  clientes: { nome: string } | { nome: string }[] | null;
  usuarios: { nome: string } | { nome: string }[] | null;
}

const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);

async function Equipe({ searchParams }: Pick<PageProps<"/gerencia">, "searchParams">) {
  await connection();
  const params = await searchParams;
  const filtro = filtroPorId(Array.isArray(params.filtro) ? params.filtro[0] : params.filtro);
  const vendedoraId = Array.isArray(params.vendedora) ? params.vendedora[0] : params.vendedora;

  const supabase = await criarClienteServidor();
  // A gerente lê todos os orçamentos (RLS) e pode mudar o status de qualquer um.
  const { data, error } = await supabase
    .from("orcamentos")
    .select(
      "id, numero, status, vendedora_id, valor_total, valor_fechado, motivo_perda, atualizado_em, enviado_em, status_em, clientes(nome), usuarios(nome)",
    )
    .order("atualizado_em", { ascending: false });
  if (error) return <p role="alert">Não foi possível carregar os orçamentos.</p>;

  const todas = (data ?? []) as unknown as Linha[];
  const vendedoras = [
    ...new Map(todas.map((l) => [l.vendedora_id, um(l.usuarios)?.nome ?? "—"])).entries(),
  ];
  const daVendedora = vendedoraId ? todas.filter((l) => l.vendedora_id === vendedoraId) : todas;

  const contagens = Object.fromEntries(
    FILTROS.map((f) => [
      f.id,
      f.status
        ? daVendedora.filter((l) => f.status!.includes(l.status as never)).length
        : daVendedora.length,
    ]),
  );
  const visiveis = filtro.status
    ? daVendedora.filter((l) => filtro.status!.includes(l.status as never))
    : daVendedora;
  const vencidos = daVendedora.filter((l) =>
    followupDevido({ status: l.status, enviadoEm: l.enviado_em, statusEm: l.status_em }),
  ).length;

  const cartoes: DadosCartao[] = visiveis.map((l) => ({
    id: l.id,
    numero: l.numero,
    status: l.status,
    clienteNome: um(l.clientes)?.nome ?? "Sem cliente",
    vendedoraNome: um(l.usuarios)?.nome ?? null,
    valorTotal: Number(l.valor_total),
    valorFechado: l.valor_fechado === null ? null : Number(l.valor_fechado),
    motivoPerda: l.motivo_perda,
    atualizadoEm: l.atualizado_em,
    enviadoEm: l.enviado_em,
    statusEm: l.status_em,
  }));

  const link = (id?: string) => {
    const p = new URLSearchParams({ filtro: filtro.id });
    if (id) p.set("vendedora", id);
    return `/gerencia?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {vencidos > 0 ? (
        <p className="rounded-lg bg-amber-100 p-3 text-lg text-amber-950">
          {vencidos} {vencidos === 1 ? "follow-up vencido" : "follow-ups vencidos"}.
        </p>
      ) : null}

      <nav
        aria-label="Filtrar por vendedora"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        {[["", "Todas"] as const, ...vendedoras.map(([id, nome]) => [id, nome] as const)].map(
          ([id, nome]) => (
            <Link
              key={id || "todas"}
              href={link(id || undefined)}
              aria-current={(vendedoraId ?? "") === id ? "page" : undefined}
              className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-base ${
                (vendedoraId ?? "") === id
                  ? "border-zinc-800 bg-zinc-800 font-semibold text-white"
                  : "border-zinc-300 bg-white"
              }`}
            >
              {nome}
            </Link>
          ),
        )}
      </nav>

      <FiltrosStatus
        base="/gerencia"
        atual={filtro.id}
        contagens={contagens}
        extra={{ vendedora: vendedoraId }}
      />

      {cartoes.length === 0 ? (
        <p className="text-lg text-zinc-600">Nenhum orçamento neste filtro.</p>
      ) : (
        <ul className="space-y-3">
          {cartoes.map((c) => (
            // Rascunho é da vendedora: a gerência acompanha, mas só ela continua o formulário.
            <CartaoOrcamento key={c.id} d={c} podeAgir={c.status !== "rascunho"} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/gerencia">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Orçamentos da equipe</h1>
      <p className="text-lg text-zinc-600">
        Acompanhe e mude o status de qualquer orçamento. Os painéis de números chegam depois.
      </p>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <Equipe searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
