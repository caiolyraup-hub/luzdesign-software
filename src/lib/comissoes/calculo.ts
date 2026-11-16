/**
 * Regras e resumos de comissão (dia 11D). O cálculo oficial roda no banco (`comissao_linhas`), junto do
 * fechamento; aqui ficam as mesmas contas em TypeScript (para prévia e testes), a leitura dos
 * percentuais digitados e os resumos da tela. Nada daqui chega à vendedora, à gerente, à OpenAI ou
 * aos documentos do cliente.
 */

export const PERCENTUAL_MAXIMO = 30;

/** "5", "5,5", "5.50" -> número com 2 casas (0 a 30). Vazio = null (não definido). Inválido = undefined. */
export function lerPercentual(texto: string | null | undefined): number | null | undefined {
  const t = (texto ?? "").replace("%", "").trim();
  if (t === "") return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return undefined;
  const n = Number(normal);
  return n >= 0 && n <= PERCENTUAL_MAXIMO ? Math.round(n * 100) / 100 : undefined;
}

/** Valor em R$ com 2 casas, arredondamento comercial (meio para cima). */
export function valorComissao(base: number, percentual: number): number {
  return Math.round(((base * percentual + Number.EPSILON) / 100) * 100) / 100;
}

export interface PercentuaisComissao {
  arquitetoPadrao: number | null;
  vendedoraPadrao: number | null;
  vendedoraComArquiteto: number | null;
  /** Por arquiteto e por vendedora (id -> percentual). */
  arquitetos?: Record<string, number>;
  vendedoras?: Record<string, number>;
}

export interface FechamentoParaComissao {
  valorFechado: number;
  arquitetoId: string | null;
  vendedoraId: string;
}

export interface LinhaCalculada {
  tipo: "arquiteto" | "vendedora";
  beneficiarioId: string;
  base: number;
  percentual: number;
  valor: number;
}

/** Mesma regra de `comissao_linhas` no banco. Percentual vazio não calcula a linha. */
export function calcularComissoes(
  f: FechamentoParaComissao,
  p: PercentuaisComissao,
): LinhaCalculada[] {
  const linhas: LinhaCalculada[] = [];
  if (f.arquitetoId) {
    const pct = p.arquitetos?.[f.arquitetoId] ?? p.arquitetoPadrao;
    if (pct !== null && pct !== undefined)
      linhas.push({
        tipo: "arquiteto",
        beneficiarioId: f.arquitetoId,
        base: f.valorFechado,
        percentual: pct,
        valor: valorComissao(f.valorFechado, pct),
      });
  }
  const pctV =
    f.arquitetoId && p.vendedoraComArquiteto !== null
      ? p.vendedoraComArquiteto
      : (p.vendedoras?.[f.vendedoraId] ?? p.vendedoraPadrao);
  if (pctV !== null && pctV !== undefined)
    linhas.push({
      tipo: "vendedora",
      beneficiarioId: f.vendedoraId,
      base: f.valorFechado,
      percentual: pctV,
      valor: valorComissao(f.valorFechado, pctV),
    });
  return linhas;
}

/** Nenhum percentual definido: a tela mostra "Defina os percentuais" e não calcula nada. */
export function semPercentuais(p: PercentuaisComissao): boolean {
  return (
    p.arquitetoPadrao === null &&
    p.vendedoraPadrao === null &&
    p.vendedoraComArquiteto === null &&
    Object.keys(p.arquitetos ?? {}).length === 0 &&
    Object.keys(p.vendedoras ?? {}).length === 0
  );
}

// ---------------------------------------------------------------- período (competência)

