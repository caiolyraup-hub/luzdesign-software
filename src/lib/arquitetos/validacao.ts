import { normalizarWhatsapp } from "../orcamento/perguntas";

/** Dados de um arquiteto já limpos, prontos para gravar. */
export interface DadosArquiteto {
  nome: string;
  escritorio: string | null;
  whatsapp: string | null;
  email: string | null;
  aniversario_dia: number | null;
  aniversario_mes: number | null;
  aniversario_ano: number | null;
  observacoes: string | null;
}

export type ResultadoArquiteto =
  { ok: true; dados: DadosArquiteto } | { ok: false; erros: Record<string, string> };

const DIAS_DO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const texto = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const inteiro = (v: unknown): number | null => {
  const t = texto(v);
  if (!t) return null;
  return /^\d{1,4}$/.test(t) ? Number(t) : Number.NaN;
};

/** Valida os campos do cadastro (vêm do formulário como texto). */
export function validarArquiteto(entrada: Record<string, unknown>): ResultadoArquiteto {
  const erros: Record<string, string> = {};

  const nome = texto(entrada.nome);
  if (nome.length < 2) erros.nome = "Informe o nome do arquiteto(a).";
  else if (nome.length > 120) erros.nome = "Use no máximo 120 caracteres.";

  const escritorio = texto(entrada.escritorio) || null;
  if (escritorio && escritorio.length > 120) erros.escritorio = "Use no máximo 120 caracteres.";

  let whatsapp: string | null = null;
  const zap = texto(entrada.whatsapp);
  if (zap) {
    whatsapp = normalizarWhatsapp(zap);
    if (!whatsapp) erros.whatsapp = "Informe um WhatsApp válido, com DDD.";
  }

  const email = texto(entrada.email).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.email = "Informe um e-mail válido.";
  else if (email && email.length > 160) erros.email = "Use no máximo 160 caracteres.";

  const dia = inteiro(entrada.aniversario_dia);
  const mes = inteiro(entrada.aniversario_mes);
  const ano = inteiro(entrada.aniversario_ano);
  let aniversario_dia: number | null = null;
  let aniversario_mes: number | null = null;
  let aniversario_ano: number | null = null;
  if (dia === null && mes === null) {
    if (ano !== null) erros.aniversario_ano = "Informe também o dia e o mês.";
  } else if (dia === null || mes === null) {
    erros.aniversario_dia = "Informe o dia e o mês do aniversário.";
  } else if (Number.isNaN(dia) || Number.isNaN(mes) || mes < 1 || mes > 12 || dia < 1) {
    erros.aniversario_dia = "Aniversário inválido.";
  } else if (dia > DIAS_DO_MES[mes - 1]) {
    erros.aniversario_dia = "Esse dia não existe nesse mês.";
  } else {
    aniversario_dia = dia;
    aniversario_mes = mes;
    if (ano !== null) {
      if (Number.isNaN(ano) || ano < 1900 || ano > 2100) erros.aniversario_ano = "Ano inválido.";
      else aniversario_ano = ano;
    }
  }

  const observacoes = typeof entrada.observacoes === "string" ? entrada.observacoes.trim() : "";
  if (observacoes.length > 1000) erros.observacoes = "Use no máximo 1000 caracteres.";

  if (Object.keys(erros).length > 0) return { ok: false, erros };
  return {
    ok: true,
    dados: {
      nome,
      escritorio,
      whatsapp,
      email,
      aniversario_dia,
      aniversario_mes,
      aniversario_ano,
      observacoes: observacoes || null,
    },
  };
}

export const MAX_BYTES_FOTO = 300 * 1024;
export const LADO_FOTO = 400;
export const QUALIDADE_FOTO = 0.8;

/** "Aniversário: 29/02" (ou com o ano, se informado). */
export function textoAniversario(
  dia: number | null,
  mes: number | null,
  ano?: number | null,
): string {
  if (!dia || !mes) return "";
  const dm = `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
  return ano ? `${dm}/${ano}` : dm;
}

/** Iniciais para o círculo sem foto ("Lula Santana" -> "LS"). */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}
