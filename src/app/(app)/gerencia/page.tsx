import Link from "next/link";
import { LinkClientes } from "@/components/orcamento/LinkClientes";
import { connection } from "next/server";
import { Suspense } from "react";
import { AvisoFiltro } from "@/components/numeros/AvisoFiltro";
import { PainelGerencia } from "@/components/numeros/PainelGerencia";
import { SeletorPeriodo } from "@/components/numeros/SeletorPeriodo";
import { BuscaFiltros } from "@/components/orcamento/BuscaFiltros";
import { ExportarPlanilha } from "@/components/orcamento/ExportarPlanilha";
import { FiltrosStatus } from "@/components/orcamento/FiltrosStatus";
import { ListaOrcamentos } from "@/components/orcamento/ListaOrcamentos";
import { hojeMaceioISO } from "@/lib/formatar";
import {
  carregarCustoIA,
  carregarMetricas,
  carregarSerieSemanal,
  lerCambio,
} from "@/lib/metricas/carregar";
import { lerFiltroPeriodo } from "@/lib/metricas/lista";
import { paramsDoPeriodo, resolverPeriodo } from "@/lib/metricas/periodo";
import { lerConfigFollowup } from "@/lib/orcamento/config-followup";
import {
  chipsAtivos,
  hrefDeFiltros,
  lerFiltrosLista,
  paraParams,
} from "@/lib/orcamento/filtros-lista";
import { followupDeHoje, textoPrazoFollowup } from "@/lib/orcamento/followup";
import { contagemDosPresets, listarOrcamentos } from "@/lib/orcamento/listar";
import { STATUS_QUE_VENCEM } from "@/lib/orcamento/validade";
import { criarClienteServidor } from "@/lib/supabase/servidor";

interface LinhaVencida {
  id: string;
  numero: string;
  status: string;
  vendedora_id: string;
  ultimo_envio_em: string | null;
  clientes: { nome: string } | { nome: string }[] | null;
  usuarios: { nome: string } | { nome: string }[] | null;
}

