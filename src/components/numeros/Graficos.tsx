import Link from "next/link";
import { formatarMoeda } from "@/lib/formatar";
import { rotuloMotivo } from "@/lib/orcamento/status";
import type { PerdaPorMotivo, SemanaSerie } from "@/lib/metricas/carregar";

/** Cobre da marca (destaque) e um azul-acinzentado para o segundo grupo; ambos passam de 4,5:1 no branco. */
export const COBRE = "#9F5F47";
export const AZUL = "#2F5575";

// ---------------------------------------------------------------- funil

export interface EtapaFunil {
  rotulo: string;
  quantidade: number;
  href: string;
}

/** Criados -> gerados -> enviados -> fechados, barras proporcionais ao maior número. */
export function Funil({ etapas }: { etapas: EtapaFunil[] }) {
  const maior = Math.max(1, ...etapas.map((e) => e.quantidade));
  return (
    <ul className="space-y-2">
      {etapas.map((e) => (
        <li key={e.rotulo}>
          <Link
            href={e.href}
            className="block min-h-11 space-y-1 rounded-lg py-1 focus-visible:outline-2"
          >
            <span className="flex items-baseline justify-between text-lg">
              <span>{e.rotulo}</span>
              <strong>{e.quantidade}</strong>
            </span>
            <span className="block h-4 rounded bg-zinc-100" aria-hidden="true">
              <span
                className="block h-4 rounded"
                style={{
                  width: `${Math.max(e.quantidade > 0 ? 2 : 0, (e.quantidade / maior) * 100)}%`,
                  backgroundColor: COBRE,
                }}
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- por que perdi

/** Barras por motivo (quantidade e R$); cada linha leva à lista de perdidos daquele motivo. */
export function BarrasMotivos({
  perdas,
  hrefDe,
}: {
  perdas: PerdaPorMotivo[];
  hrefDe: (motivo: string) => string;
}) {
  const maior = Math.max(1, ...perdas.map((p) => p.valor));
  return (
    <ul className="space-y-2">
      {perdas.map((p) => (
        <li key={p.motivo}>
          <Link href={hrefDe(p.motivo)} className="block min-h-11 space-y-1 py-1">
            <span className="flex items-baseline justify-between gap-3 text-lg">
              <span>{rotuloMotivo(p.motivo)}</span>
              <span className="shrink-0 text-right">
                <strong>{p.quantidade}</strong> · {formatarMoeda(p.valor)}
              </span>
            </span>
            <span className="block h-4 rounded bg-zinc-100" aria-hidden="true">
              <span
                className="block h-4 rounded"
                style={{
                  width: `${Math.max(2, (p.valor / maior) * 100)}%`,
                  backgroundColor: COBRE,
                }}
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- gráfico semanal (SVG feito à mão)

export interface SerieBarras {
  nome: string;
  cor: string;
  /** Um valor por semana, na ordem de `semanas`. */
  valores: number[];
}

/** AAAA-MM-DD -> DD/MM. */
const curto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Barras agrupadas por semana (sem biblioteca). As legendas e as datas ficam em HTML (16 px) e há
 * uma lista de números para leitores de tela; o SVG em si é decorativo.
 */
export function GraficoBarrasSemanal({
  titulo,
  semanas,
  series,
}: {
  titulo: string;
  semanas: string[];
  series: SerieBarras[];
}) {
  const L = 340;
  const A = 120;
  const maior = Math.max(1, ...series.flatMap((s) => s.valores));
  const grupo = L / semanas.length;
  const barra = Math.min(14, (grupo - 4) / series.length);
  const resumo = semanas
    .map(
      (s, i) =>
        `semana de ${curto(s)}: ${series.map((x) => `${x.nome} ${x.valores[i]}`).join(", ")}`,
    )
    .join("; ");

  return (
    <figure className="space-y-2">
      <figcaption className="text-lg font-semibold">{titulo}</figcaption>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        role="img"
        aria-label={`${titulo}. ${resumo}`}
        className="h-32 w-full"
        preserveAspectRatio="none"
      >
        <line x1="0" y1={A - 0.5} x2={L} y2={A - 0.5} stroke="#a1a1aa" strokeWidth="1" />
        {semanas.map((_, i) =>
          series.map((s, j) => {
            const h = (s.valores[i] / maior) * (A - 6);
            return (
              <rect
                key={`${i}-${j}`}
                x={i * grupo + (grupo - barra * series.length) / 2 + j * barra}
                y={A - h}
                width={barra - 1}
                height={h}
                fill={s.cor}
              />
            );
          }),
        )}
      </svg>
      <p className="flex justify-between text-base text-zinc-700">
        <span>{curto(semanas[0])}</span>
        <span>máx. por semana: {maior}</span>
        <span>{curto(semanas[semanas.length - 1])}</span>
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-base">
        {series.map((s) => (
          <li key={s.nome} className="flex items-center gap-2">
            <span
              className="inline-block size-4 rounded-sm"
              style={{ backgroundColor: s.cor }}
              aria-hidden="true"
            />
            {s.nome} ({s.valores.reduce((a, b) => a + b, 0)})
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Junta a série do banco (uma linha por vendedora e semana) em semanas e valores por vendedora. */
export function seriesPorVendedora(
  linhas: SemanaSerie[],
  campo: "enviados" | "fechados",
): { semanas: string[]; porVendedora: { nome: string; valores: number[] }[] } {
  const semanas = [...new Set(linhas.map((l) => l.semana))].sort();
  const nomes = [...new Set(linhas.map((l) => l.nome))].sort();
  return {
    semanas,
    porVendedora: nomes.map((nome) => ({
      nome,
      valores: semanas.map(
        (s) => linhas.find((l) => l.semana === s && l.nome === nome)?.[campo] ?? 0,
      ),
    })),
  };
}
