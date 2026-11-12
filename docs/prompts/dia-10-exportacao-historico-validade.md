# Prompt do dia 10 (12/11/2026): exportação para a gerência, histórico do cliente, validade vencida e busca na lista

Mande para o Claude Code: **"Leia docs/prompts/dia-10-exportacao-historico-validade.md e execute tudo."**

---

Hoje é o **dia 10 de 14** do projeto Luz Design Orçamentos (no plano, 17/11; estamos 3 dias úteis adiantados). Leia o `CLAUDE.md` e os arquivos em `docs/`, principalmente `docs/metricas.md` e `docs/plano.md`. Os dias 1 a 9 estão no ar (último commit 34ec914): seleção manual, Indicação da IA, PDF e XLSX, envio com data, follow-ups, painéis e atalhos.

**Objetivo de hoje:** deixar o sistema pronto para o **uso diário de verdade**: a gerência exporta tudo em planilha (a cláusula 7.3 do contrato diz que os dados são exportáveis), a vendedora acha qualquer orçamento rápido e vê o histórico do cliente, e orçamento com validade vencida é avisado e renovado sem refazer nada.

Faça em três partes, com um commit e um deploy ao fim de cada uma. Ordem de prioridade: **A (busca e filtros), B (validade), C (exportação), D (histórico do cliente)**. Mas entregue na ordem do texto abaixo, porque a B e a C usam o que a A cria. Se o dia apertar, diga no relatório o que ficou faltando.

## Regras (não mude)

- **RLS em tudo.** Aline só enxerga os próprios orçamentos e clientes, inclusive na exportação, na busca e no histórico. Nada de filtro só na tela.
- Preço continua vindo de `produtos` e congelado ao gerar. Renovar validade **nunca** altera preço sem a vendedora ver e aceitar.
- Orçamentos de teste (`orcamento_eh_teste`) ficam fora dos números e, por padrão, também da exportação. Reaproveite a view `orcamentos_reais`.
- Valem as regras do `CLAUDE.md`: RLS, service role só no servidor, `<Suspense>` no Next 16, português, mobile-first com fonte mínima de 16 px, fuso `America/Maceio`.
- Não apague os 4 orçamentos TESTE do seed nem o 2026-0005.

---

## Parte A: busca e filtros na lista de orçamentos

A lista `/orcamentos` hoje filtra por status e por período vindo dos painéis. Amplie:

- **Busca por texto** (um campo no topo): número do orçamento, nome do cliente, WhatsApp (só dígitos), nome do arquiteto e **código ou descrição de produto** (acha os orçamentos que contêm aquele item). Faça no servidor, com índice adequado (`pg_trgm` ou equivalente para nome; confira com `explain` que não vira varredura completa), e não sobrecarregue o celular.
- **Filtros** em uma gaveta que abre por baixo ("Filtrar"): status (o que já existe), período (por data de criação, envio ou fechamento), faixa de valor, tipo de cliente, "tem arquiteto", motivo de perda, **validade** (vigente, vence em até 2 dias, vencida) e, só para a gerente, vendedora. Os filtros ativos aparecem como chips que se removem com um toque.
- **Ordenação:** mais recentes (padrão), maior valor, validade mais próxima, cliente de A a Z.
- **Paginação** de 20 em 20 com "Ver mais" (cursor, não offset), e a contagem total do filtro no topo.
- Tudo na URL (`?q=...&status=...`), para a vendedora poder voltar com o botão do celular e compartilhar o filtro com a gerente.
- A tela da gerência (`/gerencia`) usa os mesmos componentes e o filtro `vendedora` que já existe.
- Testes: unitários da montagem do filtro (a partir dos parâmetros da URL, com valores inválidos ignorados), SQL (PGlite) da busca por código de produto e por WhatsApp parcial, e `test:rls` de que a busca da Aline nunca devolve orçamento da Kely, mesmo com o nome do cliente igual.

Commit: `feat: busca e filtros na lista de orçamentos (dia 10A)` e deploy.

---

## Parte B: validade vencida e renovação

Hoje `orcamentos.validade` é gravada ao gerar (hoje + `validade_dias`) e só aparece em texto.

