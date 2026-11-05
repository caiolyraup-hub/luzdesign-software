# Luz Design Orçamentos

Sistema web em que as vendedoras de uma loja de iluminação em Maceió criam orçamentos com IA e registram o status de cada um, e a gerência acompanha a conversão de cada vendedora. Entrega final: 24/11/2026. Plano em `docs/plano.md`.

## Produto

- Usuários: **Aline** e **Kely** (perfil `vendedora`) e **Gerência** (perfil `gerente`). Cada vendedora só vê os próprios orçamentos e números. A gerente vê todas.
- Criação do orçamento: a vendedora responde **10 perguntas** (`docs/perguntas.md`) e envia **até 4 anexos** (foto, PDF, planta, print). A IA (**OpenAI GPT 5.6**) monta os itens por ambiente usando o catálogo do estoque. A vendedora revisa e gera um PDF com o design da loja.
- Status: Rascunho → Gerado → Enviado → Follow-up D+5 → Follow-up D+10 → Fechado | Perdido. Ao marcar Perdido, o motivo é obrigatório: preço, prazo/pronta-entrega, comprou em outra loja, desistiu ou sem resposta.
- Métricas por vendedora: criados, enviados, conversão em quantidade e em valor, valor vendido, valor que deixou de vender (soma dos perdidos, por motivo), valor em aberto, ticket médio e tempo até fechar.
- Catálogo: vem do controle de estoque da loja (sistema ainda não identificado). A versão 1 importa planilha XLSX/CSV com mapeamento de colunas salvo.
- Rodapé padrão do orçamento: 10% de desconto à vista, validade de 7 dias, prazo de 30 a 45 dias úteis após o pagamento, sem troca de encomenda, mercadoria frágil.

## Regra central da IA

A IA só escolhe **códigos de produto e quantidades**. O servidor aplica o preço do catálogo e calcula os totais. Preço e descrição ficam congelados no item quando o PDF é gerado. Item sem código vira "item avulso", com preço manual. Nunca confie em preço, descrição ou total vindos da IA.

## Stack

Next.js (App Router) + TypeScript strict + Tailwind CSS (Vercel); Supabase (Postgres com RLS, Auth, Storage, cron); OpenAI SDK (só no servidor); pnpm, ESLint, Prettier, Vitest.

Comandos: `pnpm dev`, `pnpm lint`, `pnpm build`, `pnpm test` (rápido, sem rede), `pnpm test:rls` (isolamento no Supabase real), `pnpm test:e2e` (Playwright, celular 390 px), `pnpm format`.

## Convenções

- Código e nomes de tabelas/colunas em português sem acento (`orcamentos`, `orcamento_itens`, `produtos`, `vendedora_id`).
- Textos de interface em português do Brasil (com acentos).
- Mobile-first, fonte mínima de 16 px, barra de navegação inferior no celular.
- Nenhuma chave de API no cliente. `OPENAI_API_KEY` e `SUPABASE_SERVICE_ROLE_KEY` só existem no servidor; só `NEXT_PUBLIC_*` pode ir ao navegador.
- Não invente dados de produtos.
- Tipos de domínio em `src/lib/dominio.ts`.
- O Next.js desta versão tem mudanças em relação ao que se conhece: consulte `node_modules/next/dist/docs/` antes de usar APIs novas (ver `AGENTS.md`).

## Segurança

O isolamento entre vendedoras é feito **no banco, com RLS por `vendedora_id`**, nunca só na tela. Filtrar na interface não conta como proteção. Todo acesso do cliente passa por políticas RLS; a service role só é usada em código de servidor que realmente precise ignorá-las.
