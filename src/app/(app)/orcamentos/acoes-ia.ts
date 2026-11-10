"use server";

import { criarClienteIA, ErroConfiguracaoIA } from "@/lib/ia/cliente";
import { inicioDoDiaMaceio } from "@/lib/ia/comum";
import { lerConfigIA } from "@/lib/ia/config";
import { criarExecutorFerramentas } from "@/lib/ia/ferramentas";
import { pedirIndicacao, type IndicacaoGuardada } from "@/lib/ia/indicacao";
import { criarRepositorioIA } from "@/lib/ia/repositorio-ia";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaIndicacao =
  | ({ ok: true; restantesHoje: number } & IndicacaoGuardada)
  | { ok: false; erro: string; podeTentarDeNovo: boolean };

export interface EntradaIndicacao {
  orcamentoId: string;
  ambiente: string;
  pedidoCliente: string;
  pedidoArquiteto: string;
  descricaoAmbiente: string;
  usarAnexos: boolean;
}

/**
 * Indicação da IA: sugere produtos do catálogo para um ambiente. Roda no servidor com a sessão da
 * vendedora (RLS); a service role só entra para contar e registrar uso_ia. NÃO grava item: a
 * vendedora adiciona cada sugestão (adicionarSugestao, em acoes-revisao). A rota que usa esta ação
 * define maxDuration.
 */
export async function pedirIndicacaoIA(entrada: EntradaIndicacao): Promise<RespostaIndicacao> {
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

  const config = lerConfigIA();
  const repo = criarRepositorioIA(sessao, criarClienteAdmin());
  try {
    const r = await pedirIndicacao(
      { repo, ia, executor: criarExecutorFerramentas(sessao), config },
      usuario.id,
      entrada,
    );
    if (!r.ok) return { ok: false, erro: r.erro, podeTentarDeNovo: r.podeTentarDeNovo };
    const usados = await repo.contarUso({
      vendedoraId: usuario.id,
      desde: inicioDoDiaMaceio(new Date()),
    });
    return {
      ok: true,
      resumo: r.resumo,
      sugestoes: r.sugestoes,
      observacoes: r.observacoes,
      avisos: r.avisos,
      restantesHoje: Math.max(0, config.limiteDiario - usados),
    };
  } catch {
    // Falha antes de o uso ser registrado (por exemplo, banco fora do ar): nada foi gravado.
    return {
      ok: false,
      erro: "Não foi possível pedir a indicação agora.",
      podeTentarDeNovo: true,
    };
  }
}
