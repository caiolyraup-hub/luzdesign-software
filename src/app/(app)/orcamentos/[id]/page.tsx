import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { StatusOrcamento } from "@/lib/dominio";
import { BadgeStatus } from "@/components/BadgeStatus";
import { StatusAcoes } from "@/components/orcamento/StatusAcoes";
import { CompartilharPdf } from "@/components/orcamento/CompartilharPdf";
import { ReabrirEdicao } from "@/components/orcamento/ReabrirEdicao";
import { PreviaPdf } from "@/components/orcamento/PreviaPdf";
import { formatarDataBR, formatarDataHora, isoParaBR } from "@/lib/formatar";
import { nomeArquivoOrcamento } from "@/lib/orcamento/arquivos";
import { montarLinhaDoTempo } from "@/lib/orcamento/linha-do-tempo";
import { rotuloMotivo } from "@/lib/orcamento/status";
import { descontoAvistaCentavos, moedaCentavos } from "@/lib/orcamento/totais";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const VALIDADE_URL_SEGUNDOS = 3600;

interface VersaoPdf {
  versao: number;
  caminho: string;
  /** Versões antigas (antes do dia 8) não têm planilha. */
  xlsx_caminho?: string | null;
  gerado_em: string;
  valor_total: number;
}

async function Detalhe({ params }: Pick<PageProps<"/orcamentos/[id]">, "params">) {
  const { id } = await params;
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();

  const { data: orc } = await supabase
    .from("orcamentos")
    .select(
      "id, numero, status, vendedora_id, valor_total, valor_fechado, motivo_perda, validade, criado_em, montado_em, gerado_em, enviado_em, ultimo_envio_em, pdf_caminho, xlsx_caminho, pdf_versao, pdf_versoes, clientes(nome, whatsapp)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!orc) notFound();

  const minha = orc.vendedora_id === usuario.id;
  const cliente = Array.isArray(orc.clientes) ? orc.clientes[0] : orc.clientes;
  const versoes = ((orc.pdf_versoes ?? []) as VersaoPdf[]).sort((a, b) => b.versao - a.versao);
  const temPdf = Boolean(orc.pdf_caminho);

  const [{ data: eventos }, { data: cfg }] = await Promise.all([
    supabase
      .from("eventos")
      .select("de_status, para_status, criado_em")
      .eq("orcamento_id", id)
      .order("criado_em"),
    supabase
      .from("configuracoes_loja")
      .select("nome_fantasia, desconto_avista_pct")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const nomePdf = nomeArquivoOrcamento(cliente?.nome, orc.gerado_em, orc.numero, "pdf");
  const nomeXlsx = nomeArquivoOrcamento(cliente?.nome, orc.gerado_em, orc.numero, "xlsx");
  let urlPdf: string | null = null;
  let urlDownload: string | null = null;
  let urlXlsx: string | null = null;
  if (temPdf) {
    const [ver, baixar, planilha] = await Promise.all([
      supabase.storage.from("pdfs").createSignedUrl(orc.pdf_caminho, VALIDADE_URL_SEGUNDOS),
      supabase.storage
        .from("pdfs")
        .createSignedUrl(orc.pdf_caminho, VALIDADE_URL_SEGUNDOS, { download: nomePdf }),
      orc.xlsx_caminho
        ? supabase.storage
            .from("pdfs")
            .createSignedUrl(orc.xlsx_caminho, VALIDADE_URL_SEGUNDOS, { download: nomeXlsx })
        : Promise.resolve({ data: null }),
    ]);
    urlPdf = ver.data?.signedUrl ?? null;
    urlDownload = baixar.data?.signedUrl ?? null;
    urlXlsx = planilha.data?.signedUrl ?? null;
  }

  // Versões anteriores: links de download dos dois formatos (as de antes do dia 8 só têm PDF).
  const anteriores = await Promise.all(
    versoes
      .filter((v) => v.versao !== orc.pdf_versao)
      .map(async (v) => {
        const [pdf, xlsx] = await Promise.all([
          supabase.storage.from("pdfs").createSignedUrl(v.caminho, VALIDADE_URL_SEGUNDOS, {
            download: nomeArquivoOrcamento(cliente?.nome, v.gerado_em, orc.numero, "pdf", v.versao),
          }),
          v.xlsx_caminho
            ? supabase.storage.from("pdfs").createSignedUrl(v.xlsx_caminho, VALIDADE_URL_SEGUNDOS, {
                download: nomeArquivoOrcamento(
                  cliente?.nome,
                  v.gerado_em,
                  orc.numero,
                  "xlsx",
                  v.versao,
                ),
              })
            : Promise.resolve({ data: null }),
        ]);
        return { ...v, url: pdf.data?.signedUrl ?? null, urlXlsx: xlsx.data?.signedUrl ?? null };
      }),
  );

  const totalCentavos = Math.round(Number(orc.valor_total) * 100);
  const aVistaCentavos =
    totalCentavos - descontoAvistaCentavos(totalCentavos, Number(cfg?.desconto_avista_pct ?? 10));
  const linhaDoTempo = montarLinhaDoTempo({
    criadoEm: orc.criado_em,
    montadoEm: orc.montado_em,
    versoesPdf: versoes.map((v) => ({ versao: v.versao, gerado_em: v.gerado_em })),
    eventos: eventos ?? [],
  });

  const primeiroNome = (cliente?.nome ?? "").split(" ")[0] || "tudo bem";
  const mensagem =
    `Olá, ${primeiroNome}! Segue o orçamento nº ${orc.numero} da ${cfg?.nome_fantasia ?? "Luz Design"}.` +
    (orc.validade ? ` Válido até ${isoParaBR(orc.validade)}.` : "") +
    ` Qualquer dúvida, é só me chamar!`;
  const zap = cliente?.whatsapp ? cliente.whatsapp.replace(/\D/g, "") : null;
  const podeAcompanhar = (minha || usuario.perfil === "gerente") && orc.status !== "rascunho";
  const editavel = minha && (orc.status === "rascunho" || orc.status === "gerado");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Orçamento {orc.numero}</h1>
        <p className="text-lg text-zinc-600">{cliente?.nome ?? "Sem cliente"}</p>
        <BadgeStatus status={orc.status} />
      </div>

      {orc.status === "rascunho" && minha ? (
        <div className="space-y-3">
          <p className="text-lg text-zinc-600">Este orçamento ainda é um rascunho.</p>
          <Link
            href={`/orcamentos/${id}/editar`}
            className="flex min-h-14 items-center justify-center rounded-lg bg-amber-700 text-lg font-semibold text-white"
          >
            Continuar
          </Link>
          <Link
            href={`/orcamentos/${id}/revisao`}
            className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
          >
            Selecionar produtos
          </Link>
        </div>
      ) : null}

      {podeAcompanhar ? (
        <section aria-label="Acompanhamento" className="space-y-3">
          <h2 className="text-xl font-semibold">Acompanhamento</h2>
          {orc.status === "fechado" && orc.valor_fechado ? (
            <p className="text-lg text-emerald-800">
              Vendido por {moedaCentavos(Math.round(Number(orc.valor_fechado) * 100))}.
            </p>
          ) : null}
          {orc.status === "perdido" && orc.motivo_perda ? (
            <p className="text-lg text-red-800">
              Motivo da perda: {rotuloMotivo(orc.motivo_perda)}.
            </p>
          ) : null}
          <StatusAcoes
            orcamentoId={id}
            status={orc.status as StatusOrcamento}
            valorTotal={Number(orc.valor_total)}
            geradoEm={orc.gerado_em}
          />
          {orc.ultimo_envio_em ? (
            <p className="text-base text-zinc-600">
              Enviado em {formatarDataBR(orc.ultimo_envio_em)}
              {orc.enviado_em &&
              formatarDataBR(orc.enviado_em) !== formatarDataBR(orc.ultimo_envio_em)
                ? ` (primeiro envio em ${formatarDataBR(orc.enviado_em)})`
                : ""}
              .
            </p>
          ) : null}
          {minha && ["enviado", "followup_d5", "followup_d10"].includes(orc.status) ? (
            <ReabrirEdicao orcamentoId={id} />
          ) : null}
          {minha &&
          ["enviado", "followup_d5", "followup_d10", "fechado", "perdido"].includes(orc.status) ? (
            <Link
              href={`/orcamentos/${id}/revisao`}
              className="flex min-h-12 items-center justify-center rounded-lg border border-zinc-300 text-lg"
            >
              Ver produtos (só leitura)
            </Link>
          ) : null}
        </section>
      ) : null}

      {totalCentavos > 0 ? (
        <section aria-label="Valores" className="space-y-1 rounded-lg border-2 border-zinc-300 p-4">
          <p className="flex items-baseline justify-between text-lg">
            <span>Total</span>
            <span className="text-2xl font-semibold">{moedaCentavos(totalCentavos)}</span>
          </p>
          <p className="flex items-baseline justify-between text-lg text-zinc-700">
            <span>
              À vista ({String(Number(cfg?.desconto_avista_pct ?? 10)).replace(".", ",")}%)
            </span>
            <span className="font-semibold">{moedaCentavos(aVistaCentavos)}</span>
          </p>
          {orc.validade ? (
            <p className="pt-1 text-base text-zinc-600">Válido até {isoParaBR(orc.validade)}</p>
          ) : null}
        </section>
      ) : null}

      {temPdf && urlPdf && urlDownload ? (
        <section aria-label="PDF" className="space-y-3">
          <h2 className="text-xl font-semibold">Orçamento (versão {orc.pdf_versao})</h2>
          {/* Tela grande: prévia do PDF na página (montada só no cliente). Celular: o botão abre o leitor do aparelho. */}
          <PreviaPdf url={urlPdf} titulo={`Prévia do orçamento ${orc.numero}`} />
          <a
            href={urlPdf}
            target="_blank"
            rel="noopener"
            className="flex min-h-14 items-center justify-center rounded-lg border border-amber-700 text-lg font-semibold text-amber-700 md:hidden"
          >
            Ver PDF
          </a>
          {minha ? (
            <CompartilharPdf
              urlPdf={urlPdf}
              urlDownload={urlDownload}
              nomeArquivo={nomePdf}
              whatsappCliente={zap}
              mensagem={mensagem}
            />
          ) : (
            <a
              href={urlDownload}
              download={nomePdf}
              className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
            >
              Baixar PDF
            </a>
          )}
          {urlXlsx ? (
            <div className="space-y-1">
              <a
                href={urlXlsx}
                download={nomeXlsx}
                className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
              >
                Baixar planilha (XLSX)
              </a>
              <p className="text-base text-zinc-600">
                Se editar a planilha, lembre de informar o valor final ao marcar Fechado.
              </p>
            </div>
          ) : null}
          {editavel ? (
            <Link
              href={`/orcamentos/${id}/revisao`}
              className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
            >
              Editar (gera nova versão)
            </Link>
          ) : null}
        </section>
      ) : null}

      {anteriores.length > 0 ? (
        <section aria-label="Versões anteriores" className="space-y-2">
          <h2 className="text-xl font-semibold">Versões anteriores</h2>
          <ul className="space-y-1">
            {anteriores.map((v) => (
              <li key={v.versao} className="text-lg">
                {v.url ? (
                  <a href={v.url} download className="min-h-11 text-amber-700 underline">
                    Versão {v.versao} (PDF)
                  </a>
                ) : (
                  <span>Versão {v.versao}</span>
                )}
                {v.urlXlsx ? (
                  <>
                    {" · "}
                    <a href={v.urlXlsx} download className="min-h-11 text-amber-700 underline">
                      planilha (XLSX)
                    </a>
                  </>
                ) : null}
                <span className="text-zinc-600">
                  {" "}
                  · {formatarDataBR(v.gerado_em)} ·{" "}
                  {moedaCentavos(Math.round(Number(v.valor_total) * 100))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Linha do tempo" className="space-y-2">
        <h2 className="text-xl font-semibold">Linha do tempo</h2>
        <ol className="space-y-2 border-l-2 border-zinc-200 pl-4">
          {linhaDoTempo.map((e, i) => (
            <li key={i}>
              <p className="text-lg">{e.texto}</p>
              <p className="text-base text-zinc-600">{formatarDataHora(e.quando)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function Page({ params }: PageProps<"/orcamentos/[id]">) {
  return (
    <Suspense fallback={<p className="text-lg text-zinc-600">Carregando...</p>}>
      <Detalhe params={params} />
    </Suspense>
  );
}
