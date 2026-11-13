import { STATUS_ORCAMENTO, MOTIVOS_PERDA, TIPOS_CLIENTE, type StatusOrcamento } from "../dominio";
import { isoParaBR } from "../formatar";
import { dataISOValida } from "../metricas/periodo";
import { OPCOES_TIPO_CLIENTE } from "./perguntas";
import { rotuloMotivo } from "./status";

/** Filtros e ordem da lista de orçamentos, todos na URL (voltar do celular e compartilhar funcionam). */

export interface Preset {
  id: string;
  rotulo: string;
  status: StatusOrcamento[] | null; // null = todos
}

export const PRESETS: Preset[] = [
  {
    id: "andamento",
    rotulo: "Em andamento",
    status: ["rascunho", "gerado", "enviado", "followup_d5", "followup_d10"],
  },
  { id: "followup", rotulo: "Follow-up", status: ["enviado", "followup_d5", "followup_d10"] },
  { id: "fechados", rotulo: "Fechados", status: ["fechado"] },
  { id: "perdidos", rotulo: "Perdidos", status: ["perdido"] },
  { id: "todos", rotulo: "Todos", status: null },
];

export const presetPorId = (id: string | undefined): Preset =>
  PRESETS.find((f) => f.id === id) ?? PRESETS[0];

export const ORDENS = ["recentes", "valor", "validade", "cliente"] as const;
export type Ordem = (typeof ORDENS)[number];
export const ROTULOS_ORDEM: Record<Ordem, string> = {
  recentes: "Mais recentes",
  valor: "Maior valor",
  validade: "Validade mais próxima",
  cliente: "Cliente de A a Z",
};

export const CAMPOS_DATA = ["criado", "gerado", "enviado", "fechado", "perdido"] as const;
export type CampoData = (typeof CAMPOS_DATA)[number];
/** O que o filtro de período olha (a gaveta oferece criação, envio e fechamento; os painéis usam todos). */
export const ROTULOS_CAMPO_DATA: Record<CampoData, string> = {
  criado: "Criados",
  gerado: "Gerados",
  enviado: "Enviados",
  fechado: "Fechados",
  perdido: "Perdidos",
};

export const VALIDADES = ["vigente", "vence_2d", "vencida"] as const;
export type FiltroValidade = (typeof VALIDADES)[number];
export const ROTULOS_VALIDADE: Record<FiltroValidade, string> = {
  vigente: "Vigente",
  vence_2d: "Vence em até 2 dias",
  vencida: "Vencida",
};

export const TAMANHO_PAGINA = 20;

export interface FiltrosLista {
  q?: string;
  /** Id do atalho de status (andamento, followup, fechados, perdidos, todos). */
  preset: string;
  campo?: CampoData;
  de?: string;
  ate?: string;
  valorMin?: number;
  valorMax?: number;
  tipo?: string;
  temArquiteto: boolean;
  motivo?: string;
  /** Arquiteto do cadastro (uuid). */
  arquitetoId?: string;
  validade?: FiltroValidade;
  /** Só a gerente. */
  vendedora?: string;
  ordem: Ordem;
}

type Param = string | string[] | undefined;
const um = (v: Param) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "1500", "1.500", "1.500,50", "R$ 1500" -> número positivo; inválido -> undefined. */
export function lerValor(texto: string | undefined): number | undefined {
  if (!texto) return undefined;
  const limpo = texto.replace(/[R$\s]/g, "");
  let normal: string;
  if (limpo.includes(",")) normal = limpo.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) normal = limpo.replace(/\./g, "");
  else normal = limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return undefined;
  const n = Number(normal);
  return n <= 100_000_000 ? n : undefined;
}

