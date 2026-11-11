/* eslint-disable @typescript-eslint/no-explicit-any -- JSON vindo do banco (funções SQL), normalizado logo abaixo */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerConfigFollowup } from "../orcamento/config-followup";
import { followupDeHoje } from "../orcamento/followup";
import type { Periodo } from "./periodo";

export interface PerdaPorMotivo {
  motivo: string;
  quantidade: number;
  valor: number;
}

export interface LinhaMetricas {
  vendedora_id: string | null;
  nome: string;
  criados: number;
  gerados: number;
  enviados: number;
  fechados: number;
  valor_vendido: number;
  perdidos: number;
  valor_perdido: number;
  perdas: PerdaPorMotivo[];
  safra: {
    enviados: number;
    fechados: number;
    perdidos: number;
    em_andamento: number;
    valor_fechado: number;
    valor_resolvidos: number;
  };
  /** 0 a 1; nulo quando ninguém da safra fechou nem perdeu. */
  conversao_qtd: number | null;
  conversao_valor: number | null;
  em_aberto_qtd: number;
  em_aberto_valor: number;
  ticket_medio: number | null;
  mediana_dias: number | null;
  indicacoes_pedidas: number;
  itens_total: number;
  itens_indicacao_ia: number;
  itens_lista_colada: number;
  /** Follow-ups vencidos agora (regra do dia 8); calculado no servidor, fora do SQL. */
  followups_vencidos: number;
}

export interface Metricas {
  vendedoras: LinhaMetricas[];
  total: LinhaMetricas;
}

export interface SemanaSerie {
  semana: string;
  vendedora_id: string;
  nome: string;
  enviados: number;
  fechados: number;
  valor_vendido: number;
}

