import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AcoesGerenciaArquiteto } from "@/components/arquitetos/AcoesArquiteto";
import { Avatar } from "@/components/arquitetos/Avatar";
import { BadgeStatus } from "@/components/BadgeStatus";
import { urlsDasFotos } from "@/lib/arquitetos/servidor";
import { textoAniversario } from "@/lib/arquitetos/validacao";
import { formatarWhatsapp } from "@/lib/orcamento/perguntas";
import { formatarDataBR, formatarMoeda } from "@/lib/formatar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

interface LinhaOrcamento {
  id: string;
  numero: string;
  status: string;
  valor_total: number | string;
  valor_fechado: number | string | null;
  criado_em: string;
  clientes: { nome: string } | { nome: string }[] | null;
}

async function Ficha({ params }: Pick<PageProps<"/arquitetos/[id]">, "params">) {
  await connection();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const usuario = await obterUsuarioAtual();
  const gerente = usuario.perfil === "gerente";
  const supabase = await criarClienteServidor();

  const { data: a } = await supabase
    .from("arquitetos")
    .select(
      "id, nome, escritorio, whatsapp, email, aniversario_dia, aniversario_mes, aniversario_ano, foto_path, observacoes, ativo",
    )
    .eq("id", id)
    .maybeSingle();
  if (!a) notFound();

  // A RLS limita os orçamentos à vendedora (a gerência vê todos).
  const [{ data: orcs }, { data: outros }, fotos] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, numero, status, valor_total, valor_fechado, criado_em, clientes(nome)")
      .eq("arquiteto_id", id)
      .neq("status", "rascunho")
      .order("criado_em", { ascending: false }),
    gerente
      ? supabase.from("arquitetos").select("id, nome").eq("ativo", true).neq("id", id).order("nome")
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    urlsDasFotos([a.foto_path]),
  ]);
  const lista = (orcs ?? []) as unknown as LinhaOrcamento[];
  const fechados = lista.filter((o) => o.status === "fechado");
  const vendido = fechados.reduce((s, o) => s + Number(o.valor_fechado ?? o.valor_total), 0);
  const fotoUrl = a.foto_path ? (fotos.get(a.foto_path) ?? null) : null;
  const zap = a.whatsapp ? a.whatsapp.replace(/\D/g, "") : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Avatar nome={a.nome} url={fotoUrl} tamanho={72} />
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold">{a.nome}</h1>
          {a.escritorio ? <p className="text-lg text-zinc-600">{a.escritorio}</p> : null}
          {!a.ativo ? <p className="text-lg text-red-700">Desativado</p> : null}
        </div>
      </div>

      <dl className="space-y-1 text-lg">
        {a.whatsapp ? (
          <div>
            <dt className="inline text-zinc-600">WhatsApp: </dt>
            <dd className="inline">{formatarWhatsapp(a.whatsapp)}</dd>
          </div>
        ) : null}
        {a.email ? (
          <div>
            <dt className="inline text-zinc-600">E-mail: </dt>
            <dd className="inline break-all">{a.email}</dd>
          </div>
        ) : null}
        {a.aniversario_dia ? (
          <div>
            <dt className="inline text-zinc-600">Aniversário: </dt>
            <dd className="inline">
              {textoAniversario(a.aniversario_dia, a.aniversario_mes, a.aniversario_ano)}
            </dd>
          </div>
        ) : null}
        {a.observacoes ? <p className="whitespace-pre-wrap">{a.observacoes}</p> : null}
      </dl>

      {zap ? (
        <a
          href={`https://wa.me/${zap}`}
          target="_blank"
          rel="noopener"
          className="flex min-h-14 items-center justify-center rounded-lg border border-emerald-700 text-lg font-semibold text-emerald-800"
        >
          Abrir WhatsApp
        </a>
      ) : null}

      <section aria-label="Resumo" className="space-y-2">
        <h2 className="text-xl font-semibold">Resumo{gerente ? "" : " (seus orçamentos)"}</h2>
        <dl className="grid grid-cols-3 gap-3">
          {(
            [
              ["Indicados", String(lista.length)],
              ["Fechados", String(fechados.length)],
              ["Vendido", formatarMoeda(vendido)],
            ] as const
          ).map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-lg border border-zinc-200 p-3">
              <dt className="text-base text-zinc-600">{rotulo}</dt>
              <dd className="text-xl font-semibold">{valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Orçamentos indicados" className="space-y-2">
        <h2 className="text-xl font-semibold">Orçamentos indicados ({lista.length})</h2>
        {lista.length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum orçamento ainda.</p>
        ) : (
          <ul className="space-y-3">
            {lista.map((o) => {
              const cliente = Array.isArray(o.clientes) ? o.clientes[0] : o.clientes;
              const valor =
                o.status === "fechado" && o.valor_fechado
                  ? Number(o.valor_fechado)
                  : Number(o.valor_total);
              return (
                <li key={o.id}>
                  <Link
                    href={`/orcamentos/${o.id}`}
                    className="block space-y-1 rounded-lg border border-zinc-200 p-4"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-lg font-medium">{o.numero}</span>
                      {valor > 0 ? (
                        <span className="shrink-0 text-lg font-semibold">
                          {formatarMoeda(valor)}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-base text-zinc-600">
                      {cliente?.nome ?? "Sem cliente"} · {formatarDataBR(o.criado_em)}
                    </span>
                    <BadgeStatus status={o.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {gerente ? (
        <AcoesGerenciaArquiteto
          id={a.id}
          nome={a.nome}
          ativo={a.ativo}
          temFoto={Boolean(a.foto_path)}
          fotoUrl={fotoUrl}
          outros={(outros ?? []) as { id: string; nome: string }[]}
          inicial={{
            nome: a.nome,
            escritorio: a.escritorio ?? "",
            whatsapp: a.whatsapp ?? "",
            email: a.email ?? "",
            aniversario_dia: a.aniversario_dia ? String(a.aniversario_dia) : "",
            aniversario_mes: a.aniversario_mes ? String(a.aniversario_mes) : "",
            aniversario_ano: a.aniversario_ano ? String(a.aniversario_ano) : "",
            observacoes: a.observacoes ?? "",
          }}
        />
      ) : null}

      <Link
        href="/arquitetos"
        className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
      >
        Voltar aos arquitetos
      </Link>
    </div>
  );
}

export default function Page({ params }: PageProps<"/arquitetos/[id]">) {
  return (
    <Suspense fallback={<p className="text-lg text-zinc-600">Carregando...</p>}>
      <Ficha params={params} />
    </Suspense>
  );
}
