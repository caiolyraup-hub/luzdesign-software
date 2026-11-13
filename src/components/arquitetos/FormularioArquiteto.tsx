"use client";

import { useState } from "react";
import { criarArquiteto, editarArquiteto } from "@/app/(app)/arquitetos/acoes";
import { prepararFotoArquiteto } from "@/lib/arquitetos/foto";
import { Avatar } from "./Avatar";

export interface DadosFormulario {
  nome: string;
  escritorio: string;
  whatsapp: string;
  email: string;
  aniversario_dia: string;
  aniversario_mes: string;
  aniversario_ano: string;
  observacoes: string;
}

export const FORMULARIO_VAZIO: DadosFormulario = {
  nome: "",
  escritorio: "",
  whatsapp: "",
  email: "",
  aniversario_dia: "",
  aniversario_mes: "",
  aniversario_ano: "",
  observacoes: "",
};

const campo = "min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg";
const botao = "min-h-14 rounded-lg border border-zinc-300 px-4 text-lg";

interface Props {
  /** Se informado, edita (só a gerência); senão cria. */
  arquitetoId?: string;
  inicial?: DadosFormulario;
  fotoAtualUrl?: string | null;
  /** Cadastro curto (formulário do orçamento): nome, WhatsApp, aniversário e foto. */
  curto?: boolean;
  onSalvo: (r: { id: string; nome: string }) => void;
  onCancelar?: () => void;
}

