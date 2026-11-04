# Arquitetura

## Stack

- **Next.js (App Router) + TypeScript strict + Tailwind CSS**, hospedado na Vercel.
- **Supabase**: Postgres com Row Level Security, Auth, Storage (anexos e PDFs) e cron (vencimento e lembretes).
- **OpenAI GPT 5.6** via SDK, apenas no servidor (`OPENAI_MODEL`).
- pnpm, ESLint, Prettier, Vitest.

## Fluxo de criação do orçamento (6 passos)

1. **Perguntas**: a vendedora responde as 10 perguntas (`docs/perguntas.md`). As respostas ficam em `orcamentos.respostas` (jsonb).
2. **Anexos**: envia até 4 arquivos (foto, PDF, planta, print) para o Storage; registro em `anexos`.
3. **Montagem pela IA**: o servidor busca candidatos no catálogo e pede ao GPT 5.6 itens por ambiente. A IA devolve **somente códigos e quantidades**; o que não tem código vira item avulso.
4. **Cálculo no servidor**: o servidor aplica o preço do catálogo e calcula os totais. Nada de preço vindo da IA. Uso registrado em `uso_ia`.
5. **Revisão**: a vendedora ajusta itens, quantidades e ambientes, e preenche o preço dos itens avulsos.
6. **PDF**: ao gerar, descrição e preço são congelados em `orcamento_itens`; o status passa a Gerado e o PDF sai com o design da loja e o rodapé padrão.

Depois: Enviado → Follow-up D+5 → Follow-up D+10 → Fechado | Perdido (motivo obrigatório). Cada mudança de status grava um registro em `eventos`.

## Perfis e isolamento

- `vendedora` (Aline, Kely): vê e edita só os próprios orçamentos, os clientes ligados a eles e os números próprios.
- `gerente`: leitura de todas as vendedoras, painel, estoque e configurações.
- O isolamento é feito **no banco** com RLS por `vendedora_id` (`auth.uid()` e perfil em `usuarios`). A tela nunca é a única barreira. Testes de isolamento entram em 18/11.
- Chaves: só `NEXT_PUBLIC_*` no cliente; service role e OpenAI apenas em código de servidor.

## Conector de estoque

O sistema de estoque da loja ainda não foi identificado. A versão 1 importa planilha XLSX/CSV:

- a gerência envia o arquivo em `/gerencia/estoque`;
- o mapeamento de colunas (coluna da planilha → campo de `produtos`) é salvo e reutilizado;
- cada importação gera um registro em `sync_estoque` (linhas lidas/gravadas, erros);
- `produtos` é atualizado por `codigo` (upsert); estoque desconhecido fica nulo.

Manter a importação atrás de uma interface permite trocar a origem depois (API ou banco do sistema da loja) sem mexer no resto.
