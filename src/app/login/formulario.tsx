"use client";

import { useActionState } from "react";
import { entrar, type EstadoLogin } from "@/lib/acoes-sessao";

const inicial: EstadoLogin = { erro: null };

export function FormularioLogin() {
  const [estado, acao, pendente] = useActionState(entrar, inicial);

  return (
    <form action={acao} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-lg font-medium">E-mail</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-lg font-medium">Senha</span>
        <input
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg"
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
        className="min-h-14 w-full rounded-lg bg-amber-700 text-lg font-semibold text-white disabled:opacity-60"
      >
        {pendente ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
