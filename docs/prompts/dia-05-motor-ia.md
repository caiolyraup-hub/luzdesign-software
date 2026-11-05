# Prompt do dia 5 (adiantado): motor de IA que monta os itens do orçamento

## Antes de mandar (com você, cerca de 5 minutos)

1. Em platform.openai.com (conta da QCM), crie uma API key com o nome `luzdesign-software`.
2. Em Settings > Limits, defina um limite mensal de gasto (sugestão: US$ 30 durante os testes).
3. Abra o `.env.local` no Bloco de Notas (`notepad .env.local`) e preencha `OPENAI_API_KEY=` com a chave. Não cole a chave no chat.

Depois mande para o Claude Code: **"Leia docs/prompts/dia-05-motor-ia.md e execute tudo."**

---

Hoje é o **dia 5 de 14** do projeto Luz Design Orçamentos (no plano original, 10/11). Leia o `CLAUDE.md` e os arquivos em `docs/`. Os dias 1 a 4 estão publicados: login, RLS, catálogo provisório (158 produtos), busca `buscar_produtos` e formulário com até 4 anexos, que salva o orçamento em `rascunho`.

**Arrumação inicial:** a pasta `docs/prompts/` guarda os prompts do projeto e deve entrar no git. Inclua-a no primeiro commit de hoje.

**Objetivo de hoje:** o botão **Montar orçamento com IA** passa a funcionar. A IA lê as respostas e os anexos, consulta o catálogo e devolve itens por ambiente. O servidor valida cada código, aplica o preço do catálogo, calcula os totais e grava em `orcamento_itens`. A vendedora vê o resultado numa tela simples. A tela de revisão com edição e o PDF ficam para o dia 6.

## Regra central (não mude)

**A IA só escolhe códigos de produto e quantidades. Ela nunca define preço.** Todo preço vem de `produtos`, aplicado pelo servidor. Se a IA devolver um código que não existe ou está inativo, o item é descartado e listado num aviso. Item que a IA não encontrar no catálogo vira **item avulso** (`codigo` nulo, `avulso = true`, preço 0 e um destaque "preço a definir").

## Tarefas

1. **Configuração**
   - Use o SDK oficial `openai` (consulte os tipos e a documentação do pacote instalado; não confie em memória sobre a API).
   - Variáveis: `OPENAI_API_KEY`, `OPENAI_MODEL` (padrão `gpt-5.6`), `IA_LIMITE_DIARIO_VENDEDORA` (padrão 20), `IA_MAX_GERACOES_POR_ORCAMENTO` (padrão 3), `IA_PRECO_ENTRADA_USD_MTOK` e `IA_PRECO_SAIDA_USD_MTOK` (custo por milhão de tokens, para estimativa). Atualize o `.env.example` sem valores.
   - Leia a chave do `.env.local` e cadastre na Vercel (Production e Preview) com `vercel env add` via stdin, sem mostrar o valor. Não envie a chave para nenhum outro lugar.
   - O código da IA fica em `src/lib/ia/`, com `import 'server-only'`.

2. **Instruções da loja (`src/lib/ia/instrucoes.ts`)**
   Escreva o prompt de sistema em português, com:
   - o papel: montar orçamento de iluminação da Luz Design (linha técnica e decorativa, Maceió);
   - itens organizados **por ambiente**, usando os ambientes da pergunta 5;
   - quando houver fita LED, montar o **kit perfil + fita (em metros) + fonte** e explicar na justificativa como chegou na quantidade; quando não tiver certeza, dizer isso na justificativa e escolher a opção mais comum;
   - respeitar a linha (técnica/decorativa), a faixa de investimento (se houver) e o prazo (pronta-entrega favorece itens com `estoque_disponivel > 0`, quando o dado existir);
   - usar **só** códigos devolvidos pelas ferramentas; nunca inventar código, preço ou marca;
   - listar em `pendencias` o que faltou para um orçamento completo (por exemplo, medida do perfil ou quantidade de pontos).
   - Para escrever as regras de kits, olhe como os 37 orçamentos em `dados/orcamentos-37-extraidos.json` combinam perfil, fita e fonte, e descreva o padrão observado. Não copie nomes de clientes para o prompt.

3. **Ferramentas que a IA pode chamar (`src/lib/ia/ferramentas.ts`)**
   - `buscar_produtos(texto, categoria?, marca?, limite?)` chama a função SQL do dia 3 **com o cliente Supabase da própria vendedora**, para a RLS valer. Devolve código, categoria, marca, descrição, unidade, preço e estoque. O preço vai como informação para a IA comparar opções; o preço gravado é sempre relido do banco.
   - `detalhar_produto(codigo)` devolve o produto com atributos e apelidos.
   - Limite de 8 rodadas de ferramentas por geração. Ao passar disso, a IA precisa responder com o que tem.

