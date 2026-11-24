"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  calcularAnteriores,
  desfazerPagamento,
  marcarPagas,
  recalcular,
  salvarAjustes,
  salvarObservacao,
  salvarPercentualProprio,
} from "@/app/(app)/comissoes/acoes";
import type { LancamentoComissao } from "@/lib/comissoes/carregar";
import { formatarMoeda } from "@/lib/formatar";

const botao = "min-h-12 rounded-lg border border-zinc-300 bg-white px-4 text-lg";
const campo = "min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg";

type R = { ok: boolean; erro?: string };

function useAcao() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  async function executar<T extends R>(
    f: () => Promise<T>,
    sucesso: string | ((r: Extract<T, { ok: true }>) => string),
  ): Promise<Extract<T, { ok: true }> | null> {
    setOcupado(true);
    setMsg(null);
    let r: T | R;
    try {
      r = await f();
    } catch {
      r = { ok: false, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    setOcupado(false);
    if (!r.ok) {
      setMsg({ ok: false, texto: (r as R).erro ?? "Não foi possível agora." });
      return null;
    }
    const ok = r as Extract<T, { ok: true }>;
    setMsg({ ok: true, texto: typeof sucesso === "function" ? sucesso(ok) : sucesso });
    router.refresh();
    return ok;
  }
  return { ocupado, msg, executar };
}

function Aviso({ msg }: { msg: { ok: boolean; texto: string } | null }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={`text-lg ${msg.ok ? "text-emerald-800" : "text-red-700"}`}
    >
      {msg.texto}
    </p>
  );
}

const ROTULO_STATUS = { a_pagar: "A pagar", paga: "Paga", cancelada: "Cancelada" } as const;

