"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { gerarOrcamentoCompleto } from "@/app/(app)/orcamentos/acoes-pdf";
import {
  adicionarAmbiente,
  adicionarAvulso,
  adicionarKit,
  adicionarListaColada,
  adicionarProduto,
  adicionarSugestoes,
  alterarAvulso,
  alterarQuantidade,
  atualizarPrecos,
  duplicarAmbiente,
  editarDescricao,
  mudarAmbiente,
  removerItem,
  restaurarItem,
  trocarProduto,
  type EstadoRevisao,
  type ItemSalvo,
  type RespostaAdicao,
  type RespostaRemocao,
  type RespostaRevisao,
} from "@/app/(app)/orcamentos/acoes-revisao";
import type { ProdutoBusca } from "@/lib/estoque/buscar";
import { sugerirNomeDuplicado } from "@/lib/orcamento/atalhos";
import { agruparPorAmbiente, itensComPrecoMudado, nomeAmbienteValido } from "@/lib/orcamento/itens";
import { moedaCentavos, motivosBloqueioGerar, totaisDoOrcamento } from "@/lib/orcamento/totais";
import { BuscaProduto } from "./BuscaProduto";
import { ColarLista } from "./ColarLista";
import { KitFita } from "./KitFita";
import { IndicacaoIA, type HistoricoIndicacao } from "./IndicacaoIA";
import { ItemCard } from "./ItemCard";

interface Props {
  orcamentoId: string;
  numero: string;
  clienteNome: string;
  status: "rascunho" | "gerado";
  pdfVersao: number;
  estadoInicial: EstadoRevisao;
  /** Ambientes da pergunta 5, na ordem. */
  ambientesBase: string[];
  descontoPct: number;
  /** Pendências e avisos de orçamentos montados antes pela IA (só leitura). */
  pendencias: string[];
  avisos: string[];
  /** Pergunta 6 do formulário (ponto de partida da Indicação). */
  pedidoClienteInicial: string;
  temAnexos: boolean;
  restantesHoje: number;
  historico: HistoricoIndicacao[];
}

const SUGESTOES_AMBIENTE = [
  "Sala",
  "Cozinha",
  "Quarto",
  "Banheiro",
  "Varanda",
  "Área externa",
  "Fachada",
  "Escritório",
  "Loja",
];

type ModoBusca = { tipo: "trocar"; itemId: string } | { tipo: "adicionar"; ambiente: string };
type Resposta = RespostaRevisao | RespostaRemocao | RespostaAdicao;

const botao = "min-h-12 rounded-lg border border-zinc-300 bg-white px-4 text-lg";
const campo = "min-h-12 rounded-lg border border-zinc-300 px-3 text-lg";
const SEGUNDOS_DESFAZER = 6;

