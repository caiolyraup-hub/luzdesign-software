# Métricas (dia 9)

Respondem à pergunta que motivou o projeto: **quanto cada vendedora converte, vende e deixa de vender**. O cálculo é feito no banco (função `metricas_orcamentos`, `security invoker`), então a RLS vale: a vendedora recebe só a própria linha, mesmo passando o id de outra; a gerente recebe todas.

## Período

Datas de calendário **de Maceió** (`America/Maceio`, UTC-3), início e fim **inclusivos**. Um instante conta no período se, convertido para Maceió, cai entre as duas datas (às 23h30 de 30/11 em Maceió é 02h30 de 01/12 em UTC, e conta em novembro). Padrão: mês atual; opções: mês passado, últimos 90 dias (hoje e os 89 dias anteriores) e intervalo personalizado (início ≤ fim, no máximo 366 dias).

## O que fica de fora: orçamentos de teste

Um único lugar decide: a função SQL `orcamento_eh_teste(respostas, cliente_id)` e a view `orcamentos_reais` (a view é `security_invoker`, então a RLS continua valendo). É teste quando:

- `respostas.teste = true` (seed) ou `respostas.teste_rls = "true"` (scripts de RLS), ou
- o nome do cliente começa com a palavra **TESTE** (sem diferenciar maiúsculas; "TESTE FOLLOWUP E2E 123" é teste, "Testelli Ltda" não).

Todas as métricas, a série semanal, o uso da Indicação e o custo de IA usam `orcamentos_reais`. As listas, quando abertas por um número do painel (com período na URL), também escondem os de teste, para a contagem bater.

## Métricas

| Métrica                     | Definição                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Criados                     | `criado_em` no período (inclui rascunhos)                                                                                                                                                                           |
| Gerados                     | `gerado_em` no período                                                                                                                                                                                              |
| Enviados                    | `enviado_em` no período. É o **primeiro** envio: reenviar uma nova versão não conta de novo                                                                                                                         |
| Fechados / vendido          | `fechado_em` no período; vendido = soma de `valor_fechado`                                                                                                                                                          |
| Perdidos / deixou de vender | `perdido_em` no período; valor = soma de `valor_total`; também por motivo                                                                                                                                           |
| Conversão (quantidade)      | Da **safra** (orçamentos com `enviado_em` no período): fechados ÷ (fechados + perdidos), pelo status de **hoje**. Mostra também quantos da safra ainda estão em andamento                                           |
| Conversão (valor)           | Da mesma safra: soma de `valor_fechado` dos fechados ÷ soma de `valor_total` dos que já fecharam ou perderam                                                                                                        |
| Em aberto (agora)           | Status `enviado`, `followup_d5` ou `followup_d10` hoje, sem filtro de período; quantidade e soma de `valor_total`                                                                                                   |
| Ticket médio                | vendido ÷ fechados do período                                                                                                                                                                                       |
| Tempo até fechar            | Mediana de dias (corridos, calendário de Maceió) entre `enviado_em` e `fechado_em`, dos fechados no período que têm `enviado_em`                                                                                    |
| Follow-ups vencidos         | Agora, com a regra do dia 8 (`src/lib/orcamento/followup.ts`, a partir de `ultimo_envio_em`), calculado no servidor                                                                                                 |
| Uso da Indicação            | Indicações pedidas no período (`indicacoes_ia.criado_em`) e, dos itens dos orçamentos **gerados no período**, a % com `origem = indicacao_ia` e a % com `origem = lista_colada`                                     |
| Custo de IA (só gerente)    | Soma de `uso_ia.custo_estimado` (status `ok`) no período, em US$ e em R$ (câmbio de `configuracoes_loja.cambio_usd_brl`), por tipo (Indicação, padronização, outros) e médio por orçamento gerado. É **estimativa** |

Série semanal: últimas 13 semanas (segunda a domingo, Maceió) terminando na semana do fim do período escolhido (hoje, no padrão): enviados, fechados e valor vendido, por vendedora.

## Decisões para os dados ambíguos

1. **Fechado sem `enviado_em`** (fechou direto de `gerado`): conta em Fechados e em Vendido, mas **não entra na safra** (não há data de envio) nem no tempo até fechar.
2. **Reaberto** (fechado/perdido volta para enviado): o banco limpa `fechado_em`/`perdido_em` (e o valor/motivo), então deixa de contar como fechado/perdido; volta a contar em Em aberto. `enviado_em` continua o do primeiro envio.
3. **Nova versão** (`reabrir_para_edicao`): volta para `gerado` mantendo `enviado_em`. Na safra, status `gerado` conta como **em andamento**; fora da safra, não conta em Em aberto (só enviado e follow-ups contam).
4. **Conversão sem resolvidos** (ninguém fechou nem perdeu na safra): mostra "—", não 0%.
5. **Custo de IA de orçamento apagado** (`orcamento_id` nulo): conta, porque o dinheiro foi gasto. Custo ligado a orçamento de teste não conta.
6. **Safra por status de hoje**: a conversão de um mês pode subir depois, quando os "em andamento" se resolvem. Por isso a tela mostra a quantidade em andamento junto.
7. **Valor fechado ausente** (não deveria ocorrer; o banco exige valor ao fechar): usa `valor_total`.

## Vencidos (dia 10B)

Orçamento com validade vencida **não muda nenhuma métrica** acima (continua em "Em aberto" e na conversão pelo status). O único número novo é o contador **Vencidos sem renovação** por vendedora, na tela Equipe: orçamentos em `gerado`, `enviado` ou follow-up com `validade < hoje` (Maceió), sem os de teste (view `orcamentos_reais`). A regra é a de `docs/arquitetura.md` (Validade vencida).
