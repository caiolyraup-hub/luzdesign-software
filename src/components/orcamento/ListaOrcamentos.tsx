"use client";

import { useState } from "react";
import { carregarMaisOrcamentos } from "@/app/(app)/orcamentos/acoes-lista";
import type { ConfigFollowup } from "@/lib/orcamento/followup";
import { CartaoOrcamento, type DadosCartao } from "./CartaoOrcamento";

interface Props {
  inicial: DadosCartao[];
  proximoInicial: string | null;
  /** Parâmetros da URL (para o servidor reler os filtros ao pedir mais). */
  params: Record<string, string>;
  /** Gerência: rascunho é da vendedora, a gerência só acompanha. */
  gerencia: boolean;
  config: ConfigFollowup;
  vazio: string;
}

/** Cartões da lista com "Ver mais" (cursor): cada toque traz mais 20, sem perder o que já está na tela. */
export function ListaOrcamentos({
  inicial,
  proximoInicial,
  params,
  gerencia,
  config,
  vazio,
}: Props) {
  const [cartoes, setCartoes] = useState(inicial);
  const [proximo, setProximo] = useState(proximoInicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Se a busca ou os filtros mudarem, a tela recebe uma lista nova do servidor: recomeça dela.
  const [origem, setOrigem] = useState(inicial);
  if (origem !== inicial) {
    setOrigem(inicial);
    setCartoes(inicial);
    setProximo(proximoInicial);
  }

  async function verMais() {
    if (!proximo) return;
    setErro(null);
    setCarregando(true);
    try {
      const r = await carregarMaisOrcamentos(params, proximo);
      if (!r.ok) return setErro(r.erro);
      setCartoes((atual) => {
        const ja = new Set(atual.map((c) => c.id));
        return [...atual, ...r.cartoes.filter((c) => !ja.has(c.id))];
      });
      setProximo(r.proximo);
    } catch {
      setErro("Perdi a conexão com o servidor. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  if (cartoes.length === 0) return <p className="text-lg text-zinc-600">{vazio}</p>;
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {cartoes.map((c) => (
          <CartaoOrcamento
            key={c.id}
            d={c}
            podeAgir={!gerencia || c.status !== "rascunho"}
            config={config}
          />
        ))}
      </ul>
      {erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}
      {proximo ? (
        <button
          type="button"
          onClick={() => void verMais()}
          disabled={carregando}
          className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg font-medium disabled:opacity-60"
        >
          {carregando ? "Carregando..." : "Ver mais"}
        </button>
      ) : null}
    </div>
  );
}
