# Prompt do dia 9 (11/11/2026): painéis da vendedora e da gerência, e atalhos da seleção manual

Mande para o Claude Code: **"Leia docs/prompts/dia-09-paineis-atalhos.md e execute tudo."**

---

Hoje é o **dia 9 de 14** do projeto Luz Design Orçamentos (no plano, 16/11; estamos adiantados). Leia o `CLAUDE.md` e os arquivos em `docs/`. O dia 8 está no ar (commits c09b490 e 91ba7ec): a vendedora escolhe os produtos à mão (busca, Colar lista), pede a **Indicação da IA**, gera o orçamento em PDF e XLSX, marca o envio com data, e os follow-ups D+5/D+10 aparecem em "Para hoje".

**Objetivo de hoje:** responder à pergunta que motivou o projeto: **quanto cada vendedora converte, vende e deixa de vender**. A tela **Números** (`/meus-numeros`, hoje um placeholder) vira o painel da vendedora, e a **Equipe** (`/gerencia`) ganha o painel da gerência. Em segundo lugar, deixar a seleção à mão mais rápida, com 3 atalhos sem IA.

Faça em duas partes, com um commit e um deploy ao fim de cada uma. **A parte A (painéis) tem prioridade.**

## Regras (não mude)

- **O isolamento vale nos números também.** Aline só vê os números dela, mesmo chamando a função ou a API direto. Use a mesma RLS de sempre (função SQL `security invoker`), nunca um filtro só na tela.
- A vendedora **não** vê custo de IA (ela não lê `uso_ia`). Custo só aparece para a gerente.
- **Os orçamentos de teste ficam fora dos números**: os do seed (`respostas.teste = true`) e qualquer um com cliente "TESTE". Deixe essa regra em um lugar só (uma função ou view) e documente.
- Valem as regras do `CLAUDE.md`: RLS, service role só no servidor, `<Suspense>` no Next 16, português, mobile-first com fonte mínima de 16 px, fuso `America/Maceio`.

---

## Parte A: painéis

### A1. Definição das métricas (escreva em `docs/metricas.md` antes de codar)

Para um período (padrão: **mês atual**; opções: mês anterior, últimos 90 dias e intervalo personalizado) e uma vendedora (ou todas, para a gerente):

| Métrica                  | Definição                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Criados                  | orçamentos com `criado_em` no período (inclui rascunhos)                                                                                                                       |
| Gerados                  | `gerado_em` no período                                                                                                                                                         |
| Enviados                 | `enviado_em` (o **primeiro** envio) no período                                                                                                                                 |
| Fechados / valor vendido | `fechado_em` no período; valor = soma de `valor_fechado`                                                                                                                       |
| Perdidos / valor perdido | `perdido_em` no período; valor = soma de `valor_total`, também separado **por motivo**                                                                                         |
| Conversão (quantidade)   | dos orçamentos **enviados no período**: fechados ÷ (fechados + perdidos). Mostre junto quantos dessa safra ainda estão em andamento, para não parecer pior ou melhor do que é  |
| Conversão (valor)        | da mesma safra: soma de `valor_fechado` ÷ soma de `valor_total` dos que já fecharam ou perderam                                                                                |
| Em aberto (agora)        | status `enviado`, `followup_d5` ou `followup_d10`, hoje, sem filtro de período; quantidade e soma de `valor_total`                                                             |
| Ticket médio             | valor vendido ÷ fechados do período                                                                                                                                            |
| Tempo até fechar         | mediana de dias entre `enviado_em` e `fechado_em`, dos fechados no período                                                                                                     |
| Follow-ups vencidos      | agora, com a mesma regra do dia 8 (`src/lib/orcamento/followup.ts`)                                                                                                            |
| Uso da Indicação da IA   | indicações pedidas no período (`indicacoes_ia`) e % dos itens dos orçamentos gerados no período com `origem = indicacao_ia`; também % com `lista_colada`                       |
| Custo de IA (só gerente) | soma de `uso_ia.custo_estimado` no período, em US$ e em R$ (câmbio de `configuracoes_loja`, ver A4), separado em Indicação e padronização de descrições se o registro permitir |