export interface PeriodoComissao {
  /** AAAA-MM-DD (primeiro dia da competência inicial). */
  de: string;
  ate: string;
  rotulo: string;
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function mesAnterior(ano: number, mes: number) {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}
const dois = (n: number) => String(n).padStart(2, "0");
const mesIso = (ano: number, mes: number) => `${ano}-${dois(mes)}-01`;
const dataValida = (s: string | undefined) =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Mês atual (padrão), mês anterior ou intervalo de competências. `hojeISO` já vem no fuso de Maceió. */
export function resolverPeriodoComissao(
  params: { periodo?: string; de?: string; ate?: string },
  hojeISO: string,
): PeriodoComissao {
  const ano = Number(hojeISO.slice(0, 4));
  const mes = Number(hojeISO.slice(5, 7));
  if (
    params.periodo === "intervalo" &&
    dataValida(params.de) &&
    dataValida(params.ate) &&
    params.de! <= params.ate!
  ) {
    return {
      de: `${params.de!.slice(0, 7)}-01`,
      ate: `${params.ate!.slice(0, 7)}-01`,
      rotulo: `${params.de!.slice(0, 7)} a ${params.ate!.slice(0, 7)}`,
    };
  }
  if (params.periodo === "anterior") {
    const a = mesAnterior(ano, mes);
    return {
      de: mesIso(a.ano, a.mes),
      ate: mesIso(a.ano, a.mes),
      rotulo: `${MESES[a.mes - 1]} de ${a.ano}`,
    };
  }
  return { de: mesIso(ano, mes), ate: mesIso(ano, mes), rotulo: `${MESES[mes - 1]} de ${ano}` };
}

// ---------------------------------------------------------------- resumos

export interface LinhaComissao {
  id: string;
  orcamentoId: string;
  tipo: "arquiteto" | "vendedora";
  beneficiarioId: string;
  base: number;
  percentual: number;
  valor: number;
  status: "a_pagar" | "paga" | "cancelada";
}

export interface ResumoBeneficiario {
  beneficiarioId: string;
  vendas: number;
  vendido: number;
  aPagar: number;
  paga: number;
}

export interface ResumoComissoes {
  aPagar: number;
  pagas: number;
  arquitetos: number;
  vendedoras: number;
  porArquiteto: ResumoBeneficiario[];
  porVendedora: ResumoBeneficiario[];
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Linhas canceladas não contam em nada. */
export function resumirComissoes(linhas: LinhaComissao[]): ResumoComissoes {
  const r: ResumoComissoes = {
    aPagar: 0,
    pagas: 0,
    arquitetos: 0,
    vendedoras: 0,
    porArquiteto: [],
    porVendedora: [],
  };
  const mapas = {
    arquiteto: new Map<string, ResumoBeneficiario>(),
    vendedora: new Map<string, ResumoBeneficiario>(),
  };
  for (const l of linhas) {
    if (l.status === "cancelada") continue;
    if (l.status === "a_pagar") r.aPagar += l.valor;
    else r.pagas += l.valor;
    if (l.tipo === "arquiteto") r.arquitetos += l.valor;
    else r.vendedoras += l.valor;
    const m = mapas[l.tipo];
    const b = m.get(l.beneficiarioId) ?? {
      beneficiarioId: l.beneficiarioId,
      vendas: 0,
      vendido: 0,
      aPagar: 0,
      paga: 0,
    };
    b.vendas++;
    b.vendido += l.base;
    if (l.status === "a_pagar") b.aPagar += l.valor;
    else b.paga += l.valor;
    m.set(l.beneficiarioId, b);
  }
  const arredonda = (b: ResumoBeneficiario) => ({
    ...b,
    vendido: centavos(b.vendido),
    aPagar: centavos(b.aPagar),
    paga: centavos(b.paga),
  });
  r.aPagar = centavos(r.aPagar);
  r.pagas = centavos(r.pagas);
  r.arquitetos = centavos(r.arquitetos);
  r.vendedoras = centavos(r.vendedoras);
  r.porArquiteto = [...mapas.arquiteto.values()]
    .map(arredonda)
    .sort((a, b) => b.aPagar + b.paga - (a.aPagar + a.paga));
  r.porVendedora = [...mapas.vendedora.values()]
    .map(arredonda)
    .sort((a, b) => b.aPagar + b.paga - (a.aPagar + a.paga));
  return r;
}
