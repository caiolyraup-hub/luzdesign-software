import Link from "next/link";
import { formatarMoeda } from "@/lib/formatar";
import {
  formatarDias,
  formatarDolar,
  formatarPorcentagem,
  porcentagemDe,
  semDados,
  type CustoIA,
  type LinhaMetricas,
  type Metricas,
  type SemanaSerie,
} from "@/lib/metricas/carregar";
import { linkLista } from "@/lib/metricas/lista";
import { paramsDoPeriodo, type Periodo } from "@/lib/metricas/periodo";
import { LISTA_MOTIVOS } from "@/lib/orcamento/status";
import { AZUL, COBRE, GraficoBarrasSemanal, seriesPorVendedora } from "./Graficos";

const celula = "whitespace-nowrap px-3 py-3 text-right text-base";
const cabeca = "whitespace-nowrap px-3 py-3 text-right text-base font-semibold";

function Linha({
  l,
  periodo,
  vendedoraAtual,
  total = false,
}: {
  l: LinhaMetricas;
  periodo: Periodo;
  vendedoraAtual: string | null;
  total?: boolean;
}) {
  const link = (opcoes: Parameters<typeof linkLista>[1]) =>
    linkLista("/gerencia", { ...opcoes, vendedora: total ? null : l.vendedora_id }) + "#lista";
  return (
    <tr className={total ? "border-t-2 border-zinc-400 bg-zinc-50 font-semibold" : "border-t"}>
      <th
        scope="row"
        className="sticky left-0 bg-inherit px-3 py-3 text-left text-base whitespace-nowrap"
      >
        {total || !l.vendedora_id ? (
          l.nome
        ) : (
          <Link
            href={`/gerencia?${new URLSearchParams({
              ...paramsDoPeriodo(periodo),
              ...(vendedoraAtual === l.vendedora_id ? {} : { vendedora: l.vendedora_id }),
            }).toString()}#lista`}
            className="inline-flex min-h-11 items-center underline"
          >
            {l.nome}
          </Link>
        )}
      </th>
      <td className={celula}>
        <Link href={link({ filtro: "todos", periodo, campo: "enviado" })} className="underline">
          {l.enviados}
        </Link>
      </td>
      <td className={celula}>
        <Link href={link({ filtro: "fechados", periodo, campo: "fechado" })} className="underline">
          {l.fechados}
        </Link>
      </td>
      <td className={celula}>{formatarPorcentagem(l.conversao_qtd)}</td>
      <td className={celula}>{formatarPorcentagem(l.conversao_valor)}</td>
      <td className={celula}>{formatarMoeda(l.valor_vendido)}</td>
      <td className={celula}>
        <Link href={link({ filtro: "perdidos", periodo, campo: "perdido" })} className="underline">
          {formatarMoeda(l.valor_perdido)}
        </Link>
      </td>
      <td className={celula}>
        {formatarMoeda(l.em_aberto_valor)} ({l.em_aberto_qtd})
      </td>
      <td className={celula}>{l.ticket_medio === null ? "—" : formatarMoeda(l.ticket_medio)}</td>
      <td className={celula}>{formatarDias(l.mediana_dias)}</td>
      <td className={celula}>{l.followups_vencidos}</td>
    </tr>
  );
}

