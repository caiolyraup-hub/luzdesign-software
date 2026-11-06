import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Revisao } from "@/components/revisao/Revisao";
import { carregarItensRevisao } from "@/lib/orcamento/carregar-itens";
import { ambientesDasRespostas } from "@/lib/orcamento/itens";
import type { Respostas } from "@/lib/orcamento/perguntas";
import { respostasComCliente } from "@/lib/orcamento/respostas";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// "Gerar PDF" e "Montar de novo com IA" são Server Actions chamadas desta página.
export const maxDuration = 300;

interface Montagem {
  pendencias?: string[];
  avisos?: string[];
  resumo?: string;
  ambientes_extras?: string[];
}

async function Carregar({ params }: Pick<PageProps<"/orcamentos/[id]/revisao">, "params">) {
  const { id } = await params;
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();

  const { data: orc } = await supabase
    .from("orcamentos")
    .select(
      "id, numero, vendedora_id, status, respostas, montagem, valor_total, pdf_versao, clientes(nome, whatsapp)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!orc) notFound();
  // Só a dona revisa, e só enquanto for rascunho ou gerado.
  if (orc.vendedora_id !== usuario.id || (orc.status !== "rascunho" && orc.status !== "gerado")) {
    redirect(`/orcamentos/${id}`);
  }

  const cliente = Array.isArray(orc.clientes) ? orc.clientes[0] : orc.clientes;
  const respostas: Respostas = respostasComCliente(orc.respostas as Respostas, cliente);
  const montagem = (orc.montagem ?? {}) as Montagem;
  const itens = await carregarItensRevisao(supabase, id);

  const { data: cfg } = await supabase
    .from("configuracoes_loja")
    .select("desconto_avista_pct")
    .eq("id", true)
    .maybeSingle();

  return (
    <Revisao
      orcamentoId={id}
      numero={orc.numero}
      clienteNome={cliente?.nome ?? "Sem cliente"}
      status={orc.status as "rascunho" | "gerado"}
      pdfVersao={orc.pdf_versao}
      estadoInicial={{
        itens,
        valorTotal: Number(orc.valor_total),
        ambientesExtras: montagem.ambientes_extras ?? [],
      }}
      ambientesBase={ambientesDasRespostas(respostas)}
      descontoPct={Number(cfg?.desconto_avista_pct ?? 10)}
      pendencias={montagem.pendencias ?? []}
      avisos={montagem.avisos ?? []}
      resumoIA={montagem.resumo ?? null}
      podeMontarIA={orc.status === "rascunho"}
    />
  );
}

export default function Page({ params }: PageProps<"/orcamentos/[id]/revisao">) {
  return (
    <Suspense fallback={<p className="text-lg text-zinc-600">Carregando...</p>}>
      <Carregar params={params} />
    </Suspense>
  );
}
