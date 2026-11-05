"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  criarRascunho,
  procurarCliente,
  salvarResposta,
  type AnexoView,
} from "@/app/(app)/orcamentos/acoes";
import {
  PASSO_ANEXOS,
  PASSO_RESUMO,
  TOTAL_PERGUNTAS,
  normalizarWhatsapp,
  perguntaDoPasso,
  validarPergunta,
  type ErrosCampos,
  type Respostas,
} from "@/lib/orcamento/perguntas";
import { PassoAnexos } from "./PassoAnexos";
import { PassoPergunta, type ClienteEncontrado } from "./PassoPergunta";
import { Resumo } from "./Resumo";

interface Props {
  /** null em /orcamentos/novo: o rascunho só é criado depois da primeira resposta válida. */
  orcamentoId: string | null;
  respostasIniciais: Respostas;
  anexosIniciais: AnexoView[];
  passoInicial: number;
  montadoEm?: string | null;
}

type Estado = "parado" | "salvando" | "salvo" | "erro";

const ATRASO_AUTOSAVE_MS = 1000;
const ATRASO_BUSCA_CLIENTE_MS = 600;

export function Editor({
  orcamentoId,
  respostasIniciais,
  anexosIniciais,
  passoInicial,
  montadoEm = null,
}: Props) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [passo, setPasso] = useState(passoInicial);
  const [respostas, setRespostas] = useState<Respostas>(respostasIniciais);
  const [anexos, setAnexos] = useState<AnexoView[]>(anexosIniciais);
  const [erros, setErros] = useState<ErrosCampos>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("parado");
  const [clienteEncontrado, setClienteEncontrado] = useState<ClienteEncontrado | null>(null);
  const [clienteEmUso, setClienteEmUso] = useState(false);
  const [vindoDoResumo, setVindoDoResumo] = useState(false);

  // Autosave de texto livre: acumula o que mudou e envia 1 s depois da última tecla.
  const textoPendente = useRef<{ passo: number; valores: Record<string, unknown> } | null>(null);
  const timerSalvar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerCliente = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pergunta = perguntaDoPasso(passo);

  async function descarregarTextoPendente() {
    if (timerSalvar.current) clearTimeout(timerSalvar.current);
    timerSalvar.current = null;
    const p = textoPendente.current;
    textoPendente.current = null;
    if (!p || !orcamentoId) return;
    setEstado("salvando");
    const r = await salvarResposta(orcamentoId, p.passo, p.valores, "rascunho");
    setEstado(r.ok ? "salvo" : "erro");
  }

  function mudar(patch: Record<string, unknown>, texto?: string[]) {
    setRespostas((r) => ({ ...r, ...patch }));
    setErros((e) => {
      const novo = { ...e };
      for (const k of Object.keys(patch)) delete novo[k];
      return novo;
    });
    setErroGeral(null);

    if (texto && orcamentoId) {
      const valores = { ...(textoPendente.current?.valores ?? {}) };
      for (const campo of texto) valores[campo] = patch[campo];
      textoPendente.current = { passo, valores };
      setEstado("parado");
      if (timerSalvar.current) clearTimeout(timerSalvar.current);
      timerSalvar.current = setTimeout(descarregarTextoPendente, ATRASO_AUTOSAVE_MS);
    }

    // Passo 2: ao ter um WhatsApp válido, procura cliente já cadastrado.
    if (orcamentoId && typeof patch.cliente_whatsapp === "string") {
      if (timerCliente.current) clearTimeout(timerCliente.current);
      setClienteEncontrado(null);
      setClienteEmUso(false);
      const bruto = patch.cliente_whatsapp;
      if (normalizarWhatsapp(bruto)) {
        timerCliente.current = setTimeout(async () => {
          const r = await procurarCliente(orcamentoId, bruto);
          if (r.ok) setClienteEncontrado(r.encontrado);
        }, ATRASO_BUSCA_CLIENTE_MS);
      }
    }
  }

  function ir(destino: number) {
    setPasso(destino);
    setErros({});
    setErroGeral(null);
    setClienteEncontrado(null);
    setClienteEmUso(false);
    if (destino === PASSO_RESUMO) setVindoDoResumo(false);
    if (orcamentoId) window.history.replaceState(null, "", `?passo=${destino}`);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("h1[tabindex='-1']")?.focus({ preventScroll: true });
    });
  }

  function usarCliente() {
    if (!clienteEncontrado) return;
    setClienteEmUso(true);
    mudar({ cliente_nome: clienteEncontrado.nome });
  }

  function proximo() {
    setErroGeral(null);

    if (!pergunta) {
      ir(passo === PASSO_ANEXOS ? PASSO_RESUMO : passo);
      return;
    }

    const entrada: Record<string, unknown> = {};
    for (const campo of pergunta.campos) entrada[campo] = respostas[campo];
    const local = validarPergunta(pergunta, entrada);
    if (!local.ok) {
      setErros(local.erros);
      return;
    }

    iniciar(async () => {
      if (timerSalvar.current) clearTimeout(timerSalvar.current);
      textoPendente.current = null;
      setEstado("salvando");

      // /orcamentos/novo: a primeira resposta válida cria o rascunho.
      if (!orcamentoId) {
        const r = await criarRascunho(String(local.valores.cliente_nome));
        if (!r.ok) {
          setEstado("erro");
          setErros(r.erros ?? {});
          return setErroGeral(r.erro);
        }
        router.push(`/orcamentos/${r.id}/editar?passo=2`);
        return;
      }

      const r = await salvarResposta(orcamentoId, passo, entrada, "avancar");
      if (!r.ok) {
        setEstado("erro");
        setErros(r.erros ?? {});
        return setErroGeral(r.erro);
      }
      setEstado("salvo");
      setRespostas(r.respostas);
      ir(vindoDoResumo ? PASSO_RESUMO : passo + 1);
    });
  }

  async function voltar() {
    await descarregarTextoPendente();
    if (vindoDoResumo) return ir(PASSO_RESUMO);
    if (passo <= 1) return router.push("/orcamentos");
    ir(passo - 1);
  }

  function editarDoResumo(numero: number) {
    setVindoDoResumo(true);
    ir(numero);
  }

  const ehPergunta = passo >= 1 && passo <= TOTAL_PERGUNTAS;
  const rotuloProgresso = ehPergunta
    ? `${passo} de ${TOTAL_PERGUNTAS}`
    : passo === PASSO_ANEXOS
      ? "Anexos"
      : "Resumo";
  const percentual = ehPergunta ? (passo / TOTAL_PERGUNTAS) * 100 : 100;

  return (
    <div className="space-y-6 pb-36">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-lg font-medium">{rotuloProgresso}</p>
          <p role="status" aria-live="polite" className="text-base text-zinc-600">
            {estado === "salvando"
              ? "Salvando..."
              : estado === "salvo"
                ? "Salvo"
                : estado === "erro"
                  ? "Não salvou"
                  : ""}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Progresso"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percentual)}
          className="h-2 overflow-hidden rounded-full bg-zinc-200"
        >
          <div
            className="h-full bg-amber-700 transition-[width]"
            style={{ width: `${percentual}%` }}
          />
        </div>
      </div>

      {pergunta ? (
        <PassoPergunta
          key={pergunta.id}
          pergunta={pergunta}
          respostas={respostas}
          erros={erros}
          onMudar={mudar}
          clienteEncontrado={clienteEncontrado}
          clienteEmUso={clienteEmUso}
          onUsarCliente={usarCliente}
        />
      ) : null}

      {passo === PASSO_ANEXOS && orcamentoId ? (
        <div className="space-y-3">
          <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
            Quer anexar fotos ou arquivos?
          </h1>
          <PassoAnexos orcamentoId={orcamentoId} anexos={anexos} onMudar={setAnexos} />
        </div>
      ) : null}

      {passo === PASSO_RESUMO && orcamentoId ? (
        <Resumo
          orcamentoId={orcamentoId}
          respostas={respostas}
          anexos={anexos}
          onAnexos={setAnexos}
          onEditar={editarDoResumo}
          montadoEm={montadoEm}
        />
      ) : null}

      {erroGeral ? (
        <p role="alert" className="text-lg text-red-700">
          {erroGeral}
        </p>
      ) : null}

      {passo !== PASSO_RESUMO ? (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-3xl gap-3 px-4 py-3">
            <button
              type="button"
              onClick={voltar}
              disabled={pendente}
              className="min-h-14 flex-1 rounded-lg border border-zinc-300 bg-white text-lg font-semibold disabled:opacity-60"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={proximo}
              disabled={pendente}
              className="min-h-14 flex-[2] rounded-lg bg-amber-700 text-lg font-semibold text-white disabled:opacity-60"
            >
              {pendente
                ? "Salvando..."
                : vindoDoResumo
                  ? "Salvar"
                  : passo === PASSO_ANEXOS
                    ? "Ver resumo"
                    : "Próxima"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
