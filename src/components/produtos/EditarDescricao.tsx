"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { editarDescricaoProduto } from "@/app/(app)/produtos/acoes";

/** Edição da descrição comercial (só gerência e dono veem este botão). */
export function EditarDescricao({ codigo, descricao }: { codigo: string; descricao: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(descricao);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Editar descrição do produto ${codigo}`}
        className="min-h-11 rounded-lg border border-zinc-300 px-3 text-base"
      >
        Editar descrição
      </button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2">
      <input
        aria-label={`Descrição comercial do produto ${codigo}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg"
      />
      {erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setAberto(false);
            setErro(null);
            setTexto(descricao);
          }}
          className="min-h-12 flex-1 rounded-lg border border-zinc-300 text-lg"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true);
            setErro(null);
            let r;
            try {
              r = await editarDescricaoProduto(codigo, texto);
            } catch {
              r = { ok: false as const, erro: "Perdi a conexão com o servidor. Tente de novo." };
            }
            setOcupado(false);
            if (!r.ok) return setErro(r.erro);
            setAberto(false);
            router.refresh();
          }}
          className="min-h-12 flex-[2] rounded-lg bg-amber-700 text-lg font-semibold text-white disabled:opacity-50"
        >
          Salvar descrição
        </button>
      </div>
    </div>
  );
}
