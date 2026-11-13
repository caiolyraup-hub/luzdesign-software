import { adicionarDiasISO, hojeMaceioISO, isoParaBR } from "../formatar";
import { agruparPorAmbiente, type ItemRevisao } from "../orcamento/itens";
import { subtotalCentavos, totaisDoOrcamento, type TotaisOrcamento } from "../orcamento/totais";

export interface LojaPdf {
  nome_fantasia: string;
  razao_social: string | null;
  cnpj: string | null;
  endereco: string | null;
  telefone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  site: string | null;
}

export interface ConfigPdf {
  validade_dias: number;
  desconto_avista_pct: number;
  linhas_rodape: string;
}

export interface ItemPdf {
  quantidade: number;
  unidade: "un" | "m";
  codigo: string | null;
  descricao: string;
  categoria: string | null;
  precoCentavos: number;
  totalCentavos: number;
}

export interface AmbientePdf {
  nome: string;
  itens: ItemPdf[];
  subtotalCentavos: number;
}

/** Tudo que o PDF mostra, já pronto (textos e centavos). Serializável e testável sem React. */
export interface DadosPdf {
  loja: LojaPdf;
  numero: string;
  versao: number;
  /** DD/MM/AAAA */
  dataEmissao: string;
  /** DD/MM/AAAA */
  validade: string;
  cliente: {
    nome: string;
    whatsapp: string | null;
    arquiteto: string | null;
    /** Endereço da obra (opcional). */
    endereco?: string | null;
  };
  vendedora: string;
  ambientes: AmbientePdf[];
  totais: TotaisOrcamento;
  rodape: string[];
}

export interface EntradaDadosPdf {
  loja: LojaPdf;
  config: ConfigPdf;
  numero: string;
  versao: number;
  cliente: {
    nome: string;
    whatsapp: string | null;
    arquiteto: string | null;
    /** Endereço da obra (opcional). */
    endereco?: string | null;
  };
  vendedora: string;
  /** Itens com o preço e a descrição já congelados do catálogo. */
  itens: ItemRevisao[];
  /** Ordem preferida dos ambientes (os que não aparecerem vão depois). */
  ambientes?: string[];
  agora?: Date;
}

const numeroBR = (n: number) => String(n).replace(".", ",");

/** Troca {desconto} e {validade_dias} nas linhas de condições e descarta linhas vazias. */
export function linhasDoRodape(config: ConfigPdf): string[] {
  return config.linhas_rodape
    .split(/\r?\n/)
    .map((l) =>
      l
        .replaceAll("{desconto}", numeroBR(config.desconto_avista_pct))
        .replaceAll("{validade_dias}", String(config.validade_dias))
        .trim(),
    )
    .filter(Boolean);
}

export function montarDadosPdf(e: EntradaDadosPdf): DadosPdf {
  const hoje = hojeMaceioISO(e.agora);
  const grupos = agruparPorAmbiente(e.itens, e.ambientes ?? []).filter((g) => g.itens.length > 0);

  const ambientes: AmbientePdf[] = grupos.map((g) => {
    const itens: ItemPdf[] = g.itens.map((i) => ({
      quantidade: i.quantidade,
      unidade: i.unidade,
      codigo: i.avulso ? null : i.codigo,
      descricao: i.descricao,
      categoria: i.avulso ? null : (i.categoria ?? null),
      precoCentavos: Math.round(i.preco * 100),
      totalCentavos: subtotalCentavos(i.preco, i.quantidade),
    }));
    return {
      nome: g.nome,
      itens,
      subtotalCentavos: itens.reduce((s, i) => s + i.totalCentavos, 0),
    };
  });

  const totais = totaisDoOrcamento(
    e.itens.map((i) => ({ preco_unitario: i.preco, quantidade: i.quantidade })),
    e.config.desconto_avista_pct,
  );

  return {
    loja: e.loja,
    numero: e.numero,
    versao: e.versao,
    dataEmissao: isoParaBR(hoje),
    validade: isoParaBR(adicionarDiasISO(hoje, e.config.validade_dias)),
    cliente: e.cliente,
    vendedora: e.vendedora,
    ambientes,
    totais,
    rodape: linhasDoRodape(e.config),
  };
}
