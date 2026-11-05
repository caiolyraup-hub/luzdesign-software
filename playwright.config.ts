import { defineConfig, devices } from "@playwright/test";

// As credenciais de teste vêm do .env.local (as mesmas do pnpm test:rls).
try {
  process.loadEnvFile(".env.local");
} catch {
  // sem .env.local: as variáveis precisam estar no ambiente
}

const PORTA = 3210;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORTA}`,
    // Celular: 390 px de largura (iPhone 12/13/14).
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "pt-BR",
    timezoneId: "America/Maceio",
    trace: "retain-on-failure",
  },
  projects: [{ name: "celular-390", use: {} }],
  webServer: {
    command: `pnpm dev --port ${PORTA}`,
    url: `http://localhost:${PORTA}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
