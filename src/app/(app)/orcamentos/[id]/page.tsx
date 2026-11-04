import { Suspense } from "react";
import { Placeholder } from "@/components/Placeholder";

async function Detalhe({ params }: Pick<PageProps<"/orcamentos/[id]">, "params">) {
  const { id } = await params;
  return <Placeholder titulo="Orçamento" descricao={`Código: ${id}`} />;
}

export default function Page({ params }: PageProps<"/orcamentos/[id]">) {
  return (
    <Suspense fallback={<Placeholder titulo="Orçamento" />}>
      <Detalhe params={params} />
    </Suspense>
  );
}
