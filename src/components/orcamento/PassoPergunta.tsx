"use client";

import Link from "next/link";
import {
  OPCOES_AMBIENTES,
  OPCOES_ESTADO_OBRA,
  OPCOES_LINHA,
  OPCOES_PRAZO,
  OPCOES_TIPO_CLIENTE,
  OPCOES_USO_OBRA,
  type ErrosCampos,
  type Pergunta,
  type Respostas,
} from "@/lib/orcamento/perguntas";
import { CardsMultiplo, CardsUnico } from "./Cards";

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
            <label className="block space-y-1 pt-2">
              <span className="text-lg font-medium">
                {tipo === "arquiteto" ? "Nome do arquiteto(a)" : "Qual arquiteto(a) indicou?"}
              </span>
              <input
                name="arquiteto_indicador"
                type="text"
                autoComplete="off"
                autoCapitalize="words"
                value={str(respostas.arquiteto_indicador)}
                onChange={(e) =>
                  onMudar({ arquiteto_indicador: e.target.value }, ["arquiteto_indicador"])
                }
                className={campoTexto}
              />
              <Erro texto={erroDe("arquiteto_indicador")} />
            </label>
          ) : null}
        </>
      );
      break;
    }

    case "tipo_obra": {
      const obra = (respostas.tipo_obra ?? {}) as { uso?: string; estado?: string };
      controles = (
        <>
          <p className="text-lg font-medium">Uso</p>
          <CardsUnico
            nome="Uso da obra"
            colunas={2}
            opcoes={OPCOES_USO_OBRA}
            valor={obra.uso}
            onChange={(v) => onMudar({ tipo_obra: { ...obra, uso: v } })}
          />
          <p className="pt-2 text-lg font-medium">Situação</p>
          <CardsUnico
            nome="Situação da obra"
            colunas={2}
            opcoes={OPCOES_ESTADO_OBRA}
            valor={obra.estado}
            onChange={(v) => onMudar({ tipo_obra: { ...obra, estado: v } })}
          />
          <Erro texto={erroDe("tipo_obra")} />
        </>
      );
      break;
    }

    case "ambientes": {
      const ambientes = Array.isArray(respostas.ambientes) ? (respostas.ambientes as string[]) : [];
      controles = (
        <>
          <CardsMultiplo
            nome="Ambientes"
            opcoes={OPCOES_AMBIENTES}
            valores={ambientes}
            onChange={(v) => onMudar({ ambientes: v })}
          />
          <Erro texto={erroDe("ambientes")} />
          {ambientes.includes("outro") ? (
            <label className="block space-y-1 pt-2">
              <span className="text-lg font-medium">Qual outro ambiente?</span>
              <input
                name="ambiente_outro"
                type="text"
                autoComplete="off"
                value={str(respostas.ambiente_outro)}
                onChange={(e) => onMudar({ ambiente_outro: e.target.value }, ["ambiente_outro"])}
                className={campoTexto}
              />
              <Erro texto={erroDe("ambiente_outro")} />
            </label>
          ) : null}
        </>
      );
      break;
    }

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

    case "linha":
      controles = (
        <>
          <CardsUnico
            nome="Linha"
            opcoes={OPCOES_LINHA}
            valor={str(respostas.linha)}
            onChange={(v) => onMudar({ linha: v })}
          />
          <Erro texto={erroDe("linha")} />
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