export function Revisao(p: Props) {
  const router = useRouter();
  const [itens, setItens] = useState(p.estadoInicial.itens);
  const [extras, setExtras] = useState(p.estadoInicial.ambientesExtras);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState<ModoBusca | null>(null);
  const [avulsoEm, setAvulsoEm] = useState<string | null>(null);
  const [colarEm, setColarEm] = useState<string | null>(null);
  const [formAvulso, setFormAvulso] = useState({ descricao: "", quantidade: "1", preco: "" });
  const [kitEm, setKitEm] = useState<string | null>(null);
  const [duplicarEm, setDuplicarEm] = useState<{ origem: string; nome: string } | null>(null);
  const [novoAmbiente, setNovoAmbiente] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<ItemSalvo | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroGerar, setErroGerar] = useState<string | null>(null);

  // Alterações vão uma de cada vez ao servidor, na ordem; só se aplica o estado do servidor quando
  // não há mais nada pendente (evita a tela "pular" quando a vendedora toca no + várias vezes).
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const pendentes = useRef(0);
  const timerDesfazer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function aplicar(e: EstadoRevisao) {
    setItens(e.itens);
    setExtras(e.ambientesExtras);
  }

  async function enviar<R extends Resposta>(
    acao: () => Promise<R>,
  ): Promise<Extract<R, { ok: true }> | null> {
    pendentes.current++;
    setSalvando(true);
    setErro(null);
    const execucao = fila.current.then(acao);
    fila.current = execucao.catch(() => undefined);
    let r: Resposta;
    try {
      r = await execucao;
    } catch {
      r = { ok: false, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    pendentes.current--;
    const ultimo = pendentes.current === 0;
    if (ultimo) setSalvando(false);
    if (!r.ok) {
      setErro(r.erro);
      // A tela pode ter mudado de forma otimista: o servidor é a verdade.
      if (ultimo) router.refresh();
      return null;
    }
    if (ultimo) aplicar(r.estado);
    return r as Extract<R, { ok: true }>;
  }

  const base = [...p.ambientesBase, ...extras];
  const grupos = agruparPorAmbiente(itens, base);
  const nomesAmbientes = grupos.map((g) => g.nome);
  const totais = totaisDoOrcamento(
    itens.map((i) => ({ preco_unitario: i.preco, quantidade: i.quantidade })),
    p.descontoPct,
  );
  const bloqueios = motivosBloqueioGerar(
    itens.map((i) => ({
      avulso: i.avulso,
      preco_unitario: i.preco,
      produtoAtivo: i.produtoAtivo,
      descricao: i.descricao,
    })),
  );
  const mudaram = itensComPrecoMudado(itens);

  function quantidade(itemId: string, n: number) {
    setItens((atual) => atual.map((i) => (i.id === itemId ? { ...i, quantidade: n } : i)));
    void enviar(() => alterarQuantidade(p.orcamentoId, itemId, n));
  }

  async function remover(itemId: string) {
    const r = await enviar(() => removerItem(p.orcamentoId, itemId));
    if (r && "desfazer" in r) {
      setDesfazer(r.desfazer);
      if (timerDesfazer.current) clearTimeout(timerDesfazer.current);
      timerDesfazer.current = setTimeout(() => setDesfazer(null), SEGUNDOS_DESFAZER * 1000);
    }
  }

  function refazer() {
    if (!desfazer) return;
    const salvo = desfazer;
    setDesfazer(null);
    if (timerDesfazer.current) clearTimeout(timerDesfazer.current);
    void enviar(() => restaurarItem(p.orcamentoId, salvo));
  }

  function escolheuProduto(produto: ProdutoBusca) {
    const modo = busca;
    if (!modo) return;
    if (modo.tipo === "trocar") {
      setBusca(null);
      void enviar(() => trocarProduto(p.orcamentoId, modo.itemId, produto.codigo));
    } else {
      // A busca continua aberta para adicionar vários produtos seguidos.
      void enviar(() => adicionarProduto(p.orcamentoId, modo.ambiente, produto.codigo, 1));
    }
  }

  /** Adiciona sugestões da Indicação da IA. Devolve o texto de erro (ou null se deu certo). */
  async function adicionarDaIndicacao(
    ambiente: string,
    linhas: { codigo: string; quantidade: number }[],
  ): Promise<string | null> {
    const r = await enviar(() => adicionarSugestoes(p.orcamentoId, ambiente, linhas));
    if (!r) return "Não foi possível adicionar agora. Tente de novo.";
    if (r.avisos.length > 0) setAviso(r.avisos.join(" "));
    return null;
  }

  async function confirmarLista(ambiente: string, texto: string): Promise<string | null> {
    const r = await enviar(() => adicionarListaColada(p.orcamentoId, ambiente, texto));
    if (!r) return "Não foi possível adicionar agora. Tente de novo.";
    setAviso(
      r.avisos.length > 0
        ? r.avisos.join(" ")
        : `${r.adicionados} ${r.adicionados === 1 ? "item adicionado" : "itens adicionados"}.`,
    );
    return null;
  }

  async function confirmarKit(
    ambiente: string,
    linhas: { codigo: string; quantidade: number }[],
  ): Promise<string | null> {
    const r = await enviar(() => adicionarKit(p.orcamentoId, ambiente, linhas));
    if (!r) return "Não foi possível adicionar o kit agora. Tente de novo.";
    setAviso(
      r.avisos.length > 0
        ? r.avisos.join(" ")
        : `Kit adicionado em ${ambiente} (${r.adicionados} ${r.adicionados === 1 ? "item" : "itens"}).`,
    );
    return null;
  }

  async function confirmarDuplicar() {
    if (!duplicarEm) return;
    const { origem, nome } = duplicarEm;
    const r = await enviar(() => duplicarAmbiente(p.orcamentoId, origem, nome));
    if (!r) return;
    setDuplicarEm(null);
    setAviso(
      r.avisos.length > 0
        ? r.avisos.join(" ")
        : `${origem} copiado para ${nome.trim()} (${r.adicionados} ${r.adicionados === 1 ? "item" : "itens"}, com os preços de hoje).`,
    );
  }

  async function salvarAvulso(ambiente: string) {
    const preco = Number(formAvulso.preco.replace(/\./g, "").replace(",", ".") || 0);
    const qtd = Number(formAvulso.quantidade.replace(",", ".") || 1);
    const r = await enviar(() =>
      adicionarAvulso(p.orcamentoId, ambiente, formAvulso.descricao, qtd, preco),
    );
    if (r) {
      setAvulsoEm(null);
      setFormAvulso({ descricao: "", quantidade: "1", preco: "" });
    }
  }

  async function criarAmbiente() {
    const nome = nomeAmbienteValido(novoAmbiente ?? "");
    if (!nome) return setErro("Informe o nome do ambiente.");
    const r = await enviar(() => adicionarAmbiente(p.orcamentoId, nome));
    if (r) setNovoAmbiente(null);
  }

  async function gerar() {
    setErroGerar(null);
    setGerando(true);
    let r;
    try {
      r = await gerarOrcamentoCompleto(p.orcamentoId);
    } catch {
      r = { ok: false as const, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    setGerando(false);
    if (!r.ok) return setErroGerar(r.erro);
    router.push(`/orcamentos/${p.orcamentoId}`);
    router.refresh();
  }

  const podeGerar = bloqueios.length === 0 && !gerando;

  return (
    <div className="space-y-6 pb-52">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">Produtos do orçamento</h1>
          <span role="status" aria-live="polite" className="text-base text-zinc-600">
            {salvando ? "Salvando..." : ""}
          </span>
        </div>
        <p className="text-lg text-zinc-600">
          {p.numero} · {p.clienteNome}
        </p>
      </div>

      {p.status === "gerado" ? (
        <p className="rounded-lg border-2 border-sky-700 bg-sky-50 p-4 text-lg">
          Este orçamento já tem o PDF (versão {p.pdfVersao}). Se você mudar algo e gerar de novo,
          será criada a versão {p.pdfVersao + 1}; a anterior continua guardada.
        </p>
      ) : null}

      {p.pendencias.length > 0 ? (
        <section
          aria-labelledby="pendencias"
          className="space-y-2 rounded-lg border-2 border-amber-700 bg-amber-50 p-4"
        >
          <h2 id="pendencias" className="text-xl font-semibold">
            Pendências
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-lg">
            {p.pendencias.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {p.avisos.length > 0 ? (
        <section
          aria-labelledby="avisos"
          className="space-y-2 rounded-lg border border-zinc-300 p-4"
        >
          <h2 id="avisos" className="text-xl font-semibold">
            Avisos
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-lg text-zinc-700">
            {p.avisos.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {mudaram.length > 0 ? (
        <div role="alert" className="space-y-3 rounded-lg border-2 border-sky-700 bg-sky-50 p-4">
          <p className="text-lg">
            O preço de {mudaram.length} {mudaram.length === 1 ? "item mudou" : "itens mudaram"} no
            estoque.
          </p>
          <button
            type="button"
            onClick={() => void enviar(() => atualizarPrecos(p.orcamentoId))}
            className="min-h-12 w-full rounded-lg bg-sky-700 px-4 text-lg font-semibold text-white"
          >
            Atualizar preços
          </button>
        </div>
      ) : null}

      {erro ? (
        <p
          role="alert"
          className="rounded-lg border-2 border-red-700 bg-red-50 p-4 text-lg text-red-800"
        >
          {erro}
        </p>
      ) : null}

      {aviso ? (
        <p role="status" className="rounded-lg border border-zinc-300 bg-zinc-50 p-4 text-lg">
          {aviso}
        </p>
      ) : null}

      {grupos.map((g) => (
        <section key={g.nome} aria-label={g.nome} className="space-y-3">
          <h2 className="text-xl font-semibold">{g.nome}</h2>
          {g.itens.length > 0 ? (
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
              {g.itens.map((i) => (
                <ItemCard
                  key={i.id}
                  item={i}
                  ambientes={nomesAmbientes}
                  onQuantidade={(n) => quantidade(i.id, n)}
                  onTrocar={() => setBusca({ tipo: "trocar", itemId: i.id })}
                  onMudarAmbiente={(a) => void enviar(() => mudarAmbiente(p.orcamentoId, i.id, a))}
                  onRemover={() => void remover(i.id)}
                  onAvulso={(campos) =>
                    void enviar(() => alterarAvulso(p.orcamentoId, i.id, campos))
                  }
                  onDescricao={(texto) =>
                    void enviar(() => editarDescricao(p.orcamentoId, i.id, texto))
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="text-lg text-zinc-600">Nenhum item neste ambiente ainda.</p>
          )}

          {avulsoEm === g.nome ? (
            <div className="space-y-3 rounded-lg border-2 border-amber-700 bg-amber-50 p-4">
              <p className="text-lg font-medium">Item avulso em {g.nome}</p>
              <input
                type="text"
                aria-label="Descrição do item avulso"
                placeholder="Descrição (ex.: pendente 3 globos, vidro fumê)"
                value={formAvulso.descricao}
                onChange={(e) => setFormAvulso((f) => ({ ...f, descricao: e.target.value }))}
                className={`${campo} w-full`}
              />
              <div className="flex gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Quantidade do item avulso"
                  value={formAvulso.quantidade}
                  onChange={(e) => setFormAvulso((f) => ({ ...f, quantidade: e.target.value }))}
                  className={`${campo} w-24 text-center`}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Preço unitário do item avulso"
                  placeholder="Preço R$ (0 = a definir)"
                  value={formAvulso.preco}
                  onChange={(e) => setFormAvulso((f) => ({ ...f, preco: e.target.value }))}
                  className={`${campo} min-w-0 flex-1`}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAvulsoEm(null)}
                  className={`${botao} flex-1`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void salvarAvulso(g.nome)}
                  disabled={formAvulso.descricao.trim().length < 2}
                  className="min-h-12 flex-[2] rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
                >
                  Adicionar avulso
                </button>
              </div>
            </div>
          ) : colarEm === g.nome ? (
            <ColarLista
              ambiente={g.nome}
              onConfirmar={(texto) => confirmarLista(g.nome, texto)}
              onFechar={() => setColarEm(null)}
            />
          ) : kitEm === g.nome ? (
            <KitFita
              ambiente={g.nome}
              onConfirmar={(linhas) => confirmarKit(g.nome, linhas)}
              onFechar={() => setKitEm(null)}
            />
          ) : duplicarEm?.origem === g.nome ? (
            <div
              role="group"
              aria-label={`Duplicar ${g.nome}`}
              className="space-y-3 rounded-lg border-2 border-amber-700 bg-amber-50 p-4"
            >
              <p className="text-lg font-medium">Duplicar {g.nome}</p>
              <label className="block space-y-1">
                <span className="text-base">Nome do novo ambiente</span>
                <input
                  type="text"
                  autoFocus
                  value={duplicarEm.nome}
                  onChange={(e) => setDuplicarEm({ origem: g.nome, nome: e.target.value })}
                  className={`${campo} w-full`}
                />
              </label>
              <p className="text-base text-zinc-700">
                Os itens vão com as mesmas quantidades e com o preço de hoje do catálogo.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDuplicarEm(null)}
                  className={`${botao} flex-1`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmarDuplicar()}
                  disabled={!nomeAmbienteValido(duplicarEm.nome) || salvando}
                  className="min-h-12 flex-[2] rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
                >
                  Duplicar ambiente
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setBusca({ tipo: "adicionar", ambiente: g.nome })}
                className="min-h-12 rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white"
              >
                Adicionar produto
              </button>
              <button type="button" onClick={() => setColarEm(g.nome)} className={botao}>
                Colar lista
              </button>
              <button type="button" onClick={() => setAvulsoEm(g.nome)} className={botao}>
                Adicionar item avulso
              </button>
              <button type="button" onClick={() => setKitEm(g.nome)} className={botao}>
                Adicionar kit de fita
              </button>
              {g.itens.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setDuplicarEm({
                      origem: g.nome,
                      nome: sugerirNomeDuplicado(g.nome, nomesAmbientes),
                    })
                  }
                  className={botao}
                >
                  Duplicar ambiente
                </button>
              ) : null}
            </div>
          )}
        </section>
      ))}

      {novoAmbiente === null ? (
        <button type="button" onClick={() => setNovoAmbiente("")} className={`${botao} w-full`}>
          Adicionar ambiente
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-zinc-300 p-4">
          <div className="flex flex-wrap gap-2" aria-label="Sugestões de ambiente">
            {SUGESTOES_AMBIENTE.map((nome) => (
              <button
                key={nome}
                type="button"
                onClick={() => setNovoAmbiente(nome)}
                className="min-h-11 rounded-full border border-zinc-300 px-4 text-base"
              >
                {nome}
              </button>
            ))}
          </div>
          <input
            type="text"
            autoFocus
            aria-label="Nome do novo ambiente"
            placeholder="Nome do ambiente (ex.: Varanda)"
            value={novoAmbiente}
            onChange={(e) => setNovoAmbiente(e.target.value)}
            className={`${campo} w-full`}
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setNovoAmbiente(null)}
              className={`${botao} flex-1`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void criarAmbiente()}
              disabled={!nomeAmbienteValido(novoAmbiente)}
              className="min-h-12 flex-[2] rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              Criar ambiente
            </button>
          </div>
        </div>
      )}

      <IndicacaoIA
        orcamentoId={p.orcamentoId}
        ambientes={nomesAmbientes}
        pedidoClienteInicial={p.pedidoClienteInicial}
        temAnexos={p.temAnexos}
        restantesHoje={p.restantesHoje}
        historico={p.historico}
        onAdicionar={adicionarDaIndicacao}
      />

      <div className="space-y-3 pt-2">
        <Link
          href={`/orcamentos/${p.orcamentoId}/editar?passo=12`}
          className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
        >
          Voltar ao resumo
        </Link>
      </div>

      {desfazer ? (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[calc(14rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-lg bg-zinc-900 px-4 py-3 text-lg text-white"
        >
          <span>Item removido.</span>
          <button
            type="button"
            onClick={refazer}
            className="min-h-11 px-3 font-semibold text-amber-300 underline"
          >
            Desfazer
          </button>
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl space-y-2 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-lg">
              Total <strong>{moedaCentavos(totais.totalCentavos)}</strong>
            </span>
            <span className="text-lg">
              À vista ({String(totais.percentual).replace(".", ",")}%){" "}
              <strong className="text-xl text-amber-800">
                {moedaCentavos(totais.aVistaCentavos)}
              </strong>
            </span>
          </div>
          {bloqueios.length > 0 ? <p className="text-base text-amber-900">{bloqueios[0]}</p> : null}
          {erroGerar ? (
            <p role="alert" className="text-base text-red-700">
              {erroGerar}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void gerar()}
            disabled={!podeGerar}
            className="min-h-14 w-full rounded-lg bg-amber-700 px-5 text-lg font-semibold text-white disabled:opacity-50"
          >
            {p.status === "gerado" ? "Gerar nova versão do orçamento" : "Gerar orçamento"}
          </button>
        </div>
      </div>

      {busca ? (
        <BuscaProduto
          titulo={busca.tipo === "trocar" ? "Trocar produto" : `Adicionar em ${busca.ambiente}`}
          continuo={busca.tipo === "adicionar"}
          onEscolher={escolheuProduto}
          onFechar={() => setBusca(null)}
        />
      ) : null}

      {gerando ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white px-6 text-center"
        >
          <span
            aria-hidden="true"
            className="size-14 animate-spin rounded-full border-4 border-zinc-200 border-t-amber-700"
          />
          <p className="text-2xl font-semibold">Gerando o orçamento...</p>
          <p className="text-lg text-zinc-600">
            Conferindo os preços e montando o PDF e a planilha.
          </p>
        </div>
      ) : null}
    </div>
  );
}
