"use client";

import { useEffect, useRef, useState } from "react";
import { buscarArquitetos } from "@/app/(app)/arquitetos/acoes";
import type { CartaoArquiteto } from "@/lib/arquitetos/servidor";
import { Avatar } from "./Avatar";
import { FormularioArquiteto } from "./FormularioArquiteto";

interface Props {
  /** Arquiteto escolhido (id pode faltar em rascunhos antigos que só têm o nome digitado). */
  valor: { id: string | null; nome: string } | null;
  rotulo: string;
  onEscolher: (arquiteto: { id: string; nome: string } | null) => void;
  erro?: string;
}

/** Seletor com busca (nome ou escritório) e "+ Cadastrar arquiteto" sem sair do orçamento. */
export function ArquitetoSeletor({ valor, rotulo, onEscolher, erro }: Props) {
  const [aberto, setAberto] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<CartaoArquiteto[]>([]);
  const [carregando, setCarregando] = useState(false);
  const pedido = useRef(0);

  useEffect(() => {
    if (!aberto) return;
    const meu = ++pedido.current;
    const t = setTimeout(
      async () => {
        setCarregando(true);
        try {
          const r = await buscarArquitetos(q);
          if (pedido.current === meu) setLista(r);
        } catch {
          if (pedido.current === meu) setLista([]);
        } finally {
          if (pedido.current === meu) setCarregando(false);
        }
      },
      q ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [aberto, q]);

  function escolher(a: { id: string; nome: string }) {
    onEscolher(a);
    setAberto(false);
    setCadastrando(false);
    setQ("");
  }

  if (cadastrando) {
    return (
      <FormularioArquiteto curto onSalvo={escolher} onCancelar={() => setCadastrando(false)} />
    );
  }

  return (
    <div className="space-y-2 pt-2">
      <span className="block text-lg font-medium">{rotulo}</span>

      {valor && !aberto ? (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-300 bg-white p-3">
          <Avatar nome={valor.nome} url={null} />
          <span className="min-w-0 flex-1 truncate text-lg" data-testid="arquiteto-escolhido">
            {valor.nome}
          </span>
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="min-h-11 shrink-0 rounded-lg border border-zinc-300 px-4 text-base"
          >
            Trocar
          </button>
        </div>
      ) : null}

      {!valor && !aberto ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-left text-lg"
        >
          Escolher arquiteto(a)
        </button>
      ) : null}

      {aberto ? (
        <div className="space-y-2 rounded-lg border border-zinc-300 bg-white p-3">
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar arquiteto pelo nome ou escritório"
            placeholder="Nome ou escritório"
            className="min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg"
          />
          <ul aria-label="Arquitetos" className="max-h-72 divide-y divide-zinc-200 overflow-y-auto">
            {lista.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => escolher(a)}
                  className="flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left"
                >
                  <Avatar nome={a.nome} url={a.foto_url} />
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-medium">{a.nome}</span>
                    {a.escritorio ? (
                      <span className="block truncate text-base text-zinc-600">{a.escritorio}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!carregando && lista.length === 0 ? (
            <p className="text-lg text-zinc-600">Nenhum arquiteto(a) com esse nome.</p>
          ) : null}
          <button
            type="button"
            onClick={() => setCadastrando(true)}
            className="min-h-14 w-full rounded-lg border-2 border-amber-700 px-4 text-lg font-semibold text-amber-800"
          >
            + Cadastrar arquiteto
          </button>
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="min-h-11 w-full rounded-lg text-lg text-zinc-700 underline"
          >
            Fechar a lista
          </button>
        </div>
      ) : null}

      {erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
