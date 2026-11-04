"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CAMPOS_MAPEAVEIS,
  CAMPOS_OBRIGATORIOS,
  ROTULOS_CAMPOS,
  type CampoMapeavel,
  type Mapeamento,
} from "@/lib/estoque/tipos";
import {
  confirmarImportacao,
  gerarPrevia,
  lerArquivo,
  type RespostaLeitura,
  type RespostaPrevia,
  type RespostaImportacao,
} from "./acoes";

type Passo = "inicio" | "mapeamento" | "previa" | "pronto";
type Leitura = Extract<RespostaLeitura, { ok: true }>;
type Previa = Extract<RespostaPrevia, { ok: true }>;
type Resultado = Extract<RespostaImportacao, { ok: true }>;

const botao = "min-h-14 rounded-lg px-5 text-lg font-semibold disabled:opacity-60";
const botaoPrincipal = `${botao} bg-amber-700 text-white`;
const botaoSecundario = `${botao} border border-zinc-300 bg-white`;

export function Importador() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [passo, setPasso] = useState<Passo>("inicio");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [mapeamento, setMapeamento] = useState<Mapeamento>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [desativar, setDesativar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const faltando = CAMPOS_OBRIGATORIOS.filter((c) => !mapeamento[c]);

  function formulario(extra: Record<string, string> = {}) {
    const f = new FormData();
    if (arquivo) f.set("arquivo", arquivo);
    f.set("mapeamento", JSON.stringify(mapeamento));
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  function reiniciar() {
    setPasso("inicio");
    setArquivo(null);
    setLeitura(null);
    setMapeamento({});
    setPrevia(null);
    setResultado(null);
    setDesativar(false);
    setErro(null);
  }

  function aoEscolher(f: File | null) {
    setArquivo(f);
    setErro(null);
  }

  function enviarArquivo() {
    if (!arquivo) return;
    setErro(null);
    iniciar(async () => {
      const r = await lerArquivo(formulario());
      if (!r.ok) return setErro(r.erro);
      setLeitura(r);
      setMapeamento(r.mapeamento);
      setPasso("mapeamento");
    });
  }

  function verPrevia() {
    setErro(null);
    iniciar(async () => {
      const r = await gerarPrevia(formulario());
      if (!r.ok) return setErro(r.erro);
      setPrevia(r);
      setPasso("previa");
    });
  }

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await confirmarImportacao(formulario(desativar ? { desativarAusentes: "on" } : {}));
      if (!r.ok) return setErro(r.erro);
      setResultado(r);
      setPasso("pronto");
      router.refresh();
    });
  }

  if (passo === "inicio") {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Importar planilha</h2>
        <p className="text-zinc-600">
          Envie a planilha do estoque (.xlsx ou .csv). Se ela estiver em .xls, abra no Excel e salve
          como .xlsx.
        </p>
        <input
          type="file"
          accept=".xlsx,.csv,.txt"
          onChange={(e) => aoEscolher(e.target.files?.[0] ?? null)}
          className="block w-full rounded-lg border border-zinc-300 p-3 text-lg"
        />
        <Erro texto={erro} />
        <button
          type="button"
          className={botaoPrincipal}
          disabled={!arquivo || pendente}
          onClick={enviarArquivo}
        >
          {pendente ? "Lendo..." : "Continuar"}
        </button>
      </section>
    );
  }

  if (passo === "mapeamento" && leitura) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Quais colunas são quais?</h2>
        <p className="text-zinc-600">
          {leitura.total} linhas em {arquivo?.name}.{" "}
          {leitura.mapeamentoSalvo
            ? "Preenchi com o último mapeamento salvo; confira."
            : "Sugeri pelos nomes das colunas; confira."}
        </p>
        <div className="space-y-3">
          {CAMPOS_MAPEAVEIS.map((campo) => (
            <label key={campo} className="block space-y-1">
              <span className="text-lg font-medium">
                {ROTULOS_CAMPOS[campo]}
                {CAMPOS_OBRIGATORIOS.includes(campo) ? " *" : ""}
              </span>
              <select
                value={mapeamento[campo] ?? ""}
                onChange={(e) =>
                  setMapeamento((m) => {
                    const novo = { ...m };
                    if (e.target.value) novo[campo as CampoMapeavel] = e.target.value;
                    else delete novo[campo as CampoMapeavel];
                    return novo;
                  })
                }
                className="min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-3 text-lg"
              >
                <option value="">(não usar)</option>
                {leitura.colunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <h3 className="pt-2 text-lg font-semibold">As 5 primeiras linhas</h3>
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-left text-base">
            <thead className="bg-zinc-50">
              <tr>
                {leitura.colunas.map((c) => (
                  <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leitura.amostra.map((linha, i) => (
                <tr key={i} className="border-t border-zinc-200">
                  {leitura.colunas.map((c) => (
                    <td key={c} className="px-3 py-2 whitespace-nowrap">
                      {linha[c]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {faltando.length > 0 ? (
          <p className="text-red-700">
            Falta escolher: {faltando.map((c) => ROTULOS_CAMPOS[c]).join(", ")}.
          </p>
        ) : null}
        <Erro texto={erro} />
        <div className="flex flex-wrap gap-3">
          <button type="button" className={botaoSecundario} onClick={reiniciar}>
            Voltar
          </button>
          <button
            type="button"
            className={botaoPrincipal}
            disabled={faltando.length > 0 || pendente}
            onClick={verPrevia}
          >
            {pendente ? "Conferindo..." : "Ver prévia"}
          </button>
        </div>
      </section>
    );
  }

  if (passo === "previa" && previa) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Prévia da carga</h2>
        <ul className="grid grid-cols-2 gap-3">
          <Numero rotulo="Novos" valor={previa.previa.novos} />
          <Numero rotulo="Alterados" valor={previa.previa.alterados} />
          <Numero rotulo="Sem mudança" valor={previa.previa.iguais} />
          <Numero rotulo="Com erro" valor={previa.totalErros} destaque={previa.totalErros > 0} />
        </ul>
        {previa.previa.reativados > 0 ? (
          <p className="text-zinc-600">
            {previa.previa.reativados} produto(s) inativo(s) voltam a ficar ativos.
          </p>
        ) : null}

        {previa.totalErros > 0 ? (
          <details className="rounded-lg border border-zinc-200 p-3">
            <summary className="cursor-pointer text-lg">Ver erros ({previa.totalErros})</summary>
            <ListaErros erros={previa.erros} total={previa.totalErros} />
            <p className="pt-2 text-zinc-600">
              Linhas com erro não são importadas; as demais seguem.
            </p>
          </details>
        ) : null}

        <label className="flex min-h-14 items-start gap-3 rounded-lg border border-zinc-200 p-3 text-lg">
          <input
            type="checkbox"
            checked={desativar}
            onChange={(e) => setDesativar(e.target.checked)}
            className="mt-1 size-6"
          />
          <span>
            Desativar ausentes
            <span className="block text-base text-zinc-600">
              {previa.previa.ausentes} produto(s) ativo(s) não estão na planilha. Ficam inativos,
              nunca apagados.
            </span>
          </span>
        </label>

        <Erro texto={erro} />
        <div className="flex flex-wrap gap-3">
          <button type="button" className={botaoSecundario} onClick={() => setPasso("mapeamento")}>
            Voltar
          </button>
          <button type="button" className={botaoPrincipal} disabled={pendente} onClick={confirmar}>
            {pendente ? "Importando..." : "Confirmar importação"}
          </button>
        </div>
      </section>
    );
  }

  if (passo === "pronto" && resultado) {
    const r = resultado.resumo;
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Importação concluída</h2>
        <p className="text-lg">
          {r.linhasGravadas} gravadas ({r.novos} novos, {r.alterados} alterados), {r.iguais} sem
          mudança
          {r.desativados > 0 ? `, ${r.desativados} desativados` : ""}, {r.erros.length} erro(s).
        </p>
        <p className="text-zinc-600">O mapeamento foi salvo e já vem preenchido na próxima vez.</p>
        <button type="button" className={botaoPrincipal} onClick={reiniciar}>
          Importar outra planilha
        </button>
      </section>
    );
  }

  return null;
}

function Erro({ texto }: { texto: string | null }) {
  return texto ? (
    <p role="alert" className="text-lg text-red-700">
      {texto}
    </p>
  ) : null;
}

function Numero({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <li className="rounded-lg border border-zinc-200 p-3">
      <p className="text-base text-zinc-600">{rotulo}</p>
      <p className={`text-3xl font-semibold ${destaque ? "text-red-700" : ""}`}>{valor}</p>
    </li>
  );
}

function ListaErros({
  erros,
  total,
}: {
  erros: { linha: number; mensagem: string }[];
  total: number;
}) {
  return (
    <ul className="space-y-1 pt-2 text-base">
      {erros.map((e, i) => (
        <li key={i}>
          {e.linha > 0 ? `Linha ${e.linha}: ` : ""}
          {e.mensagem}
        </li>
      ))}
      {total > erros.length ? (
        <li className="text-zinc-600">... e mais {total - erros.length}.</li>
      ) : null}
    </ul>
  );
}
