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

## Motor de IA (dia 5, como foi implementado)

Código em `src/lib/ia/` (só servidor, `import "server-only"`). A ação do servidor é `montarComIA` (`src/app/(app)/orcamentos/acoes-ia.ts`), chamada pelo botão **Montar orçamento com IA** do Resumo e por "Montar de novo" em `/orcamentos/[id]/itens`.

1. **Conferências** (`montar.ts`): o orçamento é da vendedora logada, está em `rascunho` e tem as perguntas obrigatórias respondidas. Limites contados em `uso_ia`: `IA_LIMITE_DIARIO_VENDEDORA` (padrão 20 por dia, fuso de Maceió) e `IA_MAX_GERACOES_POR_ORCAMENTO` (padrão 3). Estourou: mensagem clara e **nenhuma chamada à API**. Montagem simultânea no mesmo orçamento é barrada.
2. **Registro de uso**: uma linha em `uso_ia` com status `em_andamento` (já conta no limite, para duplo clique não furar). No fim vira `ok` (com tokens, custo estimado, duração, modelo, chamadas de ferramenta e detalhes) ou `erro`. **Erro não conta no limite.**
3. **Entrada** (`instrucoes.ts`): as instruções da loja (papel, regra central, kits de fita, linha, prazo) e o atendimento **sem nome e sem WhatsApp**: só tipo de cliente, obra, ambientes, pedido, linha, faixa, prazo e observações. Telefones, e-mails e o nome do cliente digitados dentro do texto livre são trocados por `[telefone]`, `[e-mail]` e `[cliente]`.
4. **Anexos**: imagens (JPG, PNG, WEBP) vão como imagem em base64; PDFs vão como arquivo e, se o modelo recusar o arquivo, a montagem tenta de novo com o texto extraído (`unpdf`); HEIC não é lido pela IA e é só registrado. Cada anexo e como foi enviado ficam em `uso_ia.detalhes`.
5. **Laço de ferramentas** (`motor.ts`, Responses API, `store: false`): a IA chama `buscar_produtos(texto, categoria?, marca?, limite?)` e `detalhar_produto(codigo)`, que rodam **com a sessão da própria vendedora** (a RLS vale). No máximo 8 rodadas de ferramentas; depois disso a chamada seguinte vem com `tool_choice: "none"` e a IA responde com o que tem.
6. **Saída estruturada** (`esquema.ts`): JSON estrito `{ ambientes: [{ nome, itens: [{ codigo | null, quantidade, justificativa, descricao_avulso }] }], pendencias, resumo_para_vendedora }`, revalidado com zod. Não existe campo de preço.
7. **Normalização no servidor** (`normalizar.ts`): cada código é relido em `produtos`. Inexistente ou inativo: descartado com aviso. Existente: grava `descricao_congelada` e `preco_unitario_congelado` **do banco** (mesmo que a IA escreva outro preço, ele é ignorado). Produto por `un`: quantidade arredondada para cima (com aviso); por `m`: até 2 casas. Sem código: item **avulso** (`avulso = true`, preço 0, "preço a definir"). Mesmo código no mesmo ambiente vira uma linha. O total é calculado em centavos inteiros.
8. **Gravação atômica**: a função SQL `substituir_itens_orcamento` apaga os itens antigos, grava os novos, atualiza `valor_total`, `montado_em` e `montagem` (avisos, pendências, resumo, nº de geração) numa transação, com a sessão da vendedora (RLS). Erro de API ou resposta inválida: nada é gravado em `orcamento_itens`. O status continua `rascunho` (vira `gerado` com o PDF, no dia 6). O valor à vista (10% de desconto) é calculado na tela.
9. **Tela** `/orcamentos/[id]/itens` (provisória): itens por ambiente, avulsos destacados, total, valor à vista, pendências, avisos e "Montar de novo" com as tentativas restantes. A rota usa `maxDuration = 300` (limite de 5 minutos da Vercel).

Variáveis: `OPENAI_API_KEY`, `OPENAI_MODEL` (padrão `gpt-5.6-sol`, o modelo disponível na conta), `IA_LIMITE_DIARIO_VENDEDORA`, `IA_MAX_GERACOES_POR_ORCAMENTO`, `IA_PRECO_ENTRADA_USD_MTOK` e `IA_PRECO_SAIDA_USD_MTOK` (para estimar custo; sem elas o custo fica 0) e, opcionalmente, `IA_RACIOCINIO` (`low`, `medium` ou `high`).

