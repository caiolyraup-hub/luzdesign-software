import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resumirComissoes,
  type LinhaComissao,
  type PercentuaisComissao,
  type PeriodoComissao,
  type ResumoComissoes,
} from "./calculo";

/**
 * Leitura das comissões. Roda com a sessão do dono: a RLS das tabelas de comissão devolve linhas
 * só a ele, então para qualquer outro perfil tudo volta vazio (e a rota já responde 404).
 */

export interface LancamentoComissao extends LinhaComissao {
  competencia: string;
  pagaEm: string | null;
  observacao: string | null;
  revisar: boolean;
  orcamentoNumero: string;
  clienteNome: string | null;
  beneficiarioNome: string;
}

export interface DadosComissoes {
  lancamentos: LancamentoComissao[];
  resumo: ResumoComissoes;
  nomes: { arquitetos: Map<string, string>; vendedoras: Map<string, string> };
  fotos: Map<string, string>;
}

interface Linha {
  id: string;
  orcamento_id: string;
  tipo: "arquiteto" | "vendedora";
  beneficiario_id: string;
  base: number | string;
  percentual: number | string;
  valor: number | string;
  competencia: string;
  status: "a_pagar" | "paga" | "cancelada";
  paga_em: string | null;
  observacao: string | null;
  revisar: boolean;
  orcamentos:
    | { numero: string; clientes: { nome: string } | { nome: string }[] | null }
    | { numero: string; clientes: { nome: string } | { nome: string }[] | null }[]
    | null;
}

export async function lerPercentuais(supabase: SupabaseClient): Promise<PercentuaisComissao> {
  const [{ data: c }, { data: a }, { data: v }] = await Promise.all([
    supabase.from("configuracoes_comissao").select("*").eq("id", true).maybeSingle(),
    supabase.from("comissoes_arquiteto_percentual").select("arquiteto_id, percentual"),
    supabase.from("comissoes_vendedora_percentual").select("vendedora_id, percentual"),
  ]);
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    arquitetoPadrao: n(c?.percentual_arquiteto_padrao),
    vendedoraPadrao: n(c?.percentual_vendedora_padrao),
    vendedoraComArquiteto: n(c?.percentual_vendedora_com_arquiteto),
    arquitetos: Object.fromEntries(
      (a ?? []).map((x) => [x.arquiteto_id as string, Number(x.percentual)]),
    ),
    vendedoras: Object.fromEntries(
      (v ?? []).map((x) => [x.vendedora_id as string, Number(x.percentual)]),
    ),
  };
}

export async function carregarComissoes(
  supabase: SupabaseClient,
  periodo: PeriodoComissao,
  status: "todas" | "a_pagar" | "paga" = "todas",
): Promise<DadosComissoes> {
  let consulta = supabase
    .from("comissoes")
    .select(
      "id, orcamento_id, tipo, beneficiario_id, base, percentual, valor, competencia, status, paga_em, observacao, revisar, orcamentos(numero, clientes(nome))",
    )
    .gte("competencia", periodo.de)
    .lte("competencia", periodo.ate)
    .neq("status", "cancelada")
    .order("competencia", { ascending: false })
    .order("criado_em", { ascending: false });
  if (status !== "todas") consulta = consulta.eq("status", status);
  const { data } = await consulta;
  const linhas = (data ?? []) as unknown as Linha[];

  const [{ data: arqs }, { data: vends }] = await Promise.all([
    supabase.from("arquitetos").select("id, nome, foto_path"),
    supabase.from("usuarios").select("id, nome"),
  ]);
  const arquitetos = new Map((arqs ?? []).map((a) => [a.id as string, a.nome as string]));
  const vendedoras = new Map((vends ?? []).map((u) => [u.id as string, u.nome as string]));
  const fotos = new Map<string, string>();
  const { urlsDasFotos } = await import("../arquitetos/servidor");
  const urls = await urlsDasFotos((arqs ?? []).map((a) => a.foto_path as string | null));
  for (const a of arqs ?? []) {
    const u = a.foto_path ? urls.get(a.foto_path as string) : undefined;
    if (u) fotos.set(a.id as string, u);
  }

  const lancamentos: LancamentoComissao[] = linhas.map((l) => {
    const o = Array.isArray(l.orcamentos) ? l.orcamentos[0] : l.orcamentos;
    const cli = o ? (Array.isArray(o.clientes) ? o.clientes[0] : o.clientes) : null;
    const nomes = l.tipo === "arquiteto" ? arquitetos : vendedoras;
    return {
      id: l.id,
      orcamentoId: l.orcamento_id,
      tipo: l.tipo,
      beneficiarioId: l.beneficiario_id,
      base: Number(l.base),
      percentual: Number(l.percentual),
      valor: Number(l.valor),
      status: l.status,
      competencia: l.competencia,
      pagaEm: l.paga_em,
      observacao: l.observacao,
      revisar: l.revisar,
      orcamentoNumero: o?.numero ?? "—",
      clienteNome: cli?.nome ?? null,
      beneficiarioNome: nomes.get(l.beneficiario_id) ?? "—",
    };
  });
  return {
    lancamentos,
    resumo: resumirComissoes(lancamentos),
    nomes: { arquitetos, vendedoras },
    fotos,
  };
}
