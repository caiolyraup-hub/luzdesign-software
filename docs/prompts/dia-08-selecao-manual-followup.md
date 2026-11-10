# Prompt do dia 8 (10/11/2026): seleção manual de produtos, Indicação da IA, download em PDF e XLSX, envio e follow-up

Mande para o Claude Code: **"Leia docs/prompts/dia-08-selecao-manual-followup.md e execute tudo."**

---

Hoje é o **dia 8 de 14** do projeto Luz Design Orçamentos (no plano original, 13/11; estamos 3 dias adiantados). Leia o `CLAUDE.md` e os arquivos em `docs/`. Os dias 1 a 7 estão publicados (commit 2444d29): formulário com anexos, motor de IA que monta o orçamento inteiro, revisão, PDF com análise do ambiente e motivo por produto, mudança de status e botões de follow-up.

## Mudança de rumo pedida pelo dono da loja (leia antes de tudo)

O dono da Luz Design **não quer que a IA escolha as peças do orçamento nem explique como e por quê**, porque muitas vezes o arquiteto já escolheu os produtos. A partir de hoje:

1. **A vendedora seleciona os produtos à mão**, por ambiente, na tela de revisão (que passa a se chamar **Produtos do orçamento**). Isso já existe em parte (Montar à mão, busca, avulso); hoje vira o caminho principal e único.
2. **A IA só formata.** Ela padroniza a apresentação do que a vendedora escolheu (descrição comercial dos itens e nomes dos ambientes). O design vem do modelo de PDF/planilha, não da IA. A IA **nunca** adiciona, remove ou troca item, nem muda quantidade ou preço.
3. **Nova seção "Indicação da IA"**, logo **abaixo** da seleção de produtos. A vendedora escreve o que o cliente pediu, o que o arquiteto pediu e como é o ambiente, e a IA devolve uma sugestão de produtos do catálogo. Nada entra no orçamento sozinho: a vendedora toca em **Adicionar** em cada sugestão que quiser.
4. **O orçamento pronto pode ser baixado em PDF e em XLSX.** O PDF serve para mandar direto ao cliente; a planilha serve para a vendedora editar fora do sistema, se quiser.
5. **Sai do PDF a análise do ambiente e o motivo de cada produto** criados no dia 7.

Faça hoje em duas partes, nesta ordem, com um commit e um deploy ao fim de cada uma. **A parte A tem prioridade.** Se o dia apertar, termine a A inteira e me diga o que da B ficou faltando.

## Regras (não mude)

- **Preço sempre vem de `produtos`**, aplicado pelo servidor. Vale para item escolhido à mão, colado em lista ou adicionado a partir da Indicação da IA. Só item avulso tem preço manual.
- **A IA não grava item.** Ela só sugere (Indicação) e formata texto (descrição e nome de ambiente). Toda saída da IA é validada no servidor.
- Não envie nome nem WhatsApp do cliente para a OpenAI. Os limites de uso (`IA_LIMITE_DIARIO_VENDEDORA`) e o registro em `uso_ia` valem para a Indicação e para a formatação.
- **Não apague colunas nem dados** do dia 7 (`orcamento_ambientes.analise`, `orcamento_itens.motivo_cliente`, `justificativa`). Elas só deixam de ser usadas. Os PDFs antigos no Storage continuam como estão.
- Valem as regras do `CLAUDE.md`: RLS, service role só no servidor, `<Suspense>` no Next 16, português, mobile-first com fonte mínima de 16 px. Não apague os 4 orçamentos TESTE do seed nem o 2026-0005.

---

## Parte A: mudança estrutural

### A1. Fluxo novo

- No **Resumo** do formulário, o botão principal passa a ser **Selecionar produtos**, que leva para `/orcamentos/[id]/revisao` com os ambientes da pergunta 5 já criados (o mesmo comportamento do Montar à mão). Tire da tela o **Montar orçamento com IA** e o componente `MontarComIA`.
- A pergunta 6 (`pedido_cliente`) passa a ser **opcional** (continua em `respostas` com `versao: 1`; um campo que fica opcional não quebra orçamentos antigos). Ela serve de ponto de partida para a Indicação da IA. Atualize `docs/perguntas.md`.
- Remova a montagem completa pela IA: a server action de montar, a tela de espera e a rota que só existia para ela. **Reaproveite** o que serve para a Indicação (cliente OpenAI, ferramentas `buscar_produtos`/`detalhar_produto` com a sessão da vendedora, limites, `uso_ia`, envio de anexos) e apague o resto, junto com os testes que só testavam a montagem completa. Orçamentos já montados pela IA continuam abertos e editáveis normalmente.
- Por migration, crie em `orcamento_itens` a coluna `origem` (`manual`, `lista_colada`, `indicacao_ia`, `montagem_ia`), padrão `manual`. Preencha `montagem_ia` nos itens antigos que têm `justificativa`. Ela vai alimentar o painel (quanto a Indicação da IA é usada).

