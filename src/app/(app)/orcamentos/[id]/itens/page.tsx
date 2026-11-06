import { redirect } from "next/navigation";
import { Suspense } from "react";

// A tela provisória de itens foi substituída pela revisão (dia 6); links antigos continuam valendo.
async function Redirecionar({ params }: Pick<PageProps<"/orcamentos/[id]/itens">, "params">) {
  const { id } = await params;
  redirect(`/orcamentos/${id}/revisao`);
  return null;
}

export default function Page({ params }: PageProps<"/orcamentos/[id]/itens">) {
  return (
    <Suspense fallback={null}>
      <Redirecionar params={params} />
    </Suspense>
  );
}
