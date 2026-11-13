"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  alterarAtivoArquiteto,
  juntarArquitetos,
  removerFotoArquiteto,
} from "@/app/(app)/arquitetos/acoes";
import { FORMULARIO_VAZIO, FormularioArquiteto, type DadosFormulario } from "./FormularioArquiteto";

const botao = "min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg";

/** "+ Cadastrar arquiteto" na lista. */
export function NovoArquiteto() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={`${botao} font-semibold`}>
        + Cadastrar arquiteto
      </button>
    );
  }
  return (
    <FormularioArquiteto
      onSalvo={(a) => {
        setAberto(false);
        router.push(`/arquitetos/${a.id}`);
      }}
      onCancelar={() => setAberto(false)}
    />
  );
}

interface FichaProps {
  id: string;
  nome: string;
  ativo: boolean;
  temFoto: boolean;
  fotoUrl: string | null;
  inicial: DadosFormulario;
  /** Outros arquitetos ativos, para o "Juntar duplicados". */
  outros: { id: string; nome: string }[];
}

/** Ações da gerência na ficha: editar, desativar e juntar duplicados. */
export function AcoesGerenciaArquiteto({
  id,
  nome,
  ativo,
  temFoto,
  fotoUrl,
  inicial,
  outros,
}: FichaProps) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [juntando, setJuntando] = useState(false);
  const [duplicado, setDuplicado] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function executar(f: () => Promise<{ ok: boolean; erro?: string }>, ok: string) {
    setOcupado(true);
    setMsg(null);
    let r;
    try {
      r = await f();
    } catch {
      r = { ok: false, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    setOcupado(false);
    if (!r.ok) return setMsg({ tipo: "erro", texto: r.erro ?? "Não foi possível agora." });
    setMsg({ tipo: "ok", texto: ok });
    router.refresh();
  }

  if (editando) {
    return (
      <FormularioArquiteto
        arquitetoId={id}
        inicial={inicial}
        fotoAtualUrl={fotoUrl}
        onSalvo={() => {
          setEditando(false);
          router.refresh();
        }}
        onCancelar={() => setEditando(false)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setEditando(true)} className={botao}>
        Editar dados
      </button>
      {temFoto ? (
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void executar(() => removerFotoArquiteto(id), "Foto removida.")}
          className={botao}
        >
          Remover foto
        </button>
      ) : null}
      <button
        type="button"
        disabled={ocupado}
        onClick={() =>
          void executar(
            () => alterarAtivoArquiteto(id, !ativo),
            ativo ? "Arquiteto(a) desativado(a)." : "Arquiteto(a) reativado(a).",
          )
        }
        className={botao}
      >
        {ativo ? "Desativar" : "Reativar"}
      </button>

      {ativo && outros.length > 0 ? (
        juntando ? (
          <div className="space-y-3 rounded-lg border border-zinc-300 p-4">
            <label className="block space-y-1">
              <span className="text-lg font-medium">
                Juntar com o cadastro duplicado (ele será apagado)
              </span>
              <select
                value={duplicado}
                onChange={(e) => {
                  setDuplicado(e.target.value);
                  setConfirmando(false);
                }}
                className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg"
              >
                <option value="">Escolha...</option>
                {outros.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
            </label>
            {duplicado && !confirmando ? (
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                className="min-h-14 w-full rounded-lg bg-zinc-900 px-4 text-lg font-semibold text-white"
              >
                Juntar
              </button>
            ) : null}
            {duplicado && confirmando ? (
              <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-3">
                <p className="text-lg">
                  Os orçamentos e clientes de{" "}
                  <strong>{outros.find((o) => o.id === duplicado)?.nome}</strong> passam para{" "}
                  <strong>{nome}</strong> e o outro cadastro é apagado. Isso não dá para desfazer.
                </p>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() =>
                    void executar(async () => {
                      const r = await juntarArquitetos(id, duplicado);
                      if (r.ok) {
                        setJuntando(false);
                        setDuplicado("");
                        setConfirmando(false);
                      }
                      return r;
                    }, "Cadastros juntados.")
                  }
                  className="min-h-14 w-full rounded-lg bg-red-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
                >
                  Confirmar e juntar
                </button>
              </div>
            ) : null}
            <button type="button" onClick={() => setJuntando(false)} className={botao}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setJuntando(true)} className={botao}>
            Juntar duplicados
          </button>
        )
      ) : null}

      {msg ? (
        <p
          role={msg.tipo === "erro" ? "alert" : "status"}
          className={`text-lg ${msg.tipo === "erro" ? "text-red-700" : "text-emerald-800"}`}
        >
          {msg.texto}
        </p>
      ) : null}
    </div>
  );
}

export { FORMULARIO_VAZIO };
