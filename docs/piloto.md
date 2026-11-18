# Roteiro do piloto (quinta, 19/11/2026)

Participam **Aline e Kely**, com **clientes de verdade**. No piloto elas entram com as **contas de teste delas** (`+aline` e `+kely`, com senha nova, trocada no primeiro login). Os orçamentos criados por essas contas a partir de 19/11 00:00 ficam marcados como **piloto**: contam nos números e o go-live **não os apaga** (vão para as contas reais no dia 24, ver `docs/go-live.md`). Só o que é de teste (cliente "TESTE...", os orçamentos do seed) sai.

## Antes (quarta, 18/11)

- As contas reais **não** são criadas agora (ficam para o go-live). Passar para a Aline e para a Kely a senha nova da conta de teste delas; no primeiro login elas escolhem a própria senha.
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
- **Resumo do dia**: `pnpm piloto:resumo` (ou a aba **Resumo do dia** em Relatos). Por vendedora: orçamentos criados, gerados e enviados; **mediana do tempo do rascunho até gerar**; itens por origem (manual, lista colada, Indicação da IA, montagem da IA; o kit de fita conta como manual); relatos abertos com o texto; erros do dia; custo de IA do dia. Orçamentos de teste ficam fora, o piloto entra.
- Olhar no resumo: mediana acima de 15 a 20 minutos (algo atrapalha), muitos itens avulsos (falta produto no catálogo), erros do dia, relatos abertos e custo de IA fora do normal.
- Perguntas para Aline e Kely: o que atrapalhou? o que faltou? o guia ajudou?
- `pnpm deploy:conferir` e `pnpm golive:limpar --simular` (para ver o que ainda é de teste).

## Depois do piloto

23/11: carga do **estoque real** e ajustes do piloto. 24/11: go-live (limpeza dos testes, troca das senhas e conferência final).

## Se o sistema cair no meio do atendimento

1. Não espere nem insista: volte para a planilha antiga e siga atendendo o cliente normalmente.
2. Anote o orçamento na planilha (cliente, produtos, valores) como sempre foi feito.
3. Avise o Caio por WhatsApp ("sistema fora"), com a hora e o que a tela mostrou.
4. Quando o sistema voltar, registre depois os orçamentos que ficaram na planilha. Nada se perde: a planilha é a fonte até lá.
5. Orçamento já enviado ao cliente continua valendo; o PDF enviado não depende do sistema.
