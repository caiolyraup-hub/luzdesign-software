"use server";

import { criarClienteIA } from "@/lib/ia/cliente";
import { lerConfigIA } from "@/lib/ia/config";
import { criarExecutorFerramentas } from "@/lib/ia/ferramentas";
import { formatarTextos } from "@/lib/ia/formatacao";
import { criarRepositorioIA } from "@/lib/ia/repositorio-ia";
import { gerarPlanilhaOrcamento } from "@/lib/planilha/orcamento";
import { gerarOrcamento, type DepsGerarOrcamento } from "@/lib/pdf/gerar";
import { carregarLogo, renderizarPdf } from "@/lib/pdf/renderizar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaGerarOrcamento =
  { ok: true; versao: number } | { ok: false; erro: string; bloqueios?: string[] };

/**
 * Gera uma nova versão do orçamento (PDF e planilha XLSX). Roda no servidor com a sessão da
 * vendedora (RLS); a rota que chama esta ação define maxDuration. A IA só padroniza texto
 * (descrição dos produtos e nome dos ambientes) e nunca bloqueia a geração.
 */
export async function gerarOrcamentoCompleto(orcamentoId: string): Promise<RespostaGerarOrcamento> {
  const usuario = await obterUsuarioAtual();
  const sessao = await criarClienteServidor();

  // Sem chave da OpenAI, a geração segue com as descrições do catálogo.
  let padronizar: DepsGerarOrcamento["padronizar"];
  try {
    const ia = criarClienteIA();
    const repo = criarRepositorioIA(sessao, criarClienteAdmin());
    const config = lerConfigIA();
    const executor = criarExecutorFerramentas(sessao);
    padronizar = async (entrada) => {
      const r = await formatarTextos(
        { repo, ia, executor, config },
        usuario.id,
        orcamentoId,
        entrada,
      );
      return { descricoes: r.descricoes, ambientes: r.ambientes };
    };
  } catch {
    padronizar = undefined;
  }

  try {
    const logo = await carregarLogo();
    const r = await gerarOrcamento(
      {
        sessao,
        renderizar: (dados) => renderizarPdf(dados, logo),
        gerarPlanilha: (dados) => gerarPlanilhaOrcamento(dados, logo),
        padronizar,
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
