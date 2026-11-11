"use client";

import { useState } from "react";
import {
  calcularKitFita,
  type LinhaPreviaKit,
  type PreviaKit,
} from "@/app/(app)/orcamentos/acoes-revisao";
import type { ProdutoBusca } from "@/lib/estoque/buscar";
import { moedaCentavos, moedaSimples, subtotalCentavos } from "@/lib/orcamento/totais";
import { BuscaProduto } from "./BuscaProduto";

interface Props {
  ambiente: string;
  /** Adiciona as linhas ao ambiente. Devolve o texto do erro (ou null se deu certo). */
  onConfirmar: (linhas: { codigo: string; quantidade: number }[]) => Promise<string | null>;
  onFechar: () => void;
}

type Papel = "fita" | "perfil" | "fonte";
interface LinhaEditavel extends Omit<LinhaPreviaKit, "quantidade"> {
  /** Texto do campo (a vendedora pode ajustar). */
  quantidade: string;
}

const ROTULO: Record<Papel, string> = { fita: "Fita", perfil: "Perfil", fonte: "Fonte" };
const CATEGORIA: Record<Papel, string> = { fita: "FITA LED", perfil: "PERFIL", fonte: "FONTE" };
const campo = "min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg";

const numeroBR = (t: string) => Number(t.replace(",", "."));
const textoNumero = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

/**
 * Kit de fita LED de um ambiente: metros + fita (+ perfil) -> prévia com perfil e fonte calculados,
 * que a vendedora confirma ou ajusta antes de adicionar. O preço vem do catálogo (servidor).
 */
