import Link from "next/link";
import { formatarMediana, hojeEmMaceio, type ResumoPiloto } from "@/lib/piloto/resumo";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const hora = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Maceio" });

function somarDia(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Resumo do dia do piloto (só gerência e dono): números por vendedora, relatos, erros e custo de IA. */
export async function ResumoDia({ dia }: { dia?: string }) {
  const hoje = hojeEmMaceio();
  const alvo = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : hoje;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("resumo_piloto", { p_dia: alvo });
  if (error || !data) {
    return <p className="text-lg text-red-800">Não foi possível carregar o resumo agora.</p>;
  }
  const r = data as unknown as ResumoPiloto;
  const [a, m, d] = alvo.split("-");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/relatos?status=resumo&dia=${somarDia(alvo, -1)}`}
          className="flex min-h-12 items-center rounded-lg border border-zinc-300 px-3 text-lg"
        >
          ← Dia anterior
        </Link>
        <h2 className="text-xl font-semibold">
          {d}/{m}/{a}
        </h2>
        {alvo < hoje ? (
          <Link
            href={`/relatos?status=resumo&dia=${somarDia(alvo, 1)}`}
            className="flex min-h-12 items-center rounded-lg border border-zinc-300 px-3 text-lg"
          >
            Próximo →
          </Link>
        ) : (
          <span className="w-24" />
        )}
      </div>

      <ul className="space-y-3">
        {r.vendedoras.map((v) => (
          <li key={v.nome} className="space-y-1 rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xl font-semibold">{v.nome}</p>
            <p className="text-lg">
              {v.criados} criados · {v.gerados} gerados · {v.enviados} enviados
            </p>
            <p className="text-lg text-zinc-700">
              Do rascunho até gerar (mediana): {formatarMediana(v.mediana_ate_gerar_min)}
            </p>
            <p className="text-base text-zinc-700">
              Itens: {v.itens.manual} manual · {v.itens.kit} kit de fita · {v.itens.lista_colada}{" "}
              lista colada · {v.itens.indicacao_ia} Indicação da IA · {v.itens.montagem_ia} montagem
              da IA
            </p>
          </li>
        ))}
      </ul>

      <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
        <h3 className="text-lg font-semibold">Relatos abertos ({r.relatos_abertos.length})</h3>
        {r.relatos_abertos.length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum.</p>
        ) : (
          <ul className="space-y-2">
            {r.relatos_abertos.map((x, i) => (
              <li key={i} className="text-base">
                <span className="text-zinc-600">
                  {x.quem}
                  {x.tela ? ` · ${x.tela}` : ""}
                </span>
                <p className="text-lg whitespace-pre-wrap">{x.mensagem}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
        <h3 className="text-lg font-semibold">Erros do dia ({r.erros.length})</h3>
        {r.erros.length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum.</p>
        ) : (
          <ul className="space-y-1">
            {r.erros.map((x, i) => (
              <li key={i} className="text-base">
                {hora.format(new Date(x.criado_em))} · {x.origem}
                {x.rota ? ` ${x.rota}` : ""}: {x.mensagem}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-lg">Custo de IA do dia: US$ {Number(r.custo_ia_usd).toFixed(4)}</p>
    </div>
  );
}
