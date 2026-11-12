"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  CAMPOS_DATA,
  ORDENS,
  ROTULOS_ORDEM,
  ROTULOS_VALIDADE,
  VALIDADES,
  type FiltrosLista,
} from "@/lib/orcamento/filtros-lista";
import { LISTA_MOTIVOS } from "@/lib/orcamento/status";
import { OPCOES_TIPO_CLIENTE } from "@/lib/orcamento/perguntas";

export interface ChipLink {
  id: string;
  rotulo: string;
  href: string;
}

interface Props {
  /** Caminho da página (/orcamentos ou /gerencia). */
  base: string;
  /** Filtros atuais (para preencher o formulário). */
  filtros: FiltrosLista;
  /** Parâmetros da URL que não são filtros da lista (período do painel, por exemplo): ficam como estão. */
  manter: Record<string, string>;
  chips: ChipLink[];
  total: number;
  /** Só a gerência filtra por vendedora. */
  vendedoras?: { id: string; nome: string }[];
  /** Ancora para onde ir depois de filtrar (a lista, na tela da gerência). */
  ancora?: string;
}

const campo = "min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg";

/** Campo de busca no topo, gaveta "Filtrar" que abre por baixo e chips dos filtros ativos. Tudo na URL. */
export function BuscaFiltros({ base, filtros, manter, chips, total, vendedoras, ancora }: Props) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [q, setQ] = useState(filtros.q ?? "");

  /** Parâmetros que valem independentemente do formulário: o atalho de status e o que não é filtro. */
  function fixos(): URLSearchParams {
    const p = new URLSearchParams(manter);
    if (filtros.preset !== "andamento") p.set("filtro", filtros.preset);
    return p;
  }
  function ir(p: URLSearchParams) {
    const qs = p.toString();
    router.push(`${base}${qs ? `?${qs}` : ""}${ancora ?? ""}`);
  }

  function buscar(e: FormEvent) {
    e.preventDefault();
    // Mantém os filtros atuais (os chips) e troca só o texto.
    const p = new URLSearchParams(window.location.search);
    p.delete("cursor");
    if (q.trim()) p.set("q", q.trim());
    else p.delete("q");
    ir(p);
  }

  function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    const p = fixos();
    if (filtros.q) p.set("q", filtros.q);
    for (const [k, v] of dados.entries()) {
      const valor = typeof v === "string" ? v.trim() : "";
      if (valor) p.set(k, valor);
    }
    setAberta(false);
    ir(p);
  }

  function limpar() {
    const p = fixos();
    if (filtros.q) p.set("q", filtros.q);
    if (filtros.ordem !== "recentes") p.set("ordem", filtros.ordem);
    setAberta(false);
    ir(p);
  }

  const ativos = chips.filter((c) => c.id !== "q").length;

  return (
    <div className="space-y-3">
      <form onSubmit={buscar} role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Número, cliente, WhatsApp, arquiteto, produto"
          aria-label="Buscar orçamentos"
          enterKeyHint="search"
          className={`${campo} min-w-0 flex-1`}
        />
        <button
          type="submit"
          className="min-h-14 shrink-0 rounded-lg bg-zinc-900 px-4 text-lg font-semibold text-white"
        >
          Buscar
        </button>
      </form>

      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-lg text-zinc-700">
          <strong>{total}</strong> {total === 1 ? "orçamento" : "orçamentos"}
        </p>
        <button
          type="button"
          onClick={() => setAberta(true)}
          aria-haspopup="dialog"
          className="min-h-12 rounded-lg border border-zinc-300 bg-white px-4 text-lg font-medium"
        >
          Filtrar{ativos > 0 ? ` (${ativos})` : ""}
        </button>
      </div>

      {chips.length > 0 ? (
        <ul aria-label="Filtros ativos" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.id}>
              <Link
                href={c.href}
                aria-label={`Remover filtro: ${c.rotulo}`}
                className="flex min-h-11 items-center gap-2 rounded-full border border-[#9F5F47] bg-[#9F5F47]/10 px-4 text-base"
              >
                {c.rotulo}
                <span aria-hidden="true" className="text-lg leading-none">
                  ×
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {aberta ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Filtrar orçamentos"
            className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <h2 className="text-xl font-semibold">Filtrar</h2>
              <button
                type="button"
                onClick={() => setAberta(false)}
                className="min-h-11 rounded-lg border border-zinc-300 px-4 text-base"
              >
                Fechar
              </button>
            </div>
            <form onSubmit={aplicar} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                <fieldset className="space-y-2">
                  <legend className="text-lg font-medium">Período</legend>
                  <select
                    name="data"
                    defaultValue={filtros.campo ?? ""}
                    aria-label="Data do período"
                    className={campo}
                  >
                    <option value="">Sem período</option>
                    {CAMPOS_DATA.map((c) => (
                      <option key={c} value={c}>
                        {c === "criado"
                          ? "Data de criação"
                          : c === "enviado"
                            ? "Data de envio"
                            : c === "fechado"
                              ? "Data de fechamento"
                              : c === "gerado"
                                ? "Data de geração"
                                : "Data da perda"}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="block text-base">De</span>
                      <input
                        type="date"
                        name="de"
                        defaultValue={filtros.de ?? ""}
                        className={campo}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-base">Até</span>
                      <input
                        type="date"
                        name="ate"
                        defaultValue={filtros.ate ?? ""}
                        className={campo}
                      />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="text-lg font-medium">Valor (R$)</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      name="min"
                      aria-label="Valor mínimo"
                      placeholder="De"
                      defaultValue={filtros.valorMin ?? ""}
                      className={campo}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      name="max"
                      aria-label="Valor máximo"
                      placeholder="Até"
                      defaultValue={filtros.valorMax ?? ""}
                      className={campo}
                    />
                  </div>
                </fieldset>

                <label className="block space-y-1">
                  <span className="text-lg font-medium">Tipo de cliente</span>
                  <select name="tipo" defaultValue={filtros.tipo ?? ""} className={campo}>
                    <option value="">Todos</option>
                    {OPCOES_TIPO_CLIENTE.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex min-h-14 items-center gap-3 text-lg">
                  <input
                    type="checkbox"
                    name="arq"
                    value="1"
                    defaultChecked={filtros.temArquiteto}
                    className="size-6"
                  />
                  Tem arquiteto
                </label>

                <label className="block space-y-1">
                  <span className="text-lg font-medium">Motivo da perda</span>
                  <select name="motivo" defaultValue={filtros.motivo ?? ""} className={campo}>
                    <option value="">Qualquer</option>
                    {LISTA_MOTIVOS.map((m) => (
                      <option key={m.valor} value={m.valor}>
                        {m.rotulo}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-lg font-medium">Validade</span>
                  <select name="validade" defaultValue={filtros.validade ?? ""} className={campo}>
                    <option value="">Qualquer</option>
                    {VALIDADES.map((v) => (
                      <option key={v} value={v}>
                        {ROTULOS_VALIDADE[v]}
                      </option>
                    ))}
                  </select>
                </label>

                {vendedoras && vendedoras.length > 0 ? (
                  <label className="block space-y-1">
                    <span className="text-lg font-medium">Vendedora</span>
                    <select
                      name="vendedora"
                      defaultValue={filtros.vendedora ?? ""}
                      className={campo}
                    >
                      <option value="">Todas</option>
                      {vendedoras.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="block space-y-1">
                  <span className="text-lg font-medium">Ordenar por</span>
                  <select name="ordem" defaultValue={filtros.ordem} className={campo}>
                    {ORDENS.map((o) => (
                      <option key={o} value={o}>
                        {ROTULOS_ORDEM[o]}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-base text-zinc-600">
                  Com período, os orçamentos de teste ficam de fora.
                </p>
              </div>
              <div className="flex gap-3 border-t border-zinc-200 px-4 py-3">
                <button
                  type="button"
                  onClick={limpar}
                  className="min-h-14 flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-lg"
                >
                  Limpar
                </button>
                <button
                  type="submit"
                  className="min-h-14 flex-[2] rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white"
                >
                  Aplicar filtros
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
