"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { juntarClientes } from "@/app/(app)/clientes/acoes";

export interface ParDuplicado {
  a_id: string;
  a_nome: string;
  a_whatsapp: string | null;
  a_orcamentos: number;
  b_id: string;
  b_nome: string;
  b_whatsapp: string | null;
  b_orcamentos: number;
  vendedora_nome: string | null;
  motivo: "whatsapp" | "nome";
}

/** Possíveis duplicados (só a gerência): "Juntar" move os orçamentos para o cliente mantido e apaga o outro. */
export function Duplicados({ pares }: { pares: ParDuplicado[] }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [manter, setManter] = useState<Record<string, "a" | "b">>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  if (pares.length === 0 && !aviso) return null;

  async function juntar(p: ParDuplicado) {
    const lado = manter[p.a_id + p.b_id] ?? (p.b_orcamentos > p.a_orcamentos ? "b" : "a");
    const [m, r] = lado === "a" ? [p.a_id, p.b_id] : [p.b_id, p.a_id];
    setOcupado(true);
    setErro(null);
    let res;
    try {
      res = await juntarClientes(m, r);
    } catch {
      res = { ok: false as const, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    setOcupado(false);
    if (!res.ok) return setErro(res.erro);
    setConfirmando(null);
    setAviso(
      `Clientes juntados: ${res.movidos} ${res.movidos === 1 ? "orçamento movido" : "orçamentos movidos"}.`,
    );
    router.refresh();
  }

  return (
    <section
      aria-label="Possíveis duplicados"
      className="space-y-3 rounded-lg border-2 border-amber-700 bg-amber-50 p-4"
    >
      <h2 className="text-xl font-semibold">Possíveis duplicados</h2>
      {aviso ? (
        <p role="status" className="text-lg text-emerald-800">
          {aviso}
        </p>
      ) : null}
      <ul className="space-y-3">
        {pares.map((p) => {
          const chave = p.a_id + p.b_id;
          const lado = manter[chave] ?? (p.b_orcamentos > p.a_orcamentos ? "b" : "a");
          const nomeManter = lado === "a" ? p.a_nome : p.b_nome;
          const nomeRemover = lado === "a" ? p.b_nome : p.a_nome;
          return (
            <li key={chave} className="space-y-2 rounded-lg border border-zinc-300 bg-white p-3">
              <p className="text-base font-medium text-amber-900">
                {p.motivo === "whatsapp" ? "Mesmo WhatsApp" : "Nome muito parecido"}
                {p.vendedora_nome ? ` · ${p.vendedora_nome}` : ""}
              </p>
              <fieldset className="space-y-1">
                <legend className="sr-only">Qual cliente manter</legend>
                {(
                  [
                    ["a", p.a_nome, p.a_whatsapp, p.a_orcamentos],
                    ["b", p.b_nome, p.b_whatsapp, p.b_orcamentos],
                  ] as const
                ).map(([l, nome, zap, n]) => (
                  <label key={l} className="flex min-h-11 items-start gap-3 text-lg">
                    <input
                      type="radio"
                      name={`manter-${chave}`}
                      checked={lado === l}
                      onChange={() => setManter((m) => ({ ...m, [chave]: l }))}
                      className="mt-1 size-5"
                    />
                    <span>
                      Manter <strong>{nome}</strong>
                      <span className="block text-base text-zinc-600">
                        {zap ?? "sem WhatsApp"} · {n} {n === 1 ? "orçamento" : "orçamentos"}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {confirmando === chave ? (
                <div className="space-y-2">
                  <p role="alert" className="text-lg">
                    Os orçamentos de <strong>{nomeRemover}</strong> passam para{" "}
                    <strong>{nomeManter}</strong>, as notas são juntadas e{" "}
                    <strong>{nomeRemover}</strong> é apagado. Fica registrado.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setConfirmando(null)}
                      disabled={ocupado}
                      className="min-h-12 flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-lg"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void juntar(p)}
                      disabled={ocupado}
                      className="min-h-12 flex-[2] rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-60"
                    >
                      {ocupado ? "Juntando..." : "Confirmar e juntar"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmando(chave)}
                  className="min-h-12 w-full rounded-lg border border-amber-700 bg-white px-4 text-lg font-semibold text-amber-800"
                >
                  Juntar
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}
    </section>
  );
}
