# Prompt do dia 7 (09/11/2026): ligar a IA de verdade e testar com 10 orçamentos reais

Mande para o Claude Code: **"Leia docs/prompts/dia-07-ia-real.md e execute tudo."**

---

Hoje é o **dia 7 de 14** do projeto Luz Design Orçamentos (no plano original, 12/11). Leia o `CLAUDE.md` e os arquivos em `docs/`. Os dias 1 a 6 estão publicados: formulário, motor de IA, revisão e PDF. O motor de IA **nunca rodou contra a API real**. Esse é o maior risco que resta no projeto e é o foco de hoje.

## Passo 0: a chave está preenchida

No relatório do dia 6 você disse que `OPENAI_API_KEY` estava vazia, mas ela está preenchida desde 06/11 às 18:44: linha 8 do `.env.local`, começando com `sk-proj`, com 164 caracteres. Antes de seguir:

- descubra por que a leitura anterior deu "vazia" (cache do processo, BOM, CRLF no fim da linha, outra cópia do arquivo, `dotenv` carregando outro caminho) e corrija o carregamento, se for o caso;
- confirme que a chave funciona com uma chamada barata (`GET /v1/models`), **sem mostrar a chave**.

## Tarefas

1. **Modelo e preços**
   - Liste os modelos da conta. Se `gpt-5.6` existir, use-o. Se não existir, me mostre os `gpt-5.x` disponíveis e **pare** para eu escolher.
   - Preencha `IA_PRECO_ENTRADA_USD_MTOK` e `IA_PRECO_SAIDA_USD_MTOK` com os valores da página oficial de preços da OpenAI para esse modelo, e me diga a URL de onde tirou.
   - Cadastre `OPENAI_API_KEY`, `OPENAI_MODEL` e os dois preços na Vercel (Production e Preview), via stdin e sem mostrar valores. Faça um redeploy.

2. **Primeira chamada real**
   - Rode `pnpm ia:testar`. Se falhar, corrija o que for necessário: formato das ferramentas, saída estruturada estrita, continuação da conversa com as respostas das ferramentas (você mesmo apontou o `store: false` como o ponto mais provável de ajuste) e envio de imagem ou PDF. Consulte os tipos do SDK instalado, não a memória.
   - Mostre a saída: itens, total, códigos em comum com o original, custo em US$ e tempo.

3. **Avaliação com 10 orçamentos reais (`scripts/avaliar-ia.mts`, comando `pnpm ia:avaliar`)**
   - Escolha 10 dos 37 orçamentos em `dados/orcamentos-37-extraidos.json`, variados: pequenos e grandes, com e sem arquiteto, com fita/perfil/fonte e só com embutidos/spots. Use uma seleção fixa (lista de índices no script), para a avaliação ser repetível.
   - Para cada um, escreva o **pedido como a vendedora escreveria** no formulário, a partir dos itens originais: ambientes e o que o cliente quer, em linguagem natural, **sem** listar os códigos e **sem** nome de cliente. Por exemplo: "sala com 6 spots embutidos dicroica luz quente, cozinha com fita LED embaixo do armário, uns 3 metros". Salve esses 10 pedidos em `dados/avaliacao/pedidos.json` (fora do git), para eu poder ler e corrigir.
   - Rode o motor em cada um, como Aline, num rascunho de teste, e compare com o original:
     - **acerto de categoria por ambiente** (pediu embutido, veio embutido);
     - **códigos em comum** (exatos) e **códigos equivalentes** (mesma categoria e potência/temperatura próximas);
     - **diferença do total** em %;
     - **itens avulsos** e **códigos descartados** (inventados);
     - **kits de fita**: tem perfil + fita + fonte quando o original tinha?
   - Grave o relatório em `dados/avaliacao/relatorio-ia.md`: uma tabela por orçamento e um resumo com médias, custo total, custo médio por orçamento em US$ e em R$ (use 1 US$ = R$ 5,50 e diga que é estimativa) e tempo médio.
   - Apague todos os rascunhos de teste no fim e devolva o contador de numeração, como nos testes anteriores.

4. **Ajustes**
   - A partir do relatório, ajuste `src/lib/ia/instrucoes.ts` e, se precisar, as ferramentas (por exemplo, a busca por potência/temperatura ou por apelidos). Ajuste pelos padrões que se repetem, não para "decorar" os 10 casos.
   - Rode a avaliação de novo e mostre o antes e o depois lado a lado. Pare depois de **no máximo 3 rodadas**, para controlar o custo, e avise se o custo total passar de US$ 5.
   - Metas: zero código inventado gravado; categoria certa em pelo menos 80% dos ambientes; total dentro de ±30% do original na maioria dos casos. Se não bater, diga o que falta e se o problema é o catálogo provisório (por exemplo, produto que nunca apareceu nos 37 orçamentos) ou o motor.

5. **Robustez**
   - Teste e trate: pedido muito curto ("quero spots pra sala"), pedido com foto sem texto, PDF de projeto luminotécnico, timeout da API e o limite diário atingido. Em todos os casos, a vendedora vê uma mensagem clara, e nada quebrado é gravado.
   - Confira o `maxDuration` da rota na Vercel com o tempo real medido. Se a geração passar de 60 s com frequência, me diga.
   - Faça um teste real em produção (https://luzdesign-software.vercel.app), como Aline, com um pedido curto. Depois apague o rascunho.

6. **Fechamento**
   - Atualize `docs/arquitetura.md` (o que mudou no motor), `docs/plano.md` (dias 5 e 7 concluídos, com custo médio por orçamento) e o `CLAUDE.md` (o modelo usado e onde fica a avaliação).
   - `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar. Faça o commit `feat: IA ligada à API real e avaliada em 10 orçamentos (dia 7)` e o push.

## Fora do escopo de hoje

Status `enviado` e follow-up (dia 8) e painéis. Não envie nome ou WhatsApp de cliente para a OpenAI. Não apague os 4 orçamentos TESTE do seed.

Ao terminar, me mostre: o modelo escolhido e a fonte dos preços, o resumo do `relatorio-ia.md` (antes e depois dos ajustes), o custo total gasto hoje, o custo médio por orçamento, as principais mudanças nas instruções e qualquer pendência.
