"use client";

import { useActionState } from "react";
import { salvarConfiguracoes, type EstadoConfiguracoes } from "./acoes";

export interface ConfiguracoesLoja {
  nome_fantasia: string;
  razao_social: string | null;
  cnpj: string | null;
  endereco: string | null;
  telefone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  site: string | null;
  validade_dias: number;
  desconto_avista_pct: number;
  linhas_rodape: string;
}

const inicial: EstadoConfiguracoes = { ok: null, erro: null };
const campo = "min-h-14 w-full rounded-lg border border-zinc-300 px-4 text-lg";

function Campo({
  nome,
  rotulo,
  valor,
  tipo = "text",
  dica,
}: {
  nome: string;
  rotulo: string;
  valor: string | number | null;
  tipo?: string;
  dica?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-lg font-medium">{rotulo}</span>
      <input
        name={nome}
        type={tipo}
        defaultValue={valor ?? ""}
        inputMode={tipo === "number" ? "decimal" : undefined}
        step={tipo === "number" ? "any" : undefined}
        className={campo}
      />
      {dica ? <span className="block text-base text-zinc-600">{dica}</span> : null}
    </label>
  );
}

export function FormularioConfiguracoes({ config }: { config: ConfiguracoesLoja }) {
  const [estado, acao, pendente] = useActionState(salvarConfiguracoes, inicial);

  return (
    <form action={acao} className="space-y-5">
      <Campo nome="nome_fantasia" rotulo="Nome da loja" valor={config.nome_fantasia} />
      <Campo nome="razao_social" rotulo="Razão social" valor={config.razao_social} />
      <Campo nome="cnpj" rotulo="CNPJ" valor={config.cnpj} />
      <Campo nome="endereco" rotulo="Endereço" valor={config.endereco} />
      <Campo nome="telefone" rotulo="Telefone" valor={config.telefone} tipo="tel" />
      <Campo nome="whatsapp" rotulo="WhatsApp da loja" valor={config.whatsapp} tipo="tel" />
      <Campo
        nome="instagram"
        rotulo="Instagram"
        valor={config.instagram}
        dica="Por exemplo, @luzdesign"
      />
      <Campo nome="site" rotulo="Site" valor={config.site} />
      <div className="grid grid-cols-2 gap-4">
        <Campo
          nome="validade_dias"
          rotulo="Validade (dias)"
          valor={config.validade_dias}
          tipo="number"
          dica="De 1 a 90."
        />
        <Campo
          nome="desconto_avista_pct"
          rotulo="Desconto à vista (%)"
          valor={config.desconto_avista_pct}
          tipo="number"
          dica="De 0 a 100."
        />
      </div>
      <label className="block space-y-1">
        <span className="text-lg font-medium">Condições no fim do orçamento</span>
        <textarea
          name="linhas_rodape"
          defaultValue={config.linhas_rodape}
          className="min-h-48 w-full rounded-lg border border-zinc-300 px-4 py-3 text-lg"
        />
        <span className="block text-base text-zinc-600">
          Uma condição por linha. Se mudar o desconto ou a validade, ajuste também estas linhas. Dá
          para usar <code>{"{desconto}"}</code> e <code>{"{validade_dias}"}</code>, que o PDF troca
          pelos valores acima.
        </span>
      </label>

      {estado.erro ? (
        <p role="alert" className="text-lg text-red-700">
          {estado.erro}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="text-lg text-emerald-800">
          Dados salvos.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pendente}
        className="min-h-14 w-full rounded-lg bg-amber-700 px-5 text-lg font-semibold text-white disabled:opacity-60"
      >
        {pendente ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
