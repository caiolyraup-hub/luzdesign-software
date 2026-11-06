import { Suspense } from "react";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { FormularioConfiguracoes, type ConfiguracoesLoja } from "./formulario";

async function Dados() {
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("configuracoes_loja")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (!data) return <p role="alert">Não foi possível carregar os dados da loja.</p>;
  return (
    <FormularioConfiguracoes
      config={{
        ...(data as ConfiguracoesLoja),
        desconto_avista_pct: Number(data.desconto_avista_pct),
      }}
    />
  );
}

export default function Page() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Configurações da loja</h1>
      <p className="text-lg text-zinc-600">
        Estes dados aparecem no cabeçalho e no fim do PDF do orçamento.
      </p>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <Dados />
      </Suspense>
    </section>
  );
}
