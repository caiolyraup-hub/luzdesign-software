"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Tipo = "sucesso" | "erro";
interface Aviso {
  id: number;
  tipo: Tipo;
  texto: string;
}
const Contexto = createContext<{ avisar: (tipo: Tipo, texto: string) => void } | null>(null);

const ESTILO: Record<Tipo, string> = {
  sucesso: "border-emerald-700 text-emerald-900",
  erro: "border-red-700 text-red-900",
};

/** Aviso único de sucesso e erro, no topo, com o mesmo visual em todas as telas. */
export function ProvedorToast({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const avisar = useCallback((tipo: Tipo, texto: string) => {
    setAvisos((a) => [...a.slice(-2), { id: Date.now() + Math.random(), tipo, texto }]);
  }, []);
  const valor = useMemo(() => ({ avisar }), [avisar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] mx-auto flex max-w-md flex-col gap-2 px-4">
        {avisos.map((a) => (
          <ItemAviso
            key={a.id}
            aviso={a}
            aoSumir={() => setAvisos((l) => l.filter((x) => x.id !== a.id))}
          />
        ))}
      </div>
    </Contexto.Provider>
  );
}

function ItemAviso({ aviso, aoSumir }: { aviso: Aviso; aoSumir: () => void }) {
  useEffect(() => {
    const t = setTimeout(aoSumir, aviso.tipo === "erro" ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [aviso, aoSumir]);
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      className={`vidro-forte folha-entra pointer-events-auto rounded-xl border-l-4 px-4 py-3 text-lg font-medium ${ESTILO[aviso.tipo]}`}
    >
      {aviso.texto}
    </div>
  );
}

export function useToast() {
  const c = useContext(Contexto);
  // Fora do provedor (por exemplo em teste de componente), os avisos viram no-op.
  return c ?? { avisar: () => {} };
}