Teste com a API de verdade: `pnpm ia:testar` (custa dinheiro; monta como Aline um rascunho baseado em um dos 37 orçamentos reais e apaga no fim). Opção `--so-pedido` só mostra o pedido reescrito, sem chamar a API.

## Revisão de itens e PDF (dia 6)

- **Revisão** (`/orcamentos/[id]/revisao`, substitui `/itens`): itens por ambiente com − / + e campo de quantidade (`m` aceita decimais), trocar produto, mudar ambiente, remover (com "Desfazer" por 6 s), adicionar produto (busca `buscar_produtos`), adicionar item avulso e adicionar ambiente. Cada alteração é uma Server Action (`acoes-revisao.ts`) com a sessão da vendedora (RLS), que recalcula o `valor_total` no banco. As alterações vão ao servidor em fila, e a tela só adota o estado do servidor quando não há nada pendente (sem "pular" ao tocar várias vezes). Aviso "O preço de N itens mudou no estoque" com **Atualizar preços**. "Montar à mão" no Resumo leva à revisão vazia com os ambientes da pergunta 5.
- **Rodapé fixo**: total, total à vista (desconto configurado) e **Gerar PDF**, desabilitado com o motivo (`motivosBloqueioGerar`) se faltar item ou houver avulso sem preço.
- **PDF** (`src/lib/pdf/`, `@react-pdf/renderer`, sem navegador): `dados.ts` monta tudo (centavos e textos) e é testável sem React; `documento.tsx` desenha o A4 (cabeçalho com logo ou nome escrito, cliente, itens por ambiente com subtotal, totais com o à vista em destaque, condições, rodapé com página X de Y, linhas sem quebrar ao meio); `tema.ts` guarda as cores em um lugar só (dourado sóbrio `COR_DESTAQUE`). O logo é lido de `public/marca/logo.png` ou `logo.jpg` (SVG não entra no PDF); sem logo, sai "LUZ DESIGN" escrito.
- **Gerar PDF** (`gerar.ts`, Server Action `gerarPdf`): confere dona e status (`rascunho` ou `gerado`) e os bloqueios, relê o catálogo e calcula o congelamento, renderiza, envia ao bucket `pdfs` (`{vendedora_id}/{orcamento_id}/{numero}-v{versao}.pdf`) e só então chama `gerar_orcamento` (uma transação: congela preços e descrições, recalcula o total, `gerado`, `gerado_em`, validade = hoje + `validade_dias`, `pdf_caminho`, `pdf_versao`). Se a gravação falhar, o orçamento não fica marcado como gerado. Gerar de novo cria a versão seguinte e mantém as anteriores.
- **Tela do orçamento** (`/orcamentos/[id]`): total e à vista, validade, prévia do PDF em tela grande (o iframe só é criado no cliente quando a tela é larga; no celular, "Ver PDF" abre o leitor do aparelho, sem baixar nada sozinho), **Compartilhar no WhatsApp** (Web Share com o arquivo; no computador baixa o PDF e abre `wa.me/<número>` com a mensagem pronta), **Baixar PDF**, **Editar** (gera nova versão), versões anteriores e linha do tempo (criado, montado pela IA, PDFs gerados e mudanças de status).
- **Configurações da loja** (`/gerencia/configuracoes`): a gerente edita os dados do cabeçalho e as condições do PDF.

## IA real, análise do ambiente e motivos (dia 7)

