"use client";

import { useActionState } from "react";
import { Botao } from "@/components/ui/Botao";
import { Campo } from "@/components/ui/Campo";
import { entrar, type EstadoLogin } from "@/lib/acoes-sessao";

const inicial: EstadoLogin = { erro: null };

export function FormularioLogin() {
  const [estado, acao, pendente] = useActionState(entrar, inicial);

  return (
    <form action={acao} className="space-y-4">
      <Campo rotulo="E-mail" name="email" type="email" autoComplete="username" required />
      <Campo rotulo="Senha" name="senha" type="password" autoComplete="current-password" required />
      {estado.erro ? (
        <p role="alert" className="text-lg text-red-700">
          {estado.erro}
        </p>
      ) : null}
      <Botao type="submit" disabled={pendente}>
        {pendente ? "Entrando..." : "Entrar"}
      </Botao>
    </form>
  );
}
