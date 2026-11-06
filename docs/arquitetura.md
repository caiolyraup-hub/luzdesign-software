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

Variáveis: `OPENAI_API_KEY`, `OPENAI_MODEL` (padrão `gpt-5.6`), `IA_LIMITE_DIARIO_VENDEDORA`, `IA_MAX_GERACOES_POR_ORCAMENTO`, `IA_PRECO_ENTRADA_USD_MTOK` e `IA_PRECO_SAIDA_USD_MTOK` (para estimar custo; sem elas o custo fica 0) e, opcionalmente, `IA_RACIOCINIO` (`low`, `medium` ou `high`).

Teste com a API de verdade: `pnpm ia:testar` (custa dinheiro; monta como Aline um rascunho baseado em um dos 37 orçamentos reais e apaga no fim). Opção `--so-pedido` só mostra o pedido reescrito, sem chamar a API.

## Revisão de itens e PDF (dia 6)

- **Revisão** (`/orcamentos/[id]/revisao`, substitui `/itens`): itens por ambiente com − / + e campo de quantidade (`m` aceita decimais), trocar produto, mudar ambiente, remover (com "Desfazer" por 6 s), adicionar produto (busca `buscar_produtos`), adicionar item avulso e adicionar ambiente. Cada alteração é uma Server Action (`acoes-revisao.ts`) com a sessão da vendedora (RLS), que recalcula o `valor_total` no banco. As alterações vão ao servidor em fila, e a tela só adota o estado do servidor quando não há nada pendente (sem "pular" ao tocar várias vezes). Aviso "O preço de N itens mudou no estoque" com **Atualizar preços**. "Montar à mão" no Resumo leva à revisão vazia com os ambientes da pergunta 5.
- **Rodapé fixo**: total, total à vista (desconto configurado) e **Gerar PDF**, desabilitado com o motivo (`motivosBloqueioGerar`) se faltar item ou houver avulso sem preço.
- **PDF** (`src/lib/pdf/`, `@react-pdf/renderer`, sem navegador): `dados.ts` monta tudo (centavos e textos) e é testável sem React; `documento.tsx` desenha o A4 (cabeçalho com logo ou nome escrito, cliente, itens por ambiente com subtotal, totais com o à vista em destaque, condições, rodapé com página X de Y, linhas sem quebrar ao meio); `tema.ts` guarda as cores em um lugar só (dourado sóbrio `COR_DESTAQUE`). O logo é lido de `public/marca/logo.png` ou `logo.jpg` (SVG não entra no PDF); sem logo, sai "LUZ DESIGN" escrito.
- **Gerar PDF** (`gerar.ts`, Server Action `gerarPdf`): confere dona e status (`rascunho` ou `gerado`) e os bloqueios, relê o catálogo e calcula o congelamento, renderiza, envia ao bucket `pdfs` (`{vendedora_id}/{orcamento_id}/{numero}-v{versao}.pdf`) e só então chama `gerar_orcamento` (uma transação: congela preços e descrições, recalcula o total, `gerado`, `gerado_em`, validade = hoje + `validade_dias`, `pdf_caminho`, `pdf_versao`). Se a gravação falhar, o orçamento não fica marcado como gerado. Gerar de novo cria a versão seguinte e mantém as anteriores.
- **Tela do orçamento** (`/orcamentos/[id]`): total e à vista, validade, prévia do PDF em tela grande (no celular, "Ver PDF" abre o leitor do aparelho), **Compartilhar no WhatsApp** (Web Share com o arquivo; no computador baixa o PDF e abre `wa.me/<número>` com a mensagem pronta), **Baixar PDF**, **Editar** (gera nova versão), versões anteriores e linha do tempo (criado, montado pela IA, PDFs gerados e mudanças de status).
- **Configurações da loja** (`/gerencia/configuracoes`): a gerente edita os dados do cabeçalho e as condições do PDF.