- **Modelo**: `gpt-5.6-sol`, preços de US$ 4 (entrada) e US$ 20 (saída) por milhão de tokens, configurados em `IA_PRECO_*` (local e Vercel, Production e Preview). Custo e tempo reais: cerca de US$ 0,16 e 42 s por orçamento (R$ 0,90 a US$ 1 = R$ 5,50, estimativa); o maior caso (23 itens) levou 66 s, bem abaixo do `maxDuration` de 300 s. Timeout por chamada: 120 s.
- **Saída estruturada v2**: cada ambiente traz `analise_ambiente` (2 a 4 frases ao cliente) e `anexos_usados`; cada item traz `motivo_cliente` (1 frase) além da `justificativa` interna. A análise vai para `orcamento_ambientes`; o motivo, para `orcamento_itens.motivo_cliente`. Regras no prompt: não inventar medidas, cores ou materiais; explicar termos técnicos; só dizer "pela foto" quando um anexo embasou o texto.
- **Revisão**: motivo editável por item (com contador), análise editável por ambiente, **Reescrever análise com IA** (`reescreverAnalise`, conta no `uso_ia` com `tipo` próprio) e a opção **Mostrar análise e motivos no PDF** (`orcamentos.mostrar_analise_pdf`).
- **PDF**: bloco com fundo rosado e miniatura da foto usada em cada ambiente; motivo em itálico abaixo da descrição do item; paginação testada com 60 itens e 6 ambientes.
- **Avaliação**: `pnpm ia:avaliar [--rodada N] [--indices 0,33] [--so-relatorio]` (custa dinheiro) monta 10 orçamentos fixos de `dados/avaliacao/pedidos.json` como Aline, compara com os orçamentos reais e grava `dados/avaliacao/rodada-N.json` e `relatorio-ia.md`. Apaga os rascunhos e devolve o contador de numeração. A pasta fica fora do git.
- **Ajustes pela avaliação**: na rodada 1 as fontes e os perfis saíam como item avulso porque a descrição das fontes não informa a tensão. O prompt passou a mandar usar o produto do catálogo pela potência, anotar a tensão em pendências e só criar avulso depois de duas buscas. Resultado: categoria certa por ambiente de 54% para 96%, kits completos de 23% para 100%, avulsos de 21 para 0, orçamentos dentro de ±30% do total original de 5 para 9.

## Seleção manual, Indicação da IA e planilha (dia 8A)

Mudança de rumo pedida pelo dono da loja: muitas vezes o arquiteto já escolheu os produtos, então **a vendedora seleciona os produtos** e a IA não monta mais o orçamento.

- **Saiu**: a montagem completa pela IA (`montarOrcamento`, `MontarComIA`, a análise do ambiente, o motivo por produto e a opção de mostrar no PDF). As colunas do dia 7 (`orcamento_ambientes.analise`, `orcamento_itens.motivo_cliente`, `justificativa`) continuam no banco, sem uso. A função SQL `substituir_itens_orcamento` também ficou.
- **Reaproveitado**: cliente OpenAI e laço de ferramentas (`motor.ts`), `buscar_produtos`/`detalhar_produto` com a sessão da vendedora, limite diário e `uso_ia`, envio de anexos e a limpeza de nome/telefone (`comum.ts`, `instrucoes.ts`).
- **Tela "Produtos do orçamento"** (`/orcamentos/[id]/revisao`): busca de produto (código de 4 ou 5 dígitos acha direto com Enter; descrição, categoria, marca e apelidos; mostra preço e estoque; adiciona vários em seguida), **Colar lista** (parser por regras em `lista-colada.ts`, sem IA, com prévia: reconhecidas, não encontradas e não entendidas), item avulso, descrição editável por item e o botão **Gerar orçamento**.
- **Indicação da IA** (`indicacao.ts`, `instrucoes-indicacao.ts`): card abaixo da seleção. A vendedora informa ambiente, o que o cliente pediu, o que o arquiteto pediu e como é o ambiente (e escolhe usar ou não as fotos e plantas). A IA consulta o catálogo e devolve `resumo`, `sugestoes` (código, quantidade, motivo interno) e `observacoes`. O servidor valida (código inexistente ou inativo é descartado, `un` arredonda para cima, preço e descrição vêm do banco) e **não grava item**: cada sugestão tem **Adicionar** (`adicionarSugestoes`, origem `indicacao_ia`). O histórico fica em `indicacoes_ia` (a última de cada ambiente aparece recolhida).
- **Padronização de texto** (`formatacao.ts`): ao gerar, uma única chamada (sem ferramentas) padroniza a descrição comercial dos códigos ainda sem formatação e o nome dos ambientes. O resultado é validado (mesmos números e medidas; ambiente só muda maiúsculas e acentos) e guardado em `produtos_descricao_formatada` (só o servidor grava; refeito se a descrição do catálogo mudar). A IA recebe também a **categoria** do produto, para não chamar lâmpada de luminária. Qualquer falha cai na descrição do catálogo e **nunca bloqueia** a geração.
- **Geração** (`pdf/gerar.ts`, `gerarOrcamento`): relê o catálogo, padroniza, grava a descrição final no item, renderiza **PDF e XLSX** e só então chama `gerar_orcamento` (preço do catálogo, total conferido, `status = gerado`, caminhos dos dois arquivos). O PDF não tem mais análise nem motivo.
- **Planilha** (`src/lib/planilha/orcamento.ts`, `exceljs`): aba ORÇAMENTO com cabeçalho e logo, tabela QT | PRODUTO | DESCRIÇÃO | AMBIENTE | UNIT | TOTAL, **fórmulas reais** (TOTAL = ARRED(QT×UNIT), SOMA, desconto à vista, SOMASE por ambiente) com o resultado já gravado, formato R$, painel congelado e impressão A4. Arquivos `{vendedora}/{orcamento}/{numero}-v{versao}.pdf|.xlsx` no bucket `pdfs`. Downloads com o nome `NOME DO CLIENTE DD.MM.AA`.
- **Avaliação**: a Indicação foi avaliada em 5 ambientes dos orçamentos reais (`pnpm ia:avaliar`): categorias certas em 5/5, 88% dos códigos reais (contando equivalentes), kits de fita completos em 3/3, exigências do arquiteto respeitadas em 4/4, zero código inventado, cerca de US$ 0,08 e 21 s por indicação.
- **Testes sem custo**: com `IA_SIMULADA=1` (só fora de produção) o cliente OpenAI é trocado por um falso (`ia-simulada.ts`); o Playwright sobe o servidor assim.