### A2. Tela "Produtos do orçamento" (`/orcamentos/[id]/revisao`)

Mantenha o que já funciona (itens por ambiente, − / +, trocar produto, mudar ambiente, remover com desfazer, avulso, adicionar ambiente, aviso de preço mudou, rodapé fixo com total e à vista) e:

- **Busca mais rápida**, porque agora é o caminho principal: digitar o código de 5 dígitos acha o produto direto; a busca aceita descrição, categoria, marca e apelidos; o resultado mostra preço e estoque; tocar em um produto adiciona com quantidade 1 no ambiente aberto, sem sair da busca (dá para adicionar vários seguidos).
- **Colar lista** (para quando o arquiteto já mandou os produtos), por ambiente: um campo de texto onde a vendedora cola linhas como `10 12345`, `12345 x 10`, `3,5 m 23456` ou `12345 - 4 un`. Um parser **determinístico, sem IA**, reconhece código e quantidade em cada linha e mostra uma prévia: linhas reconhecidas (com descrição e preço do catálogo), códigos não encontrados e linhas não entendidas. Ela confirma e os itens entram com `origem = lista_colada`. Testes unitários do parser com pelo menos 10 formatos.
- Tire da tela os campos de análise do ambiente, motivo do item, "Por que este item?" e o botão **Reescrever análise com IA**.
- O botão do rodapé passa de **Gerar PDF** para **Gerar orçamento** (gera PDF e XLSX juntos, ver A5), com as mesmas regras de bloqueio (nenhum item ou avulso com preço 0).

### A3. Indicação da IA (abaixo da seleção de produtos)

- Um card **Indicação da IA**, depois da lista de ambientes e antes do rodapé, com:
  - **Ambiente:** escolha entre os ambientes do orçamento (ou "novo ambiente", com nome);
  - **O que o cliente pediu:** texto, já preenchido com a pergunta 6 se ela tiver resposta;
  - **O que o arquiteto pediu:** texto opcional (dica: "Cole o que o arquiteto especificou, se houver");
  - **Como é o ambiente:** texto opcional (tamanho, pé-direito, forro, luz natural, uso);
  - **Usar fotos e plantas anexadas:** desligado por padrão (só aparece se o orçamento tiver anexos);
  - botão **Pedir indicação**, com estado de carregamento e as tentativas restantes do dia.
- A IA recebe esses textos, a linha, o prazo e a faixa de investimento das respostas e os itens que **já estão** naquele ambiente, consulta o catálogo pelas ferramentas e devolve, em saída estruturada estrita (validada também com zod): `resumo` (2 a 3 frases para a vendedora) e `sugestoes: [{ codigo, quantidade, motivo }]` (motivo interno, curto), mais `observacoes` (por exemplo, "a fita pedida precisa de fonte; sugeri uma de 60 W").
- **Instruções da IA (`src/lib/ia/instrucoes-indicacao.ts`):** quando o arquiteto especificou algo, a indicação segue o que ele pediu e procura o produto do catálogo mais próximo, sem trocar a escolha dele por gosto próprio; se faltar algo para funcionar (fonte, perfil, driver, lâmpada), sugerir o complemento e dizer por quê; não repetir o que já está no ambiente; respeitar linha, prazo (pronta-entrega favorece `estoque_disponivel > 0`) e faixa; usar só códigos devolvidos pelas ferramentas. Reaproveite as regras de kit perfil + fita + fonte que o dia 7 validou.
- **No servidor:** releia cada código em `produtos`; descarte código inexistente ou inativo (com aviso); arredonde `un` para inteiro. Mostre as sugestões em cartões com descrição, código, quantidade (editável antes de adicionar), preço do catálogo e subtotal, e os botões **Adicionar** (por sugestão) e **Adicionar todas**. Item adicionado entra no ambiente escolhido com `origem = indicacao_ia` e preço do catálogo.
- **Histórico:** por migration, crie `indicacoes_ia` (id, orcamento_id, vendedora_id, ambiente, pedido_cliente, pedido_arquiteto, descricao_ambiente, usou_anexos, resposta jsonb, criado_em) com a mesma RLS de `orcamento_itens` (a gerente só lê). Na tela, mostre a última indicação de cada ambiente, recolhida, para a vendedora rever sem pagar de novo.
- Erros (timeout, limite, resposta inválida): mensagem clara com "Tentar de novo", nada é gravado em itens e a tentativa com erro não conta no limite.

