"use server";

import { lerDadosEstoque } from "@/lib/estoque/dados-estoque";
import { gerarPlanilhaOrcamento } from "@/lib/planilha/orcamento";
import { gerarOrcamento } from "@/lib/pdf/gerar";
import { carregarLogo, renderizarPdf } from "@/lib/pdf/renderizar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaGerarOrcamento =
  { ok: true; versao: number } | { ok: false; erro: string; bloqueios?: string[] };

/**
 * Gera uma nova versão do orçamento: o PDF do cliente (só código e tipo do produto) e a planilha do
 * estoque (com fabricante e referência). Roda no servidor com a sessão da vendedora (RLS); a service
 * role só lê os dados do estoque dos códigos do próprio orçamento. A rota que chama define maxDuration.
 */
export async function gerarOrcamentoCompleto(orcamentoId: string): Promise<RespostaGerarOrcamento> {
  const usuario = await obterUsuarioAtual();
  const sessao = await criarClienteServidor();

  try {
    const logo = await carregarLogo();
    const r = await gerarOrcamento(
      {
        sessao,
        renderizar: (dados) => renderizarPdf(dados, logo),
        gerarPlanilha: (dados, estoque) => gerarPlanilhaOrcamento(dados, logo, estoque),
        lerEstoque: (codigos) => lerDadosEstoque(criarClienteAdmin(), codigos),
      },
      { id: usuario.id, nome: usuario.nome },
      orcamentoId,
    );
    if (!r.ok) return { ok: false, erro: r.erro, bloqueios: r.bloqueios };
    return { ok: true, versao: r.versao };
  } catch {
    return { ok: false, erro: "Não foi possível gerar o orçamento agora. Tente de novo." };
  }
}