## Envio, edição bloqueada e follow-up (dia 8B)

- **Marquei como enviado** (`marcarEnviado` em `acoes-status.ts`): na tela do orçamento `gerado`, com a data do envio (padrão hoje; dias anteriores valem; futuro e antes de gerado não). Usa `marcar_enviado`.
- **Edição bloqueada** a partir de `enviado`: no banco (gatilho `EDICAO_BLOQUEADA`) e na tela (a tela de produtos abre só para leitura, com o aviso "Orçamento já enviado"). **Editar e enviar nova versão** (`reabrirParaEdicao`) volta para `gerado` mantendo as datas, libera a edição e, ao gerar, cria a próxima versão do PDF e da planilha; ao marcar enviado de novo só muda o último envio.
- **Follow-ups de hoje** (`/`): D+5 (status `enviado`) e D+10 (status `followup_d5`) que vencem hoje ou já venceram, do mais atrasado ao mais novo. Cada cartão tem **Abrir WhatsApp** (`wa.me` com a mensagem da etapa) e **Fiz o follow-up** (`registrarFollowup`, um toque). Passados 5 dias do D+10 vencido, sugere **Marcar como perdido (sem resposta)**. O número de vencidos aparece como selo no item Início da navegação. A gerência vê a lista dos vencidos por vendedora em `/gerencia` (só leitura).
- **Contas**: `followupDeHoje` (puro, testado com virada de dia e fuso) usa os dias de `configuracoes_loja`; a virada do dia é à meia-noite de Maceió.

## Painéis e atalhos de seleção (dia 9)

**Painéis (9A).** As métricas são calculadas no banco por funções `security invoker` (`metricas_orcamentos`, `serie_semanal_orcamentos` e, só para a gerente, `custo_ia_orcamentos`), então a RLS decide o que cada pessoa enxerga: a vendedora recebe só a própria linha, mesmo passando o id de outra. Os orçamentos de teste ficam fora por uma regra única (`orcamento_eh_teste` e a view `orcamentos_reais`). Definições e decisões em `docs/metricas.md`. No servidor, `src/lib/metricas/` resolve o período (dias de Maceió, URL `?periodo=mes|mes-anterior|90-dias|personalizado&de=&ate=`), chama as funções, soma os follow-ups vencidos (regra do dia 8) e monta os links das listas. As telas são `/meus-numeros` (vendedora) e o topo de `/gerencia` (gerência), com gráficos em SVG/CSS feitos à mão (`src/components/numeros/`). Tocar em um número abre `/orcamentos` (ou `/gerencia`) filtrado por `?data=criado|gerado|enviado|fechado|perdido&de=&ate=&motivo=`.

