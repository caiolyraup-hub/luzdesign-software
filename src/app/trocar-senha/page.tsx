import { sair } from "@/lib/acoes-sessao";
import { FormularioTrocaSenha } from "./formulario";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-16 pb-8">
      <h1 className="mb-1 text-3xl font-semibold">Crie sua senha</h1>
      <p className="mb-8 text-lg text-zinc-600">
        Este é o seu primeiro acesso. Troque a senha provisória por uma que só você saiba. Enquanto
        não trocar, o resto do sistema fica fechado.
      </p>
      <FormularioTrocaSenha />
      <form action={sair} className="mt-6 text-center">
        <button type="submit" className="min-h-11 px-3 text-base text-amber-700 underline">
          Sair
        </button>
      </form>
    </main>
  );
}
