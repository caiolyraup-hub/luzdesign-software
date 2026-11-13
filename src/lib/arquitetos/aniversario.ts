/**
 * Aniversários dos arquitetos. Tudo em datas ISO (AAAA-MM-DD) já no fuso de Maceió: quem chama passa
 * `hojeMaceioISO()`, então a virada de dia acompanha o relógio da loja e não o do servidor.
 */

export interface AniversarioArquiteto {
  id: string;
  nome: string;
  aniversario_dia: number | null;
  aniversario_mes: number | null;
}

export interface ProximoAniversario<T extends AniversarioArquiteto = AniversarioArquiteto> {
  arquiteto: T;
  /** 0 = hoje. */
  dias: number;
  /** Data (AAAA-MM-DD) em que a comemoração cai no calendário, já com o ajuste do 29/02. */
  data: string;
}

export function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Dia em que o aniversário cai no ano: 29/02 vira 28/02 quando o ano não é bissexto. */
export function diaNoAno(dia: number, mes: number, ano: number): { dia: number; mes: number } {
  if (mes === 2 && dia === 29 && !ehBissexto(ano)) return { dia: 28, mes: 2 };
  return { dia, mes };
}

function diasEntre(deISO: string, ateISO: string): number {
  const a = Date.UTC(+deISO.slice(0, 4), +deISO.slice(5, 7) - 1, +deISO.slice(8, 10));
  const b = Date.UTC(+ateISO.slice(0, 4), +ateISO.slice(5, 7) - 1, +ateISO.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Próxima ocorrência (hoje conta) do aniversário, ou null se o cadastro não tem dia e mês. */
export function proximaOcorrencia(
  dia: number | null,
  mes: number | null,
  hojeISO: string,
): { data: string; dias: number } | null {
  if (!dia || !mes) return null;
  const anoHoje = +hojeISO.slice(0, 4);
  for (const ano of [anoHoje, anoHoje + 1]) {
    const d = diaNoAno(dia, mes, ano);
    const data = `${ano}-${dois(d.mes)}-${dois(d.dia)}`;
    if (data >= hojeISO) return { data, dias: diasEntre(hojeISO, data) };
  }
  return null;
}

/** Arquitetos que fazem aniversário hoje e nos próximos `janela` dias, do mais próximo ao mais distante. */
export function proximosAniversarios<T extends AniversarioArquiteto>(
  arquitetos: T[],
  hojeISO: string,
  janela = 7,
): ProximoAniversario<T>[] {
  const lista: ProximoAniversario<T>[] = [];
  for (const a of arquitetos) {
    const o = proximaOcorrencia(a.aniversario_dia, a.aniversario_mes, hojeISO);
    if (o && o.dias <= janela) lista.push({ arquiteto: a, dias: o.dias, data: o.data });
  }
  return lista.sort(
    (x, y) => x.dias - y.dias || x.arquiteto.nome.localeCompare(y.arquiteto.nome, "pt-BR"),
  );
}

/** "hoje", "amanhã" ou "em N dias (DD/MM)". */
export function rotuloAniversario(dias: number, data: string): string {
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias (${data.slice(8, 10)}/${data.slice(5, 7)})`;
}

/** Substitui {arquiteto} e {vendedora} na mensagem padrão. */
export function mensagemAniversario(modelo: string, arquiteto: string, vendedora: string): string {
  const primeiro = arquiteto.trim().split(/\s+/)[0] || arquiteto;
  return modelo.replaceAll("{arquiteto}", primeiro).replaceAll("{vendedora}", vendedora);
}

/**
 * Normalização de nomes usada na migração de arquitetos (espelha `normalizar_nome_arquiteto` do SQL):
 * minúsculas, sem acentos, espaços únicos.
 */
export function normalizarNomeArquiteto(nome: string): string {
  return nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