/** Painel da gerência: tabela comparativa, gráfico semanal, perdidos por motivo e uso da IA. */
export function PainelGerencia({
  metricas,
  periodo,
  serie,
  custo,
  cambio,
  vendedoraAtual,
}: {
  metricas: Metricas;
  periodo: Periodo;
  serie: SemanaSerie[];
  custo: CustoIA | null;
  cambio: number;
  vendedoraAtual: string | null;
}) {
  const { vendedoras, total } = metricas;
  if (semDados(total)) {
    return (
      <p className="rounded-lg border border-zinc-300 p-4 text-lg">
        Nenhum orçamento da equipe neste período. Escolha outro período acima.
      </p>
    );
  }

  const env = seriesPorVendedora(serie, "enviados");
  const fec = seriesPorVendedora(serie, "fechados");
  const cores = [COBRE, AZUL, "#5C6B2F", "#6B3F7A"];
  const comCor = (nomes: { nome: string; valores: number[] }[]) =>
    nomes.map((s, i) => ({ ...s, cor: cores[i % cores.length] }));

  const usdGerado = custo && custo.gerados > 0 ? custo.usd_total / custo.gerados : null;
  const rotuloTipo = (t: string | null) =>
    t === "indicacao"
      ? "Indicação"
      : t === "formatacao"
        ? "Padronização de descrições"
        : (t ?? "Outros");

  return (
    <div className="space-y-8">
      <section aria-label="Comparativo por vendedora" className="space-y-2">
        <h2 className="text-xl font-semibold">Comparativo por vendedora</h2>
        <p className="text-base text-zinc-700">
          Conversão: dos enviados no período, fechados ÷ (fechados + perdidos). Deslize para o lado
          para ver todas as colunas.
        </p>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[56rem] border-collapse bg-white">
            <thead>
              <tr className="border-b-2 border-zinc-400">
                <th
                  scope="col"
                  className="sticky left-0 bg-white px-3 py-3 text-left text-base font-semibold"
                >
                  Vendedora
                </th>
                <th scope="col" className={cabeca}>
                  Enviados
                </th>
                <th scope="col" className={cabeca}>
                  Fechados
                </th>
                <th scope="col" className={cabeca}>
                  Conv. (qtd)
                </th>
                <th scope="col" className={cabeca}>
                  Conv. (valor)
                </th>
                <th scope="col" className={cabeca}>
                  Vendido
                </th>
                <th scope="col" className={cabeca}>
                  Deixou de vender
                </th>
                <th scope="col" className={cabeca}>
                  Em aberto
                </th>
                <th scope="col" className={cabeca}>
                  Ticket médio
                </th>
                <th scope="col" className={cabeca}>
                  Dias até fechar
                </th>
                <th scope="col" className={cabeca}>
                  Follow-ups vencidos
                </th>
              </tr>
            </thead>
            <tbody>
              {vendedoras.map((v) => (
                <Linha
                  key={v.vendedora_id}
                  l={v}
                  periodo={periodo}
                  vendedoraAtual={vendedoraAtual}
                />
              ))}
              <Linha
                l={{ ...total, nome: "Total" }}
                periodo={periodo}
                vendedoraAtual={vendedoraAtual}
                total
              />
            </tbody>
          </table>
        </div>
        <p className="text-base text-zinc-700">
          {total.safra.em_andamento} orçamentos enviados no período ainda estão em andamento: a
          conversão pode subir.
        </p>
      </section>

      <section aria-label="Gráfico semanal" className="space-y-6">
        <h2 className="text-xl font-semibold">Por semana (13 semanas)</h2>
        <GraficoBarrasSemanal
          titulo="Enviados"
          semanas={env.semanas}
          series={comCor(env.porVendedora)}
        />
        <GraficoBarrasSemanal
          titulo="Fechados"
          semanas={fec.semanas}
          series={comCor(fec.porVendedora)}
        />
      </section>

      <section aria-label="Perdido por motivo" className="space-y-2">
        <h2 className="text-xl font-semibold">Perdido por motivo</h2>
        {total.perdidos === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum orçamento perdido neste período.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[28rem] border-collapse">
              <thead>
                <tr className="border-b-2 border-zinc-400">
                  <th scope="col" className="px-3 py-3 text-left text-base font-semibold">
                    Motivo
                  </th>
                  {vendedoras.map((v) => (
                    <th key={v.vendedora_id} scope="col" className={cabeca}>
                      {v.nome}
                    </th>
                  ))}
                  <th scope="col" className={cabeca}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {LISTA_MOTIVOS.filter((mo) => total.perdas.some((p) => p.motivo === mo.valor)).map(
                  (mo) => {
                    const de = (l: LinhaMetricas) => l.perdas.find((p) => p.motivo === mo.valor);
                    const texto = (p?: { quantidade: number; valor: number }) =>
                      p ? `${p.quantidade} · ${formatarMoeda(p.valor)}` : "—";
                    return (
                      <tr key={mo.valor} className="border-t">
                        <th scope="row" className="px-3 py-3 text-left text-base font-normal">
                          {mo.rotulo}
                        </th>
                        {vendedoras.map((v) => (
                          <td key={v.vendedora_id} className={celula}>
                            {texto(de(v))}
                          </td>
                        ))}
                        <td className={`${celula} font-semibold`}>{texto(de(total))}</td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Uso da IA" className="space-y-2">
        <h2 className="text-xl font-semibold">Uso da IA</h2>
        <dl className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
          <div className="flex items-baseline justify-between gap-3 p-4 text-lg">
            <dt>Indicações pedidas</dt>
            <dd className="text-right font-semibold">
              {total.indicacoes_pedidas}
              {vendedoras.length > 1
                ? ` (${vendedoras.map((v) => `${v.nome} ${v.indicacoes_pedidas}`).join(", ")})`
                : ""}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 p-4 text-lg">
            <dt>Itens vindos da Indicação</dt>
            <dd className="text-right font-semibold">
              {porcentagemDe(total.itens_indicacao_ia, total.itens_total)} (
              {total.itens_indicacao_ia} de {total.itens_total})
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 p-4 text-lg">
            <dt>Itens vindos de Colar lista</dt>
            <dd className="text-right font-semibold">
              {porcentagemDe(total.itens_lista_colada, total.itens_total)}
            </dd>
          </div>
          {custo ? (
            <>
              <div className="flex items-baseline justify-between gap-3 p-4 text-lg">
                <dt>Custo no período</dt>
                <dd className="text-right font-semibold">
                  {formatarDolar(custo.usd_total)} · {formatarMoeda(custo.usd_total * cambio)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 p-4 text-lg">
                <dt>Custo médio por orçamento gerado</dt>
                <dd className="text-right font-semibold">
                  {usdGerado === null
                    ? "—"
                    : `${formatarDolar(usdGerado)} · ${formatarMoeda(usdGerado * cambio)}`}
                </dd>
              </div>
              {custo.por_tipo.map((t) => (
                <div
                  key={t.tipo ?? "outros"}
                  className="flex items-baseline justify-between gap-3 p-4 text-base text-zinc-700"
                >
                  <dt>{rotuloTipo(t.tipo)}</dt>
                  <dd className="text-right">
                    {formatarDolar(t.usd)} · {t.chamadas}{" "}
                    {t.chamadas === 1 ? "chamada" : "chamadas"}
                  </dd>
                </div>
              ))}
            </>
          ) : null}
        </dl>
        <p className="text-base text-zinc-700">
          Custo estimado, com o dólar a R$ {String(cambio.toFixed(2)).replace(".", ",")} (ajuste em{" "}
          <Link href="/gerencia/configuracoes" className="underline">
            Ajustes
          </Link>
          ). Orçamentos de teste não entram.
        </p>
      </section>
    </div>
  );
}
