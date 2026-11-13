"use client";

import Link from "next/link";
import {
  OPCOES_PRAZO,
  OPCOES_TIPO_CLIENTE,
  type ErrosCampos,
  type Pergunta,
  type Respostas,
} from "@/lib/orcamento/perguntas";
import { ArquitetoSeletor } from "@/components/arquitetos/ArquitetoSeletor";
import { CardsUnico } from "./Cards";

const campoTexto = "min-h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-lg";
const campoLongo = "min-h-48 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-lg";

export interface ClienteEncontrado {
  id: string;
  nome: string;
  /** Histórico do cliente ("3 orçamentos, 1 fechado, último em 04/11"). */
  historico?: string;
}

interface Props {
  pergunta: Pergunta;
  respostas: Respostas;
  erros: ErrosCampos;
  /** patch = novos valores; texto = campos de texto livre (salvos com debounce). */
  onMudar: (patch: Record<string, unknown>, texto?: string[]) => void;
  clienteEncontrado: ClienteEncontrado | null;
  clienteEmUso: boolean;
  onUsarCliente: () => void;
}

function Erro({ texto }: { texto?: string }) {
  return texto ? (
    <p role="alert" className="text-lg text-red-700">
      {texto}
    </p>
  ) : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function PassoPergunta({
  pergunta,
  respostas,
  erros,
  onMudar,
  clienteEncontrado,
  clienteEmUso,
  onUsarCliente,
}: Props) {
  const idPergunta = `pergunta-${pergunta.id}`;
  const erroDe = (campo: string) => erros[campo];

  let controles: React.ReactNode = null;

  switch (pergunta.id) {
    case "cliente_nome":
      controles = (
        <>
          <input
            id={idPergunta}
            aria-labelledby={`${idPergunta}-titulo`}
            name="cliente_nome"
            type="text"
            autoComplete="off"
            autoCapitalize="words"
            value={str(respostas.cliente_nome)}
            onChange={(e) => onMudar({ cliente_nome: e.target.value }, ["cliente_nome"])}
            aria-describedby={`${idPergunta}-ajuda`}
            className={campoTexto}
          />
          <Erro texto={erroDe("cliente_nome")} />
        </>
      );
      break;

    case "cliente_whatsapp":
      controles = (
        <>
          <input
            id={idPergunta}
            aria-labelledby={`${idPergunta}-titulo`}
            name="cliente_whatsapp"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="(82) 99999-1234"
            value={str(respostas.cliente_whatsapp)}
            onChange={(e) => onMudar({ cliente_whatsapp: e.target.value })}
            aria-describedby={`${idPergunta}-ajuda`}
            className={campoTexto}
          />
          <Erro texto={erroDe("cliente_whatsapp")} />
          {clienteEncontrado ? (
            <div className="space-y-2 rounded-lg border-2 border-amber-700 bg-amber-50 p-4">
              <p className="text-lg">Já existe um cliente com este WhatsApp.</p>
              {clienteEncontrado.historico ? (
                <p className="text-base text-zinc-700">
                  {clienteEncontrado.nome}: {clienteEncontrado.historico}.{" "}
                  <Link href={`/clientes/${clienteEncontrado.id}`} className="underline">
                    Ver ficha
                  </Link>
                </p>
              ) : null}
              <button
                type="button"
                onClick={onUsarCliente}
                aria-pressed={clienteEmUso}
                className="min-h-14 w-full rounded-lg bg-amber-700 px-4 text-lg font-semibold text-white"
              >
                {clienteEmUso ? "Usando cliente cadastrado" : "Usar cliente já cadastrado"}:{" "}
                {clienteEncontrado.nome}
              </button>
            </div>
          ) : null}
        </>
      );
      break;

    case "tipo_cliente": {
      const tipo = str(respostas.tipo_cliente);
      const indicacao = respostas.indicacao_arquiteto === true;
      const pedeArquiteto = tipo === "arquiteto" || (tipo !== "" && indicacao);
      controles = (
        <>
          <CardsUnico
            nome="Tipo de cliente"
            opcoes={OPCOES_TIPO_CLIENTE}
            valor={tipo}
            onChange={(v) => onMudar({ tipo_cliente: v })}
          />
          <Erro texto={erroDe("tipo_cliente")} />
          {tipo !== "" && tipo !== "arquiteto" ? (
            <div className="space-y-2 pt-2">
              <p className="text-lg font-medium">Veio indicado por um arquiteto(a)?</p>
              <CardsUnico
                nome="Indicação de arquiteto"
                colunas={2}
                opcoes={[
                  { valor: "nao", rotulo: "Não" },
                  { valor: "sim", rotulo: "Sim" },
                ]}
                valor={indicacao ? "sim" : "nao"}
                onChange={(v) => onMudar({ indicacao_arquiteto: v === "sim" })}
              />
            </div>
          ) : null}
          {pedeArquiteto ? (
            <ArquitetoSeletor
              rotulo={tipo === "arquiteto" ? "Arquiteto(a)" : "Qual arquiteto(a) indicou?"}
              valor={
                str(respostas.arquiteto_indicador)
                  ? {
                      id: str(respostas.arquiteto_id) || null,
                      nome: str(respostas.arquiteto_indicador),
                    }
                  : null
              }
              onEscolher={(a) =>
                onMudar({ arquiteto_id: a?.id ?? null, arquiteto_indicador: a?.nome ?? null })
              }
              erro={erroDe("arquiteto_indicador")}
            />
          ) : null}
        </>
      );
      break;
    }

    case "endereco":
      controles = (
        <>
          <input
            id={idPergunta}
            aria-labelledby={`${idPergunta}-titulo`}
            name="endereco"
            type="text"
            autoComplete="off"
            autoCapitalize="words"
            value={str(respostas.endereco)}
            onChange={(e) => onMudar({ endereco: e.target.value }, ["endereco"])}
            aria-describedby={`${idPergunta}-ajuda`}
            className={campoTexto}
          />
          <Erro texto={erroDe("endereco")} />
        </>
      );
      break;

    case "pedido_cliente":
      controles = (
        <>
          <textarea
            id={idPergunta}
            aria-labelledby={`${idPergunta}-titulo`}
            name="pedido_cliente"
            value={str(respostas.pedido_cliente)}
            onChange={(e) => onMudar({ pedido_cliente: e.target.value }, ["pedido_cliente"])}
            aria-describedby={`${idPergunta}-ajuda`}
            className={campoLongo}
          />
          <Erro texto={erroDe("pedido_cliente")} />
        </>
      );
      break;

    case "faixa_investimento":
      controles = (
        <>
          <input
            id={idPergunta}
            aria-labelledby={`${idPergunta}-titulo`}
            name="faixa_investimento"
            type="text"
            autoComplete="off"
            value={str(respostas.faixa_investimento)}
            onChange={(e) =>
              onMudar({ faixa_investimento: e.target.value }, ["faixa_investimento"])
            }
            aria-describedby={`${idPergunta}-ajuda`}
            className={campoTexto}
          />
          <Erro texto={erroDe("faixa_investimento")} />
        </>
      );
      break;

    case "prazo":
      controles = (
        <>
          <CardsUnico
            nome="Prazo"
            opcoes={OPCOES_PRAZO}
            valor={str(respostas.prazo)}
            onChange={(v) => onMudar({ prazo: v })}
          />
          <Erro texto={erroDe("prazo")} />
        </>
      );
      break;

    case "observacoes":
      controles = (
        <>
          <textarea
            id={idPergunta}
            aria-labelledby={`${idPergunta}-titulo`}
            name="observacoes"
            value={str(respostas.observacoes)}
            onChange={(e) => onMudar({ observacoes: e.target.value }, ["observacoes"])}
            aria-describedby={`${idPergunta}-ajuda`}
            className={campoLongo}
          />
          <Erro texto={erroDe("observacoes")} />
        </>
      );
      break;
  }

  return (
    <div className="space-y-3">
      <h1 id={`${idPergunta}-titulo`} tabIndex={-1} className="text-2xl font-semibold outline-none">
        {pergunta.rotulo}
        {pergunta.obrigatoria ? null : (
          <span className="text-lg font-normal text-zinc-600"> (opcional)</span>
        )}
      </h1>
      {pergunta.dica ? (
        <p id={`${idPergunta}-ajuda`} className="text-lg text-zinc-600">
          {pergunta.dica}
        </p>
      ) : null}
      {controles}
    </div>
  );
}
