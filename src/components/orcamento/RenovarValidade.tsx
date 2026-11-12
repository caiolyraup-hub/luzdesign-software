"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  previaRenovacao,
  renovarValidade,
  type RespostaPrevia,
} from "@/app/(app)/orcamentos/acoes-validade";
import { AVISO_PRECOS_DEFASADOS, type ModoRenovacao } from "@/lib/orcamento/renovacao";
import { moedaCentavos, moedaSimples } from "@/lib/orcamento/totais";
import { ReabrirEdicao } from "./ReabrirEdicao";

interface Props {
  orcamentoId: string;
  /** Abre a prévia ao carregar (vindo de "Renovar" no cartão ou em Para hoje). */
  abrirInicial?: boolean;
  /** Só a dona edita itens; a gerência renova, mas não troca produto. */
  podeEditar: boolean;
  vencido: boolean;
}

type Previa = Extract<RespostaPrevia, { ok: true }>;

const sinal = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

/**
 * "Renovar validade": mostra as diferenças entre o preço congelado e o preço atual do catálogo e deixa
 * escolher entre atualizar os preços ou manter os antigos; depois gera uma nova versão (PDF e XLSX).
 */
export function RenovarValidade({ orcamentoId, abrirInicial = false, podeEditar, vencido }: Props) {
  const router = useRouter();
  const [aberta, setAberta] = useState(abrirInicial);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(abrirInicial);
  const [renovando, setRenovando] = useState<ModoRenovacao | null>(null);
  const [pronto, setPronto] = useState<number | null>(null);

  /** Busca a prévia (só se setState vier de callbacks: o efeito abaixo não chama setState direto). */
  function buscarPrevia(): Promise<void> {
    return previaRenovacao(orcamentoId)
      .then((r) => {
        if (r.ok) setPrevia(r);
        else setErro(r.erro);
      })
      .catch(() => setErro("Perdi a conexão com o servidor. Tente de novo."))
      .finally(() => setCarregando(false));
  }

  function abrir() {
    setAberta(true);
    setCarregando(true);
    setErro(null);
    void buscarPrevia();
  }

  // Aberta de início (link "Renovar" de um cartão): o estado já nasce "carregando".
  useEffect(() => {
    if (abrirInicial) void buscarPrevia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function renovar(modo: ModoRenovacao) {
    setErro(null);
    setRenovando(modo);
    let r;
    try {
      r = await renovarValidade(orcamentoId, modo);
    } catch {
      r = { ok: false as const, erro: "Perdi a conexão com o servidor. Tente de novo." };
    }
    setRenovando(null);
    if (!r.ok) return setErro(r.erro);
    setPronto(r.versao);
    router.replace(`/orcamentos/${orcamentoId}`);
    router.refresh();
  }

  if (pronto !== null) {
    return (
      <p role="status" className="rounded-lg border-2 border-emerald-700 bg-emerald-50 p-4 text-lg">
        Validade renovada: nova versão {pronto} gerada. Confira o PDF abaixo e marque como enviado
        quando mandar para o cliente.
      </p>
    );
  }

  if (!aberta) {
    return (
      <button
        type="button"
        onClick={abrir}
        className={`flex min-h-14 w-full items-center justify-center rounded-lg px-4 text-lg font-semibold ${
          vencido ? "bg-amber-700 text-white" : "border border-amber-700 bg-white text-amber-800"
        }`}
      >
        Renovar validade
      </button>
    );
  }

  const r = previa?.resumo;
  const mudados = previa?.diferencas.filter(
    (d) => d.situacao === "mudou" || d.situacao === "inativo" || d.semEstoque,
  );

  return (
    <section
      aria-label="Renovar validade"
      className="space-y-4 rounded-lg border-2 border-amber-700 bg-amber-50 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">Renovar validade</h2>
        <button
          type="button"
          onClick={() => setAberta(false)}
          disabled={renovando !== null}
          className="min-h-11 px-2 text-base underline"
        >
          Cancelar
        </button>
      </div>

      {carregando ? <p className="text-lg">Conferindo os preços do catálogo...</p> : null}

      {previa && r ? (
        <div className="space-y-4">
          <p className="text-lg">
            Comparei os preços do orçamento com os do catálogo de hoje.{" "}
            {r.mudaram === 0 && r.inativos === 0
              ? "Nenhum preço mudou."
              : `${r.mudaram} ${r.mudaram === 1 ? "item mudou de preço" : "itens mudaram de preço"}.`}
          </p>

          {mudados && mudados.length > 0 ? (
            <ul className="space-y-2">
              {mudados.map((d) => (
                <li key={d.id} className="space-y-1 rounded-lg border border-zinc-300 bg-white p-3">
                  <p className="text-lg font-medium">{d.descricao}</p>
                  <p className="text-base text-zinc-600">
                    {d.codigo ? `Cód. ${d.codigo} · ` : ""}
                    {d.ambiente} · {String(d.quantidade).replace(".", ",")}
                  </p>
                  {d.situacao === "mudou" ? (
                    <p className="text-lg">
                      {moedaSimples(d.precoAntigo)} → <strong>{moedaSimples(d.precoNovo)}</strong>{" "}
                      <span className={d.diferenca > 0 ? "text-red-800" : "text-emerald-800"}>
                        ({sinal(d.diferenca)}
                        {moedaSimples(Math.abs(d.diferenca))}
                        {d.percentual !== null
                          ? `, ${sinal(d.percentual)}${String(Math.abs(d.percentual)).replace(".", ",")}%`
                          : ""}
                        )
                      </span>
                    </p>
                  ) : null}
                  {d.situacao === "inativo" ? (
                    <p role="alert" className="text-lg font-medium text-red-800">
                      Este produto saiu do catálogo. Troque ou remova o item antes de renovar.
                    </p>
                  ) : null}
                  {d.semEstoque ? (
                    <p className="text-base font-medium text-amber-900">
                      Estoque informado: {String(d.estoque).replace(".", ",")} (o orçamento tem{" "}
                      {String(d.quantidade).replace(".", ",")}).
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="flex items-baseline justify-between text-lg">
            <span>Total hoje no orçamento</span>
            <strong>{moedaCentavos(r.totalAntigoCentavos)}</strong>
          </p>
          {r.diferencaCentavos !== 0 ? (
            <p className="flex items-baseline justify-between text-lg">
              <span>Total com os preços atuais</span>
              <strong>
                {moedaCentavos(r.totalNovoCentavos)} ({sinal(r.diferencaCentavos)}
                {moedaCentavos(Math.abs(r.diferencaCentavos))})
              </strong>
            </p>
          ) : null}
          <p className="text-base text-zinc-700">
            A nova versão vale por {previa.validadeDias} dias a partir de hoje; as versões
            anteriores continuam guardadas.
          </p>

          {!r.podeRenovar && r.inativos > 0 ? (
            <div className="space-y-2">
              <p role="alert" className="text-lg font-medium text-red-800">
                Há produto fora do catálogo: troque ou remova antes de renovar.
              </p>
              {podeEditar ? <ReabrirEdicao orcamentoId={orcamentoId} /> : null}
            </div>
          ) : null}

          {erro ? (
            <p role="alert" className="text-lg text-red-700">
              {erro}
            </p>
          ) : null}

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => void renovar("atualizar")}
              disabled={!r.podeRenovar || renovando !== null}
              className="min-h-14 w-full rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              {renovando === "atualizar"
                ? "Gerando a nova versão..."
                : "Atualizar preços e renovar"}
            </button>
            <button
              type="button"
              onClick={() => void renovar("manter")}
              disabled={!r.podeRenovar || renovando !== null}
              className="min-h-14 w-full rounded-lg border border-zinc-400 bg-white px-4 text-lg disabled:opacity-50"
            >
              {renovando === "manter"
                ? "Gerando a nova versão..."
                : "Manter os preços antigos e renovar"}
            </button>
            <p className="text-base text-amber-950">
              {r.mudaram > 0
                ? `Se mantiver os preços antigos: ${AVISO_PRECOS_DEFASADOS}`
                : "Sem mudança de preço, as duas opções geram a mesma versão."}
            </p>
          </div>
        </div>
      ) : null}

      {!previa && !carregando && erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}
    </section>
  );
}
