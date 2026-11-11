"use client";

import Link from "next/link";
import { useState } from "react";
import { ROTULOS_PERIODO, type Periodo } from "@/lib/metricas/periodo";

interface Props {
  /** Caminho da página (/meus-numeros ou /gerencia). */
  base: string;
  periodo: Periodo;
  /** Outros parâmetros da URL a manter (vendedora, filtro...). */
  extra?: Record<string, string | undefined>;
  /** Hoje em Maceió (AAAA-MM-DD), limite das datas do intervalo. */
  hoje: string;
}

const PRESETS = ["mes", "mes-anterior", "90-dias"] as const;

/** Cards de tocar para o período; "Personalizado" abre duas datas. Tudo vira parâmetro da URL. */
export function SeletorPeriodo({ base, periodo, extra = {}, hoje }: Props) {
  const [abrirPersonalizado, setAbrirPersonalizado] = useState(periodo.id === "personalizado");
  const manter = Object.entries(extra).filter(([, v]) => v) as [string, string][];

  const href = (id: string) => {
    const p = new URLSearchParams(manter);
    p.set("periodo", id);
    return `${base}?${p.toString()}`;
  };
  const classe = (ativo: boolean) =>
    `flex min-h-14 items-center justify-center rounded-lg border-2 px-3 text-center text-lg font-medium ${
      ativo ? "border-[#9F5F47] bg-[#9F5F47] text-white" : "border-zinc-300 bg-white text-zinc-900"
    }`;

  return (
    <div className="space-y-3">
      <nav aria-label="Período" className="grid grid-cols-2 gap-2">
        {PRESETS.map((id) => (
          <Link
            key={id}
            href={href(id)}
            aria-current={periodo.id === id ? "true" : undefined}
            className={classe(periodo.id === id)}
          >
            {ROTULOS_PERIODO[id]}
          </Link>
        ))}
        <button
          type="button"
          aria-expanded={abrirPersonalizado}
          aria-current={periodo.id === "personalizado" ? "true" : undefined}
          onClick={() => setAbrirPersonalizado((v) => !v)}
          className={classe(periodo.id === "personalizado")}
        >
          {ROTULOS_PERIODO.personalizado}
        </button>
      </nav>

      {abrirPersonalizado ? (
        <form
          method="get"
          action={base}
          className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-300 p-3"
        >
          {manter.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="periodo" value="personalizado" />
          <label className="space-y-1">
            <span className="block text-base font-medium">De</span>
            <input
              type="date"
              name="de"
              required
              max={hoje}
              defaultValue={periodo.id === "personalizado" ? periodo.inicio : undefined}
              className="min-h-14 w-full rounded-lg border border-zinc-300 px-3 text-lg"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-base font-medium">Até</span>
            <input
              type="date"
              name="ate"
              required
              max={hoje}
              defaultValue={periodo.id === "personalizado" ? periodo.fim : undefined}
              className="min-h-14 w-full rounded-lg border border-zinc-300 px-3 text-lg"
            />
          </label>
          <button
            type="submit"
            className="col-span-2 min-h-14 rounded-lg bg-zinc-900 px-4 text-lg font-semibold text-white"
          >
            Ver este intervalo
          </button>
        </form>
      ) : null}

      <p className="text-base text-zinc-700">
        Período: <strong>{periodo.descricao}</strong>
      </p>
      {periodo.aviso ? (
        <p role="status" className="rounded-lg border-2 border-amber-700 bg-amber-50 p-3 text-base">
          {periodo.aviso}
        </p>
      ) : null}
    </div>
  );
}
