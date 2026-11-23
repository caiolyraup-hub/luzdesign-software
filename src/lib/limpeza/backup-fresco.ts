import type { Manifesto } from "../backup/nucleo";

/** O backup serve para uma limpeza só se for recente e tiver exatamente os orçamentos que existem agora. */
export function validarBackupFresco(
  m: Pick<Manifesto, "criado_em" | "totais" | "projeto">,
  opcoes: { agora: Date; orcamentosAgora: number; projetoAgora: string; limiteHoras?: number },
): string[] {
  const problemas: string[] = [];
  const idadeH = (opcoes.agora.getTime() - new Date(m.criado_em).getTime()) / 3_600_000;
  const limite = opcoes.limiteHoras ?? 3;
  if (!(idadeH >= -0.01 && idadeH <= limite))
    problemas.push(
      `o backup tem ${idadeH.toFixed(1)} h (precisa ser dos últimos ${limite} h). Rode pnpm backup de novo.`,
    );
  if (m.projeto !== opcoes.projetoAgora)
    problemas.push(`o backup é do projeto ${m.projeto}, não de ${opcoes.projetoAgora}.`);
  if (m.totais.orcamentos !== opcoes.orcamentosAgora)
    problemas.push(
      `o backup tem ${m.totais.orcamentos} orçamento(s) e o banco tem ${opcoes.orcamentosAgora} agora: mudou depois do backup. Rode pnpm backup de novo.`,
    );
  return problemas;
}