**Atalhos (9B), todos sem IA.** Em `/orcamentos/[id]/revisao`: **kit de fita** (`src/lib/orcamento/kit-fita.ts`: parser de potência, tensão e comprimento a partir de `atributos` e da descrição; fita em metros ou rolos, perfil em barras arredondadas para cima, fonte = W/m × metros × 1,2, a menor do catálogo que aguenta, ou N fontes iguais; sem dado, a vendedora escolhe e o sistema diz o que faltou); **Seus mais usados** (os 12 códigos que a própria vendedora mais usou em 90 dias, com a busca vazia); **duplicar ambiente** (copia os itens relendo o preço atual do catálogo). As três usam as mesmas ações do servidor da revisão (`acoes-revisao.ts`): preço sempre do catálogo, edição só em rascunho e gerado.

## Busca e filtros da lista (dia 10A)

A lista (`/orcamentos` da vendedora e a lista do `/gerencia`) usa os mesmos componentes: `BuscaFiltros` (campo de busca, gaveta "Filtrar" por baixo, chips que se removem com um toque), `FiltrosStatus` (atalhos de status) e `ListaOrcamentos` ("Ver mais" de 20 em 20). Tudo mora na URL (`?q=&filtro=&data=&de=&ate=&min=&max=&tipo=&arq=1&motivo=&validade=&vendedora=&ordem=`); `src/lib/orcamento/filtros-lista.ts` lê esses parâmetros, ignora o que for inválido e monta a entrada da função SQL `listar_orcamentos`, que roda como quem consulta (RLS): a vendedora nunca recebe orçamento de outra, nem com o mesmo nome de cliente, filtro de vendedora ou cursor forjado. A paginação é por **cursor** (chave de ordenação + id), não por offset. "Ver mais" chama a ação `carregarMaisOrcamentos`, que relê e valida os filtros no servidor. Com período na URL (vindo dos painéis ou da gaveta), os orçamentos de teste ficam de fora.

## Validade vencida e renovação (dia 10B)

**Regra de vencimento (uma só).** Vencido não é um status: é `validade < hoje` (calendário de Maceió) em orçamento `gerado`, `enviado`, `followup_d5` ou `followup_d10`. Rascunho, fechado, perdido e orçamento sem validade nunca vencem. Está escrita em dois lugares que dizem a mesma coisa: `src/lib/orcamento/validade.ts` (`diasParaVencer`: 0 = vence hoje, 1 = amanhã, negativo = vencido há N dias) e a função SQL `orcamento_dias_para_vencer`; `busca-sql.test.ts` confere que concordam para todos os status e distâncias. Lista, cartão, "Para hoje", tela do orçamento, filtro da lista e contador da gerência usam essa regra. Os follow-ups D+5 e D+10 continuam em orçamento vencido (o aviso de vencimento não os substitui).

**Avisos.** Etiqueta "Vencido há N dias" (rosa) ou "Vence hoje" / "Vence amanhã" (âmbar) na lista e no cartão; seção **Para renovar** em "Para hoje" (vencidos ou que vencem em até 1 dia, do mais antigo ao mais novo, com Renovar e WhatsApp); o badge da navegação soma follow-ups vencidos e esses; na tela do orçamento, "Os preços e a validade expiraram em DD/MM. Renove para mandar de novo". Na gerência, "Vencidos sem renovação" por vendedora (só os que entram nos números, sem os de teste), com link para a lista filtrada.

**Fluxo do Renovar (decidido).**

1. **Renovar** (tela do orçamento, cartão e Para hoje) abre uma prévia que compara o preço **congelado** de cada item com o preço **atual** do catálogo (item, preço antigo, novo, diferença em R$ e em %), mais itens inativos e com estoque informado menor que a quantidade. Nada é gravado.
2. A vendedora escolhe **Atualizar preços e renovar** ou **Manter os preços antigos e renovar** (este mostra "Estes preços podem estar defasados"). Item **inativo** bloqueia as duas opções: é preciso trocar ou remover antes ("Editar e enviar nova versão"). Renovar nunca muda preço sem ela ver e escolher.
3. O servidor gera PDF e XLSX da **versão `pdf_versao + 1`** (validade = hoje + `validade_dias`; as descrições já congeladas ficam, sem IA), guarda os arquivos e chama a função SQL `renovar_validade`, que numa transação volta o orçamento para `gerado` **sem apagar** `enviado_em` e `ultimo_envio_em` (mesmo caminho do "Editar e enviar nova versão"), aplica os preços do modo escolhido, grava a versão (marcada `renovada` em `pdf_versoes`) e a nova validade. As versões antigas ficam guardadas; a linha do tempo mostra "Validade renovada (versão N, válida até DD/MM)" além da mudança de status. Ao marcar **enviado** de novo, só `ultimo_envio_em` muda e os follow-ups recomeçam dali.
4. **Quem pode: a dona e a gerência.** Exceção deliberada à regra "só a dona gera": `renovar_validade` é `security definer` (a gerência não escreve itens pela RLS) e confere a permissão dentro; os arquivos vão ao Storage pela chave de servidor, na pasta da dona, depois de a ação conferir quem pediu. Outra vendedora recebe `SEM_PERMISSAO`.