- **Vencido é calculado, não é um status novo.** Um orçamento está vencido quando `validade < hoje` (em Maceió) e o status é `gerado`, `enviado`, `followup_d5` ou `followup_d10`. Fechado, perdido e rascunho nunca são vencidos. Escreva a regra em **uma só função** (TypeScript e a mesma regra em SQL, com teste de que as duas concordam) e use em todo lugar.
- **Avisos:**
  - na lista e no cartão do orçamento, uma etiqueta "Vencido há N dias" (ou "Vence amanhã" e "Vence hoje" em âmbar);
  - em "Para hoje" (`/`), uma seção **Para renovar** com os orçamentos vencidos ou que vencem em até 1 dia, do mais antigo ao mais novo, cada um com **Renovar** e **WhatsApp**; o badge da navegação soma os follow-ups vencidos e esses;
  - na tela do orçamento vencido, a mensagem "Os preços e a validade expiraram em DD/MM. Renove para mandar de novo".
  - Os follow-ups D+5 e D+10 continuam funcionando em orçamento vencido (o aviso de vencimento não os substitui).
- **Renovar validade** (botão na tela do orçamento e no cartão): decida o fluxo mais simples que cumpra isto e documente em `docs/arquitetura.md`:
  1. A vendedora toca em **Renovar**; o sistema compara o preço congelado de cada item com o preço **atual** do catálogo e mostra a lista das diferenças (item, preço antigo, preço novo, diferença em R$ e em %), mais itens que ficaram inativos ou sem estoque.
  2. Ela escolhe **Atualizar preços e renovar** ou **Manter os preços antigos e renovar** (este mostra o aviso "Estes preços podem estar defasados" e só vale para itens que ainda existem; item inativo precisa ser trocado ou removido antes).
  3. O sistema gera uma **nova versão** (PDF e XLSX, `pdf_versao + 1`) com `validade = hoje + validade_dias`, mantém as versões antigas e registra o evento "validade renovada" na linha do tempo. O status volta para `gerado` pelo mesmo caminho do "Editar e enviar nova versão" do dia 8B; ao marcar enviado de novo, só `ultimo_envio_em` muda e os follow-ups recomeçam dali.
  4. Quem pode: a dona e a gerente (como nas outras ações de status).
- **Gerência:** em `/gerencia`, o contador "Vencidos sem renovação" por vendedora.
- **Configuração:** a gerente edita `validade_dias` em Ajustes (já existe). O aviso "vence amanhã" usa 1 dia, sem configuração nova.
- Testes: unitários da regra de vencimento (virada de dia no fuso de Maceió, fechado nunca vence, rascunho sem validade), SQL do renovar (preços atualizados vs. mantidos, item inativo bloqueia, versão nova, evento gravado), `test:rls` (Aline não renova orçamento da Kely), e2e em 390 px: gerar, forçar a validade para ontem pelo banco do teste, ver "Vencido", renovar atualizando um preço alterado no catálogo, baixar o PDF e conferir a nova validade e o preço.

Commit: `feat: validade vencida e renovação com nova versão (dia 10B)` e deploy.

---

## Parte C: exportação em planilha

Cláusula 7.3 do contrato: o dado é da loja e precisa sair em planilha. Reaproveite `src/lib/planilha/` e o `exceljs`.

- **Gerente:** em `/gerencia`, o botão **Exportar planilha** com os mesmos filtros da lista (período, vendedora, status) e a opção **Incluir orçamentos de teste** (desligada). **Vendedora:** o mesmo botão em `/orcamentos`, exportando só os próprios (a RLS decide; não crie um segundo caminho de acesso).
- Arquivo `luz-design-orcamentos AAAA-MM-DD.xlsx` com as abas:
  1. **Resumo:** período, filtros usados, data da exportação, quem exportou, totais (quantidade, valor, vendido, perdido, em aberto) e a tabela por vendedora do painel (gerente).
  2. **Orçamentos:** uma linha por orçamento: número, vendedora, cliente, WhatsApp, tipo de cliente, arquiteto, status, valor total, valor fechado, motivo da perda, criado, gerado, enviado (primeiro), último envio, fechado, perdido, validade, vencido (sim/não), versão do PDF.
  3. **Itens:** uma linha por item: número do orçamento, ambiente, código, descrição, quantidade, unidade, preço unitário, total do item, avulso (sim/não), origem (manual, lista colada, indicação da IA, montagem antiga).
  4. **Clientes:** cliente, WhatsApp, tipo, arquiteto, quantidade de orçamentos, enviados, fechados, valor vendido e data do último orçamento.
  5. **Eventos** (só gerente): histórico de status com data e quem mudou.
