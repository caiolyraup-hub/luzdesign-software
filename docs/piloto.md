# Roteiro do piloto (quinta, 19/11/2026)

Participam **Aline e Kely**, com **clientes de verdade**. Os orçamentos criados no piloto são reais e **ficam** (não serão apagados no go-live). Só o que é de teste (cliente "TESTE...", os orçamentos do seed) sai no dia 24.

## Antes (quarta, 18/11)

- Criar as contas reais: preencher `REAL_EMAIL_*` no `.env.local` e rodar `pnpm usuarios:reais --criar` (mostra a senha provisória de cada pessoa uma vez só; todas trocam a senha no primeiro login).
- Entregar o **guia** (`dados/guia-vendedora.pdf`) e abrir o sistema no celular de cada uma.
- Conferir `pnpm deploy:conferir` (o que está no ar é o commit mais novo).
- Lembrar: o catálogo ainda é **provisório** (158 produtos vindos de orçamentos antigos). Se um produto não existir, use **item avulso** com preço manual e **relate**.

## O que cada uma faz no dia

1. **2 ou 3 orçamentos reais** por pessoa; **pelo menos um com arquiteto** do cadastro (ou cadastrando um novo).
2. Usar de verdade: achar produtos pelo código, **Colar lista** quando o arquiteto mandar lista, a **Indicação da IA** em pelo menos um ambiente, baixar o PDF e mandar pelo WhatsApp, marcar enviado.
3. Se der tempo: um follow-up, uma renovação de validade e marcar um fechamento ou perda.
4. Anotar o **tempo** que levou para montar cada orçamento (do "Novo orçamento" ao "Gerar").

## O que observar

- Falta produto no catálogo? Descrição estranha ou repetida? (relatar)
- Alguma tela demora, trava ou mostra mensagem esquisita? (relatar)
- O PDF está como a loja quer? (nome do arquiteto, endereço, rodapé, validade)
- Os números de **Números** batem com o que ela espera?

## Como relatar

Em qualquer tela, **Relatar problema** (menu): escrever o que aconteceu; a tela atual vai junto; foto opcional. Não precisa mandar print por WhatsApp.

## O que conferir no fim do dia (gerência e Caio)

- **Relatos** em aberto: resolver ou anotar em `docs/pendencias.md`.
- **Erros de hoje** em Ajustes (e a tabela `erros_app`): algum erro de servidor?
- Orçamentos criados (Equipe): quantos, quantos gerados e enviados.
- **Tempo médio para montar** um orçamento: do evento de criação ao "gerado" (campos `criado_em` e `gerado_em` dos orçamentos do dia).
- Perguntas para Aline e Kely: o que atrapalhou? o que faltou? o guia ajudou?
- `pnpm deploy:conferir` e `pnpm golive:limpar --simular` (para ver o que ainda é de teste).

## Depois do piloto

23/11: carga do **estoque real** e ajustes do piloto. 24/11: go-live (limpeza dos testes, troca das senhas e conferência final).
