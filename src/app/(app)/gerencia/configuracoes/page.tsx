import { Suspense } from "react";
import { connection } from "next/server";
import { hojeMaceioISO } from "@/lib/formatar";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { FormularioConfiguracoes, type ConfiguracoesLoja } from "./formulario";

async function Dados() {
  await connection(); // a sessão depende da requisição: fora do prerender
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
        cambio_usd_brl: Number(data.cambio_usd_brl),
      }}
    />
  );
}

const hora = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Maceio" });

/** Erros do dia (servidor e telas): para a gerência e o dono acompanharem o piloto. */
async function ErrosDeHoje() {
  await connection();
  const supabase = await criarClienteServidor();
  const inicio = `${hojeMaceioISO()}T00:00:00-03:00`;
  const [{ count }, { data }] = await Promise.all([
    supabase
      .from("erros_app")
      .select("id", { count: "exact", head: true })
      .gte("criado_em", inicio),
    supabase
      .from("erros_app")
      .select("id, criado_em, origem, rota, mensagem")
      .gte("criado_em", inicio)
      .order("criado_em", { ascending: false })
      .limit(5),
  ]);
  return (
    <section aria-label="Erros de hoje" className="space-y-2 rounded-lg border border-zinc-300 p-4">
      <h2 className="text-xl font-semibold">Erros de hoje: {count ?? 0}</h2>
      {(data ?? []).length === 0 ? (
        <p className="text-lg text-zinc-600">Nenhum erro registrado hoje.</p>
      ) : (
        <ul className="space-y-1 text-base">
          {(data ?? []).map((e) => (
            <li key={e.id as number}>
              {hora.format(new Date(e.criado_em as string))} ·{" "}
              {e.origem === "tela" ? "tela" : "servidor"}
              {e.rota ? ` · ${e.rota}` : ""} · {e.mensagem}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Page() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Configurações da loja</h1>
      <p className="text-lg text-zinc-600">
        Estes dados aparecem no cabeçalho e no fim do PDF do orçamento.
      </p>
      <Suspense fallback={null}>
        <ErrosDeHoje />
      </Suspense>
      <Suspense fallback={<p className="text-zinc-600">Carregando...</p>}>
        <Dados />
      </Suspense>
    </section>
  );
}