- Formato: cabeçalho na cor cobre `#9F5F47`, filtro automático e painel congelado em cada aba, datas como data do Excel (`dd/mm/aaaa hh:mm`, Maceió), valores como número com formato R$ (nunca texto), larguras boas, WhatsApp como texto.
- **Volume:** gere por streaming (`exceljs` em modo de escrita contínua) e leia do banco em lotes, para uma exportação com milhares de orçamentos não estourar a memória nem o tempo da função na Vercel. Teste com 5.000 orçamentos e 30.000 itens sintéticos (no teste local, sem tocar no banco real) e me diga o tempo e o tamanho.
- A exportação é uma rota de servidor autenticada (não um arquivo público no Storage) e registra em `eventos_exportacao` (quem, quando, filtros, quantidade de linhas) para auditoria, com RLS: a gerente lê tudo, a vendedora só as próprias; o registro é gravado só pelo servidor.
- Testes: abrir o XLSX gerado com o `exceljs` e conferir abas, cabeçalhos, número de linhas e totais contra o banco de teste; `test:rls` (a exportação da Aline nunca contém dado da Kely; a vendedora não lê a aba Eventos; teste fica fora por padrão e entra com a opção).

Commit: `feat: exportação da base em planilha (dia 10C)` e deploy.

---

## Parte D: histórico do cliente

- **Lista de clientes** (`/clientes`, novo item "Clientes" dentro de Produtos/Orçamentos na navegação, sem tirar nenhum botão principal): busca por nome ou WhatsApp, e para cada cliente a quantidade de orçamentos, o valor vendido e a data do último. A vendedora vê os próprios clientes; a gerente vê todos e filtra por vendedora.
- **Ficha do cliente** (`/clientes/[id]`): nome, WhatsApp com **Abrir WhatsApp**, tipo, arquiteto indicador, resumo (orçamentos, fechados, perdidos, vendido, ticket médio) e a **lista de todos os orçamentos dele**, cada um com status, valor, validade e atalho para abrir; botão **Novo orçamento para este cliente**, que cria o rascunho já com nome, WhatsApp, tipo e arquiteto preenchidos (pula as perguntas 1 a 3).
- **Notas do cliente:** um campo de texto curto, editável pela dona do cliente (ex.: "prefere fita 3000 K, obra termina em dezembro"). Por migration, coluna `observacoes` em `clientes`, com a RLS já existente, e nunca enviada à OpenAI.
- **No formulário:** quando a pergunta 2 achar cliente já cadastrado, mostre uma linha com o histórico dele ("3 orçamentos, 1 fechado, último em 04/11") com link para a ficha.
- **Na tela do orçamento:** o nome do cliente vira link para a ficha.
- **Fusão de duplicados:** só para a gerente, em `/clientes`, se dois clientes da mesma vendedora tiverem WhatsApp ou nome muito parecidos, mostre "Possível duplicado" e o botão **Juntar** (move os orçamentos para o cliente escolhido, copia as observações e apaga o outro), com confirmação e registro. Se isso não couber hoje, deixe fora e avise.
- Testes: `test:rls` (Aline não lê cliente da Kely nem a ficha por URL direta), e2e em 390 px: abrir a ficha, tocar em **Novo orçamento para este cliente** e ver o formulário pulando para a pergunta 4 com os dados preenchidos; unitários do resumo do cliente.

Commit: `feat: clientes, ficha e histórico (dia 10D)` e deploy.

---

## Fechamento do dia

- Atualize `docs/arquitetura.md`, `docs/modelo-de-dados.md`, `docs/metricas.md` (se vencidos entram em algum número) e `docs/plano.md` (dia 10 concluído).
- `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar em cada commit. Aplique as migrations no remoto e confira o deploy depois de cada parte.
- Gere de novo `dados/exemplo-orcamento.pdf` e `.xlsx` só se algo neles mudou, e salve uma exportação de exemplo em `dados/exemplo-exportacao.xlsx` (fora do git), gerada com dados fictícios.

## Fora do escopo de hoje

Metas de venda, notificação por e-mail ou push, importação da planilha editada de volta para o sistema, integração direta com o sistema de estoque e novo visual. O estoque real continua dependendo da planilha da loja (dia 13).

Ao terminar, me mostre: o que cada parte entregou e o que ficou de fora; a regra de vencimento escrita e o fluxo do Renovar que você decidiu; prints ou descrição no celular da busca com filtros, do aviso de vencido, da ficha do cliente; o caminho da exportação de exemplo e o tempo da exportação com 5.000 orçamentos; as migrations novas; a saída dos testes e qualquer pendência.
