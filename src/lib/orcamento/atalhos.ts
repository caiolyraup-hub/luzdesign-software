/** Funções puras dos atalhos de seleção (dia 9B): mais usados e nome de ambiente duplicado. */

/** Quantos produtos aparecem em "Seus mais usados". */
export const QTD_MAIS_USADOS = 12;
/** Janela do histórico, em dias. */
export const DIAS_MAIS_USADOS = 90;

/**
 * Os códigos mais usados: conta quantas linhas de item cada código tem (um item por ambiente de
 * cada orçamento), do mais para o menos usado; empate pela ordem em que apareceu primeiro.
 * Item avulso (sem código) não conta.
 */
export function codigosMaisUsados(
  linhas: { codigo: string | null }[],
  limite = QTD_MAIS_USADOS,
): string[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    if (!l.codigo) continue;
    contagem.set(l.codigo, (contagem.get(l.codigo) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([codigo, n], ordem) => ({ codigo, n, ordem }))
    .sort((a, b) => b.n - a.n || a.ordem - b.ordem)
    .slice(0, limite)
    .map((x) => x.codigo);
}

/**
 * Nome sugerido para a cópia de um ambiente: "Quarto 1" -> "Quarto 2"; "Quarto" -> "Quarto 2";
 * "Sala de estar" -> "Sala de estar 2". Pula números que já existem ("Quarto 2" -> "Quarto 3").
 */
export function sugerirNomeDuplicado(nome: string, existentes: string[]): string {
  const limpo = nome.trim().replace(/\s+/g, " ");
  const m = /^(.*?)\s+(\d+)$/.exec(limpo);
  const raiz = m ? m[1] : limpo;
  let n = m ? Number(m[2]) + 1 : 2;
  const usados = new Set(existentes.map((e) => e.trim().toLowerCase()));
  while (usados.has(`${raiz} ${n}`.toLowerCase())) n++;
  return `${raiz} ${n}`;
}