## Exportação em planilha (dia 10C)

Cláusula 7.3 do contrato: o dado é da loja e precisa sair em planilha. O botão **Exportar planilha** (em `/orcamentos` e em `/gerencia`) baixa `luz-design-orcamentos AAAA-MM-DD.xlsx` com os **mesmos filtros da lista** (status, período, busca, vendedora...). A gerência pode marcar "Incluir orçamentos de teste" (desligado por padrão; os de teste ficam fora, como nos números).

- **Um só caminho de acesso:** a rota `GET /exportar` (`src/app/(app)/exportar/route.ts`) é autenticada e lê com a **sessão de quem pediu** (RLS), pela mesma função `listar_orcamentos` da lista (em lotes de 100, por cursor). A vendedora nunca recebe dado de outra; a aba Eventos e a tabela por vendedora só existem para a gerência.
- **Abas:** Resumo (período e filtros, data, quem exportou, totais e tabela por vendedora), Orçamentos, Itens, Clientes e Eventos (só gerência). Cabeçalho na cor cobre `#9F5F47`, filtro automático e painel congelado; datas como data do Excel em horário de Maceió (`dd/mm/aaaa hh:mm`), valores como número com formato R$, WhatsApp e código como texto.
- **Volume:** `src/lib/exportacao/planilha.ts` escreve em fluxo (`exceljs` WorkbookWriter): os orçamentos ficam na memória como linhas compactas e os itens e eventos são lidos em lotes enquanto a aba é escrita. Com 5.000 orçamentos e 30.000 itens sintéticos (teste local): cerca de 1 a 2 s, 2,4 MB de arquivo e poucas dezenas de MB de heap.
- **Auditoria:** cada exportação grava uma linha em `eventos_exportacao` (quem, quando, filtros, quantidade de linhas), só pelo servidor.

## Clientes: lista, ficha e histórico (dia 10D)

- **`/clientes`**: busca por nome, WhatsApp ou arquiteto e, para cada cliente, a quantidade de orçamentos, o valor vendido e o último (função SQL `listar_clientes`, RLS: a vendedora vê só os dela; a gerência vê todos e filtra por vendedora). O atalho "Clientes" fica no topo de Orçamentos, Equipe e Produtos (a barra de baixo não perdeu nenhum botão).
- **`/clientes/[id]` (ficha)**: nome, WhatsApp (Abrir WhatsApp), tipo, arquiteto, resumo (orçamentos, fechados, perdidos, em aberto, vendido, ticket médio, calculado por `src/lib/clientes/resumo.ts`), notas editáveis pela dona e a lista de todos os orçamentos dele (status, valor e validade). URL direta de cliente de outra vendedora mostra "não encontrado": a RLS não devolve a linha. **Novo orçamento para este cliente** cria o rascunho já com nome, WhatsApp, tipo e arquiteto (as perguntas 1 a 3 ficam respondidas e o formulário abre na primeira que faltar, a 4).
- **No formulário**, a pergunta 2 mostra, quando o WhatsApp já existe, o histórico do cliente ("3 orçamentos, 1 fechado, último em 04/11") com link para a ficha; na tela do orçamento o nome do cliente vira link para a ficha.
- **Duplicados (só gerência)**: em `/clientes`, "Possíveis duplicados" mostra os pares da mesma vendedora (mesmo WhatsApp ou nome muito parecido); **Juntar** pede confirmação, move os orçamentos para o cliente escolhido, junta as notas, apaga o outro e registra em `clientes_fusoes`.