export interface CustoIA {
  usd_total: number;
  chamadas: number;
  por_tipo: { tipo: string | null; chamadas: number; usd: number }[];
  gerados: number;
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function normalizarLinha(j: Record<string, any>): LinhaMetricas {
  return {
    vendedora_id: j.vendedora_id ?? null,
    nome: String(j.nome),
    criados: n(j.criados),
    gerados: n(j.gerados),
    enviados: n(j.enviados),
    fechados: n(j.fechados),
    valor_vendido: n(j.valor_vendido),
    perdidos: n(j.perdidos),
    valor_perdido: n(j.valor_perdido),
    perdas: ((j.perdas ?? []) as Record<string, any>[]).map((p) => ({
      motivo: String(p.motivo),
      quantidade: n(p.quantidade),
      valor: n(p.valor),
    })),
    safra: {
      enviados: n(j.safra?.enviados),
      fechados: n(j.safra?.fechados),
      perdidos: n(j.safra?.perdidos),
      em_andamento: n(j.safra?.em_andamento),
      valor_fechado: n(j.safra?.valor_fechado),
      valor_resolvidos: n(j.safra?.valor_resolvidos),
    },
    conversao_qtd: nn(j.conversao_qtd),
    conversao_valor: nn(j.conversao_valor),
    em_aberto_qtd: n(j.em_aberto_qtd),
    em_aberto_valor: n(j.em_aberto_valor),
    ticket_medio: nn(j.ticket_medio),
    mediana_dias: nn(j.mediana_dias),
    indicacoes_pedidas: n(j.indicacoes_pedidas),
    itens_total: n(j.itens_total),
    itens_indicacao_ia: n(j.itens_indicacao_ia),
    itens_lista_colada: n(j.itens_lista_colada),
    followups_vencidos: 0,
  };
}

/** Follow-ups vencidos agora, por vendedora (RLS: a vendedora só enxerga os dela). Testes ficam de fora. */
async function followupsVencidosPorVendedora(
  supabase: SupabaseClient,
  agora: Date,
): Promise<Map<string, number>> {
  const [{ data }, config] = await Promise.all([
    supabase
      .from("orcamentos_reais")
      .select("vendedora_id, status, ultimo_envio_em")
      .in("status", ["enviado", "followup_d5", "followup_d10"]),
    lerConfigFollowup(supabase),
  ]);
  const mapa = new Map<string, number>();
  for (const l of (data ?? []) as {
    vendedora_id: string;
    status: string;
    ultimo_envio_em: string | null;
  }[]) {
    if (followupDeHoje({ status: l.status, ultimoEnvioEm: l.ultimo_envio_em, agora, config }))
      mapa.set(l.vendedora_id, (mapa.get(l.vendedora_id) ?? 0) + 1);
  }
  return mapa;
}

/**
 * Números do período pela função SQL (security invoker: a RLS decide o que cada uma enxerga).
 * `vendedoraId` nulo = todas as que a pessoa pode ver.
 */
export async function carregarMetricas(
  supabase: SupabaseClient,
  periodo: Periodo,
  vendedoraId: string | null = null,
  agora: Date = new Date(),
): Promise<Metricas | null> {
  const [{ data, error }, vencidos] = await Promise.all([
    supabase.rpc("metricas_orcamentos", {
      p_inicio: periodo.inicio,
      p_fim: periodo.fim,
      p_vendedora: vendedoraId,
    }),
    followupsVencidosPorVendedora(supabase, agora),
  ]);
  if (error || !data) return null;
  const j = data as { vendedoras: Record<string, any>[]; total: Record<string, any> };
  const vendedoras = j.vendedoras.map(normalizarLinha);
  for (const v of vendedoras) v.followups_vencidos = vencidos.get(v.vendedora_id!) ?? 0;
  const total = normalizarLinha(j.total);
  total.followups_vencidos = vendedoras.reduce((s, v) => s + v.followups_vencidos, 0);
  return { vendedoras, total };
}

/** Série semanal (13 semanas até a semana do fim do período). */
export async function carregarSerieSemanal(
  supabase: SupabaseClient,
  periodo: Periodo,
  vendedoraId: string | null = null,
): Promise<SemanaSerie[]> {
  const { data } = await supabase.rpc("serie_semanal_orcamentos", {
    p_fim: periodo.fim,
    p_vendedora: vendedoraId,
  });
  return ((data ?? []) as Record<string, any>[]).map((s) => ({
    semana: String(s.semana),
    vendedora_id: String(s.vendedora_id),
    nome: String(s.nome),
    enviados: n(s.enviados),
    fechados: n(s.fechados),
    valor_vendido: n(s.valor_vendido),
  }));
}

/** Custo de IA do período. Só a gerente consegue; para a vendedora devolve nulo. */
export async function carregarCustoIA(
  supabase: SupabaseClient,
  periodo: Periodo,
): Promise<CustoIA | null> {
  const { data, error } = await supabase.rpc("custo_ia_orcamentos", {
    p_inicio: periodo.inicio,
    p_fim: periodo.fim,
  });
  if (error || !data) return null;
  const j = data as Record<string, any>;
  return {
    usd_total: n(j.usd_total),
    chamadas: n(j.chamadas),
    gerados: n(j.gerados),
    por_tipo: ((j.por_tipo ?? []) as Record<string, any>[]).map((t) => ({
      tipo: t.tipo ?? null,
      chamadas: n(t.chamadas),
      usd: n(t.usd),
    })),
  };
}

/** Câmbio estimado US$ -> R$ (configuracoes_loja); 5,50 se a linha não puder ser lida. */
export async function lerCambio(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from("configuracoes_loja")
    .select("cambio_usd_brl")
    .eq("id", true)
    .maybeSingle();
  const c = Number(data?.cambio_usd_brl);
  return Number.isFinite(c) && c > 0 ? c : 5.5;
}

/** Nenhuma etapa aconteceu no período (o que está em aberto agora não depende do período). */
export function semDados(l: LinhaMetricas): boolean {
  return l.criados + l.gerados + l.enviados + l.fechados + l.perdidos === 0;
}

// ---------------------------------------------------------------- formatação

/** 0,375 -> "37,5%"; 0,5 -> "50%"; nulo -> "—". */
export function formatarPorcentagem(v: number | null): string {
  if (v === null) return "—";
  const p = Math.round(v * 1000) / 10;
  return `${String(p).replace(".", ",")}%`;
}

/** Parte sobre o todo em porcentagem, "—" se o todo for zero. */
export function porcentagemDe(parte: number, todo: number): string {
  return todo > 0 ? formatarPorcentagem(parte / todo) : "—";
}

/** 4 -> "4 dias"; 1 -> "1 dia"; 4.5 -> "4,5 dias"; nulo -> "—". */
export function formatarDias(v: number | null): string {
  if (v === null) return "—";
  const r = Math.round(v * 10) / 10;
  return `${String(r).replace(".", ",")} ${r === 1 ? "dia" : "dias"}`;
}

const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const usdPreciso = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
/** US$ com até 4 casas (os custos são de centavos). */
export const formatarDolar = (v: number) => (v >= 1 ? usd.format(v) : usdPreciso.format(v));