4. **Saída estruturada (`src/lib/ia/esquema.ts`)**
   Esquema JSON estrito (structured outputs), validado também com zod no servidor:

   ```
   { ambientes: [ { nome, itens: [ { codigo | null, quantidade, justificativa, descricao_avulso? } ] } ],
     pendencias: string[], resumo_para_vendedora: string }
   ```

5. **Entrada para a IA (privacidade)**
   - Envie as respostas das perguntas **sem** nome e WhatsApp do cliente (a IA não precisa deles). Mande só o tipo de cliente, a obra, os ambientes, o pedido, a linha, a faixa, o prazo e as observações.
   - Anexos: imagens vão como imagem (URL assinada de curta duração ou base64, o que o SDK suportar). PDFs vão como arquivo, se o modelo aceitar; senão, extraia o texto no servidor e mande o texto. Registre no `uso_ia` como cada anexo foi enviado.

6. **Montagem no servidor (`src/lib/ia/montar.ts`)**
   - Confirme que o orçamento é da vendedora logada, está em `rascunho` e tem as perguntas obrigatórias respondidas.
   - Confira os limites: diário por vendedora e por orçamento, contados em `uso_ia`. Ao estourar, mostre uma mensagem clara e não chame a API.
   - Chame a IA, valide a saída e, para cada item:
     - com código: releia o produto em `produtos`; se estiver ativo, grave `descricao_congelada`, `preco_unitario_congelado`, `quantidade` e `ambiente`. Quantidade precisa ser maior que 0. Em produto de unidade `un`, arredonde para cima até um número inteiro e avise; em `m`, aceite até 2 casas decimais;
     - código inexistente ou inativo: descarte e registre o aviso;
     - sem código: item avulso.
   - Uma nova geração **substitui** os itens anteriores do orçamento (dentro de uma transação).
   - Calcule e grave `valor_total`. O valor à vista (10% de desconto) é calculado na tela, não gravado.
   - Grave em `uso_ia` os tokens de entrada e saída, o custo estimado, a duração, o modelo e o número de chamadas de ferramenta.
   - Erros da API (timeout, limite, resposta inválida): nada é gravado em `orcamento_itens`, aparece uma mensagem amigável com "Tentar de novo", e a tentativa com erro **não** conta no limite do orçamento.
   - O status continua `rascunho`. Ele só vira `gerado` com o PDF, no dia 6. Guarde `montado_em` (nova coluna em `orcamentos`, por migration).

7. **Tela**
   - No Resumo, o botão **Montar orçamento com IA** fica habilitado quando as obrigatórias estiverem completas.
   - Ao tocar, aparece uma tela de espera com mensagens em sequência ("Lendo o pedido", "Procurando no catálogo", "Montando por ambiente"). A rota precisa de `maxDuration` suficiente na Vercel; confira o limite do plano.
   - Resultado em `/orcamentos/[id]/itens` (provisória): itens agrupados por ambiente, com código, descrição, quantidade, unidade, preço unitário e subtotal; itens avulsos destacados como "preço a definir"; total, valor à vista (com 10% de desconto) e a lista de `pendencias` e avisos. Botões: "Montar de novo" (mostrando quantas tentativas restam) e "Voltar ao resumo".

8. **Testes**
   - Unitários com o cliente OpenAI simulado (sem chamar a API): código inventado é descartado; o preço vem do banco, mesmo que a IA "sugira" outro; quantidade `un` fracionada é arredondada; item avulso; total; erro da API não grava nada; limites diário e por orçamento.
   - `pnpm test:rls`: a ferramenta `buscar_produtos` roda com a sessão da vendedora; Aline não consegue montar orçamento da Kely; a vendedora não lê `uso_ia`.
   - **Teste real (uma vez, com a API):** crie o script `pnpm ia:testar`, que monta, como Aline, um rascunho de teste baseado em 1 dos 37 orçamentos (reescreva o pedido como a vendedora escreveria, sem nome do cliente) e compara os códigos escolhidos com os do orçamento original. Mostre: itens, total, códigos em comum, custo em US$ e tempo. Apague o rascunho de teste no fim.

9. **Fechamento**
   - Atualize `docs/arquitetura.md` (fluxo da IA como foi implementado), `docs/modelo-de-dados.md` (`montado_em`) e `docs/plano.md` (dia 5).
   - `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar. Aplique a migration no remoto, faça o commit `feat: motor de IA monta itens a partir do catálogo (dia 5)` e o push, e confira o deploy.

## Fora do escopo de hoje

Edição de itens, PDF, mudança de status para `gerado` ou além e painéis. Não apague os 4 orçamentos TESTE do seed. Não envie dados de cliente (nome, WhatsApp) para a OpenAI.

Ao terminar, me mostre: a saída do `pnpm ia:testar` (itens, total, comparação com o original, custo e tempo), o trecho principal das instruções da loja, a saída dos testes e qualquer pendência.