Se alguma definição esbarrar em um dado que não existe ou é ambíguo (por exemplo, orçamento fechado sem `enviado_em`), decida o mais simples, escreva a regra no `docs/metricas.md` e me conte no relatório.

### A2. Cálculo no banco

- Por migration, uma função `metricas_orcamentos(p_inicio date, p_fim date, p_vendedora uuid default null)` em SQL, **security invoker**, que devolve um jsonb com os números da tabela acima por vendedora (e o total). Com a RLS, a vendedora recebe só a própria linha, mesmo passando outro id. O custo de IA vem de uma função separada, que só a gerente consegue executar.
- Uma série **semanal** dos últimos 3 meses (enviados, fechados, valor vendido), para o gráfico.
- Índices necessários para isso não ficar lento com alguns milhares de orçamentos (confira o plano com `explain`).
- Testes de SQL (PGlite, como nos dias anteriores) com um conjunto pequeno montado à mão, em que você sabe o resultado de cada métrica, incluindo os casos: safra com orçamento em andamento, perdido por motivos diferentes, reaberto, orçamento de teste (precisa ficar fora) e virada de mês no fuso de Maceió.

### A3. Tela da vendedora (`/meus-numeros`)

- No topo, o seletor de período (cards de tocar: Este mês, Mês passado, 90 dias, Personalizado).
- Cartões grandes: **Vendido** (R$), **Conversão** (% em quantidade, com o valor logo abaixo), **Em aberto** (R$ e quantidade), **Deixou de vender** (R$).
- **Funil** do período: criados → gerados → enviados → fechados, com as quantidades.
- **Por que perdi**: barras por motivo (quantidade e R$).
- Ticket médio, tempo até fechar e follow-ups vencidos (que leva para "Para hoje").
- Uma linha de uso: "Indicação da IA: N pedidos, X% dos itens".
- Cada número leva para a lista de orçamentos já filtrada (por exemplo, tocar em Perdidos abre `/orcamentos` com o filtro Perdido e o período). Se a lista ainda não aceitar período na URL, acrescente.
- Sem dados no período: uma mensagem simples, sem gráfico vazio.

### A4. Painel da gerência (`/gerencia`)

- Acima da lista atual de orçamentos (que continua igual), o painel com o mesmo seletor de período e:
  - uma **tabela comparativa por vendedora**: enviados, fechados, conversão (qtd e valor), vendido, deixou de vender, em aberto, ticket médio, tempo até fechar e follow-ups vencidos, com a linha de total;
  - o **gráfico semanal** (enviados e fechados) com as duas vendedoras;
  - **perdido por motivo**, por vendedora;
  - **uso da IA**: indicações pedidas, % de itens com origem `indicacao_ia`, custo no período em US$ e em R$ e custo médio por orçamento gerado.
- Câmbio: por migration, `cambio_usd_brl` em `configuracoes_loja` (padrão 5,50, editável pela gerente em Ajustes, com o aviso de que é estimativa).
- Tocar no nome de uma vendedora filtra a lista abaixo por ela (o filtro `vendedora` já existe).
- Gráficos leves: SVG ou CSS feitos à mão, sem biblioteca pesada. Cores com bom contraste, a cor cobre `#9F5F47` como destaque e legível no celular.

### A5. Testes e commit da parte A

