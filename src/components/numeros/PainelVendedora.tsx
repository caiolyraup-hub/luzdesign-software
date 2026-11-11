import Link from "next/link";
import { formatarMoeda } from "@/lib/formatar";
import {
  formatarDias,
  formatarPorcentagem,
  porcentagemDe,
  semDados,
  type LinhaMetricas,
  type SemanaSerie,
} from "@/lib/metricas/carregar";
import { linkLista } from "@/lib/metricas/lista";
import type { Periodo } from "@/lib/metricas/periodo";
import {
  AZUL,
  BarrasMotivos,
  COBRE,
  Funil,
  GraficoBarrasSemanal,
  seriesPorVendedora,
} from "./Graficos";

function Cartao({
  titulo,
  valor,
  linhas,
  href,
  destaque = false,
}: {
  titulo: string;
  valor: string;
  linhas: string[];
  href: string;
  destaque?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block min-h-32 space-y-1 rounded-lg border-2 p-4 ${
        destaque ? "border-[#9F5F47] bg-[#9F5F47]/10" : "border-zinc-300 bg-white"
      }`}
    >
      <span className="block text-base font-medium text-zinc-700">{titulo}</span>
      <strong className="block text-2xl leading-tight">{valor}</strong>
      {linhas.map((l) => (
        <span key={l} className="block text-base text-zinc-700">
          {l}
        </span>
      ))}
    </Link>
  );
}

/** Painel de números da vendedora: o que vendeu, converteu, deixou de vender e tem em aberto. */
export function PainelVendedora({
  m,
  periodo,
  serie,
}: {
  m: LinhaMetricas;
  periodo: Periodo;
  serie: SemanaSerie[];
}) {
  if (semDados(m)) {
    return (
      <div className="space-y-2 rounded-lg border border-zinc-300 p-4 text-lg">
        <p>
          Nenhum orçamento neste período. Escolha outro período acima ou crie um novo orçamento.
        </p>
        {m.em_aberto_qtd > 0 ? (
          <p>
            Em aberto agora: {m.em_aberto_qtd} {m.em_aberto_qtd === 1 ? "orçamento" : "orçamentos"}{" "}
            ({formatarMoeda(m.em_aberto_valor)}).{" "}
            <Link href="/orcamentos?filtro=followup" className="underline">
              Ver
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  const lista = (opcoes: {
    filtro: string;
    campo?: Parameters<typeof linkLista>[1]["campo"];
    motivo?: string;
  }) => linkLista("/orcamentos", { ...opcoes, periodo: opcoes.campo ? periodo : undefined });
  const resolvidos = m.safra.fechados + m.safra.perdidos;
  const { semanas, porVendedora } = seriesPorVendedora(serie, "enviados");
  const fechadosSemana = seriesPorVendedora(serie, "fechados").porVendedora;

  return (
    <div className="space-y-8">
      <section aria-label="Resumo do período" className="grid grid-cols-2 gap-3">
        <Cartao
          destaque
          titulo="Vendido"
          valor={formatarMoeda(m.valor_vendido)}
          linhas={[`${m.fechados} ${m.fechados === 1 ? "fechado" : "fechados"}`]}
          href={lista({ filtro: "fechados", campo: "fechado" })}
        />
        <Cartao
          titulo="Conversão"
          valor={formatarPorcentagem(m.conversao_qtd)}
          linhas={[
            `em valor: ${formatarPorcentagem(m.conversao_valor)}`,
            resolvidos > 0 || m.safra.em_andamento > 0
              ? `${m.safra.fechados} de ${m.safra.enviados} enviados fecharam · ${m.safra.em_andamento} em andamento`
              : "nenhum enviado no período",
          ]}
          href={lista({ filtro: "todos", campo: "enviado" })}
        />
        <Cartao
          titulo="Em aberto (agora)"
          valor={formatarMoeda(m.em_aberto_valor)}
          linhas={[`${m.em_aberto_qtd} ${m.em_aberto_qtd === 1 ? "orçamento" : "orçamentos"}`]}
          href={lista({ filtro: "followup" })}
        />
        <Cartao
          titulo="Deixou de vender"
          valor={formatarMoeda(m.valor_perdido)}
          linhas={[`${m.perdidos} ${m.perdidos === 1 ? "perdido" : "perdidos"}`]}
          href={lista({ filtro: "perdidos", campo: "perdido" })}
        />
      </section>

      <section aria-label="Funil" className="space-y-2">
        <h2 className="text-xl font-semibold">Funil do período</h2>
        <Funil
          etapas={[
            {
              rotulo: "Criados",
              quantidade: m.criados,
              href: lista({ filtro: "todos", campo: "criado" }),
            },
            {
              rotulo: "Gerados",
              quantidade: m.gerados,
              href: lista({ filtro: "todos", campo: "gerado" }),
            },
            {
              rotulo: "Enviados",
              quantidade: m.enviados,
              href: lista({ filtro: "todos", campo: "enviado" }),
            },
            {
              rotulo: "Fechados",
              quantidade: m.fechados,
              href: lista({ filtro: "fechados", campo: "fechado" }),
            },
          ]}
        />
      </section>

      <section aria-label="Por que perdi" className="space-y-2">
        <h2 className="text-xl font-semibold">Por que perdi</h2>
        {m.perdas.length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum orçamento perdido neste período.</p>
        ) : (
          <BarrasMotivos
            perdas={m.perdas}
            hrefDe={(motivo) => lista({ filtro: "perdidos", campo: "perdido", motivo })}
          />
        )}
      </section>

      <section aria-label="Outros números" className="space-y-1">
        <h2 className="text-xl font-semibold">Outros números</h2>
        <dl className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
          <div className="flex items-baseline justify-between gap-3 p-4 text-lg">
            <dt>Ticket médio</dt>
            <dd className="font-semibold">
              {m.ticket_medio === null ? "—" : formatarMoeda(m.ticket_medio)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 p-4 text-lg">
            <dt>Tempo até fechar (mediana)</dt>
            <dd className="font-semibold">{formatarDias(m.mediana_dias)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 p-4 text-lg">
            <dt>Follow-ups vencidos</dt>
            <dd className="font-semibold">
              {m.followups_vencidos > 0 ? (
                <Link href="/" className="underline">
                  {m.followups_vencidos} · ver em Para hoje
                </Link>
              ) : (
                "nenhum"
              )}
            </dd>
          </div>
        </dl>
      </section>

      {serie.length > 0 ? (
        <section aria-label="Por semana" className="space-y-6">
          <h2 className="text-xl font-semibold">Por semana (13 semanas)</h2>
          <GraficoBarrasSemanal
            titulo="Enviados e fechados"
            semanas={semanas}
            series={[
              { nome: "Enviados", cor: AZUL, valores: porVendedora[0]?.valores ?? [] },
              { nome: "Fechados", cor: COBRE, valores: fechadosSemana[0]?.valores ?? [] },
            ]}
          />
        </section>
      ) : null}

      <p className="text-lg text-zinc-700">
        Indicação da IA: {m.indicacoes_pedidas} {m.indicacoes_pedidas === 1 ? "pedido" : "pedidos"},{" "}
        {porcentagemDe(m.itens_indicacao_ia, m.itens_total)} dos itens dos orçamentos gerados no
        período.
      </p>
    </div>
  );
}
