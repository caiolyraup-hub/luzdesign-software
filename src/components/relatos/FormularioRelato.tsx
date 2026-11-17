"use client";

import Link from "next/link";
import { useState } from "react";
import { enviarRelato } from "@/app/(app)/relatar/acoes";
import { prepararArquivo } from "@/lib/orcamento/imagem";

const campo = "min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg";

export function FormularioRelato({ tela }: { tela: string }) {
  const [mensagem, setMensagem] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  if (enviado) {
    return (
      <div role="status" className="space-y-4">
        <p className="text-xl font-semibold">Relato enviado. Obrigado!</p>
        <p className="text-lg text-zinc-700">
          A gerência já recebeu. Pode continuar o que estava fazendo.
        </p>
        <Link
          href="/"
          className="flex min-h-14 items-center justify-center rounded-lg bg-amber-700 text-lg font-semibold text-white"
        >
          Voltar ao início
        </Link>
      </div>
    );
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const f = new FormData();
      f.set("mensagem", mensagem);
      f.set("tela", tela);
      if (foto) {
        const pronto = await prepararArquivo(foto); // reduz a foto antes de enviar
        f.set("foto", new File([pronto.blob], "tela.jpg", { type: pronto.mime || "image/jpeg" }));
      }
      const r = await enviarRelato(f);
      if (!r.ok) setErro(r.erro);
      else setEnviado(true);
    } catch {
      setErro("Sem internet ou conexão instável. O texto continua aqui: tente de novo.");
    }
    setOcupado(false);
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <label className="block space-y-1">
        <span className="text-lg font-medium">O que aconteceu?</span>
        <textarea
          name="mensagem"
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          className={`${campo} min-h-40 py-3`}
        />
      </label>
      <p className="text-base text-zinc-600">
        Tela: <strong>{tela || "(não identificada)"}</strong> (vai junto com o relato)
      </p>
      <label className="block space-y-1">
        <span className="text-lg font-medium">Foto da tela (opcional)</span>
        <input
          type="file"
          accept="image/*"
          data-testid="foto-relato"
          onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
          className="block min-h-12 w-full text-lg"
        />
      </label>
      {erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={ocupado}
        className="min-h-14 w-full rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {ocupado ? "Enviando..." : "Enviar relato"}
      </button>
    </form>
  );
}
