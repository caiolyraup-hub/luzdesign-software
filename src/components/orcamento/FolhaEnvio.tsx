"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { marcarEnviado } from "@/app/(app)/orcamentos/acoes-status";
import { Botao } from "@/components/ui/Botao";
import { classeCampo } from "@/components/ui/Campo";
import { Folha } from "@/components/ui/Folha";
import { useToast } from "@/components/ui/Toast";
import { hojeMaceioISO } from "@/lib/formatar";
import { dataDeEnvioValida } from "@/lib/orcamento/envio";
import { dataMaceioISO } from "@/lib/orcamento/followup";

interface Props {
  orcamentoId: string;
  /** Quando foi gerado (o envio não pode ser antes). */
  geradoEm: string | null;
  aberta: boolean;
  onFechar: () => void;
}

/**
 * Folha curta (sobe de baixo no celular): "Você já mandou para o cliente?". "Enviei agora" grava com a
 * hora atual; "Enviei em outra data" pede a data (não futura, não antes de gerado); "Ainda não" só fecha.
 */
export function FolhaEnvio({ orcamentoId, geradoEm, aberta, onFechar }: Props) {
  const router = useRouter();
  const { avisar } = useToast();
  const [outraData, setOutraData] = useState(false);
  const [data, setData] = useState(() => hojeMaceioISO());
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gravar(valor?: string) {
    setErro(null);
    if (valor !== undefined) {
      const v = dataDeEnvioValida(valor, { geradoEm });
      if (!v.ok)
        return setErro(
          v.motivo === "futura"
            ? "A data do envio não pode ser no futuro."
            : v.motivo === "antes_de_gerado"
              ? "A data do envio não pode ser antes de o orçamento ser gerado."
              : "Informe a data do envio.",
        );
    }
    setOcupado(true);
    const r = await marcarEnviado(orcamentoId, valor);
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    setOutraData(false);
    avisar("sucesso", "Envio registrado.");
    onFechar();
    router.refresh();
  }

  return (
    <Folha aberta={aberta} onFechar={onFechar} titulo="Você já mandou para o cliente?">
      <p className="text-base text-zinc-600">
        Registrar o envio mantém os follow-ups e os números certos.
      </p>
      <Botao disabled={ocupado} onClick={() => void gravar()}>
        {ocupado && !outraData ? "Salvando..." : "Enviei agora"}
      </Botao>
      {outraData ? (
        <div className="space-y-2 rounded-lg border-2 border-indigo-700 bg-indigo-50 p-3">
          <label className="block space-y-1">
            <span className="text-lg font-medium">Data do envio</span>
            <input
              type="date"
              value={data}
              max={hojeMaceioISO()}
              min={geradoEm ? dataMaceioISO(geradoEm) : undefined}
              onChange={(e) => setData(e.target.value)}
              className={classeCampo}
            />
          </label>
          <Botao disabled={ocupado} onClick={() => void gravar(data)}>
            {ocupado ? "Salvando..." : "Confirmar envio"}
          </Botao>
        </div>
      ) : (
        <Botao variante="secundario" onClick={() => setOutraData(true)}>
          Enviei em outra data
        </Botao>
      )}
      <Botao variante="fantasma" onClick={onFechar}>
        Ainda não
      </Botao>
      {erro ? (
        <p role="alert" className="text-lg text-red-700">
          {erro}
        </p>
      ) : null}
    </Folha>
  );
}
