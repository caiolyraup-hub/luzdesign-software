import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { AnexoView } from "../../acoes";
import { Editor } from "@/components/orcamento/Editor";
import { PASSO_RESUMO, primeiroPassoPendente, type Respostas } from "@/lib/orcamento/perguntas";
import type { TipoAnexo } from "@/lib/orcamento/perguntas";
import { normalizarWhatsapp } from "@/lib/orcamento/perguntas";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const VALIDADE_URL_SEGUNDOS = 3600;

function passoPedido(bruto: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(bruto) ? bruto[0] : bruto);
  return Number.isInteger(n) && n >= 1 && n <= PASSO_RESUMO ? n : null;
}

async function Carregar({
  params,
  searchParams,
}: Pick<PageProps<"/orcamentos/[id]/editar">, "params" | "searchParams">) {
  const { id } = await params;
  const { passo } = await searchParams;
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();

  const { data: orcamento } = await supabase
    .from("orcamentos")
    .select(
      "id, vendedora_id, status, respostas, clientes(nome, whatsapp, tipo, arquiteto_indicador)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!orcamento) notFound();
  // Só a dona edita, e só enquanto for rascunho.
  if (orcamento.vendedora_id !== usuario.id || orcamento.status !== "rascunho") {
    redirect(`/orcamentos/${id}`);
  }

  // Rascunhos antigos (ou do seed) podem não ter tudo em respostas: completa pelo cadastro do cliente.
  const cliente = Array.isArray(orcamento.clientes) ? orcamento.clientes[0] : orcamento.clientes;
  const doCliente: Respostas = {};
  if (cliente?.nome) doCliente.cliente_nome = cliente.nome;
  if (cliente?.whatsapp && normalizarWhatsapp(cliente.whatsapp)) {
    doCliente.cliente_whatsapp = normalizarWhatsapp(cliente.whatsapp);
  }
  const respostas: Respostas = { ...doCliente, ...(orcamento.respostas as Respostas) };

  const { data: linhas } = await supabase
    .from("anexos")
    .select("id, tipo, nome_original, mime_type, caminho_storage")
    .eq("orcamento_id", id)
    .order("criado_em");

  const caminhos = (linhas ?? []).map((l) => l.caminho_storage);
  const { data: urls } = caminhos.length
    ? await supabase.storage.from("anexos").createSignedUrls(caminhos, VALIDADE_URL_SEGUNDOS)
    : { data: [] };
  const anexos: AnexoView[] = (linhas ?? []).map((l) => ({
    id: l.id,
    tipo: l.tipo as TipoAnexo,
    nome_original: l.nome_original,
    mime_type: l.mime_type,
    url: urls?.find((u) => u.path === l.caminho_storage)?.signedUrl ?? null,
  }));

  // Sem ?passo=: volta para a primeira obrigatória ainda vazia (ou o resumo, se estiver tudo respondido).
  const passoInicial = passoPedido(passo) ?? primeiroPassoPendente(respostas) ?? PASSO_RESUMO;

  return (
    <Editor
      orcamentoId={id}
      respostasIniciais={respostas}
      anexosIniciais={anexos}
      passoInicial={passoInicial}
    />
  );
}

export default function Page({ params, searchParams }: PageProps<"/orcamentos/[id]/editar">) {
  return (
    <Suspense fallback={<p className="text-lg text-zinc-600">Carregando...</p>}>
      <Carregar params={params} searchParams={searchParams} />
    </Suspense>
  );
}
