"use client";

import Link from "next/link";
import { useState } from "react";
import { carregarMaisClientes } from "@/app/(app)/clientes/acoes";
import type { CartaoCliente } from "@/lib/clientes/listar";
import { formatarMoeda } from "@/lib/formatar";
import { textoHistorico } from "@/lib/clientes/resumo";
import { OPCOES_TIPO_CLIENTE } from "@/lib/orcamento/perguntas";

interface Props {
  inicial: CartaoCliente[];
  proximoInicial: string | null;
  params: Record<string, string>;
  gerencia: boolean;
}

/** Lista de clientes com "Ver mais" (cursor). Cada cartão leva à ficha do cliente. */
export function ListaClientes({ inicial, proximoInicial, params, gerencia }: Props) {
  const [clientes, setClientes] = useState(inicial);
  const [proximo, setProximo] = useState(proximoInicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Nova busca = lista nova do servidor: recomeça dela.
  const [origem, setOrigem] = useState(inicial);
  if (origem !== inicial) {
    setOrigem(inicial);
    setClientes(inicial);
    setProximo(proximoInicial);
  }

  async function verMais() {
    if (!proximo) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await carregarMaisClientes(params, proximo);
      if (!r.ok) return setErro(r.erro);
      setClientes((atual) => {
        const ja = new Set(atual.map((c) => c.id));
        return [...atual, ...r.clientes.filter((c) => !ja.has(c.id))];
      });
      setProximo(r.proximo);
    } catch {
      setErro("Perdi a conexão com o servidor. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  if (clientes.length === 0)
    return <p className="text-lg text-zinc-600">Nenhum cliente encontrado.</p>;
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {clientes.map((c) => (
          <li key={c.id}>
            <Link
              href={`/clientes/${c.id}`}
              className="block space-y-1 rounded-lg border border-zinc-200 p-4"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-lg font-medium">{c.nome}</span>
                {c.vendido > 0 ? (
                  <span className="shrink-0 text-lg font-semibold">{formatarMoeda(c.vendido)}</span>
                ) : null}
              </span>
              <span className="block text-base text-zinc-600">
                {OPCOES_TIPO_CLIENTE.find((o) => o.valor === c.tipo)?.rotulo ?? c.tipo}
                {c.whatsapp ? ` · ${c.whatsapp}` : ""}
                {gerencia && c.vendedoraNome ? ` · ${c.vendedoraNome}` : ""}
              </span>
              <span className="block text-base text-zinc-700">
                {textoHistorico({
                  orcamentos: c.orcamentos,
                  fechados: c.fechados,
                  ultimoEm: c.ultimoEm,
                })}
              </span>
            </Link>
          </li>
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
