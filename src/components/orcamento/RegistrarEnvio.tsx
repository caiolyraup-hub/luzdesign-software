"use client";

import { useState, type ReactNode } from "react";
import { FolhaEnvio } from "./FolhaEnvio";

/** Botão "Registrar envio" (cartão da lista, Para hoje): abre a folha "Você já mandou para o cliente?". */
export function BotaoRegistrarEnvio({
  orcamentoId,
  geradoEm,
  compacto = false,
}: {
  orcamentoId: string;
  geradoEm: string | null;
  compacto?: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        className={`bg-primario text-sobre-primario rounded-lg font-semibold ${
          compacto ? "min-h-11 px-3 text-base" : "min-h-14 w-full px-4 text-lg"
        }`}
      >
        Registrar envio
      </button>
      <FolhaEnvio
        orcamentoId={orcamentoId}
        geradoEm={geradoEm}
        aberta={aberta}
        onFechar={() => setAberta(false)}
      />
    </>
  );
}

const ACOES_QUE_ENVIAM = /baixar pdf|baixar planilha|compartilhar|whatsapp/i;

/**
 * Envolve os botões do PDF: depois de Baixar PDF, Baixar XLSX, Compartilhar ou Abrir WhatsApp num
 * orçamento gerado, aparece a folha "Você já mandou para o cliente?". Não muda o que os botões fazem.
 */
export function EnvioAposAcao({
  orcamentoId,
  geradoEm,
  ativo,
  children,
}: {
  orcamentoId: string;
  geradoEm: string | null;
  /** Só em orçamento gerado, sem envio registrado. */
  ativo: boolean;
  children: ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <div
      onClickCapture={(e) => {
        if (!ativo) return;
        const alvo = (e.target as HTMLElement).closest("a, button");
        if (alvo && ACOES_QUE_ENVIAM.test(alvo.textContent ?? "")) {
          // Dá tempo de o download ou a folha de compartilhar do sistema acontecerem.
          setTimeout(() => setAberta(true), 700);
        }
      }}
    >
      {children}
      <FolhaEnvio
        orcamentoId={orcamentoId}
        geradoEm={geradoEm}
        aberta={aberta}
        onFechar={() => setAberta(false)}
      />
    </div>
  );
}
