// Resumo do dia do piloto (função SQL resumo_piloto): tipos e texto para o terminal.

export interface ResumoVendedora {
  nome: string;
  criados: number;
  gerados: number;
  enviados: number;
  mediana_ate_gerar_min: number | null;
  itens: { manual: number; lista_colada: number; indicacao_ia: number; montagem_ia: number };
}
export interface ResumoPiloto {
  dia: string;
  vendedoras: ResumoVendedora[];
  relatos_abertos: { criado_em: string; quem: string; tela: string | null; mensagem: string }[];
  erros: { criado_em: string; origem: string; rota: string | null; mensagem: string }[];
  custo_ia_usd: number;
}

const hora = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Maceio",
});

export function formatarMediana(min: number | null): string {
  if (min === null || min === undefined) return "—";
  const m = Number(min);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}

/** Hoje em Maceió, no formato AAAA-MM-DD. */
export function hojeEmMaceio(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function formatarResumo(r: ResumoPiloto): string {
  const [a, m, d] = r.dia.split("-");
  const linhas: string[] = [`RESUMO DO PILOTO — ${d}/${m}/${a} (dia de Maceió)`, ""];
  for (const v of r.vendedoras) {
    linhas.push(
      `${v.nome}`,
      `  orçamentos: ${v.criados} criados · ${v.gerados} gerados · ${v.enviados} enviados`,
      `  do início do rascunho até gerar (mediana): ${formatarMediana(v.mediana_ate_gerar_min)}`,
      `  itens por origem: ${v.itens.manual} manual (inclui kit de fita) · ${v.itens.lista_colada} lista colada · ${v.itens.indicacao_ia} Indicação da IA · ${v.itens.montagem_ia} montagem da IA`,
      "",
    );
  }
  linhas.push(`Relatos abertos (${r.relatos_abertos.length}):`);
  for (const x of r.relatos_abertos)
    linhas.push(
      `  ${hora.format(new Date(x.criado_em))} ${x.quem}${x.tela ? ` [${x.tela}]` : ""}: ${x.mensagem}`,
    );
  linhas.push("", `Erros do dia (${r.erros.length}):`);
  for (const x of r.erros)
    linhas.push(
      `  ${hora.format(new Date(x.criado_em))} ${x.origem}${x.rota ? ` ${x.rota}` : ""}: ${x.mensagem}`,
    );
  linhas.push("", `Custo de IA do dia: US$ ${Number(r.custo_ia_usd).toFixed(4)}`);
  return linhas.join("\n");
}
