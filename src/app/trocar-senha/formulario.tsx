"use client";

import { useActionState } from "react";
import { trocarSenha, type EstadoTrocaSenha } from "./acoes";

const inicial: EstadoTrocaSenha = { erro: null };
const campo = "min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg";

export function FormularioTrocaSenha() {
  const [estado, acao, pendente] = useActionState(trocarSenha, inicial);
  return (
    <form action={acao} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-lg font-medium">Senha nova</span>
        <input name="nova" type="password" autoComplete="new-password" required className={campo} />
        <span className="block text-base text-zinc-600">
          Pelo menos 10 caracteres, com letras e números.
        </span>
      </label>
      <label className="block space-y-1">
        <span className="text-lg font-medium">Repita a senha nova</span>
        <input
          name="confirmacao"
          type="password"
          autoComplete="new-password"
          required
          className={campo}
        />
      </label>
      {estado.erro ? (
        <p role="alert" className="text-lg text-red-700">
          {estado.erro}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pendente}
        className="bg-primario text-sobre-primario min-h-14 w-full rounded-lg text-lg font-semibold disabled:opacity-60"
      >
        {pendente ? "Salvando..." : "Salvar e entrar"}
      </button>
    </form>
  );
}
