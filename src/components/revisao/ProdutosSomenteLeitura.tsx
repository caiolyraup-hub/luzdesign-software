import Link from "next/link";
import { ReabrirEdicao } from "@/components/orcamento/ReabrirEdicao";
import { agruparPorAmbiente, type ItemRevisao } from "@/lib/orcamento/itens";
import {
  moedaCentavos,
  moedaSimples,
  subtotalCentavos,
  totaisDoOrcamento,
} from "@/lib/orcamento/totais";

interface Props {
  orcamentoId: string;
  numero: string;
  clienteNome: string;
  status: string;
  itens: ItemRevisao[];
  ambientes: string[];
  descontoPct: number;
  /** Só a dona pode reabrir, e só de enviado e dos follow-ups. */
  podeReabrir: boolean;
}

/** Produtos de um orçamento já enviado: só leitura. Para mudar, "Editar e enviar nova versão". */
export function ProdutosSomenteLeitura({
  orcamentoId,
  numero,
  clienteNome,
  status,
  itens,
  ambientes,
  descontoPct,
  podeReabrir,
}: Props) {
  const grupos = agruparPorAmbiente(itens, ambientes).filter((g) => g.itens.length > 0);
  const totais = totaisDoOrcamento(
    itens.map((i) => ({ preco_unitario: i.preco, quantidade: i.quantidade })),
    descontoPct,
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Produtos do orçamento</h1>
        <p className="text-lg text-zinc-600">
          {numero} · {clienteNome}
        </p>
      </div>

      <p role="status" className="rounded-lg border-2 border-sky-700 bg-sky-50 p-4 text-lg">
        Orçamento já enviado: os produtos estão só para leitura.
        {podeReabrir
          ? " Para mudar algo, use “Editar e enviar nova versão”."
          : status === "fechado" || status === "perdido"
            ? " Reabra o orçamento para poder editar."
            : ""}
      </p>

      {grupos.map((g) => (
        <section key={g.nome} aria-label={g.nome} className="space-y-2">
          <h2 className="text-xl font-semibold">{g.nome}</h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
            {g.itens.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-lg font-medium">{i.descricao}</p>
                  <p className="text-base text-zinc-600">
                    {i.avulso ? "Item avulso" : `Cód. ${i.codigo}`} · {i.quantidade} {i.unidade} ×{" "}
                    {moedaSimples(i.preco)}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-semibold">
                  {moedaCentavos(subtotalCentavos(i.preco, i.quantidade))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="space-y-1 rounded-lg border-2 border-zinc-300 p-4">
        <p className="flex items-baseline justify-between text-lg">
          <span>Total</span>
          <strong>{moedaCentavos(totais.totalCentavos)}</strong>
        </p>
        <p className="flex items-baseline justify-between text-lg text-zinc-700">
          <span>À vista ({String(totais.percentual).replace(".", ",")}%)</span>
          <strong>{moedaCentavos(totais.aVistaCentavos)}</strong>
        </p>
      </div>

      {podeReabrir ? <ReabrirEdicao orcamentoId={orcamentoId} /> : null}
      <Link
        href={`/orcamentos/${orcamentoId}`}
        className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
      >
        Voltar ao orçamento
      </Link>
    </div>
  );
}
