import { Suspense } from "react";
import { FormularioLogin } from "./formulario";

async function Aviso({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { erro } = await searchParams;
  if (erro !== "sem-perfil") return null;
  return (
    <p role="alert" className="mb-4 text-lg text-red-700">
      Sua conta ainda não tem perfil no sistema. Fale com a gerência.
    </p>
  );
}

export default function Page({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-16 pb-8">
      <h1 className="mb-1 text-3xl font-semibold">Luz Design</h1>
      <p className="mb-8 text-lg text-zinc-600">Entre para ver seus orçamentos.</p>
      <Suspense fallback={null}>
        <Aviso searchParams={searchParams} />
      </Suspense>
      <FormularioLogin />
    </main>
  );
}