/** Lê os filtros dos parâmetros da URL. Valor inválido é ignorado (nunca quebra a tela). */
export function lerFiltrosLista(
  params: Record<string, Param>,
  opcoes: { gerente: boolean },
): FiltrosLista {
  const q = (um(params.q) ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const campo = um(params.data);
  const de = um(params.de);
  const ate = um(params.ate);
  const periodoValido =
    CAMPOS_DATA.includes(campo as CampoData) && (dataISOValida(de) || dataISOValida(ate));
  let valorMin = lerValor(um(params.min));
  let valorMax = lerValor(um(params.max));
  if (valorMin !== undefined && valorMax !== undefined && valorMin > valorMax)
    [valorMin, valorMax] = [valorMax, valorMin];
  const de1 = periodoValido && dataISOValida(de) ? de : undefined;
  const ate1 = periodoValido && dataISOValida(ate) ? ate : undefined;
  const periodoOk = !(de1 && ate1 && ate1 < de1);
  const tipo = um(params.tipo);
  const motivo = um(params.motivo);
  const validade = um(params.validade);
  const ordem = um(params.ordem);
  const vendedora = um(params.vendedora);
  const arquitetoId = um(params.arquiteto);

  return {
    q: q || undefined,
    preset: presetPorId(um(params.filtro)).id,
    campo: periodoValido && periodoOk ? (campo as CampoData) : undefined,
    de: periodoValido && periodoOk ? de1 : undefined,
    ate: periodoValido && periodoOk ? ate1 : undefined,
    valorMin,
    valorMax,
    tipo: (TIPOS_CLIENTE as readonly string[]).includes(tipo ?? "") ? tipo : undefined,
    temArquiteto: um(params.arq) === "1",
    arquitetoId: arquitetoId && UUID.test(arquitetoId) ? arquitetoId : undefined,
    motivo: (MOTIVOS_PERDA as readonly string[]).includes(motivo ?? "") ? motivo : undefined,
    validade: (VALIDADES as readonly string[]).includes(validade ?? "")
      ? (validade as FiltroValidade)
      : undefined,
    vendedora: opcoes.gerente && vendedora && UUID.test(vendedora) ? vendedora : undefined,
    ordem: (ORDENS as readonly string[]).includes(ordem ?? "") ? (ordem as Ordem) : "recentes",
  };
}

/** Parâmetros de URL dos filtros (só o que foge do padrão). Inverso de `lerFiltrosLista`. */
export function paraParams(f: FiltrosLista): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.preset !== PRESETS[0].id) p.set("filtro", f.preset);
  if (f.campo) {
    p.set("data", f.campo);
    if (f.de) p.set("de", f.de);
    if (f.ate) p.set("ate", f.ate);
  }
  if (f.valorMin !== undefined) p.set("min", String(f.valorMin));
  if (f.valorMax !== undefined) p.set("max", String(f.valorMax));
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.temArquiteto) p.set("arq", "1");
  if (f.arquitetoId) p.set("arquiteto", f.arquitetoId);
  if (f.motivo) p.set("motivo", f.motivo);
  if (f.validade) p.set("validade", f.validade);
  if (f.vendedora) p.set("vendedora", f.vendedora);
  if (f.ordem !== "recentes") p.set("ordem", f.ordem);
  return p;
}

/** Entrada da função SQL `listar_orcamentos`. Com período (vindo dos painéis), os de teste ficam de fora. */
export function paraRpc(
  f: FiltrosLista,
  extra: { cursor?: string | null; limite?: number } = {},
): Record<string, unknown> {
  const status = presetPorId(f.preset).status;
  return {
    ...(f.q ? { q: f.q } : {}),
    ...(status ? { status } : {}),
    ...(f.campo
      ? { campo: f.campo, ...(f.de ? { de: f.de } : {}), ...(f.ate ? { ate: f.ate } : {}) }
      : {}),
    ...(f.valorMin !== undefined ? { valor_min: f.valorMin } : {}),
    ...(f.valorMax !== undefined ? { valor_max: f.valorMax } : {}),
    ...(f.tipo ? { tipo: f.tipo } : {}),
    ...(f.temArquiteto ? { arquiteto: "1" } : {}),
    ...(f.arquitetoId ? { arquiteto_id: f.arquitetoId } : {}),
    ...(f.motivo ? { motivo: f.motivo } : {}),
    ...(f.validade ? { validade: f.validade } : {}),
    ...(f.vendedora ? { vendedora: f.vendedora } : {}),
    incluir_teste: !f.campo,
    ordem: f.ordem,
    ...(extra.cursor ? { cursor: extra.cursor } : {}),
    limite: extra.limite ?? TAMANHO_PAGINA,
  };
}

