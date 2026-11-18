import { defineConfig, devices } from "@playwright/test";

// As credenciais de teste vêm do .env.local (as mesmas do pnpm test:rls).
try {
  process.loadEnvFile(".env.local");
} catch {
  // sem .env.local: as variáveis precisam estar no ambiente
}

const PORTA = 3210;
// E2E_BASE_URL aponta o teste para outro endereço (por exemplo, a produção) e dispensa o servidor local.
const BASE_EXTERNA = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_EXTERNA ?? `http://localhost:${PORTA}`,
    // Celular: 390 px de largura (iPhone 12/13/14).
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "pt-BR",
    timezoneId: "America/Maceio",
    trace: "retain-on-failure",
  },
  projects: [
    // Todos os e2e, no celular de 390 px (Chromium).
    { name: "celular-390", use: {}, testIgnore: /jornada/ },
    // Jornadas completas por perfil, nos dois sistemas de celular (dia 12C).
    {
      name: "iphone",
      testMatch: /jornada.*\.spec\.ts/,
      use: { ...devices["iPhone 14"], locale: "pt-BR", timezoneId: "America/Maceio" },
    },
    {
      name: "android",
      testMatch: /jornada.*\.spec\.ts/,
      use: { ...devices["Pixel 7"], locale: "pt-BR", timezoneId: "America/Maceio" },
    },
  ],
  webServer: BASE_EXTERNA
    ? undefined
    : {
        command: `pnpm dev --port ${PORTA}`,
        url: `http://localhost:${PORTA}/login`,
        // A IA é simulada nos testes (sem custo); um servidor já aberto precisa ter IA_SIMULADA=1.
        env: { IA_SIMULADA: "1" },
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
