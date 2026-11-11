import { adicionarDiasISO, hojeMaceioISO, isoParaBR } from "../formatar";

/** Períodos do painel: datas de calendário de Maceió, início e fim inclusivos. */
export const IDS_PERIODO = ["mes", "mes-anterior", "90-dias", "personalizado"] as const;
export type IdPeriodo = (typeof IDS_PERIODO)[number];

export const ROTULOS_PERIODO: Record<IdPeriodo, string> = {
  mes: "Este mês",
  "mes-anterior": "Mês passado",
  "90-dias": "90 dias",
  personalizado: "Personalizado",
};

/** Maior intervalo personalizado, em dias (contando as duas pontas). */
export const MAX_DIAS_PERIODO = 366;

export interface Periodo {
  id: IdPeriodo;
  /** AAAA-MM-DD, inclusivo. */
  inicio: string;
  /** AAAA-MM-DD, inclusivo. */
  fim: string;
  /** "01/11/2026 a 30/11/2026". */
  descricao: string;
  /** Presente quando o intervalo personalizado era inválido e caímos no mês atual. */
  aviso: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** AAAA-MM-DD que existe no calendário (rejeita 2026-02-30). */
export function dataISOValida(texto: string | undefined | null): texto is string {
  if (!texto || !ISO.test(texto)) return false;
  const [a, m, d] = texto.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}

function diasEntre(inicio: string, fim: string): number {
  const [a1, m1, d1] = inicio.split("-").map(Number);
  const [a2, m2, d2] = fim.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

function montar(id: IdPeriodo, inicio: string, fim: string, aviso: string | null = null): Periodo {
  return { id, inicio, fim, descricao: `${isoParaBR(inicio)} a ${isoParaBR(fim)}`, aviso };
}

export interface EntradaPeriodo {
  periodo?: string;
  de?: string;
  ate?: string;
}

/**
 * Resolve o período pedido na URL. Sem pedido (ou pedido desconhecido): mês atual até hoje.
 * Intervalo personalizado inválido (data que não existe, fim antes do início, mais de 366 dias):
 * cai no mês atual e devolve um aviso.
 */
export function resolverPeriodo(entrada: EntradaPeriodo = {}, agora: Date = new Date()): Periodo {
  const hoje = hojeMaceioISO(agora);
  const primeiroDoMes = `${hoje.slice(0, 7)}-01`;

  switch (entrada.periodo) {
    case "mes-anterior": {
      const fim = adicionarDiasISO(primeiroDoMes, -1); // último dia do mês passado (vale em janeiro)
      return montar("mes-anterior", `${fim.slice(0, 7)}-01`, fim);
    }
    case "90-dias":
      return montar("90-dias", adicionarDiasISO(hoje, -89), hoje);
    case "personalizado": {
      const { de, ate } = entrada;
      const mes = montar("mes", primeiroDoMes, hoje);
      if (!dataISOValida(de) || !dataISOValida(ate))
        return { ...mes, aviso: "Datas inválidas. Mostrando este mês." };
      if (ate < de)
        return { ...mes, aviso: "A data final é antes da inicial. Mostrando este mês." };
      if (diasEntre(de, ate) + 1 > MAX_DIAS_PERIODO)
        return {
          ...mes,
          aviso: `O intervalo vai até ${MAX_DIAS_PERIODO} dias. Mostrando este mês.`,
        };
      return montar("personalizado", de, ate);
    }
    default:
      return montar("mes", primeiroDoMes, hoje);
  }
}

/** Parâmetros de URL que reproduzem o período (para manter a escolha ao navegar). */
export function paramsDoPeriodo(p: Periodo): Record<string, string> {
  return p.id === "personalizado"
    ? { periodo: "personalizado", de: p.inicio, ate: p.fim }
    : { periodo: p.id };
}
