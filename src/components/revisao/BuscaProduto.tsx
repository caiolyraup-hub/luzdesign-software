"use client";

import { useEffect, useRef, useState } from "react";
import { buscarProdutosRevisao, produtosMaisUsados } from "@/app/(app)/orcamentos/acoes-revisao";
import type { ProdutoBusca } from "@/lib/estoque/buscar";
import { moedaSimples } from "@/lib/orcamento/totais";

interface Props {
  titulo: string;
  /**
   * Produto escolhido. No modo `continuo` a folha continua aberta (dá para adicionar vários
   * seguidos); no modo normal ela fecha (trocar produto).
   */
  onEscolher: (produto: ProdutoBusca) => void;
  onFechar: () => void;
  continuo?: boolean;
  /** Só produtos desta categoria (ex.: "FITA LED"), na busca e nos mais usados. */
  categoria?: string;
}

const ATRASO_MS = 250;
const SO_CODIGO = /^\d{4,5}$/;

/**
 * Folha em tela cheia: busca no catálogo por código (5 dígitos acha o produto direto), descrição,
 * categoria, marca ou apelido. Mostra preço e estoque. Tocar adiciona com quantidade 1.
 */
export function BuscaProduto({ titulo, onEscolher, onFechar, continuo = false, categoria }: Props) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ProdutoBusca[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [adicionados, setAdicionados] = useState<Map<string, number>>(new Map());
  const [aviso, setAviso] = useState<string | null>(null);
  const [maisUsados, setMaisUsados] = useState<ProdutoBusca[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequencia = useRef(0);
  const campo = useRef<HTMLInputElement>(null);

  // Com a busca vazia: os produtos que a própria vendedora mais usou nos últimos 90 dias.
  useEffect(() => {
    let ativo = true;
    void produtosMaisUsados(categoria ?? null)
      .then((r) => {
        if (ativo && r.ok) setMaisUsados(r.produtos);
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [categoria]);

  async function buscar(valor: string): Promise<ProdutoBusca[] | null> {
    const minha = ++sequencia.current;
    setBuscando(true);
    const r = await buscarProdutosRevisao(valor, categoria ?? null);
    if (minha !== sequencia.current) return null; // chegou uma busca mais nova
    setBuscando(false);
    if (!r.ok) {
      setErro(r.erro);
      return null;
    }
    setErro(null);
    setResultados(r.produtos);
    return r.produtos;
  }

  function mudou(valor: string) {
    setTexto(valor);
    setAviso(null);
    if (timer.current) clearTimeout(timer.current);
    if (valor.trim().length < 2) {
      setResultados(null);
      setErro(null);
      return;
    }
    timer.current = setTimeout(() => void buscar(valor), ATRASO_MS);
  }

  function escolher(p: ProdutoBusca) {
    onEscolher(p);
    if (!continuo) return;
    setAdicionados((atual) => new Map(atual).set(p.codigo, (atual.get(p.codigo) ?? 0) + 1));
    setAviso(`Adicionado: ${p.descricao}`);
    // Pronto para o próximo código.
    setTexto("");
    setResultados(null);
    campo.current?.focus();
  }

  async function enter() {
    const valor = texto.trim();
    if (!SO_CODIGO.test(valor)) return;
    if (timer.current) clearTimeout(timer.current);
    const lista = resultados?.[0]?.codigo === valor ? resultados : await buscar(valor);
    const exato = lista?.find((p) => p.codigo === valor);
    if (exato) escolher(exato);
    else if (lista) setAviso(`Código ${valor} não encontrado.`);
  }

  function renderLista(lista: ProdutoBusca[]) {
    return (
      <ul className="divide-y divide-zinc-200">
        {lista.map((p) => (
          <li key={p.codigo}>
            <button
              type="button"
              onClick={() => escolher(p)}
              className="flex min-h-16 w-full items-start justify-between gap-3 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-lg font-medium">{p.descricao}</span>
                <span className="block text-base text-zinc-600">
                  Cód. {p.codigo}
                  {p.categoria ? ` · ${p.categoria}` : ""}
                  {p.marca ? ` · ${p.marca}` : ""}
                  {p.estoque_disponivel !== null ? ` · estoque ${p.estoque_disponivel}` : ""}
                </span>
                {adicionados.get(p.codigo) ? (
                  <span className="block text-base font-medium text-emerald-800">
                    ✓ {adicionados.get(p.codigo)} adicionado
                    {(adicionados.get(p.codigo) ?? 0) > 1 ? "s" : ""}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-lg font-semibold">
                {moedaSimples(p.preco_unitario)}
                <span className="text-base font-normal text-zinc-600">/{p.unidade}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const total = [...adicionados.values()].reduce((a, b) => a + b, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-40 flex flex-col bg-white"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="text-xl font-semibold">{titulo}</h2>
        <button
          type="button"
          onClick={onFechar}
          className="min-h-11 rounded-lg border border-zinc-300 px-4 text-base"
        >
          {continuo && total > 0 ? `Concluir (${total})` : "Fechar"}
        </button>
      </div>
      <div className="space-y-2 px-4 py-3">
        <input
          ref={campo}
          type="search"
          autoFocus
          value={texto}
          onChange={(e) => mudou(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void enter();
            }
          }}
          inputMode="search"
          enterKeyHint="go"
          placeholder="Código de 5 dígitos, descrição, marca..."
          aria-label="Buscar produto"
          className="min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg"
        />
        {aviso ? (
          <p role="status" className="text-base font-medium text-emerald-800">
            {aviso}
          </p>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {erro ? (
          <p role="alert" className="text-lg text-red-700">
            {erro}
          </p>
        ) : null}
        {buscando ? <p className="text-lg text-zinc-600">Buscando...</p> : null}
        {!buscando && resultados === null ? (
          <p className="text-lg text-zinc-600">
            Digite o código (4 ou 5 dígitos) ou ao menos 2 letras. Com o código completo, toque em
            Enter para adicionar direto.
          </p>
        ) : null}
        {!buscando && resultados?.length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum produto encontrado.</p>
        ) : null}
        {!buscando && resultados === null && maisUsados.length > 0 ? (
          <section aria-label="Seus mais usados" className="space-y-1">
            <h3 className="pt-2 text-lg font-semibold">Seus mais usados</h3>
            {renderLista(maisUsados)}
          </section>
        ) : null}
        {renderLista(resultados ?? [])}
      </div>
    </div>
  );
}
