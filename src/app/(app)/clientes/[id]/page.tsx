import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BadgeStatus } from "@/components/BadgeStatus";
import { BadgeValidade } from "@/components/orcamento/BadgeValidade";
import { NotasCliente, NovoOrcamentoDoCliente } from "@/components/clientes/AcoesCliente";
import { resumoDoCliente } from "@/lib/clientes/resumo";
import { formatarDataBR, formatarMoeda, isoParaBR } from "@/lib/formatar";
import { OPCOES_TIPO_CLIENTE } from "@/lib/orcamento/perguntas";
import { rotuloMotivo } from "@/lib/orcamento/status";
import { avisoValidade } from "@/lib/orcamento/validade";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

interface LinhaOrcamento {
  id: string;
  numero: string;
  status: string;
  valor_total: number | string;
  valor_fechado: number | string | null;
  motivo_perda: string | null;
  validade: string | null;
  criado_em: string;
}

async function Ficha({ params }: Pick<PageProps<"/clientes/[id]">, "params">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const usuario = await obterUsuarioAtual();
  const supabase = await criarClienteServidor();

  // A RLS decide: URL direta de cliente de outra vendedora não devolve nada (404).
  const { data: c } = await supabase
    .from("clientes")
    .select(
      "id, nome, whatsapp, tipo, arquiteto_indicador, observacoes, vendedora_id, usuarios(nome)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const dona = c.vendedora_id === usuario.id;
  const nomeDona = (Array.isArray(c.usuarios) ? c.usuarios[0] : c.usuarios)?.nome ?? null;

  const { data: orcs } = await supabase
    .from("orcamentos")
    .select("id, numero, status, valor_total, valor_fechado, motivo_perda, validade, criado_em")
    .eq("cliente_id", id)
    .order("criado_em", { ascending: false });
  const lista = (orcs ?? []) as unknown as LinhaOrcamento[];
  const r = resumoDoCliente(
    lista.map((o) => ({
      status: o.status,
      valor_total: Number(o.valor_total),
      valor_fechado: o.valor_fechado === null ? null : Number(o.valor_fechado),
      criado_em: o.criado_em,
    })),
  );
  const zap = c.whatsapp ? c.whatsapp.replace(/\D/g, "") : null;
  const tipo = OPCOES_TIPO_CLIENTE.find((o) => o.valor === c.tipo)?.rotulo ?? c.tipo;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{c.nome}</h1>
        <p className="text-lg text-zinc-600">
          {tipo}
          {c.whatsapp ? ` · ${c.whatsapp}` : ""}
          {!dona && nomeDona ? ` · ${nomeDona}` : ""}
        </p>
        {c.arquiteto_indicador ? (
          <p className="text-lg text-zinc-600">Arquiteto(a): {c.arquiteto_indicador}</p>
        ) : null}
      </div>

      <div className="space-y-3">
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
        {dona ? <NovoOrcamentoDoCliente clienteId={c.id} /> : null}
      </div>

      <section aria-label="Resumo" className="space-y-2">
        <h2 className="text-xl font-semibold">Resumo</h2>
        <dl className="grid grid-cols-2 gap-3">
          {(
            [
              ["Orçamentos", String(r.orcamentos)],
              ["Fechados", String(r.fechados)],
              ["Perdidos", String(r.perdidos)],
              ["Em aberto", String(r.emAberto)],
              ["Vendido", formatarMoeda(r.vendido)],
              ["Ticket médio", r.ticketMedio === null ? "—" : formatarMoeda(r.ticketMedio)],
            ] as const
          ).map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-lg border border-zinc-200 p-3">
              <dt className="text-base text-zinc-600">{rotulo}</dt>
              <dd className="text-xl font-semibold">{valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Notas do cliente" className="space-y-2">
        <h2 className="text-xl font-semibold">Notas</h2>
        <NotasCliente clienteId={c.id} inicial={c.observacoes ?? ""} podeEditar={dona} />
      </section>

      <section aria-label="Orçamentos do cliente" className="space-y-2">
        <h2 className="text-xl font-semibold">Orçamentos ({lista.length})</h2>
        {lista.length === 0 ? (
          <p className="text-lg text-zinc-600">Nenhum orçamento ainda.</p>
        ) : (
          <ul className="space-y-3">
            {lista.map((o) => {
              const venc = avisoValidade(o.status, o.validade);
              const valor =
                o.status === "fechado" && o.valor_fechado
                  ? Number(o.valor_fechado)
                  : Number(o.valor_total);
              return (
                <li key={o.id}>
                  <Link
                    href={
                      o.status === "rascunho" && dona
                        ? `/orcamentos/${o.id}/editar`
                        : `/orcamentos/${o.id}`
                    }
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
                      Criado em {formatarDataBR(o.criado_em)}
                      {o.validade && !["fechado", "perdido", "rascunho"].includes(o.status)
                        ? ` · validade ${isoParaBR(o.validade).slice(0, 5)}`
                        : ""}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <BadgeStatus status={o.status} />
                      {venc ? <BadgeValidade aviso={venc} /> : null}
                      {o.status === "perdido" && o.motivo_perda ? (
                        <span className="text-base text-zinc-700">
                          {rotuloMotivo(o.motivo_perda)}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Link
        href="/clientes"
        className="flex min-h-14 items-center justify-center rounded-lg border border-zinc-300 text-lg"
      >
        Voltar aos clientes
      </Link>
    </div>
  );
}

export default function Page({ params }: PageProps<"/clientes/[id]">) {
  return (
    <Suspense fallback={<p className="text-lg text-zinc-600">Carregando...</p>}>
      <Ficha params={params} />
    </Suspense>
  );
}
