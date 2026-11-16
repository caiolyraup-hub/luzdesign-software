import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Data do build, para a rota pública /api/saude (qual versão está no ar).
  env: { BUILD_DATA: new Date().toISOString() },
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Planilhas de estoque chegam por Server Action (limite da Vercel: 4,5 MB).
    serverActions: { bodySizeLimit: "4mb" },
  },
  partialPrefetching: true,
  // O PDF lê o logo em public/marca dentro da função (a Vercel só inclui o que o rastreio achar).
  outputFileTracingIncludes: {
    "/orcamentos/\\[id\\]/revisao": ["./public/marca/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
