"use client";

import { useState } from "react";

/**
 * "Exportar planilha": baixa o XLSX com os mesmos filtros da lista. A gerência pode incluir os
 * orçamentos de teste (desligado por padrão). O arquivo é gerado no servidor, com a sessão de quem
 * pediu (RLS): a vendedora só recebe os próprios dados.
 */
export function ExportarPlanilha({ query, gerencia }: { query: string; gerencia: boolean }) {
  const [teste, setTeste] = useState(false);
  const href = `/exportar?${query}${teste ? `${query ? "&" : ""}teste=1` : ""}`;
  return (
    <div className="space-y-2 rounded-lg border border-zinc-300 p-3">
      <a
        href={href}
        download
        className="flex min-h-14 items-center justify-center rounded-lg border border-amber-700 px-4 text-lg font-semibold text-amber-800"
      >
        Exportar planilha
      </a>
      {gerencia ? (
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={teste}
            onChange={(e) => setTeste(e.target.checked)}
            className="size-6"
          />
          Incluir orçamentos de teste
        </label>
      ) : null}
      <p className="text-base text-zinc-600">
        Planilha com os orçamentos, os itens e os clientes
        {gerencia ? " e o histórico de status" : ""} do filtro atual.
      </p>
    </div>
  );
}
