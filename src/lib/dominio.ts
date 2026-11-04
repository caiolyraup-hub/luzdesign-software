export const PERFIS = ["vendedora", "gerente"] as const;
export type Perfil = (typeof PERFIS)[number];

export const STATUS_ORCAMENTO = [
  "rascunho",
  "gerado",
  "enviado",
  "followup_d5",
  "followup_d10",
  "fechado",
  "perdido",
] as const;
export type StatusOrcamento = (typeof STATUS_ORCAMENTO)[number];

export const MOTIVOS_PERDA = [
  "preco",
  "prazo_pronta_entrega",
  "comprou_em_outra_loja",
  "desistiu",
  "sem_resposta",
] as const;
export type MotivoPerda = (typeof MOTIVOS_PERDA)[number];

export const TIPOS_CLIENTE = [
  "final",
  "arquiteto",
  "eletricista",
  "construtora",
  "empresa",
] as const;
export type TipoCliente = (typeof TIPOS_CLIENTE)[number];

export type UnidadeProduto = "un" | "m";

export interface Produto {
  /** Código de 5 dígitos, em texto (chave primária). */
  codigo: string;
  categoria: string;
  marca: string;
  descricao: string;
  unidade: UnidadeProduto;
  precoUnitario: number;
  /** Nulo quando o estoque é desconhecido. */
  estoqueDisponivel: number | null;
  atributos: { w?: number; k?: number; comprimento?: number } & Record<string, unknown>;
  ativo: boolean;
  atualizadoEm: string;
}

export interface Orcamento {
  id: string;
  numero: number;
  vendedoraId: string;
  clienteId: string;
  respostas: Record<string, unknown>;
  status: StatusOrcamento;
  valorTotal: number;
  valorFechado: number | null;
  validade: string | null;
  geradoEm: string | null;
  enviadoEm: string | null;
  fechadoEm: string | null;
  perdidoEm: string | null;
  /** Obrigatório quando o status é "perdido". */
  motivoPerda: MotivoPerda | null;
}

export interface OrcamentoItem {
  id: string;
  orcamentoId: string;
  /** Nulo quando é item avulso. */
  codigo: string | null;
  descricaoCongelada: string;
  precoUnitarioCongelado: number;
  quantidade: number;
  ambiente: string;
  avulso: boolean;
}
