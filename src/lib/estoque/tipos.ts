import type { UnidadeProduto } from "../dominio";

/** Campos do sistema que podem receber uma coluna da planilha. */
export const CAMPOS_MAPEAVEIS = [
  "codigo",
  "descricao",
  "preco_unitario",
  "categoria",
  "marca",
  "referencia_fabricante",
  "modelo",
  "unidade",
  "estoque_disponivel",
  "w",
  "k",
  "comprimento",
] as const;
export type CampoMapeavel = (typeof CAMPOS_MAPEAVEIS)[number];

export const CAMPOS_OBRIGATORIOS: readonly CampoMapeavel[] = [
  "codigo",
  "descricao",
  "preco_unitario",
];

export const ROTULOS_CAMPOS: Record<CampoMapeavel, string> = {
  codigo: "Código",
  descricao: "Descrição",
  preco_unitario: "Preço unitário",
  categoria: "Categoria",
  marca: "Fabricante (só a gerência vê)",
  referencia_fabricante: "Referência do fabricante (só a gerência vê)",
  modelo: "Modelo (só a gerência vê)",
  unidade: "Unidade (un ou m)",
  estoque_disponivel: "Estoque disponível",
  w: "Potência (W)",
  k: "Temperatura de cor (K)",
  comprimento: "Comprimento (m)",
};

/** Campo do sistema -> nome da coluna na planilha. */
export type Mapeamento = Partial<Record<CampoMapeavel, string>>;

export interface PlanilhaLida {
  colunas: string[];
  linhas: Record<string, string>[];
}

/** Produto pronto para gravar. Campos opcionais ausentes não sobrescrevem o que já existe. */
export interface ProdutoImportacao {
  codigo: string;
  descricao: string;
  preco_unitario: number;
  categoria?: string | null;
  /** Fabricante: vai para produtos_dados_fornecedor, nunca para `produtos`. */
  marca?: string | null;
  referencia_fabricante?: string | null;
  modelo?: string | null;
  unidade?: UnidadeProduto;
  estoque_disponivel?: number | null;
  atributos?: Record<string, unknown>;
  apelidos?: string[];
}

export interface ErroLinha {
  /** Número da linha na planilha (1 = primeira linha de dados). */
  linha: number;
  codigo?: string | null;
  mensagem: string;
}

export interface ResumoImportacao {
  syncId: string;
  linhasLidas: number;
  linhasGravadas: number;
  novos: number;
  alterados: number;
  iguais: number;
  desativados: number;
  erros: ErroLinha[];
}

export interface PreviaImportacao {
  novos: number;
  alterados: number;
  iguais: number;
  reativados: number;
  /** Ativos hoje que não vieram na planilha. */
  ausentes: number;
}
