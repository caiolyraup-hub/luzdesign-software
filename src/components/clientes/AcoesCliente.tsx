"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { novoOrcamentoParaCliente, salvarObservacoes } from "@/app/(app)/clientes/acoes";

/** Botão "Novo orçamento para este cliente": cria o rascunho preenchido e abre o formulário. */
export function NovoOrcamentoDoCliente({ clienteId }: { clienteId: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setOcupado(true);
    setErro(null);
    let r;
    try {
      r = await novoOrcamentoParaCliente(clienteId);
    } catch {
      r = { ok: false as const, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    if (!r.ok) {
      setOcupado(false);
      return setErro(r.erro);
    }
    // Sem ?passo: o formulário abre na primeira pergunta que ainda falta (a 4, com nome, WhatsApp e tipo prontos).
    router.push(`/orcamentos/${r.id}/editar`);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void criar()}
        disabled={ocupado}
        className="min-h-14 w-full rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {ocupado ? "Criando..." : "Novo orçamento para este cliente"}
      </button>
      {erro ? (
        <p role="alert" className="text-base text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

/** Notas do cliente (texto curto). Só a dona edita; a gerência lê. Nunca vão à OpenAI. */
export function NotasCliente({
  clienteId,
  inicial,
  podeEditar,
}: {
  clienteId: string;
  inicial: string;
  podeEditar: boolean;
}) {
  const [texto, setTexto] = useState(inicial);
  const [salvo, setSalvo] = useState(inicial);
  const [estado, setEstado] = useState<"parado" | "salvando" | "salvo">("parado");
  const [erro, setErro] = useState<string | null>(null);

  if (!podeEditar)
    return (
      <p className="rounded-lg border border-zinc-200 p-4 text-lg whitespace-pre-line">
        {inicial || "Sem notas."}
      </p>
    );

  async function salvar() {
    setErro(null);
    setEstado("salvando");
    let r;
    try {
      r = await salvarObservacoes(clienteId, texto);
    } catch {
      r = { ok: false as const, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    if (!r.ok) {
      setEstado("parado");
      return setErro(r.erro);
    }
    setSalvo(texto.trim());
    setEstado("salvo");
  }

  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="sr-only">Notas do cliente</span>
        <textarea
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setEstado("parado");
          }}
          maxLength={1000}
          rows={4}
          placeholder="Ex.: prefere fita 3000 K, obra termina em dezembro"
          className="min-h-32 w-full rounded-lg border border-zinc-300 px-4 py-3 text-lg"
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span role="status" className="text-base text-zinc-600">
          {estado === "salvo" ? "Notas salvas." : `${texto.length}/1000`}
        </span>
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={estado === "salvando" || texto.trim() === salvo}
          className="min-h-12 rounded-lg border border-zinc-400 bg-white px-5 text-lg font-medium disabled:opacity-50"
        >
          {estado === "salvando" ? "Salvando..." : "Salvar notas"}
        </button>
      </div>
      {erro ? (
        <p role="alert" className="text-base text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
