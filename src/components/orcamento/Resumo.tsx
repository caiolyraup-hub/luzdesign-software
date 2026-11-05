"use client";

import Link from "next/link";
import type { AnexoView } from "@/app/(app)/orcamentos/acoes";
import {
  PERGUNTAS,
  perguntaCompleta,
  resumirResposta,
  type Respostas,
} from "@/lib/orcamento/perguntas";
import { MontarComIA } from "./MontarComIA";
import { PassoAnexos } from "./PassoAnexos";

interface Props {
  orcamentoId: string;
  respostas: Respostas;
  anexos: AnexoView[];
  onAnexos: (anexos: AnexoView[]) => void;
  onEditar: (numero: number) => void;
  /** Quando a IA montou os itens pela última vez (null = ainda não montou). */
  montadoEm: string | null;
}

export function Resumo({ orcamentoId, respostas, anexos, onAnexos, onEditar, montadoEm }: Props) {
  const pendentes = PERGUNTAS.filter((p) => !perguntaCompleta(p, respostas));

  return (
    <div className="space-y-6">
      <h1 tabIndex={-1} id="resumo-titulo" className="text-2xl font-semibold outline-none">
        Resumo do orçamento
      </h1>

      {pendentes.length > 0 ? (
        <div role="alert" className="space-y-2 rounded-lg border-2 border-red-700 bg-red-50 p-4">
          <p className="text-lg font-medium">Faltam respostas obrigatórias:</p>
          <ul className="space-y-1">
            {pendentes.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onEditar(p.numero)}
                  className="min-h-11 text-lg text-red-800 underline"
                >
                  {p.numero}. {p.resumo}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
        {PERGUNTAS.map((p) => {
          const valor = resumirResposta(p, respostas);
          return (
            <div key={p.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <dt className="text-base text-zinc-600">{p.resumo}</dt>
                <dd className="text-lg break-words whitespace-pre-wrap">{valor || "—"}</dd>
              </div>
              <button
                type="button"
                onClick={() => onEditar(p.numero)}
                aria-label={`Editar ${p.resumo}`}
                className="min-h-11 shrink-0 rounded-lg border border-zinc-300 px-4 text-base"
              >
                Editar
              </button>
            </div>
          );
        })}
      </dl>

      <PassoAnexos orcamentoId={orcamentoId} anexos={anexos} onMudar={onAnexos} />

      <div className="space-y-3">
        <MontarComIA
          orcamentoId={orcamentoId}
          rotulo={montadoEm ? "Montar de novo com IA" : "Montar orçamento com IA"}
          desabilitado={pendentes.length > 0}
          dica={
            pendentes.length > 0 ? "Responda as perguntas obrigatórias para montar." : undefined
          }
        />
        {montadoEm ? (
          <Link
            href={`/orcamentos/${orcamentoId}/itens`}
            className="flex min-h-14 items-center justify-center rounded-lg border border-amber-700 text-lg font-semibold text-amber-700"
          >
            Ver itens montados
          </Link>
        ) : null}
        <Link
          href="/orcamentos"
          className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
        >
          Sair e continuar depois
        </Link>
      </div>
    </div>
  );
}
