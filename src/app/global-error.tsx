"use client";

// Último recurso (erro no layout raiz): precisa trazer o próprio <html>.
export default function ErroGlobal({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, fontSize: 18 }}>
        <h1 style={{ fontSize: 24 }}>Algo não saiu como esperado</h1>
        <p>Não conseguimos abrir o sistema agora. Confira a internet e tente de novo.</p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: 56,
            width: "100%",
            fontSize: 18,
            background: "#b45309",
            color: "#fff",
            border: 0,
            borderRadius: 8,
          }}
        >
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
