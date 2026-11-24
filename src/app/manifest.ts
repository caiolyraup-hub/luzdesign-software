import type { MetadataRoute } from "next";

/** Metadados do app instalável: cores da marca (barra do navegador e tela de abertura). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Luz Design Orçamentos",
    short_name: "Luz Design",
    description: "Orçamentos com IA e acompanhamento de conversão da Luz Design.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffdf8",
    theme_color: "#fffdf8",
    lang: "pt-BR",
  };
}
