import type { InputHTMLAttributes, ReactNode } from "react";

export const classeCampo =
  "min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg";

/** Campo com rótulo, ajuda e erro. Fonte de 16 px ou mais (o iPhone não dá zoom). */
export function Campo({
  rotulo,
  ajuda,
  erro,
  className = "",
  ...resto
}: {
  rotulo: string;
  ajuda?: ReactNode;
  erro?: string | null;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-lg font-medium">{rotulo}</span>
      <input
        {...resto}
        aria-invalid={erro ? true : undefined}
        className={`${classeCampo} ${className}`}
      />
      {ajuda ? <span className="block text-base text-zinc-600">{ajuda}</span> : null}
      {erro ? (
        <span role="alert" className="block text-base text-red-700">
          {erro}
        </span>
      ) : null}
    </label>
  );
}
