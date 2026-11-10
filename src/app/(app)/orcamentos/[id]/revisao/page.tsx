import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Revisao } from "@/components/revisao/Revisao";
import type { HistoricoIndicacao } from "@/components/revisao/IndicacaoIA";
import { inicioDoDiaMaceio } from "@/lib/ia/comum";
import { lerConfigIA } from "@/lib/ia/config";
import type { IndicacaoGuardada } from "@/lib/ia/indicacao";
import { criarRepositorioIA } from "@/lib/ia/repositorio-ia";
import { carregarItensRevisao } from "@/lib/orcamento/carregar-itens";
import { ambientesDasRespostas } from "@/lib/orcamento/itens";
import type { Respostas } from "@/lib/orcamento/perguntas";
import { respostasComCliente } from "@/lib/orcamento/respostas";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// "Gerar orçamento" e "Pedir indicação" são Server Actions chamadas desta página.
export const maxDuration = 300;

interface Montagem {
  pendencias?: string[];
  avisos?: string[];
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
  // Só a dona seleciona produtos, e só enquanto for rascunho ou gerado.
  if (orc.vendedora_id !== usuario.id || (orc.status !== "rascunho" && orc.status !== "gerado")) {
    redirect(`/orcamentos/${id}`);
  }

  const cliente = Array.isArray(orc.clientes) ? orc.clientes[0] : orc.clientes;
  const respostas: Respostas = respostasComCliente(orc.respostas as Respostas, cliente);
  const montagem = (orc.montagem ?? {}) as Montagem;
  const itens = await carregarItensRevisao(supabase, id);

  const [{ data: cfg }, { count: anexos }, { data: indicacoes }, usadosHoje] = await Promise.all([
    supabase.from("configuracoes_loja").select("desconto_avista_pct").eq("id", true).maybeSingle(),
    supabase.from("anexos").select("id", { count: "exact", head: true }).eq("orcamento_id", id),
    supabase
      .from("indicacoes_ia")
      .select("ambiente, criado_em, resposta")
      .eq("orcamento_id", id)
      .order("criado_em", { ascending: false })
      .limit(40),
    criarRepositorioIA(supabase, criarClienteAdmin()).contarUso({
      vendedoraId: usuario.id,
      desde: inicioDoDiaMaceio(new Date()),
    }),
  ]);

  // Só a última indicação de cada ambiente.
  const historico: HistoricoIndicacao[] = [];
  for (const i of indicacoes ?? []) {
    if (historico.some((h) => h.ambiente.toLowerCase() === String(i.ambiente).toLowerCase()))
      continue;
    historico.push({
      ambiente: i.ambiente,
      criadoEm: i.criado_em,
      resposta: i.resposta as IndicacaoGuardada,
    });
  }

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
      pedidoClienteInicial={
        typeof respostas.pedido_cliente === "string" ? respostas.pedido_cliente : ""
      }
      temAnexos={(anexos ?? 0) > 0}
      restantesHoje={Math.max(0, lerConfigIA().limiteDiario - usadosHoje)}
      historico={historico}
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
