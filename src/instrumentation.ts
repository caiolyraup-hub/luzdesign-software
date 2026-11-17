// Next chama onRequestError para todo erro não tratado no servidor (páginas, rotas e Server Actions).
export async function onRequestError(
  erro: unknown,
  request: { path: string },
  context: { routeType?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registrarErro } = await import("./lib/erros/registrar");
  await registrarErro({
    origem: "servidor",
    rota: `${context.routeType ?? "?"} ${request.path}`,
    erro,
    digest: (erro as { digest?: string } | null)?.digest ?? null,
  });
}
