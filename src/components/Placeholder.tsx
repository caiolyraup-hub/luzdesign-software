export function Placeholder({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{titulo}</h1>
      {descricao ? <p className="text-zinc-600">{descricao}</p> : null}
      <p className="text-zinc-600">Em construção.</p>
    </section>
  );
}