export function KitFita({ ambiente, onConfirmar, onFechar }: Props) {
  const [metros, setMetros] = useState("");
  const [fita, setFita] = useState<ProdutoBusca | null>(null);
  const [comPerfil, setComPerfil] = useState(true);
  const [perfil, setPerfil] = useState<ProdutoBusca | null>(null);
  const [busca, setBusca] = useState<Papel | null>(null);
  const [previa, setPrevia] = useState<PreviaKit | null>(null);
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function calcular() {
    setErro(null);
    if (!fita) return setErro("Escolha a fita.");
    if (comPerfil && !perfil) return setErro("Escolha o perfil ou desmarque “Incluir perfil”.");
    setOcupado(true);
    let r;
    try {
      r = await calcularKitFita({
        metros,
        fita: fita.codigo,
        perfil: comPerfil ? perfil!.codigo : null,
      });
    } catch {
      r = { ok: false as const, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    setPrevia(r.previa);
    setLinhas(r.previa.linhas.map((l) => ({ ...l, quantidade: textoNumero(l.quantidade) })));
  }

  function escolheu(papel: Papel, p: ProdutoBusca) {
    setBusca(null);
    if (!previa) return papel === "fita" ? setFita(p) : setPerfil(p);
    // Na prévia, trocar uma linha (a fonte, por exemplo) mantém a quantidade em 1 até ela ajustar.
    setLinhas((atual) => {
      const nova: LinhaEditavel = {
        papel,
        codigo: p.codigo,
        descricao: p.descricao,
        unidade: p.unidade,
        precoUnitario: p.preco_unitario,
        quantidade: "1",
        conta: "escolhida por você",
      };
      return atual.some((l) => l.papel === papel)
        ? atual.map((l) => (l.papel === papel ? nova : l))
        : [...atual, nova];
    });
  }

  const validas = linhas.map((l) => ({ l, n: numeroBR(l.quantidade) }));
  const invalida = validas.find(({ n }) => !Number.isFinite(n) || n <= 0);
  const total = validas.reduce(
    (s, { l, n }) => (Number.isFinite(n) && n > 0 ? s + subtotalCentavos(l.precoUnitario, n) : s),
    0,
  );
  const faltaFonte =
    previa?.fonte.estado === "escolher" && !linhas.some((l) => l.papel === "fonte");

  async function confirmar() {
    setErro(null);
    if (invalida) return setErro(`Confira a quantidade de ${invalida.l.descricao}.`);
    if (linhas.length === 0) return setErro("Nada para adicionar.");
    setOcupado(true);
    const e = await onConfirmar(validas.map(({ l, n }) => ({ codigo: l.codigo, quantidade: n })));
    setOcupado(false);
    if (e) return setErro(e);
    onFechar();
  }

  return (
    <div
      role="group"
      aria-label={`Kit de fita em ${ambiente}`}
      className="space-y-4 rounded-lg border-2 border-amber-700 bg-amber-50 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xl font-semibold">Kit de fita em {ambiente}</p>
        <button type="button" onClick={onFechar} className="min-h-11 px-2 text-base underline">
          Cancelar
        </button>
      </div>

      {!previa ? (
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-lg font-medium">Metros de fita</span>
            <input
              type="text"
              inputMode="decimal"
              value={metros}
              onChange={(e) => setMetros(e.target.value)}
              placeholder="Ex.: 5 ou 5,5"
              className={campo}
            />
          </label>

          <div className="space-y-2">
            <p className="text-lg font-medium">Fita</p>
            <button
              type="button"
              onClick={() => setBusca("fita")}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-zinc-300 bg-white px-4 text-left text-lg"
            >
              <span className="min-w-0">
                {fita ? (
                  <>
                    <span className="block font-medium">{fita.descricao}</span>
                    <span className="block text-base text-zinc-600">
                      Cód. {fita.codigo} · {moedaSimples(fita.preco_unitario)}/{fita.unidade}
                    </span>
                  </>
                ) : (
                  "Escolher a fita"
                )}
              </span>
              <span className="shrink-0 text-base underline">{fita ? "Trocar" : "Buscar"}</span>
            </button>
          </div>

          <div className="space-y-2">
            <label className="flex min-h-11 items-center gap-3 text-lg">
              <input
                type="checkbox"
                checked={comPerfil}
                onChange={(e) => setComPerfil(e.target.checked)}
                className="size-6"
              />
              Incluir perfil
            </label>
            {comPerfil ? (
              <button
                type="button"
                onClick={() => setBusca("perfil")}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-zinc-300 bg-white px-4 text-left text-lg"
              >
                <span className="min-w-0">
                  {perfil ? (
                    <>
                      <span className="block font-medium">{perfil.descricao}</span>
                      <span className="block text-base text-zinc-600">
                        Cód. {perfil.codigo} · {moedaSimples(perfil.preco_unitario)}/
                        {perfil.unidade}
                      </span>
                    </>
                  ) : (
                    "Escolher o perfil"
                  )}
                </span>
                <span className="shrink-0 text-base underline">{perfil ? "Trocar" : "Buscar"}</span>
              </button>
            ) : null}
          </div>

          {erro ? (
            <p role="alert" className="text-lg text-red-700">
              {erro}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void calcular()}
            disabled={ocupado || metros.trim() === ""}
            className="min-h-14 w-full rounded-lg bg-amber-700 px-5 text-lg font-semibold text-white disabled:opacity-50"
          >
            {ocupado ? "Calculando..." : "Calcular o kit"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-lg">
            Kit de <strong>{String(previa.metros).replace(".", ",")} m</strong>. Confira e ajuste as
            quantidades antes de adicionar.
          </p>

          <ul className="space-y-3">
            {linhas.map((l) => {
              const n = numeroBR(l.quantidade);
              return (
                <li
                  key={l.papel}
                  className="space-y-2 rounded-lg border border-zinc-300 bg-white p-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-base font-semibold text-amber-900">
                      {ROTULO[l.papel]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBusca(l.papel)}
                      className="min-h-11 px-2 text-base underline"
                    >
                      Trocar
                    </button>
                  </div>
                  <p className="text-lg font-medium">{l.descricao}</p>
                  <p className="text-base text-zinc-600">
                    Cód. {l.codigo} · {moedaSimples(l.precoUnitario)}/{l.unidade}
                  </p>
                  <p className="text-base text-zinc-700">{l.conta}</p>
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-lg">
                      <span>Qtd. ({l.unidade})</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Quantidade de ${ROTULO[l.papel].toLowerCase()}`}
                        value={l.quantidade}
                        onChange={(e) =>
                          setLinhas((atual) =>
                            atual.map((x) =>
                              x.papel === l.papel ? { ...x, quantidade: e.target.value } : x,
                            ),
                          )
                        }
                        className="min-h-12 w-24 rounded-lg border border-zinc-300 px-3 text-center text-lg"
                      />
                    </label>
                    <strong className="text-lg">
                      {Number.isFinite(n) && n > 0
                        ? moedaCentavos(subtotalCentavos(l.precoUnitario, n))
                        : "—"}
                    </strong>
                  </div>
                </li>
              );
            })}
          </ul>

          {faltaFonte && previa.fonte.estado === "escolher" ? (
            <div className="space-y-2 rounded-lg border-2 border-amber-700 bg-white p-3">
              <p role="status" className="text-lg">
                {previa.fonte.motivo}
              </p>
              {previa.fonte.necessariaW !== null ? (
                <p className="text-base text-zinc-700">
                  Carga da fita: {String(previa.fonte.cargaW).replace(".", ",")} W; com margem,{" "}
                  {String(previa.fonte.necessariaW).replace(".", ",")} W.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setBusca("fonte")}
                className="min-h-12 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg"
              >
                Escolher a fonte
              </button>
            </div>
          ) : null}
          {previa.fonte.estado === "nao_precisa" ? (
            <p className="text-base text-zinc-700">{previa.fonte.motivo}</p>
          ) : null}

          {previa.avisos
            .filter((a) => !(previa.fonte.estado === "escolher" && a === previa.fonte.motivo))
            .map((a) => (
              <p key={a} role="status" className="text-base font-medium text-amber-950">
                {a}
              </p>
            ))}

          <p className="flex items-baseline justify-between text-lg">
            <span>Total do kit</span>
            <strong>{moedaCentavos(total)}</strong>
          </p>

          {erro ? (
            <p role="alert" className="text-lg text-red-700">
              {erro}
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setPrevia(null);
                setErro(null);
              }}
              className="min-h-14 flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-lg"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={ocupado || linhas.length === 0}
              className="min-h-14 flex-[2] rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              {ocupado ? "Adicionando..." : "Adicionar kit ao ambiente"}
            </button>
          </div>
        </div>
      )}

      {busca ? (
        <BuscaProduto
          titulo={`${ROTULO[busca]}: buscar`}
          categoria={CATEGORIA[busca]}
          onEscolher={(p) => escolheu(busca, p)}
          onFechar={() => setBusca(null)}
        />
      ) : null}
    </div>
  );
}
