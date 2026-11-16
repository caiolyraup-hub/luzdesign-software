import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar } from "@/components/arquitetos/Avatar";
import { FechamentosAnteriores, Lancamentos } from "@/components/comissoes/AcoesComissoes";
import {
  resolverPeriodoComissao,
  semPercentuais,
  type ResumoBeneficiario,
} from "@/lib/comissoes/calculo";
import { carregarComissoes, lerPercentuais } from "@/lib/comissoes/carregar";
import { formatarMoeda, hojeMaceioISO } from "@/lib/formatar";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Param = string | string[] | undefined;
const um = (v: Param) => (Array.isArray(v) ? v[0] : v);
const campo = "min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg";

async function Conteudo({ searchParams }: Pick<PageProps<"/comissoes">, "searchParams">) {
  await connection();
  const params = await searchParams;
  const hoje = hojeMaceioISO();
  const periodoParam = um(params.periodo);
  const periodo = resolverPeriodoComissao(
    {
      periodo: periodoParam,
      de: um(params.de) ? `${um(params.de)}-01` : undefined,
      ate: um(params.ate) ? `${um(params.ate)}-01` : undefined,
    },
    hoje,
  );
  const statusParam = um(params.status);
  const status = statusParam === "a_pagar" || statusParam === "paga" ? statusParam : "todas";
  const aba = um(params.aba) === "vendedoras" ? "vendedoras" : "arquitetos";

  const supabase = await criarClienteServidor();
  const [dados, percentuais] = await Promise.all([
    carregarComissoes(supabase, periodo, status),
    lerPercentuais(supabase),
  ]);
  const sem = semPercentuais(percentuais);

  const q = new URLSearchParams();
  if (periodoParam) q.set("periodo", periodoParam);
  if (um(params.de)) q.set("de", um(params.de)!);
  if (um(params.ate)) q.set("ate", um(params.ate)!);
  if (status !== "todas") q.set("status", status);
  const abaHref = (a: string) =>
    `/comissoes?${new URLSearchParams({ ...Object.fromEntries(q), aba: a })}`;

  const lista: ResumoBeneficiario[] =
    aba === "arquitetos" ? dados.resumo.porArquiteto : dados.resumo.porVendedora;
  const nomes = aba === "arquitetos" ? dados.nomes.arquitetos : dados.nomes.vendedoras;

  return (
    <div className="space-y-5">
      {sem ? (
        <div
          role="status"
          className="space-y-2 rounded-lg border-2 border-amber-700 bg-amber-50 p-4"
        >
          <p className="text-lg font-medium">Defina os percentuais em Ajustes de comissão.</p>
          <p className="text-base text-zinc-700">Enquanto estiverem vazios, nada é calculado.</p>
          <Link
            href="/comissoes/ajustes"
            className="flex min-h-12 items-center justify-center rounded-lg bg-amber-700 text-lg font-semibold text-white"
          >
            Ajustes de comissão
          </Link>
        </div>
      ) : null}

      <form method="get" className="space-y-3 rounded-lg border border-zinc-200 p-3">
        <input type="hidden" name="aba" value={aba} />
        <label className="block space-y-1">
          <span className="text-lg font-medium">Período (competência)</span>
          <select name="periodo" defaultValue={periodoParam ?? "atual"} className={campo}>
            <option value="atual">Mês atual</option>
            <option value="anterior">Mês anterior</option>
            <option value="intervalo">Intervalo</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-base">De</span>
            <input type="month" name="de" defaultValue={um(params.de)} className={campo} />
          </label>
          <label className="block space-y-1">
            <span className="text-base">Até</span>
            <input type="month" name="ate" defaultValue={um(params.ate)} className={campo} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-lg font-medium">Status</span>
          <select name="status" defaultValue={status} className={campo}>
            <option value="todas">Todas</option>
            <option value="a_pagar">A pagar</option>
            <option value="paga">Pagas</option>
          </select>
        </label>
        <button
          type="submit"
          className="min-h-14 w-full rounded-lg bg-zinc-900 px-4 text-lg font-semibold text-white"
        >
          Filtrar
        </button>
      </form>

      <p role="status" className="text-lg text-zinc-700">
        Competência: <strong>{periodo.rotulo}</strong>
      </p>

      <dl className="grid grid-cols-2 gap-3">
        {(
          [
            ["A pagar", dados.resumo.aPagar],
            ["Pagas no período", dados.resumo.pagas],
            ["Arquitetos", dados.resumo.arquitetos],
            ["Vendedoras", dados.resumo.vendedoras],
          ] as const
        ).map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-lg border border-zinc-200 p-3">
            <dt className="text-base text-zinc-600">{rotulo}</dt>
            <dd className="text-xl font-semibold">{formatarMoeda(valor)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href={`/comissoes/exportar?${q}`}
          className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg font-medium"
        >
          Exportar planilha
        </Link>
        <Link
          href="/comissoes/ajustes"
          className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg font-medium"
        >
          Ajustes de comissão
        </Link>
      </div>

      <nav aria-label="Abas" className="grid grid-cols-2 gap-2">
        {(["arquitetos", "vendedoras"] as const).map((a) => (
          <Link
            key={a}
            href={abaHref(a)}
            aria-current={aba === a ? "page" : undefined}
            className="flex min-h-12 items-center justify-center rounded-lg border border-zinc-300 text-lg aria-[current=page]:border-amber-700 aria-[current=page]:bg-amber-50 aria-[current=page]:font-semibold"
          >
            {a === "arquitetos" ? "Arquitetos" : "Vendedoras"}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <p className="text-lg text-zinc-600">Nenhuma comissão neste período.</p>
      ) : (
        <ul className="space-y-3">
          {lista.map((b) => {
            const nome = nomes.get(b.beneficiarioId) ?? "—";
            const dele = dados.lancamentos.filter(
              (l) =>
                l.tipo === (aba === "arquitetos" ? "arquiteto" : "vendedora") &&
                l.beneficiarioId === b.beneficiarioId,
            );
            return (
              <li key={b.beneficiarioId} className="rounded-lg border border-zinc-200 bg-white">
                <details>
                  <summary className="flex min-h-16 cursor-pointer items-center gap-3 p-3">
                    {aba === "arquitetos" ? (
                      <Avatar nome={nome} url={dados.fotos.get(b.beneficiarioId) ?? null} />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-semibold">{nome}</span>
                      <span className="block text-base text-zinc-600">
                        {b.vendas} {b.vendas === 1 ? "venda" : "vendas"} ·{" "}
                        {formatarMoeda(b.vendido)} vendido
                      </span>
                      <span className="block text-base">
                        A pagar <strong>{formatarMoeda(b.aPagar)}</strong> · paga{" "}
                        <strong>{formatarMoeda(b.paga)}</strong>
                      </span>
                    </span>
                  </summary>
                  <div className="border-t border-zinc-200 p-3">
                    <Lancamentos lancamentos={dele} hoje={hoje} />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {!sem ? <FechamentosAnteriores /> : null}
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/comissoes">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Comissões</h1>
      <Suspense fallback={<p className="text-lg text-zinc-600">Carregando...</p>}>
        <Conteudo searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
