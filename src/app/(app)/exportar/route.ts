import { PassThrough, Readable } from "node:stream";
import { carregarFonteExportacao } from "@/lib/exportacao/fonte-supabase";
import { escreverExportacao, type ContagemExportacao } from "@/lib/exportacao/planilha";
import { hojeMaceioISO } from "@/lib/formatar";
import { chipsAtivos, lerFiltrosLista, paraRpc, presetPorId } from "@/lib/orcamento/filtros-lista";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Milhares de orçamentos: a planilha é escrita em fluxo e a função pode demorar.
export const maxDuration = 300;

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Exporta a lista (com os filtros da URL) em planilha XLSX. Rota de servidor autenticada: usa a
 * sessão de quem pediu, então a RLS decide as linhas (a vendedora nunca recebe dado de outra). O
 * registro de auditoria (`eventos_exportacao`) é gravado só aqui, com a chave de serviço.
 * `?teste=1` inclui os orçamentos de teste (por padrão ficam de fora).
 */
export async function GET(req: Request) {
  const usuario = await obterUsuarioAtual();
  const gerencia = usuario.perfil === "gerente";
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const filtros = lerFiltrosLista(params, { gerente: gerencia });
  const incluirTeste = params.teste === "1";
  const sessao = await criarClienteServidor();

  let fonte;
  try {
    fonte = await carregarFonteExportacao(sessao, filtros, { incluirTeste });
  } catch {
    return new Response("Não foi possível ler os dados agora. Tente de novo.", { status: 500 });
  }

  const agora = new Date();
  const filtrosTexto = [
    presetPorId(filtros.preset).rotulo,
    ...chipsAtivos(filtros).map((c) => c.rotulo),
  ];
  const saida = new PassThrough();

  const registrar = async (linhas: ContagemExportacao) => {
    const rpc = { ...paraRpc(filtros, {}) } as Record<string, unknown>;
    delete rpc.cursor;
    delete rpc.limite;
    const { error } = await criarClienteAdmin().from("eventos_exportacao").insert({
      usuario_id: usuario.id,
      filtros: rpc,
      incluiu_teste: incluirTeste,
      linhas: linhas.orcamentos,
      detalhes: linhas,
    });
    if (error) throw new Error("Não foi possível registrar a exportação.");
  };

  // A escrita roda em segundo plano enquanto o corpo da resposta já sai em fluxo.
  void escreverExportacao(fonte, saida, {
    exportadoPor: usuario.nome,
    exportadoEm: agora,
    filtros: filtrosTexto,
    incluiuTeste: incluirTeste,
    gerencia,
    aoFinalizar: registrar,
  }).catch((e) => saida.destroy(e instanceof Error ? e : new Error("falha")));

  const nome = `luz-design-orcamentos ${hojeMaceioISO(agora)}.xlsx`;
  return new Response(Readable.toWeb(saida) as ReadableStream, {
    headers: {
      "Content-Type": MIME_XLSX,
      "Content-Disposition": `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