export function FormularioArquiteto({
  arquitetoId,
  inicial = FORMULARIO_VAZIO,
  fotoAtualUrl = null,
  curto = false,
  onSalvo,
  onCancelar,
}: Props) {
  const [d, setD] = useState<DadosFormulario>(inicial);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const mudar =
    (k: keyof DadosFormulario) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setD((x) => ({ ...x, [k]: e.target.value }));

  async function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErros((x) => ({ ...x, foto: "" }));
    try {
      const blob = await prepararFotoArquiteto(arquivo);
      setFoto(blob);
      setPrevia((antes) => {
        if (antes) URL.revokeObjectURL(antes);
        return URL.createObjectURL(blob);
      });
    } catch {
      setErros((x) => ({ ...x, foto: "Não consegui ler essa imagem. Tente outra foto." }));
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErros({});
    setErroGeral(null);
    const f = new FormData();
    for (const [k, v] of Object.entries(d)) f.set(k, v);
    if (foto) f.set("foto", new File([foto], "foto.jpg", { type: "image/jpeg" }));
    type Resp = {
      ok: boolean;
      erro?: string;
      erros?: Record<string, string>;
      id?: string;
      nome?: string;
    };
    let r: Resp;
    try {
      r = arquitetoId ? await editarArquiteto(arquitetoId, f) : await criarArquiteto(f);
    } catch {
      r = { ok: false, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    setOcupado(false);
    if (!r.ok) {
      setErros(r.erros ?? {});
      return setErroGeral(r.erro ?? "Não foi possível salvar agora.");
    }
    onSalvo({ id: r.id ?? arquitetoId ?? "", nome: r.nome ?? d.nome.trim() });
  }

  const erro = (k: string) =>
    erros[k] ? (
      <p role="alert" className="text-lg text-red-700">
        {erros[k]}
      </p>
    ) : null;

  return (
    <form
      onSubmit={salvar}
      className="space-y-4 rounded-lg border border-zinc-300 bg-white p-4"
      noValidate
    >
      <h2 className="text-xl font-semibold">
        {arquitetoId ? "Editar arquiteto(a)" : "Cadastrar arquiteto(a)"}
      </h2>

      <label className="block space-y-1">
        <span className="text-lg font-medium">Nome</span>
        <input
          name="nome"
          value={d.nome}
          onChange={mudar("nome")}
          autoComplete="off"
          autoCapitalize="words"
          className={campo}
        />
        {erro("nome")}
      </label>

      {!curto ? (
        <label className="block space-y-1">
          <span className="text-lg font-medium">Escritório (opcional)</span>
          <input
            name="escritorio"
            value={d.escritorio}
            onChange={mudar("escritorio")}
            autoComplete="off"
            className={campo}
          />
          {erro("escritorio")}
        </label>
      ) : null}

      <label className="block space-y-1">
        <span className="text-lg font-medium">WhatsApp (opcional)</span>
        <input
          name="whatsapp"
          type="tel"
          inputMode="tel"
          value={d.whatsapp}
          onChange={mudar("whatsapp")}
          autoComplete="off"
          className={campo}
        />
        {erro("whatsapp")}
      </label>

      {!curto ? (
        <label className="block space-y-1">
          <span className="text-lg font-medium">E-mail (opcional)</span>
          <input
            name="email"
            type="email"
            value={d.email}
            onChange={mudar("email")}
            autoComplete="off"
            className={campo}
          />
          {erro("email")}
        </label>
      ) : null}

      <fieldset className="space-y-1">
        <legend className="text-lg font-medium">Aniversário (opcional)</legend>
        <div className="grid grid-cols-3 gap-2">
          <input
            aria-label="Dia do aniversário"
            placeholder="Dia"
            inputMode="numeric"
            maxLength={2}
            name="aniversario_dia"
            value={d.aniversario_dia}
            onChange={mudar("aniversario_dia")}
            className={campo}
          />
          <input
            aria-label="Mês do aniversário"
            placeholder="Mês"
            inputMode="numeric"
            maxLength={2}
            name="aniversario_mes"
            value={d.aniversario_mes}
            onChange={mudar("aniversario_mes")}
            className={campo}
          />
          <input
            aria-label="Ano de nascimento (opcional)"
            placeholder="Ano"
            inputMode="numeric"
            maxLength={4}
            name="aniversario_ano"
            value={d.aniversario_ano}
            onChange={mudar("aniversario_ano")}
            className={campo}
          />
        </div>
        <p className="text-base text-zinc-600">
          O ano é opcional; muita gente prefere não informar.
        </p>
        {erro("aniversario_dia")}
        {erro("aniversario_ano")}
      </fieldset>

      {!curto ? (
        <label className="block space-y-1">
          <span className="text-lg font-medium">Observações (opcional)</span>
          <textarea
            name="observacoes"
            value={d.observacoes}
            onChange={mudar("observacoes")}
            className={`${campo} min-h-28 py-3`}
          />
          {erro("observacoes")}
        </label>
      ) : null}

      <div className="space-y-2">
        <p className="text-lg font-medium">Foto (opcional)</p>
        <div className="flex items-center gap-3">
          {previa ? (
            // eslint-disable-next-line @next/next/no-img-element -- prévia local
            <img
              src={previa}
              alt="Prévia da foto"
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <Avatar nome={d.nome || "?"} url={fotoAtualUrl} tamanho={64} />
          )}
          <label className={`${botao} flex cursor-pointer items-center`}>
            {previa || fotoAtualUrl ? "Trocar foto" : "Escolher foto"}
            <input
              data-testid="foto-arquiteto"
              type="file"
              accept="image/*"
              onChange={escolherFoto}
              className="sr-only"
            />
          </label>
        </div>
        <p className="text-base text-zinc-600">Use a foto só com autorização do arquiteto.</p>
        {erro("foto")}
      </div>

      {erroGeral && Object.keys(erros).length === 0 ? (
        <p role="alert" className="text-lg text-red-700">
          {erroGeral}
        </p>
      ) : null}

      <div className="flex gap-3">
        {onCancelar ? (
          <button type="button" onClick={onCancelar} className={`${botao} flex-1`}>
            Cancelar
          </button>
        ) : null}
        <button
          type="submit"
          disabled={ocupado}
          className="min-h-14 flex-[2] rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
        >
          {ocupado ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  );
}