### A4. Formatação pela IA (só texto)

- Ao tocar em **Gerar orçamento**, o servidor monta o documento. A IA entra só para **padronizar a descrição comercial** de cada produto (por exemplo, `EMB DICR MR16 GU10 BR` vira "Embutido para dicroica MR16 GU10, branco") e corrigir maiúsculas e acentos dos nomes de ambiente.
- Faça isso **por código de produto, com cache**: por migration, crie `produtos_descricao_formatada` (codigo, descricao_formatada, origem_atualizado_em, criado_em). Só chame a IA para códigos sem formatação ou cujo produto mudou depois dela, em **uma chamada** com todos os códigos pendentes. Assim o custo cai perto de zero depois das primeiras semanas.
- **Validação no servidor:** a descrição formatada precisa manter todos os números e medidas da original (potência, K, mm, V, metros); se não mantiver, ou se a IA falhar, use a descrição do catálogo. A formatação nunca bloqueia a geração do orçamento.
- A vendedora vê a descrição formatada na tela de produtos e pode **editar a descrição de um item** (texto curto) antes de gerar. Item avulso usa o texto que ela escreveu.
- Ao gerar, a descrição final fica congelada em `descricao_congelada`, como já acontece hoje.

### A5. PDF e XLSX

- **PDF:** remova o bloco "Análise do ambiente", a miniatura da foto e a linha de motivo dos itens, e a opção "Mostrar análise e motivos no PDF". O resto do layout fica (logo, cor cobre `#9F5F47`, cliente, itens por ambiente com subtotal, totais, condições, paginação).
- **XLSX (`src/lib/planilha/`, com o `exceljs` que já está no projeto):** uma aba **ORÇAMENTO** com o mesmo conteúdo do PDF, pensada para ser **editada**:
  - cabeçalho com o logo, os dados da loja de `configuracoes_loja`, "ORÇAMENTO Nº", data, validade, cliente, WhatsApp, arquiteto e vendedora;
  - uma tabela única com as colunas do modelo que a loja já usa: **QT | PRODUTO | DESCRIÇÃO | AMBIENTE | UNIT | TOTAL** (PRODUTO = categoria + código, como nas planilhas antigas em `dados/orcamentos-37-extraidos.json`), ordenada por ambiente;
  - **fórmulas de verdade**, para a planilha recalcular quando a vendedora mudar algo: TOTAL = QT × UNIT, total geral com SOMA, desconto à vista e total à vista; um quadro de subtotais por ambiente com SOMASE. Grave também o resultado calculado de cada fórmula, para a planilha abrir certa até em visualizador sem recálculo (WhatsApp, celular);
  - formato R$ brasileiro, cabeçalho da tabela na cor cobre, congelar painel no cabeçalho da tabela, larguras de coluna boas, impressão A4 ajustada à largura e as condições do rodapé no fim.
- **Gerar orçamento (server action):** na mesma transação de hoje (congela preços e descrições, `status = gerado`, validade), gere o PDF **e** o XLSX e salve os dois no bucket `pdfs`: `{vendedora_id}/{orcamento_id}/{numero}-v{versao}.pdf` e `.xlsx`, com a mesma versão. Confira o `allowed_mime_types` do bucket e inclua o tipo do XLSX por migration. Guarde `xlsx_caminho` em `orcamentos`.
- **Tela do orçamento (`/orcamentos/[id]`):** botões **Baixar PDF**, **Baixar planilha (XLSX)** e **Compartilhar no WhatsApp** (PDF, como hoje). O nome dos arquivos baixados segue o costume da loja: `NOME DO CLIENTE DD.MM.AA.pdf` e `.xlsx` (sem caracteres inválidos no Windows). Versões anteriores também baixam nos dois formatos (as antigas, só PDF).
- Dica curta na tela: "Se editar a planilha, lembre de informar o valor final ao marcar Fechado."

