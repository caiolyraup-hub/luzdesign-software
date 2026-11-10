import { MOTIVOS_PERDA, type MotivoPerda, type StatusOrcamento } from "../dominio";

export const ROTULOS_STATUS: Record<StatusOrcamento, string> = {
  rascunho: "Rascunho",
  gerado: "Gerado",
  enviado: "Enviado",
  followup_d5: "Follow-up D+5",
  followup_d10: "Follow-up D+10",
  fechado: "Fechado",
  perdido: "Perdido",
};

/** Classes do selo de cada status (Tailwind). Rascunho é cinza. Ver docs/modelo-de-dados.md. */
export const CLASSES_STATUS: Record<StatusOrcamento, string> = {
  rascunho: "bg-zinc-200 text-zinc-800",
  gerado: "bg-sky-100 text-sky-900",
  enviado: "bg-indigo-100 text-indigo-900",
  followup_d5: "bg-amber-100 text-amber-900",
  followup_d10: "bg-orange-100 text-orange-900",
  fechado: "bg-emerald-100 text-emerald-900",
  perdido: "bg-rose-100 text-rose-900",
};

export function rotuloStatus(status: string): string {
  return ROTULOS_STATUS[status as StatusOrcamento] ?? status;
}

export function classeStatus(status: string): string {
  return CLASSES_STATUS[status as StatusOrcamento] ?? "bg-zinc-200 text-zinc-800";
}

// ---------------------------------------------------------------- motivos de perda

export const ROTULOS_MOTIVO: Record<MotivoPerda, string> = {
  preco: "Preço",
  prazo_pronta_entrega: "Prazo / pronta-entrega",
  comprou_em_outra_loja: "Comprou em outra loja",
  desistiu: "Desistiu",
  sem_resposta: "Sem resposta",
};

export const LISTA_MOTIVOS = MOTIVOS_PERDA.map((valor) => ({
  valor,
  rotulo: ROTULOS_MOTIVO[valor],
}));

export function rotuloMotivo(motivo: string | null | undefined): string {
  return motivo ? (ROTULOS_MOTIVO[motivo as MotivoPerda] ?? motivo) : "";
}

// ---------------------------------------------------------------- acompanhamento

/** Uma ação de status na tela: um toque (ou um formulário curto para fechar e perder). */
export interface AcaoStatus {
  para: StatusOrcamento;
  rotulo: string;
  /** primaria = o próximo passo natural; perigo = perdeu; discreta = voltar/reabrir. */
  estilo: "primaria" | "secundaria" | "sucesso" | "perigo" | "discreta";
  /** Pede dados antes de confirmar. */
  pede: "valor" | "motivo" | "data" | null;
}

const FECHOU: AcaoStatus = {
  para: "fechado",
  rotulo: "Fechou (vendeu)",
  estilo: "sucesso",
  pede: "valor",
};
const PERDEU: AcaoStatus = { para: "perdido", rotulo: "Perdeu", estilo: "perigo", pede: "motivo" };

/**
 * Ações disponíveis em cada status. Espelha a função SQL mudar_status_orcamento (a regra de verdade
 * fica no banco; aqui só decidimos quais botões mostrar).
 */
export function acoesDoStatus(status: StatusOrcamento): AcaoStatus[] {
  switch (status) {
    case "gerado":
      return [
        { para: "enviado", rotulo: "Marquei como enviado", estilo: "primaria", pede: "data" },
        FECHOU,
        PERDEU,
      ];
    case "enviado":
      return [
        { para: "followup_d5", rotulo: "Follow-up D+5 feito", estilo: "primaria", pede: null },
        { para: "followup_d10", rotulo: "Follow-up D+10 feito", estilo: "secundaria", pede: null },
        FECHOU,
        PERDEU,
        { para: "gerado", rotulo: "Corrigir: não foi enviado", estilo: "discreta", pede: null },
      ];
    case "followup_d5":
      return [
        { para: "followup_d10", rotulo: "Follow-up D+10 feito", estilo: "primaria", pede: null },
        FECHOU,
        PERDEU,
        { para: "enviado", rotulo: "Voltar para enviado", estilo: "discreta", pede: null },
      ];
    case "followup_d10":
      return [
        FECHOU,
        PERDEU,
        {
          para: "followup_d5",
          rotulo: "Voltar para follow-up D+5",
          estilo: "discreta",
          pede: null,
        },
      ];
    case "fechado":
    case "perdido":
      return [
        { para: "enviado", rotulo: "Reabrir (volta para enviado)", estilo: "discreta", pede: null },
      ];
    default:
      return []; // rascunho: o status muda ao gerar o PDF
  }
}

/** Quais status ainda estão "em andamento" (não fechados nem perdidos). */
export const STATUS_EM_ANDAMENTO: StatusOrcamento[] = [
  "rascunho",
  "gerado",
  "enviado",
  "followup_d5",
  "followup_d10",
];
