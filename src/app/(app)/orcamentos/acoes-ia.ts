"use server";

import { criarClienteIA, ErroConfiguracaoIA } from "@/lib/ia/cliente";
import { lerConfigIA } from "@/lib/ia/config";
import { criarExecutorFerramentas } from "@/lib/ia/ferramentas";
import { montarOrcamento, reescreverAnaliseAmbiente } from "@/lib/ia/montar";
import { criarRepositorioIA } from "@/lib/ia/repositorio-ia";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaMontarIA =
  | { ok: true; itens: number; geracoesRestantes: number }
  | { ok: false; erro: string; podeTentarDeNovo: boolean };

/**
 * Monta os itens do orçamento com a IA. Roda no servidor com a sessão da vendedora (RLS); a
 * service role só entra para contar e registrar uso_ia. A rota que usa esta ação define maxDuration.
 */
export async function montarComIA(orcamentoId: string): Promise<RespostaMontarIA> {
  const usuario = await obterUsuarioAtual();
  const sessao = await criarClienteServidor();

  let ia;
  try {
    ia = criarClienteIA();
  } catch (e) {
    if (e instanceof ErroConfiguracaoIA) {
      return {
        ok: false,
        erro: "A IA ainda não está configurada. Avise a gerência.",
        podeTentarDeNovo: false,
      };
    }
    throw e;
  }

  try {
    const r = await montarOrcamento(
      {
        repo: criarRepositorioIA(sessao, criarClienteAdmin()),
        ia,
        executor: criarExecutorFerramentas(sessao),
        config: lerConfigIA(),
      },
      usuario.id,
      orcamentoId,
    );
    if (!r.ok) return { ok: false, erro: r.erro, podeTentarDeNovo: r.podeTentarDeNovo };
    return { ok: true, itens: r.itens, geracoesRestantes: r.geracoesRestantes };
  } catch {
    // Falha antes de a montagem registrar o uso (por exemplo, banco fora do ar): nada foi gravado.
    return {
      ok: false,
      erro: "Não foi possível montar o orçamento agora.",
      podeTentarDeNovo: true,
    };
  }
}

export type RespostaReescrita =
  | { ok: true; analise: string; anexosUsados: string[] }
  | { ok: false; erro: string; podeTentarDeNovo: boolean };

/** "Reescrever análise com IA" de um ambiente (conta no limite diário de uso da IA). */
export async function reescreverAnalise(
  orcamentoId: string,
  ambiente: string,
): Promise<RespostaReescrita> {
  const usuario = await obterUsuarioAtual();
  const sessao = await criarClienteServidor();
  let ia;
  try {
    ia = criarClienteIA();
  } catch (e) {
    if (e instanceof ErroConfiguracaoIA) {
      return {
        ok: false,
        erro: "A IA ainda não está configurada. Avise a gerência.",
        podeTentarDeNovo: false,
      };
    }
    throw e;
  }
  try {
    const r = await reescreverAnaliseAmbiente(
      {
        repo: criarRepositorioIA(sessao, criarClienteAdmin()),
        ia,
        executor: criarExecutorFerramentas(sessao),
        config: lerConfigIA(),
      },
      usuario.id,
      orcamentoId,
      ambiente,
    );
    if (!r.ok) return { ok: false, erro: r.erro, podeTentarDeNovo: r.podeTentarDeNovo };
    return { ok: true, analise: r.analise, anexosUsados: r.anexosUsados };
  } catch {
    return {
      ok: false,
      erro: "Não foi possível reescrever a análise agora.",
      podeTentarDeNovo: true,
    };
  }
}
