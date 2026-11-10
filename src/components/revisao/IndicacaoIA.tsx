"use client";

import { useState } from "react";
import { pedirIndicacaoIA } from "@/app/(app)/orcamentos/acoes-ia";
import type { IndicacaoGuardada, SugestaoValida } from "@/lib/ia/indicacao";
import { moedaCentavos, moedaSimples, subtotalCentavos } from "@/lib/orcamento/totais";

export interface HistoricoIndicacao {
  ambiente: string;
  criadoEm: string;
  resposta: IndicacaoGuardada;
}

type Adicionar = (
  ambiente: string,
  linhas: { codigo: string; quantidade: number }[],
) => Promise<string | null>;

interface Props {
  orcamentoId: string;
  /** Ambientes do orçamento (os das perguntas, os acrescentados e os que já têm item). */
  ambientes: string[];
  /** Pergunta 6 do formulário, se foi respondida. */
  pedidoClienteInicial: string;
  temAnexos: boolean;
  restantesHoje: number;
  /** Última indicação de cada ambiente. */
  historico: HistoricoIndicacao[];
  onAdicionar: Adicionar;
}

const NOVO = "__novo__";
const campo = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-lg";

function numeroBR(n: number) {
  return String(n).replace(".", ",");
}

/** Sugestões de uma indicação: a vendedora toca em Adicionar em cada uma (nada entra sozinho). */
function ListaSugestoes({
  ambiente,
  indicacao,
  onAdicionar,
}: {
  ambiente: string;
  indicacao: IndicacaoGuardada;
  onAdicionar: Adicionar;
}) {
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [adicionadas, setAdicionadas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const quantidadeDe = (s: SugestaoValida) => {
    const q = Number((quantidades[s.codigo] ?? numeroBR(s.quantidade)).replace(",", "."));
    return Number.isFinite(q) && q > 0 ? q : s.quantidade;
  };

  async function adicionar(lista: SugestaoValida[]) {
    setErro(null);
    const e = await onAdicionar(
      ambiente,
      lista.map((s) => ({ codigo: s.codigo, quantidade: quantidadeDe(s) })),
    );
    if (e) return setErro(e);
    setAdicionadas((atual) => new Set([...atual, ...lista.map((s) => s.codigo)]));
  }

  const pendentes = indicacao.sugestoes.filter((s) => !adicionadas.has(s.codigo));

  return (
    <div className="space-y-3">
      {indicacao.resumo ? (
        <p className="rounded-lg bg-white p-3 text-lg whitespace-pre-wrap">{indicacao.resumo}</p>
      ) : null}

      {indicacao.observacoes.length > 0 ? (
        <ul className="list-disc space-y-1 rounded-lg border border-amber-700 bg-amber-50 py-3 pr-3 pl-8 text-base">
          {indicacao.observacoes.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      ) : null}

      {indicacao.avisos.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-base text-zinc-700">
          {indicacao.avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : null}

      {erro ? (
        <p role="alert" className="text-base font-medium text-red-700">
          {erro}
        </p>
      ) : null}

      {indicacao.sugestoes.length === 0 ? (
        <p className="text-lg text-zinc-700">A IA não encontrou produtos para sugerir.</p>
      ) : (
        <ul className="space-y-3">
          {indicacao.sugestoes.map((s) => {
            const feita = adicionadas.has(s.codigo);
            const q = quantidadeDe(s);
            return (
              <li
                key={s.codigo}
                className="space-y-2 rounded-lg border border-zinc-300 bg-white p-3"
                aria-label={`Sugestão ${s.codigo}`}
              >
                <p className="text-lg font-medium">{s.descricao}</p>
                <p className="text-base text-zinc-600">
                  Cód. {s.codigo}
                  {s.categoria ? ` · ${s.categoria}` : ""} · {moedaSimples(s.precoUnitario)}/
                  {s.unidade}
                  {s.jaNoAmbiente ? " · já está neste ambiente" : ""}
                </p>
                {s.motivo ? <p className="text-base text-zinc-700">{s.motivo}</p> : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-base">
                    Qtd
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Quantidade sugerida de ${s.codigo}`}
                      value={quantidades[s.codigo] ?? numeroBR(s.quantidade)}
                      disabled={feita}
                      onChange={(e) =>
                        setQuantidades((a) => ({ ...a, [s.codigo]: e.target.value }))
                      }
                      onFocus={(e) => e.target.select()}
                      className="min-h-12 w-24 rounded-lg border border-zinc-300 px-3 text-center text-lg disabled:opacity-60"
                    />
                    {s.unidade}
                  </label>
                  <span className="text-lg font-semibold">
                    {moedaCentavos(subtotalCentavos(s.precoUnitario, q))}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void adicionar([s])}
                  disabled={feita}
                  className="min-h-12 w-full rounded-lg border-2 border-amber-700 px-4 text-lg font-semibold text-amber-800 disabled:border-emerald-700 disabled:text-emerald-800"
                >
                  {feita ? "Adicionado ✓" : "Adicionar"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pendentes.length > 1 ? (
        <button
          type="button"
          onClick={() => void adicionar(pendentes)}
          className="min-h-12 w-full rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white"
        >
          Adicionar todas ({pendentes.length})
        </button>
      ) : null}
    </div>
  );
}

/** Card "Indicação da IA": a vendedora conta o pedido e a IA sugere produtos do catálogo. */
export function IndicacaoIA({
  orcamentoId,
  ambientes,
  pedidoClienteInicial,
  temAnexos,
  restantesHoje,
  historico,
  onAdicionar,
}: Props) {
  const [ambiente, setAmbiente] = useState(ambientes[0] ?? NOVO);
  const [novoNome, setNovoNome] = useState("");
  const [cliente, setCliente] = useState(pedidoClienteInicial);
  const [arquiteto, setArquiteto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [anexos, setAnexos] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [podeTentar, setPodeTentar] = useState(true);
  const [restantes, setRestantes] = useState(restantesHoje);
  const [atual, setAtual] = useState<{
    ambiente: string;
    indicacao: IndicacaoGuardada;
    chave: number;
  } | null>(null);

  const nomeAmbiente = ambiente === NOVO ? novoNome.trim() : ambiente;
  const semTexto = !cliente.trim() && !arquiteto.trim() && !descricao.trim();
  const pode = !pedindo && nomeAmbiente.length > 0 && !semTexto && restantes > 0;

  async function pedir() {
    setErro(null);
    setPedindo(true);
    setAtual(null);
    let r;
    try {
      r = await pedirIndicacaoIA({
        orcamentoId,
        ambiente: nomeAmbiente,
        pedidoCliente: cliente,
        pedidoArquiteto: arquiteto,
        descricaoAmbiente: descricao,
        usarAnexos: anexos,
      });
    } catch {
      r = {
        ok: false as const,
        erro: "Perdi a conexão com o servidor. Tente de novo.",
        podeTentarDeNovo: true,
      };
    }
    setPedindo(false);
    if (!r.ok) {
      setErro(r.erro);
      setPodeTentar(r.podeTentarDeNovo);
      return;
    }
    setRestantes(r.restantesHoje);
    setAtual({
      ambiente: nomeAmbiente,
      chave: Date.now(),
      indicacao: {
        resumo: r.resumo,
        sugestoes: r.sugestoes,
        observacoes: r.observacoes,
        avisos: r.avisos,
      },
    });
  }

  const anteriores = historico.filter(
    (h) => !atual || h.ambiente.toLowerCase() !== atual.ambiente.toLowerCase(),
  );

  return (
    <section
      aria-labelledby="indicacao-ia"
      className="space-y-4 rounded-lg border-2 border-sky-700 bg-sky-50 p-4"
    >
      <div className="space-y-1">
        <h2 id="indicacao-ia" className="text-xl font-semibold">
          Indicação da IA
        </h2>
        <p className="text-base text-zinc-700">
          Conte o pedido e a IA sugere produtos do catálogo. Nada entra no orçamento sozinho: você
          toca em Adicionar nas sugestões que quiser.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-base font-medium">Ambiente</span>
        <select
          value={ambiente}
          onChange={(e) => setAmbiente(e.target.value)}
          className={`${campo} min-h-12`}
        >
          {ambientes.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value={NOVO}>Novo ambiente...</option>
        </select>
      </label>
      {ambiente === NOVO ? (
        <input
          type="text"
          aria-label="Nome do novo ambiente"
          placeholder="Nome do ambiente (ex.: Varanda)"
          value={novoNome}
          maxLength={60}
          onChange={(e) => setNovoNome(e.target.value)}
          className={`${campo} min-h-12`}
        />
      ) : null}

      <label className="block space-y-1">
        <span className="text-base font-medium">O que o cliente pediu</span>
        <textarea
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          rows={3}
          maxLength={4000}
          className={campo}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-base font-medium">O que o arquiteto pediu (opcional)</span>
        <textarea
          value={arquiteto}
          onChange={(e) => setArquiteto(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Cole o que o arquiteto especificou, se houver"
          className={campo}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-base font-medium">Como é o ambiente (opcional)</span>
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Tamanho, pé-direito, forro, luz natural, uso"
          className={campo}
        />
      </label>

      {temAnexos ? (
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input
            type="checkbox"
            checked={anexos}
            onChange={(e) => setAnexos(e.target.checked)}
            className="size-6"
          />
          Usar fotos e plantas anexadas
        </label>
      ) : null}

      {erro ? (
        <div role="alert" className="space-y-2 rounded-lg border-2 border-red-700 bg-red-50 p-3">
          <p className="text-base font-medium text-red-800">{erro}</p>
          {podeTentar ? (
            <button
              type="button"
              onClick={() => void pedir()}
              disabled={!pode}
              className="min-h-11 rounded-lg border border-red-700 px-4 text-base font-semibold text-red-800"
            >
              Tentar de novo
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1">
        <button
          type="button"
          onClick={() => void pedir()}
          disabled={!pode}
          className="min-h-14 w-full rounded-lg bg-sky-700 px-5 text-lg font-semibold text-white disabled:opacity-50"
        >
          {pedindo ? "Pedindo a indicação..." : "Pedir indicação"}
        </button>
        <p className="text-center text-base text-zinc-600" aria-live="polite">
          {pedindo
            ? "Isso leva cerca de 30 segundos."
            : restantes > 0
              ? `${restantes} ${restantes === 1 ? "uso" : "usos"} da IA restantes hoje.`
              : "Você usou todas as indicações de hoje."}
        </p>
      </div>

      {atual ? (
        <div className="space-y-2" aria-label={`Sugestões para ${atual.ambiente}`}>
          <h3 className="text-lg font-semibold">Sugestões para {atual.ambiente}</h3>
          <ListaSugestoes
            key={atual.chave}
            ambiente={atual.ambiente}
            indicacao={atual.indicacao}
            onAdicionar={onAdicionar}
          />
        </div>
      ) : null}

      {anteriores.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Indicações anteriores</h3>
          {anteriores.map((h) => (
            <details key={h.ambiente} className="rounded-lg border border-sky-200 bg-white p-3">
              <summary className="min-h-11 cursor-pointer py-2 text-lg">
                {h.ambiente} ({h.resposta.sugestoes.length}{" "}
                {h.resposta.sugestoes.length === 1 ? "sugestão" : "sugestões"})
              </summary>
              <div className="pt-2">
                <ListaSugestoes
                  ambiente={h.ambiente}
                  indicacao={h.resposta}
                  onAdicionar={onAdicionar}
                />
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}
