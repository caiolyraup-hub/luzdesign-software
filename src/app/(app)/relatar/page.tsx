import { connection } from "next/server";
import { Suspense } from "react";
import { FormularioRelato } from "@/components/relatos/FormularioRelato";
import { EsqueletoLista } from "@/components/ui/Esqueleto";

async function Conteudo({ searchParams }: Pick<PageProps<"/relatar">, "searchParams">) {
  await connection();
  const { tela } = await searchParams;
  const t = (Array.isArray(tela) ? tela[0] : tela) ?? "";
  return <FormularioRelato tela={t.slice(0, 200)} />;
}

export default function Page({ searchParams }: PageProps<"/relatar">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Relatar problema</h1>
      <p className="text-lg text-zinc-600">
        Conte o que aconteceu. A tela em que você estava vai junto.
      </p>
      <Suspense fallback={<EsqueletoLista />}>
        <Conteudo searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
