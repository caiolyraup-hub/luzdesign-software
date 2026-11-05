# Prompt do dia 4 (adiantado para 05/11/2026): formulário das 10 perguntas e anexos

Hoje é o **dia 4 de 14** do projeto Luz Design Orçamentos (no plano original era 09/11; estamos adiantados). Leia o `CLAUDE.md` e os arquivos em `docs/`, principalmente `perguntas.md`, `modelo-de-dados.md` e `seguranca.md`. Os dias 1 a 3 estão concluídos e publicados em https://luzdesign-software.vercel.app: banco com RLS, login das 3 contas, catálogo provisório com 158 produtos, importação de planilha e busca de produtos.

**Antes de tudo:** existe uma alteração pendente no `.gitignore` (as linhas que tiram `dados/` do git e provavelmente uma troca de fim de linha CRLF/LF). Confira o diff, mantenha as regras de `dados/` e o fim de linha original, e faça o commit `chore: ignorar dados reais da loja`.

**Objetivo de hoje:** a vendedora consegue, pelo celular, começar um orçamento novo, responder as 10 perguntas, anexar até 4 arquivos e sair a qualquer momento sem perder nada. O resultado do dia é um orçamento em `rascunho`, salvo no banco, com cliente e anexos, pronto para a IA montar os itens no dia 5. **Hoje ainda não há chamada à OpenAI.**

## Regras (não mude)

- Valem as regras do `CLAUDE.md`: RLS por `vendedora_id`, service role só no servidor, Next 16 com `cacheComponents` (o que lê sessão, cookies ou `params` fica em `<Suspense>`), textos em português do Brasil e mobile-first com fonte mínima de 16 px.
- A vendedora só cria orçamento e cliente em nome próprio. A gerente não usa esta tela para criar orçamento de outra pessoa.
- Nenhum dado inventado: as opções das perguntas são exatamente as de `docs/perguntas.md`.

## Tarefas

1. **Esquema das respostas (`src/lib/orcamento/perguntas.ts`)**
   - Defina as 10 perguntas como dados (id estável, rótulo, tipo, opções, obrigatória ou não), na mesma ordem de `docs/perguntas.md`. Ids sugeridos: `cliente_nome`, `cliente_whatsapp`, `tipo_cliente` (+ `arquiteto_indicador`), `tipo_obra` (`residencial`/`comercial` e `nova`/`reforma`), `ambientes` (múltipla, com "outro" em texto), `pedido_cliente` (texto livre longo), `linha` (`tecnica`/`decorativa`/`ambas`), `faixa_investimento` (opcional), `prazo` (`pronta_entrega`/`encomenda`), `observacoes` (opcional).
   - Valide com zod. O WhatsApp aceita formatos brasileiros e é normalizado para `+55DDDNÚMERO`. As obrigatórias são as perguntas 1, 2, 3, 4, 5, 6, 7 e 9.
   - Grave em `orcamentos.respostas` (jsonb) com uma chave `versao: 1`, para podermos mudar as perguntas depois sem quebrar orçamentos antigos.
   - Testes Vitest: validação de cada tipo, normalização do WhatsApp e o "arquiteto indicador" sendo exigido só quando o tipo for arquiteto ou houver indicação.

2. **Cliente**
   - Ao concluir a pergunta 2, procure cliente existente da mesma vendedora pelo WhatsApp normalizado. Se achar, ofereça "Usar cliente já cadastrado: NOME". Se não achar, crie o cliente ao salvar.
   - Crie um índice único em `clientes(vendedora_id, whatsapp)` por migration. O mesmo cliente pode existir para Aline e para Kely separadamente, porque uma não vê a outra.

3. **Fluxo `/orcamentos/novo` (uma pergunta por tela)**
   - Barra de progresso ("3 de 10"), botões Voltar e Próxima grandes no rodapé e, em opções fechadas, cards de tocar em vez de `<select>`.
   - **Rascunho automático:** na primeira resposta válida, crie o orçamento em `rascunho` (server action) e redirecione para `/orcamentos/[id]/editar?passo=N`. A partir daí, salve cada resposta ao avançar e também com debounce de 1 s em campos de texto. Mostre "Salvo" discretamente.
   - Ao reabrir um rascunho, volte para a primeira pergunta obrigatória ainda vazia.
   - Na pergunta 6, coloque uma dica: "Pode colar a mensagem do WhatsApp do cliente".
   - Por último, uma tela de **Resumo** com todas as respostas (cada uma com "Editar"), os anexos e o botão principal **Montar orçamento com IA**. Hoje esse botão fica desabilitado, com o texto "disponível em breve".

4. **Anexos (até 4)**
   - Na tela de Resumo, e também como passo próprio depois da pergunta 10: "Adicionar foto ou arquivo" (câmera ou galeria no celular). Tipos aceitos: JPG, PNG, WEBP, HEIC e PDF, até 10 MB cada.
   - Reduza as fotos no navegador antes do envio (lado maior com 2000 px, JPEG com qualidade 0,8). Converta HEIC se o navegador permitir; se não der, envie como está.
   - Envie direto para o Storage, no bucket `anexos`, no caminho `{vendedora_id}/{orcamento_id}/{uuid}.{ext}`, com URL assinada gerada no servidor, e grave a linha em `anexos` (tipo: `foto`, `pdf`, `planta` ou `print`, que a vendedora escolhe com um toque).
   - **O limite de 4 vale no banco:** crie um gatilho em `anexos` que barra o 5º arquivo do mesmo orçamento. Na tela, o botão some quando chega a 4.
   - Mostre a miniatura (foto) ou o ícone (PDF), com a opção de remover. Remover apaga o arquivo do Storage e a linha.

5. **Listas**
   - `/orcamentos`: mostre os rascunhos com cliente, data e "Continuar", e os status em português com a cor definida em `docs/` (cinza para Rascunho). Use os nomes legíveis em vez dos valores crus.
   - `/` (Para hoje): a seção "Rascunhos para terminar", com os 3 mais recentes.

6. **Segurança e testes**
   - Amplie o `pnpm test:rls`: Aline não consegue criar orçamento com `vendedora_id` da Kely; não consegue enviar arquivo para `kely_id/...` no Storage nem ler anexo da Kely; o 5º anexo é barrado; o cliente com o mesmo WhatsApp em duas vendedoras não conflita.
   - Faça um teste ponta a ponta simples (Playwright, se já não estiver instalado, como dependência de dev) em largura de celular (390 px): login como Aline, responder as 10 perguntas, anexar 1 imagem de teste gerada no próprio teste, ver o Resumo e confirmar que o rascunho aparece em `/orcamentos`. Use o comando `pnpm test:e2e`, rodando contra o `pnpm dev` local.

7. **Fechamento**
   - Atualize `docs/modelo-de-dados.md` (índice de clientes, gatilho de anexos, `respostas.versao`), `docs/perguntas.md` (ids técnicos) e `docs/plano.md` (dia 4 concluído).
   - `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar. Aplique as migrations novas no Supabase remoto (`--remote`) e confira o deploy na Vercel depois do push.
   - Faça o commit `feat: formulário das 10 perguntas e anexos (dia 4)` e o push.

## Fora do escopo de hoje

Chamada à OpenAI, montagem de itens, PDF, mudança de status além de `rascunho` e painéis. Não apague os 4 orçamentos TESTE do seed.

Ao terminar, me mostre: as migrations novas, a saída do `pnpm test:rls` e do `pnpm test:e2e`, prints ou descrição das telas no celular (uma pergunta, o Resumo e os anexos) e qualquer pendência.
