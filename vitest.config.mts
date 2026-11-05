import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" lança fora do servidor do Next; nos testes vira um módulo vazio.
      "server-only": path.resolve(import.meta.dirname, "src/lib/testes/vazio.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
