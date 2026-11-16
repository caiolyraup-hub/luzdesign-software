import { resolverPeriodoComissao } from "@/lib/comissoes/calculo";
import { carregarComissoes } from "@/lib/comissoes/carregar";
import { gerarPlanilhaComissoes } from "@/lib/comissoes/planilha";
import { ehDono } from "@/lib/dominio";
import { hojeMaceioISO } from "@/lib/formatar";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Planilha de comissões: rota autenticada, só o dono (404 para os outros). */
export async function GET(request: Request) {
  const usuario = await obterUsuarioAtual();
  if (!ehDono(usuario.perfil)) return new Response("Not Found", { status: 404 });

  const p = new URL(request.url).searchParams;
  const agora = new Date();
  const periodo = resolverPeriodoComissao(
    {
      periodo: p.get("periodo") ?? undefined,
      de: p.get("de") ? `${p.get("de")}-01` : undefined,
      ate: p.get("ate") ? `${p.get("ate")}-01` : undefined,
    },
    hojeMaceioISO(agora),
  );
  const status =
    p.get("status") === "a_pagar" || p.get("status") === "paga"
      ? (p.get("status") as "a_pagar" | "paga")
      : "todas";
  const supabase = await criarClienteServidor();
  const dados = await carregarComissoes(supabase, periodo, status);
  const buffer = await gerarPlanilhaComissoes(dados, {
    periodo,
    exportadoPor: usuario.nome,
    exportadoEm: agora,
    status,
  });
  const nome = `comissoes ${hojeMaceioISO(agora)}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": MIME_XLSX,
      "Content-Disposition": `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
