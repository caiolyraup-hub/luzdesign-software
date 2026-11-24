import type { ReactNode } from "react";
import { BotaoLink } from "./Botao";

/** Tela vazia que ajuda: uma frase curta e o próximo passo. */
export function ListaVazia({
  titulo,
  texto,
  acao,
  children,
}: {
  titulo: string;
  texto?: string;
  acao?: { rotulo: string; href: string };
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-zinc-300 bg-white/70 p-6 text-center">
      <p className="text-marrom-titulo text-xl font-semibold">{titulo}</p>
      {texto ? <p className="text-lg text-zinc-600">{texto}</p> : null}
      {acao ? (
        <div className="mx-auto max-w-xs">
          <BotaoLink href={acao.href}>{acao.rotulo}</BotaoLink>
        </div>
      ) : null}
      {children}
    </div>
  );
}
