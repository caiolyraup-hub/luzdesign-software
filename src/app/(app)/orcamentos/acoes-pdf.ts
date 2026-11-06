"use server";

import { gerarPdfOrcamento } from "@/lib/pdf/gerar";
import { renderizarPdf } from "@/lib/pdf/renderizar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaGerarPdf =
  { ok: true; versao: number } | { ok: false; erro: string; bloqueios?: string[] };

/**
 * Gera uma nova versão do PDF do orçamento. Roda no servidor com a sessão da vendedora (RLS);
 * a rota que chama esta ação define maxDuration.
 */
export async function gerarPdf(orcamentoId: string): Promise<RespostaGerarPdf> {
  const usuario = await obterUsuarioAtual();
  const sessao = await criarClienteServidor();
  try {
    const r = await gerarPdfOrcamento(
      { sessao, renderizar: renderizarPdf },
      { id: usuario.id, nome: usuario.nome },
      orcamentoId,
    );
    if (!r.ok) return { ok: false, erro: r.erro, bloqueios: r.bloqueios };
    return { ok: true, versao: r.versao };
  } catch {
    return { ok: false, erro: "Não foi possível gerar o PDF agora. Tente de novo." };
  }
}