### A6. Documentos, testes e commit da parte A

- Reescreva no `CLAUDE.md` a seção **Regra central da IA** com este sentido: "A vendedora escolhe os produtos. A IA só (1) sugere produtos na Indicação da IA, que a vendedora aceita ou não, e (2) padroniza a descrição e o nome dos ambientes. O servidor aplica o preço do catálogo e calcula os totais; a IA nunca grava item nem define preço." Atualize também a descrição do produto no topo e os comandos `ia:testar`/`ia:avaliar`.
- `pnpm ia:testar`: passa a testar uma Indicação real (1 ambiente de 1 dos 37 orçamentos, sem nome de cliente) e uma formatação de 10 códigos. Mostre sugestões, códigos válidos, custo e tempo.
- `pnpm ia:avaliar`: passa a avaliar a Indicação em **5 ambientes** de `dados/avaliacao/pedidos.json` (1 rodada, teto de US$ 1): códigos válidos, categoria certa, complementos de kit de fita e se respeitou o que o "arquiteto" pediu (crie 2 casos com pedido de arquiteto). Atualize o relatório.
- Unitários: parser da lista colada; validação da Indicação (código inventado descartado, preço do banco, `un` arredondado, nada gravado sem Adicionar); validação da formatação (número perdido cai para a descrição do catálogo) e cache; XLSX (abra o arquivo gerado com o `exceljs` e confira cabeçalho, linhas, fórmulas, resultados calculados e totais iguais aos do PDF).
- `pnpm test:rls`: Aline não lê nem cria `indicacoes_ia` da Kely; a gerente só lê; Aline não baixa o XLSX da Kely; a vendedora não grava em `produtos_descricao_formatada` direto (só o servidor).
- `pnpm test:e2e` (390 px), como Aline: criar orçamento, **Selecionar produtos**, adicionar 2 produtos pela busca (um pelo código), colar uma lista de 3 linhas, pedir uma **Indicação da IA com o cliente OpenAI simulado** e adicionar 1 sugestão, gerar o orçamento e baixar PDF e XLSX. Limpe tudo o que o teste criar.
- Gere de novo `dados/exemplo-orcamento.pdf` e um `dados/exemplo-orcamento.xlsx` (fora do git), com cliente "TESTE", para eu ver.
- `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar. Aplique as migrations no remoto, atualize `docs/arquitetura.md` e `docs/modelo-de-dados.md`, faça o commit `feat: seleção manual, Indicação da IA e download em PDF e XLSX (dia 8A)`, o push, e confira o deploy.

---

## Parte B: o que já estava previsto para hoje (envio e follow-up D+5/D+10)

### B1. Marcar como enviado

- Na tela do orçamento `gerado`, o botão **Marquei como enviado**, com a data do envio (padrão hoje; aceita dias anteriores, mas não futuro nem antes de `gerado_em`). Use o fuso `America/Maceio`.
- Por migration: nova coluna `ultimo_envio_em` em `orcamentos`. `enviado_em` continua sendo o **primeiro** envio (para as métricas). `ultimo_envio_em` é o envio mais recente e é dele que contam os follow-ups. Faça uma função SQL `marcar_enviado(p_orcamento, p_data)` (security invoker, mesmas regras de dona/gerência da `mudar_status_orcamento`) que grava as duas datas e o evento.

### B2. Edição bloqueada a partir de enviado

- **No banco:** um gatilho em `orcamento_itens` e `orcamento_ambientes` barra inserir, alterar ou apagar quando o orçamento não está em `rascunho` ou `gerado` (erro `EDICAO_BLOQUEADA`). A geração do orçamento também recusa.
- **Na tela:** a tela de produtos abre só para leitura, com o aviso "Orçamento já enviado". O botão **Editar e enviar nova versão** volta o status para `gerado` (sem apagar `enviado_em`), libera a edição e, ao gerar, cria a próxima versão do PDF e do XLSX. Ao marcar enviado de novo, só `ultimo_envio_em` muda. Mantenha o "Corrigir: não foi enviado" que já existe para engano (esse sim limpa as datas).
- `test:rls`/SQL: com status `enviado`, nem a dona nem a gerente alteram itens.

### B3. Avisos de follow-up D+5 e D+10

- Em `configuracoes_loja`, por migration: `followup_d5_dias` (padrão 5), `followup_d10_dias` (padrão 10), em dias corridos, e `mensagem_d5`/`mensagem_d10` com textos padrão curtos e cordiais que usam `{cliente}`, `{numero}` e `{vendedora}`. A gerente edita em `/gerencia/configuracoes`.
- **Para hoje (`/`):** uma seção **Follow-ups de hoje**, no topo, com os orçamentos em que o D+5 (status `enviado`) ou o D+10 (status `followup_d5`) vence hoje ou já venceu, contados de `ultimo_envio_em`, do mais atrasado para o mais novo. Cada cartão mostra cliente, número, valor, etapa e "vence hoje" ou "atrasado N dias", com **Abrir WhatsApp** (`wa.me` com a mensagem da etapa preenchida) e **Fiz o follow-up** (muda para `followup_d5` ou `followup_d10`). Depois do D+10 vencido há mais de 5 dias, sugira **Marcar como perdido (sem resposta)**.
- Um número (badge) com o total de follow-ups vencidos no item "Para hoje" da navegação.
- **Gerência (`/gerencia`):** a lista de follow-ups vencidos por vendedora, só leitura.
- Calcule tudo na leitura (sem cron hoje), numa função testável, com testes de virada de dia e fuso.

### B4. Testes, documentos e commit da parte B

- Unitários do cálculo de vencimento; `test:rls` do `marcar_enviado` (Aline não marca o da Kely) e do bloqueio de edição; e2e: gerar, marcar enviado com data de 6 dias atrás, ver o card em Follow-ups de hoje, tocar em Fiz o follow-up e ver o status D+5.
- Atualize `docs/modelo-de-dados.md` e o `docs/plano.md`: marque o dia 8 (13/11) concluído e reescreva as linhas dos dias seguintes com estes objetivos:

| Dia             | Entrega                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dia 9           | Painel da vendedora e da gerência (conversão em quantidade e valor, vendido, perdido por motivo, em aberto, ticket médio, tempo até fechar, follow-ups vencidos) **mais** uso da Indicação da IA (indicações pedidas, % de itens com origem `indicacao_ia`, custo de IA no mês). Atalhos de seleção: kit perfil + fita + fonte por metragem (sem IA), produtos mais usados pela vendedora e duplicar ambiente. |
| Dia 10          | Exportação em planilha para a gerência (todos os orçamentos e itens, reaproveitando `src/lib/planilha/`; cláusula 7.3 do contrato), histórico do cliente, vencimento automático da validade (aviso "vencido" e "renovar validade" gerando nova versão), busca e filtros na lista de orçamentos.                                                                                                                |
| Dia 11          | Testes completos: isolamento, ponta a ponta do fluxo novo, celular real, tempo para montar um orçamento de 20 itens à mão vs. na planilha antiga, custo da Indicação e da formatação por orçamento.                                                                                                                                                                                                            |
| Dia 12 (piloto) | Piloto com Aline e Kely em orçamentos reais, com roteiro focado na seleção manual, na Lista colada, na Indicação da IA e nos downloads; coleta de ajustes.                                                                                                                                                                                                                                                     |
| Dia 13 (23/11)  | Ajustes do piloto, **carga final do estoque real** (agora crítica, porque a vendedora escolhe tudo pelo catálogo) e manual de uso do fluxo novo.                                                                                                                                                                                                                                                               |
| Dia 14 (24/11)  | Produção e treinamento: apagar seed TESTE, trocar a senha inicial, criar as contas reais, conferir chaves e limites da OpenAI.                                                                                                                                                                                                                                                                                 |

- `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar. Aplique as migrations no remoto, faça o commit `feat: envio com data, bloqueio de edição e follow-up D+5/D+10 (dia 8B)`, o push, e confira o deploy.

## Fora do escopo de hoje

Painéis, exportação geral, notificação por e-mail ou push, cron e importação da planilha editada de volta para o sistema. Não envie nome ou WhatsApp de cliente para a OpenAI.

Ao terminar, me mostre: o que saiu da montagem pela IA e o que foi reaproveitado; os prints ou a descrição da tela de produtos no celular (busca, Lista colada e Indicação da IA); a saída do `pnpm ia:testar` e o resumo do `ia:avaliar` com o custo; os caminhos do PDF e do XLSX de exemplo; as migrations novas; a saída dos testes; o que da parte B ficou pronto; e qualquer pendência.
