import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CartaoOrcamento, type DadosCartao } from "@/components/orcamento/CartaoOrcamento";
import { FILTROS, FiltrosStatus, filtroPorId } from "@/components/orcamento/FiltrosStatus";
import { AvisoFiltro } from "@/components/numeros/AvisoFiltro";
import { PainelGerencia } from "@/components/numeros/PainelGerencia";
import { SeletorPeriodo } from "@/components/numeros/SeletorPeriodo";
import { hojeMaceioISO } from "@/lib/formatar";
import {
  carregarCustoIA,
  carregarMetricas,
  carregarSerieSemanal,
  lerCambio,
} from "@/lib/metricas/carregar";
import { aplicarFiltroPeriodo, lerFiltroPeriodo } from "@/lib/metricas/lista";
import { paramsDoPeriodo, resolverPeriodo } from "@/lib/metricas/periodo";
import { lerConfigFollowup } from "@/lib/orcamento/config-followup";
import { followupDeHoje, textoPrazoFollowup } from "@/lib/orcamento/followup";
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
  criado_em: string;
  gerado_em: string | null;
  enviado_em: string | null;
  fechado_em: string | null;
  perdido_em: string | null;
  ultimo_envio_em: string | null;
  clientes: { nome: string } | { nome: string }[] | null;
  usuarios: { nome: string } | { nome: string }[] | null;
}

