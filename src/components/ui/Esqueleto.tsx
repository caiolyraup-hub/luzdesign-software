/** Esqueleto com brilho, no lugar de "Carregando...". */
export function Esqueleto({ className = "h-5 w-full" }: { className?: string }) {
  return <div aria-hidden className={`esqueleto ${className}`} />;
}

/** Várias linhas de cartão esqueleto (listas e Para hoje). */
export function EsqueletoLista({ linhas = 2 }: { linhas?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="space-y-3">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-zinc-200 p-4">
          <Esqueleto className="h-5 w-2/3" />
          <Esqueleto className="h-4 w-1/2" />
          <Esqueleto className="h-11 w-full" />
        </div>
      ))}
      <span className="sr-only">Carregando...</span>
    </div>
  );
}