const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);
const texto = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Equipe({ searchParams }: Pick<PageProps<"/gerencia">, "searchParams">) {
  await connection();
  const params = await searchParams;
  // A gerente filtra por vendedora; a RLS deixa ver todas (a vendedora nunca chega aqui).
  const filtros = lerFiltrosLista(params, { gerente: true });
  const filtroPeriodo = lerFiltroPeriodo(params);
  const periodo = resolverPeriodo({
    periodo: texto(params.periodo),
    de: texto(params.de),
    ate: texto(params.ate),
  });

  const supabase = await criarClienteServidor();
  const [
    pagina,
    config,
    { data: listaVendedoras },
    { data: abertos },
    { data: vencidosValidade },
    { data: listaArquitetos },
  ] = await Promise.all([
    listarOrcamentos(supabase, filtros, { mostrarVendedora: true }),
    lerConfigFollowup(supabase),
    supabase.from("usuarios").select("id, nome").eq("perfil", "vendedora").order("nome"),
    supabase
      .from("orcamentos")
      .select("id, numero, status, vendedora_id, ultimo_envio_em, clientes(nome), usuarios(nome)")
      .in("status", ["enviado", "followup_d5", "followup_d10"]),
    // Validade vencida sem renovação (só os que entram nos números: sem os de teste).
    supabase
      .from("orcamentos_reais")
      .select("vendedora_id")
      .in("status", [...STATUS_QUE_VENCEM])
      .lt("validade", hojeMaceioISO()),
    supabase.from("arquitetos").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  const arquitetos = (listaArquitetos ?? []) as { id: string; nome: string }[];
  if (!pagina) return <p role="alert">Não foi possível carregar os orçamentos.</p>;
  const vendedoras = (listaVendedoras ?? []) as { id: string; nome: string }[];
  const nomeDe = (id: string) => vendedoras.find((v) => v.id === id)?.nome ?? "Vendedora";

  const vencidosSemRenovacao = new Map<string, number>();
  for (const l of (vencidosValidade ?? []) as { vendedora_id: string }[])
    vencidosSemRenovacao.set(l.vendedora_id, (vencidosSemRenovacao.get(l.vendedora_id) ?? 0) + 1);

  // Follow-ups vencidos por vendedora (só leitura): do mais atrasado para o mais novo.
  const vencidosLista = ((abertos ?? []) as unknown as LinhaVencida[])
    .filter((l) => !filtros.vendedora || l.vendedora_id === filtros.vendedora)
    .map((l) => ({
      l,
      f: followupDeHoje({ status: l.status, ultimoEnvioEm: l.ultimo_envio_em, config }),
    }))
    .filter((x): x is { l: LinhaVencida; f: NonNullable<typeof x.f> } => x.f !== null)
    .sort((a, b) => b.f.diasAtraso - a.f.diasAtraso);
  const vencidos = vencidosLista.length;
  const porVendedora = new Map<string, typeof vencidosLista>();
  for (const v of vencidosLista) {
    porVendedora.set(v.l.vendedora_id, [...(porVendedora.get(v.l.vendedora_id) ?? []), v]);
  }

  // O período do painel (periodo, de, ate) acompanha a navegação da lista.
  const manter: Record<string, string> = params.periodo ? paramsDoPeriodo(periodo) : {};
  const urlParams = Object.fromEntries(paraParams(filtros));
  const { filtro: _preset, ...semPreset } = urlParams;
  void _preset;

  const [metricas, serie, custo, cambio] = await Promise.all([
    carregarMetricas(supabase, periodo, null),
    carregarSerieSemanal(supabase, periodo, null),
    carregarCustoIA(supabase, periodo),
    lerCambio(supabase),
  ]);
  const ANCORA = "#lista";
  const chips = chipsAtivos(
    filtros,
    nomeDe,
    (id) => arquitetos.find((a) => a.id === id)?.nome ?? "escolhido",
  ).map((c) => ({
    id: c.id,
    rotulo: c.rotulo,
    href: hrefDeFiltros("/gerencia", c.semEle, manter, ANCORA),
  }));
  const voltarHref = `/gerencia?${new URLSearchParams({
    ...paramsDoPeriodo(periodo),
    ...(filtros.vendedora ? { vendedora: filtros.vendedora } : {}),
  }).toString()}`;

  return (
    <div className="space-y-6">
      <SeletorPeriodo
        base="/gerencia"
        periodo={periodo}
        extra={{
          vendedora: filtros.vendedora,
          filtro: params.filtro ? filtros.preset : undefined,
          q: filtros.q,
        }}
        hoje={hojeMaceioISO()}
      />
      {metricas ? (
        <PainelGerencia
          metricas={metricas}
          periodo={periodo}
          serie={serie}
          custo={custo}
          cambio={cambio}
          vendedoraAtual={filtros.vendedora ?? null}
        />
      ) : (
        <p role="alert" className="text-lg">
          Não foi possível carregar os números agora. Tente de novo.
        </p>
      )}

      <div id="lista" className="scroll-mt-4 space-y-4">
        <h2 className="text-xl font-semibold">Orçamentos</h2>
        {filtroPeriodo ? (
          <AvisoFiltro
            filtro={filtroPeriodo}
            limparHref={hrefDeFiltros(
              "/gerencia",
              { ...filtros, campo: undefined, de: undefined, ate: undefined, motivo: undefined },
              {},
              ANCORA,
            )}
            voltarHref={voltarHref}
          />
        ) : null}
        <section
          aria-label="Vencidos sem renovação"
          className="space-y-2 rounded-lg border border-zinc-300 p-4"
        >
          <h2 className="text-xl font-semibold">Vencidos sem renovação</h2>
          <ul className="space-y-1">
            {vendedoras.map((v) => {
              const n = vencidosSemRenovacao.get(v.id) ?? 0;
              return (
                <li key={v.id} className="flex items-baseline justify-between gap-3 text-lg">
                  <span>{v.nome}</span>
                  {n > 0 ? (
                    <Link
                      href={hrefDeFiltros(
                        "/gerencia",
                        { ...filtros, preset: "todos", validade: "vencida", vendedora: v.id },
                        manter,
                        ANCORA,
                      )}
                      className="inline-flex min-h-11 items-center font-semibold underline"
                    >
                      {n} {n === 1 ? "orçamento" : "orçamentos"}
                    </Link>
                  ) : (
                    <span className="text-zinc-600">nenhum</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
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

        <BuscaFiltros
          base="/gerencia"
          filtros={filtros}
          manter={manter}
          chips={chips}
          total={pagina.total}
          vendedoras={vendedoras}
          arquitetos={arquitetos}
          ancora={ANCORA}
        />
        <ExportarPlanilha query={paraParams(filtros).toString()} gerencia />
        <FiltrosStatus
          base="/gerencia"
          atual={filtros.preset}
          contagens={contagemDosPresets(pagina.porStatus)}
          extra={{ ...manter, ...semPreset }}
        />
        <ListaOrcamentos
          inicial={pagina.cartoes}
          proximoInicial={pagina.proximo}
          params={urlParams}
          gerencia
          config={config}
          vazio="Nenhum orçamento neste filtro."
        />
      </div>
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/gerencia">) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Orçamentos da equipe</h1>
        <LinkClientes />
      </div>
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
