import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { MontarComIA } from "@/components/orcamento/MontarComIA";
import { formatarMoeda } from "@/lib/formatar";
import { lerConfigIA } from "@/lib/ia/config";
import { centavosParaReais, subtotalCentavos } from "@/lib/ia/normalizar";
import { PASSO_RESUMO } from "@/lib/orcamento/perguntas";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// "Montar de novo" é uma Server Action chamada desta página: precisa de tempo.
export const maxDuration = 300;

const DESCONTO_A_VISTA = 0.1;
const quantidadeBR = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

interface ItemLinha {
  id: string;
  codigo: string | null;
  descricao_congelada: string;
  preco_unitario_congelado: number;
  quantidade: number;
  ambiente: string | null;
  avulso: boolean;
  justificativa: string | null;
  ordem: number;
  produtos: { unidade: string } | { unidade: string }[] | null;
}

interface Montagem {
  geracoes?: number;
  pendencias?: string[];
  avisos?: string[];
  resumo?: string;
}

async function Itens({ params }: Pick<PageProps<"/orcamentos/[id]/itens">, "params">) {
  const { id } = await params;
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();

  const { data: orcamento } = await supabase
    .from("orcamentos")
    .select("id, numero, status, vendedora_id, montado_em, montagem, clientes(nome)")
    .eq("id", id)
    .maybeSingle();
  if (!orcamento) notFound();

  const minha = orcamento.vendedora_id === usuario.id;
  const emRascunho = orcamento.status === "rascunho";
  const montagem = (orcamento.montagem ?? {}) as Montagem;
  const cliente = Array.isArray(orcamento.clientes) ? orcamento.clientes[0] : orcamento.clientes;

  const { data } = await supabase
    .from("orcamento_itens")
    .select(
      "id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, justificativa, ordem, produtos(unidade)",
    )
    .eq("orcamento_id", id)
    .order("ordem");
  const itens = (data ?? []) as unknown as ItemLinha[];

  if (!orcamento.montado_em && itens.length === 0) {
    if (minha && emRascunho) redirect(`/orcamentos/${id}/editar?passo=${PASSO_RESUMO}`);
    return <p className="text-lg text-zinc-600">Este orçamento ainda não tem itens.</p>;
  }

  // Ambientes na ordem em que a IA montou.
  const ambientes: { nome: string; itens: ItemLinha[] }[] = [];
  for (const item of itens) {
    const nome = item.ambiente ?? "Geral";
    const grupo = ambientes.find((a) => a.nome === nome);
    if (grupo) grupo.itens.push(item);
    else ambientes.push({ nome, itens: [item] });
  }

  const totalCentavos = itens.reduce(
    (s, i) => s + subtotalCentavos(Number(i.preco_unitario_congelado), Number(i.quantidade)),
    0,
  );
  const aVistaCentavos = Math.round(totalCentavos * (1 - DESCONTO_A_VISTA));
  const avulsos = itens.filter((i) => i.avulso).length;

  const config = lerConfigIA();
  const usadas = montagem.geracoes ?? 0;
  const restantes = Math.max(0, config.maxGeracoesPorOrcamento - usadas);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Itens do orçamento</h1>
        <p className="text-lg text-zinc-600">
          {orcamento.numero} · {cliente?.nome ?? "Sem cliente"}
        </p>
      </div>

      {montagem.resumo ? (
        <p className="rounded-lg bg-zinc-50 p-4 text-lg whitespace-pre-wrap">{montagem.resumo}</p>
      ) : null}

      {(montagem.pendencias?.length ?? 0) > 0 ? (
        <section
          aria-labelledby="pendencias"
          className="space-y-2 rounded-lg border-2 border-amber-700 bg-amber-50 p-4"
        >
          <h2 id="pendencias" className="text-xl font-semibold">
            Pendências
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-lg">
            {montagem.pendencias!.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {(montagem.avisos?.length ?? 0) > 0 ? (
        <section
          aria-labelledby="avisos"
          className="space-y-2 rounded-lg border border-zinc-300 p-4"
        >
          <h2 id="avisos" className="text-xl font-semibold">
            Avisos
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-lg text-zinc-700">
            {montagem.avisos!.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {ambientes.map((ambiente) => (
        <section key={ambiente.nome} aria-label={ambiente.nome} className="space-y-3">
          <h2 className="text-xl font-semibold">{ambiente.nome}</h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
            {ambiente.itens.map((i) => {
              const produto = Array.isArray(i.produtos) ? i.produtos[0] : i.produtos;
              const unidade = i.avulso ? "un" : (produto?.unidade ?? "un");
              const subtotal = subtotalCentavos(
                Number(i.preco_unitario_congelado),
                Number(i.quantidade),
              );
              return (
                <li key={i.id} className="space-y-1 p-4">
                  <p className="text-lg font-medium">{i.descricao_congelada}</p>
                  <p className="text-base text-zinc-600">
                    {i.avulso ? "Item avulso" : `Cód. ${i.codigo}`} ·{" "}
                    {quantidadeBR.format(Number(i.quantidade))} {unidade}
                    {i.avulso
                      ? ""
                      : ` · ${formatarMoeda(Number(i.preco_unitario_congelado))}/${unidade}`}
                  </p>
                  {i.avulso ? (
                    <p className="inline-block rounded-full bg-amber-100 px-3 py-1 text-base font-medium text-amber-900">
                      Preço a definir
                    </p>
                  ) : (
                    <p className="text-lg font-semibold">
                      {formatarMoeda(centavosParaReais(subtotal))}
                    </p>
                  )}
                  {i.justificativa ? (
                    <p className="text-base text-zinc-600">{i.justificativa}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section aria-label="Totais" className="space-y-2 rounded-lg border-2 border-zinc-300 p-4">
        <p className="flex items-baseline justify-between text-lg">
          <span>Total</span>
          <span className="text-2xl font-semibold">
            {formatarMoeda(centavosParaReais(totalCentavos))}
          </span>
        </p>
        <p className="flex items-baseline justify-between text-lg text-zinc-700">
          <span>À vista (10% de desconto)</span>
          <span className="font-semibold">{formatarMoeda(centavosParaReais(aVistaCentavos))}</span>
        </p>
        {avulsos > 0 ? (
          <p className="text-base text-amber-900">
            {avulsos} item(ns) avulso(s) com preço a definir não entram no total.
          </p>
        ) : null}
      </section>

      {minha && emRascunho ? (
        <div className="space-y-3">
          <MontarComIA
            orcamentoId={id}
            rotulo="Montar de novo"
            secundario
            desabilitado={restantes === 0}
            dica={
              restantes === 0
                ? "Você usou todas as montagens deste orçamento."
                : `${restantes} ${restantes === 1 ? "tentativa restante" : "tentativas restantes"} neste orçamento.`
            }
          />
          <Link
            href={`/orcamentos/${id}/editar?passo=${PASSO_RESUMO}`}
            className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
          >
            Voltar ao resumo
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export default function Page({ params }: PageProps<"/orcamentos/[id]/itens">) {
  return (
    <Suspense fallback={<p className="text-lg text-zinc-600">Carregando...</p>}>
      <Itens params={params} />
    </Suspense>
  );
}