export interface ChipFiltro {
  id: string;
  rotulo: string;
  /** Filtros sem este chip (para o link de remover). */
  semEle: FiltrosLista;
}

const real = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Os filtros ativos da gaveta (o atalho de status e a ordem não viram chip). */
export function chipsAtivos(
  f: FiltrosLista,
  nomeVendedora?: (id: string) => string,
  nomeArquiteto?: (id: string) => string,
): ChipFiltro[] {
  const chips: ChipFiltro[] = [];
  const sem = (mudanca: Partial<FiltrosLista>): FiltrosLista => ({ ...f, ...mudanca });
  if (f.q) chips.push({ id: "q", rotulo: `Busca: ${f.q}`, semEle: sem({ q: undefined }) });
  if (f.campo) {
    const de = f.de ? isoParaBR(f.de).slice(0, 5) : null;
    const ate = f.ate ? isoParaBR(f.ate).slice(0, 5) : null;
    const quando = de && ate ? `de ${de} a ${ate}` : de ? `desde ${de}` : `até ${ate}`;
    chips.push({
      id: "periodo",
      rotulo: `${ROTULOS_CAMPO_DATA[f.campo]} ${quando}`,
      semEle: sem({ campo: undefined, de: undefined, ate: undefined }),
    });
  }
  if (f.valorMin !== undefined || f.valorMax !== undefined) {
    const a = f.valorMin !== undefined ? real(f.valorMin) : null;
    const b = f.valorMax !== undefined ? real(f.valorMax) : null;
    chips.push({
      id: "valor",
      rotulo: a && b ? `Valor de ${a} a ${b}` : a ? `Valor a partir de ${a}` : `Valor até ${b}`,
      semEle: sem({ valorMin: undefined, valorMax: undefined }),
    });
  }
  if (f.tipo)
    chips.push({
      id: "tipo",
      rotulo: OPCOES_TIPO_CLIENTE.find((o) => o.valor === f.tipo)?.rotulo ?? f.tipo,
      semEle: sem({ tipo: undefined }),
    });
  if (f.temArquiteto)
    chips.push({ id: "arq", rotulo: "Tem arquiteto", semEle: sem({ temArquiteto: false }) });
  if (f.arquitetoId)
    chips.push({
      id: "arquiteto",
      rotulo: `Arquiteto: ${nomeArquiteto?.(f.arquitetoId) ?? "escolhido"}`,
      semEle: sem({ arquitetoId: undefined }),
    });
  if (f.motivo)
    chips.push({
      id: "motivo",
      rotulo: `Motivo: ${rotuloMotivo(f.motivo)}`,
      semEle: sem({ motivo: undefined }),
    });
  if (f.validade)
    chips.push({
      id: "validade",
      rotulo: ROTULOS_VALIDADE[f.validade],
      semEle: sem({ validade: undefined }),
    });
  if (f.vendedora)
    chips.push({
      id: "vendedora",
      rotulo: nomeVendedora?.(f.vendedora) ?? "Vendedora",
      semEle: sem({ vendedora: undefined }),
    });
  return chips;
}

/** Status de uma lista de status válidos (usado para validar o que volta do banco). */
export const ehStatus = (s: string): s is StatusOrcamento =>
  (STATUS_ORCAMENTO as readonly string[]).includes(s);

/** URL de uma lista com estes filtros (mais os parâmetros que não são filtros, como o período do painel). */
export function hrefDeFiltros(
  base: string,
  f: FiltrosLista,
  manter: Record<string, string> = {},
  ancora = "",
): string {
  const p = new URLSearchParams(manter);
  for (const [k, v] of paraParams(f)) p.set(k, v);
  const qs = p.toString();
  return `${base}${qs ? `?${qs}` : ""}${ancora}`;
}
