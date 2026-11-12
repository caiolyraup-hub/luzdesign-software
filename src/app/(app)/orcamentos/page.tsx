import { connection } from "next/server";
import { Suspense } from "react";
import { AvisoFiltro } from "@/components/numeros/AvisoFiltro";
import { BuscaFiltros } from "@/components/orcamento/BuscaFiltros";
import { FiltrosStatus } from "@/components/orcamento/FiltrosStatus";
import { ListaOrcamentos } from "@/components/orcamento/ListaOrcamentos";
import { lerFiltroPeriodo } from "@/lib/metricas/lista";
import { lerConfigFollowup } from "@/lib/orcamento/config-followup";
import {
  chipsAtivos,
  hrefDeFiltros,
  lerFiltrosLista,
  paraParams,
} from "@/lib/orcamento/filtros-lista";
import { contagemDosPresets, listarOrcamentos } from "@/lib/orcamento/listar";
import { criarClienteServidor } from "@/lib/supabase/servidor";

async function Lista({ searchParams }: Pick<PageProps<"/orcamentos">, "searchParams">) {
  await connection();
  const params = await searchParams;
  // A vendedora só enxerga os próprios orçamentos: quem garante é a RLS, dentro da função SQL.
  const filtros = lerFiltrosLista(params, { gerente: false });
  const filtroPeriodo = lerFiltroPeriodo(params);
  const supabase = await criarClienteServidor();
  const [pagina, config] = await Promise.all([
    listarOrcamentos(supabase, filtros),
    lerConfigFollowup(supabase),
  ]);
  if (!pagina) return <p role="alert">Não foi possível carregar os orçamentos.</p>;

  const urlParams = Object.fromEntries(paraParams(filtros));
  const chips = chipsAtivos(filtros).map((c) => ({
    id: c.id,
    rotulo: c.rotulo,
    href: hrefDeFiltros("/orcamentos", c.semEle),
  }));
  const { filtro: _preset, ...semPreset } = urlParams;
  void _preset;
  const semStatusNaUrl = Object.fromEntries(
    Object.entries(semPreset).map(([k, v]) => [k, v as string | undefined]),
  );
  const voltar = params.periodo
    ? `/meus-numeros?${new URLSearchParams(
        params.periodo === "personalizado" && filtroPeriodo
          ? { periodo: "personalizado", de: filtroPeriodo.de, ate: filtroPeriodo.ate }
          : { periodo: String(params.periodo) },
      ).toString()}`
    : "/meus-numeros";

  return (
    <div className="space-y-4">
      {filtroPeriodo ? (
        <AvisoFiltro
          filtro={filtroPeriodo}
          limparHref={hrefDeFiltros("/orcamentos", {
            ...filtros,
            campo: undefined,
            de: undefined,
            ate: undefined,
            motivo: undefined,
          })}
          voltarHref={voltar}
        />
      ) : null}
      <BuscaFiltros
        base="/orcamentos"
        filtros={filtros}
        manter={params.periodo ? { periodo: String(params.periodo) } : {}}
        chips={chips}
        total={pagina.total}
      />
      <FiltrosStatus
        base="/orcamentos"
        atual={filtros.preset}
        contagens={contagemDosPresets(pagina.porStatus)}
        extra={semStatusNaUrl}
      />
      <ListaOrcamentos
        inicial={pagina.cartoes}
        proximoInicial={pagina.proximo}
        params={urlParams}
        gerencia={false}
        config={config}
        vazio={
          pagina.total === 0 && Object.keys(semPreset).length === 0 && filtros.preset === "todos"
            ? "Nenhum orçamento ainda. Toque em Novo para começar."
            : "Nenhum orçamento neste filtro."
        }
      />
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/orcamentos">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Meus orçamentos</h1>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <Lista searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