/** Lançamentos de um beneficiário: marcar como paga (várias, com data), desfazer, recalcular, observação. */
export function Lancamentos({
  lancamentos,
  hoje,
}: {
  lancamentos: LancamentoComissao[];
  hoje: string;
}) {
  const { ocupado, msg, executar } = useAcao();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [data, setData] = useState(hoje);
  const [obs, setObs] = useState<{ id: string; texto: string } | null>(null);
  const aPagar = lancamentos.filter((l) => l.status === "a_pagar");
  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const totalSel = aPagar.filter((l) => sel.has(l.id)).reduce((s, l) => s + l.valor, 0);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {lancamentos.map((l) => (
          <li key={l.id} className="space-y-2 rounded-lg border border-zinc-200 p-3">
            <div className="flex items-start gap-3">
              {l.status === "a_pagar" ? (
                <input
                  type="checkbox"
                  aria-label={`Selecionar ${l.orcamentoNumero}`}
                  checked={sel.has(l.id)}
                  onChange={() => alternar(l.id)}
                  className="mt-1 h-6 w-6 shrink-0"
                />
              ) : null}
              <div className="min-w-0 flex-1 space-y-0.5">
                <Link
                  href={`/orcamentos/${l.orcamentoId}`}
                  className="block text-lg font-medium underline"
                >
                  {l.orcamentoNumero}
                  {l.clienteNome ? ` · ${l.clienteNome}` : ""}
                </Link>
                <p className="text-base text-zinc-600">
                  {formatarMoeda(l.base)} × {String(l.percentual).replace(".", ",")}% ·{" "}
                  {ROTULO_STATUS[l.status]}
                  {l.pagaEm ? ` em ${l.pagaEm.split("-").reverse().join("/")}` : ""}
                </p>
                {l.revisar ? (
                  <p className="text-base font-medium text-amber-800">
                    Orçamento reaberto depois do pagamento: revise.
                  </p>
                ) : null}
                {l.observacao ? (
                  <p className="text-base whitespace-pre-wrap text-zinc-700">{l.observacao}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-lg font-semibold">{formatarMoeda(l.valor)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {l.status === "paga" ? (
                <button
                  type="button"
                  disabled={ocupado}
                  className={botao}
                  onClick={() =>
                    void executar(() => desfazerPagamento(l.id), "Pagamento desfeito.")
                  }
                >
                  Desfazer pagamento
                </button>
              ) : null}
              {l.status === "a_pagar" ? (
                <button
                  type="button"
                  disabled={ocupado}
                  className={botao}
                  onClick={() => {
                    if (window.confirm("Recalcular com o percentual de hoje?"))
                      void executar(() => recalcular(l.id), "Recalculada.");
                  }}
                >
                  Recalcular
                </button>
              ) : null}
              <button
                type="button"
                className={botao}
                onClick={() => setObs({ id: l.id, texto: l.observacao ?? "" })}
              >
                Observação
              </button>
            </div>
            {obs?.id === l.id ? (
              <div className="space-y-2">
                <textarea
                  aria-label="Observação da comissão"
                  value={obs.texto}
                  onChange={(e) => setObs({ id: l.id, texto: e.target.value })}
                  className={`${campo} min-h-24 py-3`}
                />
                <button
                  type="button"
                  disabled={ocupado}
                  className={botao}
                  onClick={async () => {
                    if (
                      await executar(() => salvarObservacao(l.id, obs.texto), "Observação salva.")
                    )
                      setObs(null);
                  }}
                >
                  Salvar observação
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {aPagar.length > 0 ? (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-3">
          <label className="block space-y-1">
            <span className="text-lg font-medium">Data do pagamento</span>
            <input
              type="date"
              value={data}
              max={hoje}
              onChange={(e) => setData(e.target.value)}
              className={campo}
            />
          </label>
          <button
            type="button"
            disabled={ocupado || sel.size === 0}
            onClick={async () => {
              const r = await executar(
                () => marcarPagas([...sel], data),
                (x) => `${x.pagas} comissão(ões) marcada(s) como paga(s).`,
              );
              if (r) setSel(new Set());
            }}
            className="bg-primario text-sobre-primario min-h-14 w-full rounded-lg px-4 text-lg font-semibold disabled:opacity-50"
          >
            Marcar como paga{sel.size > 0 ? ` (${sel.size} · ${formatarMoeda(totalSel)})` : ""}
          </button>
        </div>
      ) : null}
      <Aviso msg={msg} />
    </div>
  );
}

/** "Calcular fechamentos anteriores": mostra a prévia e só grava depois de confirmar. */
export function FechamentosAnteriores() {
  const { ocupado, msg, executar } = useAcao();
  const [previa, setPrevia] = useState<{
    linhas: number;
    itens: { orcamento: string; tipo: string; percentual: number; valor: number }[];
  } | null>(null);
  return (
    <div className="space-y-3 rounded-lg border border-zinc-300 p-4">
      <h2 className="text-xl font-semibold">Fechamentos anteriores</h2>
      <p className="text-base text-zinc-600">
        Orçamentos já fechados (sem os de teste) que ainda não têm comissão. Veja a prévia antes de
        gravar.
      </p>
      <button
        type="button"
        disabled={ocupado}
        className={botao}
        onClick={async () => {
          const r = await executar(
            () => calcularAnteriores(false),
            (x) => `${x.linhas} lançamento(s) na prévia.`,
          );
          if (r) setPrevia({ linhas: r.linhas, itens: r.itens });
        }}
      >
        Calcular fechamentos anteriores
      </button>
      {previa ? (
        <div className="space-y-2">
          <ul className="max-h-60 space-y-1 overflow-y-auto text-base">
            {previa.itens.map((i, k) => (
              <li key={k}>
                {i.orcamento} · {i.tipo === "arquiteto" ? "Arquiteto" : "Vendedora"} ·{" "}
                {String(i.percentual).replace(".", ",")}% · {formatarMoeda(i.valor)}
              </li>
            ))}
          </ul>
          {previa.linhas > 0 ? (
            <button
              type="button"
              disabled={ocupado}
              className="bg-primario text-sobre-primario min-h-14 w-full rounded-lg px-4 text-lg font-semibold"
              onClick={async () => {
                if (await executar(() => calcularAnteriores(true), "Comissões gravadas."))
                  setPrevia(null);
              }}
            >
              Gravar {previa.linhas} lançamento(s)
            </button>
          ) : (
            <p className="text-lg text-zinc-700">Nada a calcular.</p>
          )}
        </div>
      ) : null}
      <Aviso msg={msg} />
    </div>
  );
}

interface Ajustes {
  arquitetoPadrao: string;
  vendedoraPadrao: string;
  vendedoraComArquiteto: string;
}

export function FormAjustes({ inicial }: { inicial: Ajustes }) {
  const { ocupado, msg, executar } = useAcao();
  const [v, setV] = useState(inicial);
  const f = (k: keyof Ajustes) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void executar(() => salvarAjustes(v), "Percentuais salvos.");
      }}
      className="space-y-4"
    >
      <p className="text-base text-zinc-600">
        Deixe em branco o que ainda não foi definido: enquanto estiver vazio, nada é calculado. A
        base é o valor fechado do orçamento. Use de 0 a 30%, com até 2 casas.
      </p>
      <label className="block space-y-1">
        <span className="text-lg font-medium">Arquiteto (RT): percentual padrão (%)</span>
        <input
          inputMode="decimal"
          value={v.arquitetoPadrao}
          onChange={f("arquitetoPadrao")}
          className={campo}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-lg font-medium">Vendedora: percentual padrão (%)</span>
        <input
          inputMode="decimal"
          value={v.vendedoraPadrao}
          onChange={f("vendedoraPadrao")}
          className={campo}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-lg font-medium">Vendedora, venda com arquiteto (%)</span>
        <input
          inputMode="decimal"
          value={v.vendedoraComArquiteto}
          onChange={f("vendedoraComArquiteto")}
          className={campo}
        />
        <span className="block text-base text-zinc-600">
          Em branco = usa o padrão da vendedora.
        </span>
      </label>
      <button
        type="submit"
        disabled={ocupado}
        className="bg-primario text-sobre-primario min-h-14 w-full rounded-lg px-4 text-lg font-semibold disabled:opacity-50"
      >
        Salvar percentuais
      </button>
      <Aviso msg={msg} />
    </form>
  );
}

/** Percentual próprio de uma pessoa (vazio = volta ao padrão). */
export function PercentualProprio({
  tipo,
  id,
  nome,
  inicial,
}: {
  tipo: "arquiteto" | "vendedora";
  id: string;
  nome: string;
  inicial: string;
}) {
  const { ocupado, msg, executar } = useAcao();
  const [valor, setValor] = useState(inicial);
  return (
    <div className="space-y-1 rounded-lg border border-zinc-200 p-3">
      <label className="block space-y-1">
        <span className="text-lg font-medium">{nome}</span>
        <div className="flex gap-2">
          <input
            aria-label={`Percentual de ${nome}`}
            inputMode="decimal"
            placeholder="padrão"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className={campo}
          />
          <button
            type="button"
            disabled={ocupado}
            className={`${botao} shrink-0`}
            onClick={() => void executar(() => salvarPercentualProprio(tipo, id, valor), "Salvo.")}
          >
            Salvar
          </button>
        </div>
      </label>
      <Aviso msg={msg} />
    </div>
  );
}
