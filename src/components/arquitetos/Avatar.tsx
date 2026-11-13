import { iniciais } from "@/lib/arquitetos/validacao";

/** Foto redonda do arquiteto, ou um círculo com as iniciais quando não há foto. */
export function Avatar({
  nome,
  url,
  tamanho = 48,
}: {
  nome: string;
  url: string | null;
  tamanho?: number;
}) {
  const estilo = { width: tamanho, height: tamanho };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL assinada de curta duração
      <img
        src={url}
        alt={`Foto de ${nome}`}
        style={estilo}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...estilo, fontSize: Math.round(tamanho / 2.6) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-amber-100 font-semibold text-amber-900"
    >
      {iniciais(nome)}
    </span>
  );
}
