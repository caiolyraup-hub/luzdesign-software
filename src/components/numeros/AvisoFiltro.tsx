import Link from "next/link";
import { isoParaBR } from "@/lib/formatar";
import { ROTULOS_CAMPO, type FiltroPeriodo } from "@/lib/metricas/lista";
import { rotuloMotivo } from "@/lib/orcamento/status";

/** Faixa que explica o filtro de período vindo de um número do painel, com atalho para limpar e voltar. */
export function AvisoFiltro({
  filtro,
  limparHref,
  voltarHref,
}: {
  filtro: FiltroPeriodo;
  limparHref: string;
  voltarHref: string;
}) {
  return (
    <div
      role="status"
      className="space-y-1 rounded-lg border-2 border-[#9F5F47] bg-[#9F5F47]/10 p-3 text-base"
    >
      <p>
        Orçamentos <strong>{ROTULOS_CAMPO[filtro.campo]}</strong> de {isoParaBR(filtro.de)} a{" "}
        {isoParaBR(filtro.ate)}
        {filtro.motivo ? <> · motivo: {rotuloMotivo(filtro.motivo)}</> : null}. Orçamentos de teste
        ficam de fora.
      </p>
      <p className="flex flex-wrap gap-x-4">
        <Link href={limparHref} className="inline-flex min-h-11 items-center underline">
          Ver todos, sem período
        </Link>
        <Link href={voltarHref} className="inline-flex min-h-11 items-center underline">
          Voltar aos números
        </Link>
      </p>
    </div>
  );
}