const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);
const texto = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Equipe({ searchParams }: Pick<PageProps<"/gerencia">, "searchParams">) {
  await connection();
  const params = await searchParams;
  const filtro = filtroPorId(Array.isArray(params.filtro) ? params.filtro[0] : params.filtro);
  const vendedoraId = Array.isArray(params.vendedora) ? params.vendedora[0] : params.vendedora;
  const periodo = resolverPeriodo({
    periodo: texto(params.periodo),
    de: texto(params.de),
    ate: texto(params.ate),
  });
  const filtroPeriodo = lerFiltroPeriodo(params);

  const supabase = await criarClienteServidor();
  // A gerente lê todos os orçamentos (RLS) e pode mudar o status de qualquer um.
  const { data, error } = await supabase
    .from("orcamentos")
    .select(
      "id, numero, status, vendedora_id, valor_total, valor_fechado, motivo_perda, atualizado_em, criado_em, gerado_em, enviado_em, fechado_em, perdido_em, ultimo_envio_em, clientes(nome), usuarios(nome)",
    )
    .order("atualizado_em", { ascending: false });
  if (error) return <p role="alert">Não foi possível carregar os orçamentos.</p>;

  const config = await lerConfigFollowup(supabase);
  const todasSemPeriodo = (data ?? []) as unknown as Linha[];
  // Aberta por um número do painel: só o que cai naquele período (e sem os de teste).
  const todas = await aplicarFiltroPeriodo(supabase, todasSemPeriodo, filtroPeriodo);
  const vendedoras = [
    ...new Map(todasSemPeriodo.map((l) => [l.vendedora_id, um(l.usuarios)?.nome ?? "—"])).entries(),
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
  // Follow-ups vencidos por vendedora (só leitura): do mais atrasado para o mais novo.
  const vencidosLista = (
    vendedoraId ? todasSemPeriodo.filter((l) => l.vendedora_id === vendedoraId) : todasSemPeriodo
  )
    .map((l) => ({
      l,
      f: followupDeHoje({ status: l.status, ultimoEnvioEm: l.ultimo_envio_em, config }),
    }))
    .filter((x): x is { l: Linha; f: NonNullable<typeof x.f> } => x.f !== null)
    .sort((a, b) => b.f.diasAtraso - a.f.diasAtraso);
  const vencidos = vencidosLista.length;
  const porVendedora = new Map<string, typeof vencidosLista>();
  for (const v of vencidosLista) {
    porVendedora.set(v.l.vendedora_id, [...(porVendedora.get(v.l.vendedora_id) ?? []), v]);
  }

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
    geradoEm: l.gerado_em,
    ultimoEnvioEm: l.ultimo_envio_em,
  }));

  // Os parâmetros do período (e do filtro vindo de um número do painel) acompanham a navegação.
  const paramsPeriodo: Record<string, string> = {
    ...(params.periodo ? paramsDoPeriodo(periodo) : {}),
    ...(filtroPeriodo
      ? {
          data: filtroPeriodo.campo,
          de: filtroPeriodo.de,
          ate: filtroPeriodo.ate,
          ...(filtroPeriodo.motivo ? { motivo: filtroPeriodo.motivo } : {}),
        }
      : {}),
  };
  const link = (id?: string) => {
    const p = new URLSearchParams({ ...paramsPeriodo, filtro: filtro.id });
    if (id) p.set("vendedora", id);
    return `/gerencia?${p.toString()}#lista`;
  };

  // Painel de números (a função SQL e a RLS decidem o que entra; custo só a gerente executa).
  const [metricas, serie, custo, cambio] = await Promise.all([
    carregarMetricas(supabase, periodo, null),
    carregarSerieSemanal(supabase, periodo, null),
    carregarCustoIA(supabase, periodo),
    lerCambio(supabase),
  ]);
  const limparHref = `/gerencia?${new URLSearchParams({
    ...(vendedoraId ? { vendedora: vendedoraId } : {}),
    filtro: filtro.id,
  }).toString()}#lista`;
  const voltarHref = `/gerencia?${new URLSearchParams({
    ...paramsDoPeriodo(periodo),
    ...(vendedoraId ? { vendedora: vendedoraId } : {}),
  }).toString()}`;

  return (
    <div className="space-y-6">
      <SeletorPeriodo
        base="/gerencia"
        periodo={periodo}
        extra={{ vendedora: vendedoraId, filtro: params.filtro ? filtro.id : undefined }}
        hoje={hojeMaceioISO()}
      />
      {metricas ? (
        <PainelGerencia
          metricas={metricas}
          periodo={periodo}
          serie={serie}
          custo={custo}
          cambio={cambio}
          vendedoraAtual={vendedoraId ?? null}
        />
      ) : (
        <p role="alert" className="text-lg">
          Não foi possível carregar os números agora. Tente de novo.
        </p>
      )}

      <div id="lista" className="scroll-mt-4 space-y-4">
        <h2 className="text-xl font-semibold">Orçamentos</h2>
        {filtroPeriodo ? (
          <AvisoFiltro filtro={filtroPeriodo} limparHref={limparHref} voltarHref={voltarHref} />
        ) : null}
        {vencidos > 0 ? (
          <section
            aria-label="Follow-ups vencidos"
            className="space-y-3 rounded-lg border-2 border-amber-700 bg-amber-50 p-4"
          >
            <h2 className="text-xl font-semibold">
              {vencidos} {vencidos === 1 ? "follow-up vencido" : "follow-ups vencidos"}
            </h2>
            {[...porVendedora.entries()].map(([id, itens]) => (
              <div key={id} className="space-y-1">
                <p className="text-lg font-medium">
                  {um(itens[0].l.usuarios)?.nome ?? "—"} ({itens.length})
                </p>
                <ul className="space-y-1">
                  {itens.map(({ l, f }) => (
                    <li key={l.id}>
                      <Link
                        href={`/orcamentos/${l.id}`}
                        className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 text-lg underline"
                      >
                        <span>
                          {um(l.clientes)?.nome ?? "Sem cliente"} · {l.numero}
                        </span>
                        <span className="text-base text-amber-950">
                          {f.etapa === "ENCERRAR" ? "encerrar" : f.etapa} · {textoPrazoFollowup(f)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
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
          extra={{ vendedora: vendedoraId, ...paramsPeriodo }}
        />

        {cartoes.length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum orçamento neste filtro.</p>
        ) : (
          <ul className="space-y-3">
            {cartoes.map((c) => (
              // Rascunho é da vendedora: a gerência acompanha, mas só ela continua o formulário.
              <CartaoOrcamento
                key={c.id}
                d={c}
                podeAgir={c.status !== "rascunho"}
                config={config}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/gerencia">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Orçamentos da equipe</h1>
      <p className="text-lg text-zinc-600">
        Números da equipe no período e, abaixo, todos os orçamentos para acompanhar e mudar o
        status.
      </p>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <Equipe searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
