import { clienteEhDeTeste } from "../orcamento/eh-teste";

export type OrcLinha = {
  id: string;
  numero: string;
  cliente_id: string;
  arquiteto_id: string | null;
  piloto: boolean;
  respostas: Record<string, unknown> | null;
  cliente_nome: string | null;
};
export type CliLinha = { id: string; nome: string; arquiteto_id: string | null };
export type ArqLinha = { id: string; nome: string };

export const EH_NOME_DE_TESTE_AUTOMATIZADO = /^(COM|ARQ|CLIENTE) (E2E|RLS)/i;

/** Motivos pelos quais o orçamento é lixo de teste (vazio = não é). Piloto nunca é. */
export function motivosDeTeste(o: OrcLinha): string[] {
  if (o.piloto) return [];
  const r = o.respostas ?? {};
  return [
    r.teste === true || r.teste === "true" ? "respostas.teste" : "",
    r.teste_rls === "true" ? "respostas.teste_rls" : "",
    r.teste_ia ? "respostas.teste_ia" : "",
    clienteEhDeTeste(o.cliente_nome) ? `cliente "${o.cliente_nome}"` : "",
    EH_NOME_DE_TESTE_AUTOMATIZADO.test(o.cliente_nome ?? "")
      ? `cliente de teste automatizado "${o.cliente_nome}"`
      : "",
    o.numero === "2026-0005" ? "orçamento 2026-0005 (guardado de propósito até o go-live)" : "",
  ].filter(Boolean);
}

/**
 * O que o go-live considera lixo de teste, sem tocar no PILOTO: orçamento piloto, o cliente dele e o
 * arquiteto ligado a ele (direto ou pelo cliente) ficam sempre protegidos, mesmo com nome de teste.
 * Itens, anexos, PDFs, eventos e comissões acompanham o orçamento, então também ficam.
 */
export function selecionarLixoDeTeste(dados: {
  orcamentos: OrcLinha[];
  clientes: CliLinha[];
  arquitetos: ArqLinha[];
}) {
  const pilotos = dados.orcamentos.filter((o) => o.piloto);
  const clientesProtegidos = new Set(pilotos.map((o) => o.cliente_id));
  const arquitetosProtegidos = new Set<string>();
  for (const o of pilotos) if (o.arquiteto_id) arquitetosProtegidos.add(o.arquiteto_id);
  for (const c of dados.clientes)
    if (clientesProtegidos.has(c.id) && c.arquiteto_id) arquitetosProtegidos.add(c.arquiteto_id);

  const orcamentos = dados.orcamentos
    .map((o) => ({ o, motivos: motivosDeTeste(o) }))
    .filter((x) => x.motivos.length > 0);
  const clientes = dados.clientes.filter(
    (c) =>
      !clientesProtegidos.has(c.id) &&
      (clienteEhDeTeste(c.nome) || EH_NOME_DE_TESTE_AUTOMATIZADO.test(c.nome)),
  );
  const arquitetos = dados.arquitetos.filter(
    (a) => !arquitetosProtegidos.has(a.id) && /teste|e2e|rls/i.test(a.nome),
  );
  return {
    orcamentos,
    clientes,
    arquitetos,
    protegidos: {
      orcamentos: pilotos,
      clientes: dados.clientes.filter((c) => clientesProtegidos.has(c.id)),
      arquitetos: dados.arquitetos.filter((a) => arquitetosProtegidos.has(a.id)),
    },
  };
}
