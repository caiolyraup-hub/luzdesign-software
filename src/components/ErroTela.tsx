"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { registrarErroDaTela } from "@/app/erros-acoes";

/**
 * Tela de erro em português, sem texto técnico: diz o que aconteceu e o que fazer. O erro é registrado
 * para a gerência (sem dado do cliente) e o botão tenta de novo sem perder a navegação.
 */
export function ErroTela({
  erro,
  tentarDeNovo,
}: {
  erro: Error & { digest?: string };
  tentarDeNovo: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    void registrarErroDaTela(window.location.pathname, erro.digest ?? null).catch(() => undefined);
  }, [erro]);
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Algo não saiu como esperado</h1>
      <p className="text-lg">
        Não conseguimos abrir esta tela. Confira a internet e tente de novo. O que você já salvou
        não foi perdido.
      </p>
      <button
        type="button"
        onClick={tentarDeNovo}
        className="min-h-14 w-full rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white"
      >
        Tentar de novo
      </button>
      <button
        type="button"
        onClick={() => router.push("/")}
        className="flex min-h-14 w-full items-center justify-center rounded-lg border border-zinc-300 text-lg"
      >
        Voltar ao início
      </button>
      <p className="text-base text-zinc-600">
        Se continuar, use o botão &quot;Relatar problema&quot; ou avise a gerência.
      </p>
    </div>
  );
}
