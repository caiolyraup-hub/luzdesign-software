"use client";

import { useRef, useState } from "react";
import {
  prepararUpload,
  registrarAnexo,
  removerAnexo,
  type AnexoView,
} from "@/app/(app)/orcamentos/acoes";
import { tipoSugerido, tiposPermitidos, validarArquivoAnexo } from "@/lib/orcamento/anexos";
import { mimeDoArquivo, prepararArquivo } from "@/lib/orcamento/imagem";
import {
  MAX_ANEXOS,
  MIME_ANEXO_ACEITOS,
  ROTULOS_TIPO_ANEXO,
  type TipoAnexo,
} from "@/lib/orcamento/perguntas";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

interface Props {
  orcamentoId: string;
  anexos: AnexoView[];
  onMudar: (anexos: AnexoView[]) => void;
}

interface Escolhido {
  arquivo: File;
  mime: string;
}

export function PassoAnexos({ orcamentoId, anexos, onMudar }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [escolhido, setEscolhido] = useState<Escolhido | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const cheio = anexos.length >= MAX_ANEXOS;

  function aoEscolher(arquivo: File | undefined) {
    setErro(null);
    if (!arquivo) return;
    const mime = mimeDoArquivo(arquivo);
    // Imagens grandes são reduzidas antes do envio; o limite de 10 MB vale depois disso.
    const invalido = validarArquivoAnexo({ mime, tamanho: Math.min(arquivo.size, 1) });
    if (invalido) return setErro(invalido);
    setEscolhido({ arquivo, mime });
  }

  async function enviar(tipo: TipoAnexo) {
    if (!escolhido) return;
    setEnviando(true);
    setErro(null);
    try {
      const pronto = await prepararArquivo(escolhido.arquivo);
      const invalido = validarArquivoAnexo({ mime: pronto.mime, tamanho: pronto.blob.size });
      if (invalido) throw new Error(invalido);

      const preparo = await prepararUpload(orcamentoId, {
        mime: pronto.mime,
        tamanho: pronto.blob.size,
      });
      if (!preparo.ok) throw new Error(preparo.erro);

      const { error } = await criarClienteNavegador()
        .storage.from("anexos")
        .uploadToSignedUrl(preparo.caminho, preparo.token, pronto.blob, {
          contentType: pronto.mime,
        });
      if (error) throw new Error("Não foi possível enviar o arquivo. Tente de novo.");

      const registro = await registrarAnexo(orcamentoId, {
        caminho: preparo.caminho,
        tipo,
        nome: escolhido.arquivo.name,
        mime: pronto.mime,
      });
      if (!registro.ok) throw new Error(registro.erro);

      onMudar([...anexos, registro.anexo]);
      setEscolhido(null);
      if (entrada.current) entrada.current.value = "";
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar o arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  async function remover(id: string) {
    setRemovendo(id);
    setErro(null);
    const r = await removerAnexo(id);
    setRemovendo(null);
    setConfirmar(null);
    if (!r.ok) return setErro(r.erro);
    onMudar(anexos.filter((a) => a.id !== id));
  }

  return (
    <section aria-labelledby="titulo-anexos" className="space-y-3">
      <h2 id="titulo-anexos" className="text-xl font-semibold">
        Fotos e arquivos ({anexos.length} de {MAX_ANEXOS})
      </h2>
      <p className="text-lg text-zinc-600">
        Foto do ambiente, planta, print de conversa ou PDF. Até {MAX_ANEXOS}.
      </p>

      {anexos.length > 0 ? (
        <ul className="space-y-3">
          {anexos.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3"
            >
              <Miniatura anexo={a} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg">{a.nome_original ?? "Arquivo"}</p>
                <p className="text-base text-zinc-600">{ROTULOS_TIPO_ANEXO[a.tipo]}</p>
              </div>
              {confirmar === a.id ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={removendo === a.id}
                    onClick={() => remover(a.id)}
                    className="min-h-11 rounded-lg bg-red-700 px-3 text-base font-semibold text-white"
                  >
                    {removendo === a.id ? "Removendo..." : "Confirmar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmar(null)}
                    className="min-h-11 rounded-lg border border-zinc-300 px-3 text-base"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Remover ${a.nome_original ?? "arquivo"}`}
                  onClick={() => setConfirmar(a.id)}
                  className="min-h-11 rounded-lg border border-zinc-300 px-3 text-base"
                >
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {escolhido ? (
        <div className="space-y-3 rounded-lg border-2 border-amber-700 bg-amber-50 p-4">
          <p className="text-lg font-medium">O que é este arquivo?</p>
          <p className="truncate text-base text-zinc-600">{escolhido.arquivo.name}</p>
          <div className="grid grid-cols-3 gap-2">
            {tiposPermitidos(escolhido.mime).map((tipo) => (
              <button
                key={tipo}
                type="button"
                disabled={enviando}
                onClick={() => enviar(tipo)}
                className={`min-h-14 rounded-lg border-2 px-2 text-lg font-semibold disabled:opacity-60 ${
                  tipo === tipoSugerido(escolhido.mime)
                    ? "border-amber-700 bg-white"
                    : "border-zinc-300 bg-white"
                }`}
              >
                {ROTULOS_TIPO_ANEXO[tipo]}
              </button>
            ))}
          </div>
          {enviando ? (
            <p role="status" className="text-lg">
              Enviando...
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEscolhido(null);
                if (entrada.current) entrada.current.value = "";
              }}
              className="min-h-11 text-base text-amber-700 underline"
            >
              Cancelar
            </button>
          )}
        </div>
      ) : null}

      {erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}

      {cheio ? (
        <p className="text-lg text-zinc-600">Limite de {MAX_ANEXOS} anexos atingido.</p>
      ) : !escolhido ? (
        <>
          <input
            ref={entrada}
            id="arquivo-anexo"
            data-testid="arquivo-anexo"
            type="file"
            accept={[...MIME_ANEXO_ACEITOS, ".heic", ".heif"].join(",")}
            onChange={(e) => aoEscolher(e.target.files?.[0])}
            className="sr-only"
          />
          <label
            htmlFor="arquivo-anexo"
            className="flex min-h-14 w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-amber-700 px-4 text-lg font-semibold text-amber-700"
          >
            Adicionar foto ou arquivo
          </label>
        </>
      ) : null}
    </section>
  );
}

function Miniatura({ anexo }: { anexo: AnexoView }) {
  const [falhou, setFalhou] = useState(false);
  const ehImagem = anexo.mime_type?.startsWith("image/") ?? false;

  if (ehImagem && anexo.url && !falhou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL assinada do Storage, não otimizável
      <img
        src={anexo.url}
        alt={anexo.nome_original ?? "Anexo"}
        onError={() => setFalhou(true)}
        className="size-16 shrink-0 rounded-lg border border-zinc-200 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-base font-semibold text-zinc-600"
    >
      {anexo.mime_type === "application/pdf" ? "PDF" : "IMG"}
    </span>
  );
}
