"use client";

import { useState } from "react";
import type { ItemRevisao } from "@/lib/orcamento/itens";
import { moedaCentavos, moedaSimples, subtotalCentavos } from "@/lib/orcamento/totais";
import { MAX_MOTIVO } from "@/lib/ia/esquema";
import { CampoQuantidade } from "./CampoQuantidade";

interface Props {
  item: ItemRevisao;
  ambientes: string[];
  onQuantidade: (quantidade: number) => void;
  onTrocar: () => void;
  onMudarAmbiente: (ambiente: string) => void;
  onRemover: () => void;
  onAvulso: (campos: { descricao?: string; preco?: number }) => void;
  onMotivo: (texto: string) => void;
}

const botaoAcao = "min-h-11 rounded-lg border border-zinc-300 px-3 text-base";

export function ItemCard({
  item,
  ambientes,
  onQuantidade,
  onTrocar,
  onMudarAmbiente,
  onRemover,
  onAvulso,
  onMotivo,
}: Props) {
  const [motivo, setMotivo] = useState<string | null>(null);
  const [mudandoAmbiente, setMudandoAmbiente] = useState(false);
  const [novoAmbiente, setNovoAmbiente] = useState("");
  const [preco, setPreco] = useState<string | null>(null);
  const [descricao, setDescricao] = useState<string | null>(null);

  const subtotal = subtotalCentavos(item.preco, item.quantidade);
  const semPreco = item.avulso && !(item.preco > 0);
  const rotulo = item.descricao.slice(0, 40);

  function confirmarPreco() {
    if (preco === null) return;
    const n = Number(preco.replace(/\./g, "").replace(",", "."));
    setPreco(null);
    if (!Number.isNaN(n) && Math.round(n * 100) !== Math.round(item.preco * 100))
      onAvulso({ preco: n });
  }

  function confirmarDescricao() {
    if (descricao === null) return;
    const d = descricao.trim();
    setDescricao(null);
    if (d && d !== item.descricao) onAvulso({ descricao: d });
  }

  return (
    <li className="space-y-3 p-4">
      <div className="space-y-1">
        {item.avulso ? (
          <input
            type="text"
            aria-label={`Descrição do item avulso ${rotulo}`}
            value={descricao ?? item.descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onBlur={confirmarDescricao}
            className="min-h-12 w-full rounded-lg border border-zinc-300 px-3 text-lg font-medium"
          />
        ) : (
          <p className="text-lg font-medium">{item.descricao}</p>
        )}
        <p className="text-base text-zinc-600">
          {item.avulso
            ? "Item avulso"
            : `Cód. ${item.codigo}${item.marca ? ` · ${item.marca}` : ""}`}
        </p>
        {item.produtoAtivo === false ? (
          <p role="alert" className="text-base font-medium text-red-700">
            Este produto saiu do catálogo. Troque o produto.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <CampoQuantidade
          valor={item.quantidade}
          unidade={item.unidade}
          avulso={item.avulso}
          rotulo={rotulo}
          onMudar={onQuantidade}
        />
        <div className="text-right">
          {item.avulso ? (
            <label className="block">
              <span className="block text-base text-zinc-600">Preço unitário (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Preço unitário de ${rotulo}`}
                value={preco ?? (item.preco > 0 ? String(item.preco).replace(".", ",") : "")}
                placeholder="0,00"
                onChange={(e) => setPreco(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={confirmarPreco}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="min-h-12 w-32 rounded-lg border border-zinc-300 px-3 text-right text-lg"
              />
            </label>
          ) : (
            <p className="text-base text-zinc-600">
              {moedaSimples(item.preco)}/{item.unidade}
            </p>
          )}
          {semPreco ? (
            <p className="mt-1 inline-block rounded-full bg-amber-100 px-3 py-1 text-base font-medium text-amber-900">
              Preço a definir
            </p>
          ) : (
            <p className="text-xl font-semibold">{moedaCentavos(subtotal)}</p>
          )}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-base font-medium text-zinc-700">Motivo para o cliente</span>
        <input
          type="text"
          maxLength={MAX_MOTIVO}
          value={motivo ?? item.motivo ?? ""}
          placeholder="Por que este produto neste ambiente (opcional)"
          aria-label={`Motivo para o cliente de ${rotulo}`}
          onChange={(e) => setMotivo(e.target.value)}
          onBlur={() => {
            if (motivo === null) return;
            const novo = motivo;
            setMotivo(null);
            if (novo.trim() !== (item.motivo ?? "").trim()) onMotivo(novo);
          }}
          className="min-h-11 w-full rounded-lg border border-zinc-300 px-3 text-base"
        />
        <span className="block text-right text-base text-zinc-500">
          {(motivo ?? item.motivo ?? "").length}/{MAX_MOTIVO}
        </span>
      </label>

      {item.justificativa ? (
        <details className="text-base text-zinc-700">
          <summary className="min-h-11 cursor-pointer py-2 text-zinc-600">
            Por que este item?
          </summary>
          <p className="pb-2">{item.justificativa}</p>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onTrocar} className={botaoAcao}>
          {item.avulso ? "Escolher produto do catálogo" : "Trocar produto"}
        </button>
        <button type="button" onClick={() => setMudandoAmbiente((v) => !v)} className={botaoAcao}>
          Mudar ambiente
        </button>
        <button type="button" onClick={onRemover} className={`${botaoAcao} text-red-700`}>
          Remover
        </button>
      </div>

      {mudandoAmbiente ? (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-3">
          <p className="text-base font-medium">Mover para:</p>
          <div className="flex flex-wrap gap-2">
            {ambientes
              .filter((a) => a.toLowerCase() !== item.ambiente.toLowerCase())
              .map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    setMudandoAmbiente(false);
                    onMudarAmbiente(a);
                  }}
                  className={botaoAcao}
                >
                  {a}
                </button>
              ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={novoAmbiente}
              onChange={(e) => setNovoAmbiente(e.target.value)}
              placeholder="Outro ambiente"
              aria-label="Novo ambiente"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 text-base"
            />
            <button
              type="button"
              disabled={!novoAmbiente.trim()}
              onClick={() => {
                setMudandoAmbiente(false);
                onMudarAmbiente(novoAmbiente);
                setNovoAmbiente("");
              }}
              className={`${botaoAcao} disabled:opacity-50`}
            >
              Mover
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
