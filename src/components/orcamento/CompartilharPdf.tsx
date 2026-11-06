"use client";

import { useState } from "react";

interface Props {
  /** URL assinada para ler o PDF (curta duração). */
  urlPdf: string;
  /** URL assinada que força o download. */
  urlDownload: string;
  nomeArquivo: string;
  /** Só dígitos com DDI (ex.: 5582999991234) ou null se o cliente não tem WhatsApp. */
  whatsappCliente: string | null;
  mensagem: string;
}

const botaoPrincipal =
  "flex min-h-14 w-full items-center justify-center rounded-lg bg-amber-700 px-5 text-lg font-semibold text-white";
const botaoSecundario =
  "flex min-h-14 w-full items-center justify-center rounded-lg border border-zinc-300 px-5 text-lg";

/**
 * Celular: abre a folha de compartilhar do sistema com o PDF anexado (WhatsApp aparece na lista).
 * Computador (ou navegador sem suporte): baixa o PDF e abre a conversa do cliente no WhatsApp com a
 * mensagem pronta, para a vendedora anexar o arquivo baixado.
 */
export function CompartilharPdf({
  urlPdf,
  urlDownload,
  nomeArquivo,
  whatsappCliente,
  mensagem,
}: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const linkWhatsapp = `https://wa.me/${whatsappCliente ?? ""}?text=${encodeURIComponent(mensagem)}`;

  async function compartilhar() {
    setAviso(null);
    setOcupado(true);
    try {
      const resposta = await fetch(urlPdf);
      if (!resposta.ok) throw new Error("download");
      const arquivo = new File([await resposta.blob()], nomeArquivo, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [arquivo] })) {
        await navigator.share({ files: [arquivo], text: mensagem, title: nomeArquivo });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // a vendedora fechou a folha de compartilhar
    } finally {
      setOcupado(false);
    }

    // Sem compartilhar arquivo: baixa o PDF e abre o WhatsApp com a mensagem pronta.
    const a = document.createElement("a");
    a.href = urlDownload;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.open(linkWhatsapp, "_blank", "noopener");
    setAviso("O PDF foi baixado. Anexe o arquivo na conversa do WhatsApp que abriu.");
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void compartilhar()}
        disabled={ocupado}
        className={`${botaoPrincipal} disabled:opacity-60`}
      >
        {ocupado ? "Preparando..." : "Compartilhar no WhatsApp"}
      </button>
      {aviso ? (
        <p role="status" className="text-lg text-zinc-700">
          {aviso}
        </p>
      ) : null}
      <a href={urlDownload} download={nomeArquivo} className={botaoSecundario}>
        Baixar PDF
      </a>
    </div>
  );
}
