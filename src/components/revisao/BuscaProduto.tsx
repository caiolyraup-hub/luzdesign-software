"use client";

import { useRef, useState } from "react";
import { buscarProdutosRevisao } from "@/app/(app)/orcamentos/acoes-revisao";
import type { ProdutoBusca } from "@/lib/estoque/buscar";
import { moedaSimples } from "@/lib/orcamento/totais";

interface Props {
  titulo: string;
  onEscolher: (produto: ProdutoBusca) => void;
  onFechar: () => void;
}

const ATRASO_MS = 300;

/** Folha em tela cheia: busca no catálogo (código, descrição, marca) e devolve o produto escolhido. */
export function BuscaProduto({ titulo, onEscolher, onFechar }: Props) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ProdutoBusca[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequencia = useRef(0);

  function mudou(valor: string) {
    setTexto(valor);
    if (timer.current) clearTimeout(timer.current);
    if (valor.trim().length < 2) {
      setResultados(null);
      setErro(null);
      return;
    }
    timer.current = setTimeout(async () => {
      const minha = ++sequencia.current;
      setBuscando(true);
      const r = await buscarProdutosRevisao(valor);
      if (minha !== sequencia.current) return; // chegou uma busca mais nova
      setBuscando(false);
      if (!r.ok) return setErro(r.erro);
      setErro(null);
      setResultados(r.produtos);
    }, ATRASO_MS);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-40 flex flex-col bg-white"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="text-xl font-semibold">{titulo}</h2>
        <button
          type="button"
          onClick={onFechar}
          className="min-h-11 rounded-lg border border-zinc-300 px-4 text-base"
        >
          Fechar
        </button>
      </div>
      <div className="px-4 py-3">
        <input
          type="search"
          autoFocus
          value={texto}
          onChange={(e) => mudou(e.target.value)}
          placeholder="Código, descrição ou marca"
          aria-label="Buscar produto"
          className="min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {erro ? (
          <p role="alert" className="text-lg text-red-700">
            {erro}
          </p>
        ) : null}
        {buscando ? <p className="text-lg text-zinc-600">Buscando...</p> : null}
        {!buscando && resultados === null ? (
          <p className="text-lg text-zinc-600">Digite ao menos 2 letras ou números.</p>
        ) : null}
        {!buscando && resultados?.length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum produto encontrado.</p>
        ) : null}
        <ul className="divide-y divide-zinc-200">
          {(resultados ?? []).map((p) => (
            <li key={p.codigo}>
              <button
                type="button"
                onClick={() => onEscolher(p)}
                className="flex min-h-16 w-full items-start justify-between gap-3 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-lg font-medium">{p.descricao}</span>
                  <span className="block text-base text-zinc-600">
                    Cód. {p.codigo}
                    {p.categoria ? ` · ${p.categoria}` : ""}
                    {p.marca ? ` · ${p.marca}` : ""}
                    {p.estoque_disponivel !== null ? ` · estoque ${p.estoque_disponivel}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-lg font-semibold">
                  {moedaSimples(p.preco_unitario)}
                  <span className="text-base font-normal text-zinc-600">/{p.unidade}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
