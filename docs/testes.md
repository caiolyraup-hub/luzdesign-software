# Testes: sempre no projeto `luz-design-testes`

Os testes **nunca** rodam no banco de produção (`xdrubtojofckgxilkttm`). Eles usam um segundo projeto Supabase, `luz-design-testes`, com as chaves de `.env.test.local` (fora do git). O `.env.local` é só da produção e nenhum teste o lê.

## O que roda onde

| Comando | Onde |
| --- | --- |
| `pnpm test` (Vitest, PGlite em memória) | local, sem rede |
| `pnpm test:rls` (isolamento, matriz, importação, vazamento do catálogo...) | projeto de testes |
| `pnpm test:e2e` (Playwright: Chromium 390 px, iPhone, Android) | servidor local (`pnpm dev`, IA simulada) ligado ao projeto de testes |

## A trava

`scripts/guarda-producao.ts`: se **qualquer** variável de ambiente tiver, em qualquer parte do valor, o ref de produção, o teste falha no começo com `TESTE RECUSADO`. Vale para `test:rls`, a matriz e o Playwright (que também recusa um servidor já aberto ligado à produção, via `/api/saude`). Não existe variável para liberar. Se `.env.test.local` não existe, os testes também recusam e dizem o que fazer. O e2e ainda recusa `NODE_ENV=production` e servidor sem `IA_SIMULADA=1` (nunca chama a OpenAI de verdade; no arquivo de testes a chave é uma falsa).

## Criar o projeto de testes (uma vez)

1. Plano gratuito: cada conta tem **no máximo 2 projetos ativos**. Se já houver 2, **pause um** (ou apague um que não use): Supabase → o projeto → Settings → General → **Pause project**. (A criação pela CLI devolve `entitlement_required / free_project_limit` quando o limite está cheio.)
2. Crie o projeto: Supabase → **New project** → nome `luz-design-testes`, mesma organização, região **South America (São Paulo) / sa-east-1**, uma senha de banco (guarde em `.env.test.local` como `SUPABASE_TESTE_DB_PASSWORD`). Pela CLI: `npx supabase projects create luz-design-testes --org-id <org> --region sa-east-1 --db-password <senha> --yes`.
3. `pnpm testes:ambiente`: lê as chaves, grava `.env.test.local`, aplica **todas as migrations**, fecha o cadastro público, cria as 4 contas de teste, aplica o seed (clientes TESTE) e carrega os **158 produtos provisórios**. Pode rodar de novo (é idempotente).
4. `pnpm env:verificar --teste` confere o arquivo (e falha se algo apontar para a produção).

## Rodar a suíte inteira (um de cada vez)

```
pnpm test
pnpm test:rls
pnpm exec playwright test --project=android
pnpm exec playwright test --project=iphone
pnpm exec playwright test --project=celular-390
pnpm lint
pnpm build
```

O Playwright sobe sozinho um `pnpm dev` na porta 3210 com as variáveis do `.env.test.local` e `IA_SIMULADA=1`. Se já houver um servidor aberto nessa porta, ele precisa ter sido aberto com esse mesmo ambiente; senão o teste recusa.

## Quando o projeto de testes cai atrás da produção

Depois de qualquer migration nova na produção: `pnpm testes:ambiente` (aplica as pendentes no projeto de testes) e só então rode os testes.