- Unitários das funções de período (início e fim no fuso de Maceió, mês passado em janeiro, intervalo personalizado inválido).
- `pnpm test:rls`: Aline chamando `metricas_orcamentos` com o id da Kely recebe só os dados dela (ou nada da Kely); a vendedora não executa a função de custo; a gerente recebe as duas vendedoras; orçamentos de teste não entram.
- `pnpm test:e2e` (390 px): Aline abre Números e vê os cartões; a gerente abre Equipe e vê a tabela comparativa; tocar em Perdidos abre a lista filtrada.
- Mostre os números reais de hoje no banco de testes (provavelmente quase tudo zero, por causa da regra dos testes) e os números do conjunto de teste do PGlite.
- `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar. Aplique as migrations no remoto, faça o commit `feat: painéis da vendedora e da gerência (dia 9A)`, o push, e confira o deploy.

---

## Parte B: atalhos da seleção manual (sem IA)

Na tela **Produtos do orçamento** (`/orcamentos/[id]/revisao`):

### B1. Kit de fita LED

- Botão **Adicionar kit de fita** em cada ambiente. A vendedora informa os **metros** e escolhe a **fita** pela busca (já filtrada pela categoria de fita).
- O sistema calcula e mostra uma prévia, que ela confirma ou ajusta antes de adicionar:
  - **fita:** a metragem (unidade `m`, 2 casas) ou o número de rolos, conforme a unidade do produto;
  - **perfil** (opcional, ligado por padrão): busca filtrada por perfil; quantidade pela metragem (em `m`) ou por barras, arredondando para cima, se o comprimento da barra existir nos atributos ou na descrição;
  - **fonte:** potência necessária = W/m da fita × metros × 1,2 de margem, e a sugestão da **menor fonte do catálogo com a mesma tensão e potência suficiente**. Se a carga passar da maior fonte, divida em mais fontes.
- Tire potência, tensão e comprimento dos `atributos` do produto e, se não houver, da descrição, com um parser testado. Se não der para saber, **não chute**: peça para a vendedora escolher a fonte e diga o que faltou.
- Use o padrão perfil + fita + fonte que o dia 7 observou nos 37 orçamentos (está em `src/lib/ia/instrucoes*.ts` ou no relatório do dia 7) para conferir a regra.
- Testes unitários do cálculo (fita 12 V e 24 V, metragem quebrada, carga que pede 2 fontes e produto sem dado de potência).

### B2. Mais usados

- Com a busca vazia, mostre **Seus mais usados**: os 12 códigos que **a própria vendedora** mais colocou em orçamentos nos últimos 90 dias (pela RLS), com preço atual e um toque para adicionar. Sem histórico, mostre os produtos com mais estoque da categoria mais buscada, ou nada.

### B3. Duplicar ambiente

- Nas ações do ambiente, **Duplicar ambiente** pede o novo nome (sugestão: "Quarto 2" a partir de "Quarto 1" ou "Quarto") e copia os itens com as quantidades, **relendo o preço atual do catálogo** (avulso copia o preço manual).
- Respeita o bloqueio de edição a partir de `enviado`.

### B4. Testes e commit da parte B

- `pnpm test:e2e` (390 px): adicionar um kit de 5 m e conferir os 3 itens; duplicar o ambiente e conferir o total; ver os mais usados depois de ter adicionado produtos.
- Atualize `docs/arquitetura.md`, `docs/modelo-de-dados.md` e `docs/plano.md` (dia 9 concluído). Gere de novo o `dados/exemplo-orcamento.pdf` e o `.xlsx` só se algo neles mudou.
- `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar. Faça o commit `feat: atalhos de seleção: kit de fita, mais usados e duplicar ambiente (dia 9B)`, o push, e confira o deploy.

## Fora do escopo de hoje

Exportação geral em planilha, histórico do cliente, vencimento da validade e busca/filtros novos na lista (dia 10); metas de venda por vendedora; notificação por e-mail ou push. Não apague os 4 orçamentos TESTE do seed nem o 2026-0005.

Ao terminar, me mostre: o `docs/metricas.md` (e as decisões que você tomou nas definições), prints ou a descrição dos dois painéis no celular, os números do conjunto de teste, a saída do `test:rls` sobre o isolamento dos números, um exemplo de kit de fita calculado com o catálogo provisório, a saída dos testes e qualquer pendência.
