"use client";

import { useState } from "react";
import { previaListaColada, type PreviaLista } from "@/app/(app)/orcamentos/acoes-revisao";
import { moedaCentavos, moedaSimples } from "@/lib/orcamento/totais";

interface Props {
  ambiente: string;
  /** Confirma: o servidor lê o texto de novo e adiciona. Devolve o texto de erro ou null. */
  onConfirmar: (texto: string) => Promise<string | null>;
  onFechar: () => void;
}

const botao = "min-h-12 rounded-lg border border-zinc-300 bg-white px-4 text-lg";

/** Colar lista de produtos (código + quantidade) de um arquiteto. Sem IA: leitura por regras. */
export function ColarLista({ ambiente, onConfirmar, onFechar }: Props) {
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState<PreviaLista | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function conferir() {
    setErro(null);
    setConferindo(true);
    let r;
    try {
      r = await previaListaColada(texto);
    } catch {
      r = { ok: false as const, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    setConferindo(false);
    if (!r.ok) {
      setPrevia(null);
      return setErro(r.erro);
    }
    setPrevia(r.previa);
  }

  async function confirmar() {
    setEnviando(true);
    const e = await onConfirmar(texto);
    setEnviando(false);
    if (e) return setErro(e);
    onFechar();
  }

  const qtd = previa?.reconhecidas.length ?? 0;
  const totalCentavos = (previa?.reconhecidas ?? []).reduce((s, l) => s + l.subtotalCentavos, 0);

  return (
    <div className="space-y-3 rounded-lg border-2 border-sky-700 bg-sky-50 p-4">
      <p className="text-lg font-medium">Colar lista em {ambiente}</p>
      <label className="block space-y-1">
        <span className="text-base text-zinc-700">
          Uma linha por produto, com o código (4 ou 5 dígitos) e a quantidade. Ex.:{" "}
          <code>10 12345</code>, <code>12345 x 10</code>, <code>3,5 m 23456</code>,{" "}
          <code>12345 - 4 un</code>
        </span>
        <textarea
          aria-label="Lista de produtos"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setPrevia(null);
          }}
          rows={6}
          className="min-h-32 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-base"
          placeholder={"10 12345\n12346 x 3\n3,5 m 23456"}
        />
      </label>

      {erro ? (
        <p role="alert" className="text-base font-medium text-red-700">
          {erro}
        </p>
      ) : null}

      {previa ? (
        <div className="space-y-3" aria-live="polite">
          {qtd > 0 ? (
            <div className="space-y-1">
              <p className="text-lg font-medium">
                {qtd} {qtd === 1 ? "linha reconhecida" : "linhas reconhecidas"}
              </p>
              <ul className="divide-y divide-sky-200 rounded-lg border border-sky-200 bg-white">
                {previa.reconhecidas.map((l) => (
                  <li key={l.linha} className="space-y-0.5 p-3 text-base">
                    <p className="font-medium">
                      {l.quantidade} {l.unidade} · {l.descricao}
                    </p>
                    <p className="text-zinc-600">
                      Cód. {l.codigo} · {moedaSimples(l.precoUnitario)}/{l.unidade} ={" "}
                      {moedaCentavos(l.subtotalCentavos)}
                    </p>
                    {l.aviso ? <p className="text-amber-900">{l.aviso}</p> : null}
                  </li>
                ))}
              </ul>
              <p className="text-right text-base text-zinc-700">
                Subtotal da lista: <strong>{moedaCentavos(totalCentavos)}</strong>
              </p>
            </div>
          ) : null}

          {previa.naoEncontradas.length > 0 ? (
            <div className="space-y-1 rounded-lg border-2 border-amber-700 bg-amber-50 p-3">
              <p className="text-base font-medium">Códigos que não entram:</p>
              <ul className="space-y-1 text-base">
                {previa.naoEncontradas.map((l) => (
                  <li key={l.linha}>
                    Linha {l.linha}: <code>{l.codigo}</code> — {l.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {previa.naoEntendidas.length > 0 ? (
            <div className="space-y-1 rounded-lg border-2 border-red-700 bg-red-50 p-3">
              <p className="text-base font-medium">Linhas que não entendi:</p>
              <ul className="space-y-1 text-base">
                {previa.naoEntendidas.map((l) => (
                  <li key={l.linha}>
                    Linha {l.linha}: “{l.texto}” — {l.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {previa.excedeu ? (
            <p className="text-base text-amber-900">
              A lista passou do limite; só as primeiras linhas foram lidas.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-3">
        <button type="button" onClick={onFechar} className={`${botao} flex-1`}>
          Cancelar
        </button>
        {previa && qtd > 0 ? (
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={enviando}
            className="min-h-12 flex-[2] rounded-lg bg-sky-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
          >
            {enviando ? "Adicionando..." : `Adicionar ${qtd} ${qtd === 1 ? "item" : "itens"}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void conferir()}
            disabled={conferindo || texto.trim().length === 0}
            className="min-h-12 flex-[2] rounded-lg bg-sky-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
          >
            {conferindo ? "Conferindo..." : "Conferir lista"}
          </button>
        )}
      </div>
    </div>
  );
}
