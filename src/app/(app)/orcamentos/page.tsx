import { connection } from "next/server";
import { Suspense } from "react";
import { CartaoOrcamento, type DadosCartao } from "@/components/orcamento/CartaoOrcamento";
import { FILTROS, FiltrosStatus, filtroPorId } from "@/components/orcamento/FiltrosStatus";
import { lerConfigFollowup } from "@/lib/orcamento/config-followup";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

interface Linha {
  id: string;
  numero: string;
  status: string;
  valor_total: number | string;
  valor_fechado: number | string | null;
  motivo_perda: string | null;
  atualizado_em: string;
  gerado_em: string | null;
  ultimo_envio_em: string | null;
  clientes: { nome: string } | { nome: string }[] | null;
}

async function Lista({ searchParams }: Pick<PageProps<"/orcamentos">, "searchParams">) {
  await connection();
  const { filtro: bruto } = await searchParams;
  const filtro = filtroPorId(Array.isArray(bruto) ? bruto[0] : bruto);

  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();
  // "Meus orçamentos": o filtro é só para a tela; quem protege os dados é a RLS.
  const { data, error } = await supabase
    .from("orcamentos")
    .select(
      "id, numero, status, valor_total, valor_fechado, motivo_perda, atualizado_em, gerado_em, ultimo_envio_em, clientes(nome)",
    )
    .eq("vendedora_id", usuario.id)
    .order("atualizado_em", { ascending: false });

  if (error) return <p role="alert">Não foi possível carregar os orçamentos.</p>;
  const config = await lerConfigFollowup(supabase);
  const linhas = (data ?? []) as unknown as Linha[];

  const contagens = Object.fromEntries(
    FILTROS.map((f) => [
      f.id,
      f.status ? linhas.filter((l) => f.status!.includes(l.status as never)).length : linhas.length,
    ]),
  );
  const visiveis = filtro.status
    ? linhas.filter((l) => filtro.status!.includes(l.status as never))
    : linhas;

  const cartoes: DadosCartao[] = visiveis.map((l) => {
    const cliente = Array.isArray(l.clientes) ? l.clientes[0] : l.clientes;
    return {
      id: l.id,
      numero: l.numero,
      status: l.status,
      clienteNome: cliente?.nome ?? "Sem cliente",
      valorTotal: Number(l.valor_total),
      valorFechado: l.valor_fechado === null ? null : Number(l.valor_fechado),
      motivoPerda: l.motivo_perda,
      atualizadoEm: l.atualizado_em,
      geradoEm: l.gerado_em,
      ultimoEnvioEm: l.ultimo_envio_em,
    };
  });

  return (
    <div className="space-y-4">
      <FiltrosStatus base="/orcamentos" atual={filtro.id} contagens={contagens} />
      {cartoes.length === 0 ? (
        <p className="text-lg text-zinc-600">
          {linhas.length === 0
            ? "Nenhum orçamento ainda. Toque em Novo para começar."
            : "Nenhum orçamento neste filtro."}
        </p>
      ) : (
        <ul className="space-y-3">
          {cartoes.map((c) => (
            <CartaoOrcamento key={c.id} d={c} podeAgir config={config} />
          ))}
        </ul>
      )}
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
