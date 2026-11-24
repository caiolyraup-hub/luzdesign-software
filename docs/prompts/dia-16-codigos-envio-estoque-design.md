# Prompt do dia 16 (24/11/2026): só código nos documentos, data de envio, banco do estoque e design novo

Mande para o Claude Code: **"Leia docs/prompts/dia-16-codigos-envio-estoque-design.md e execute tudo."** Antes, copie este arquivo para `docs/prompts/` no repositório, ou cole o texto inteiro.

---

A loja já está usando o sistema. Hoje são quatro partes, nesta ordem:

- **Parte A:** o PDF e o XLSX do orçamento mostram só o código do produto, sem a descrição;
- **Parte B:** a data de envio de cada orçamento fica sempre registrada e visível;
- **Parte C:** ligar o catálogo ao banco de dados do estoque da loja, que vem criptografado;
- **Parte D:** o visual novo do sistema.

## Regras de hoje

- O sistema está em uso. **Nada vai para o `main` sem eu aprovar o preview.** Publicação só depois das 18:00 de Maceió, salvo um erro que impeça a loja de trabalhar (correção mínima, `pnpm deploy:conferir` e me avise).
- Antes de qualquer migration ou gravação em produção: `pnpm backup` e `pnpm backup:conferir`.
- Nenhum teste roda contra a produção. A trava continua como está.
- Continua valendo tudo do dia 11: fabricante, referência e custo nunca aparecem para a vendedora nem nos documentos do cliente. Comissões só o dono vê.
- **A senha do banco do estoque nunca vai para o chat, o git, os logs, os relatórios nem o Supabase.** Ela só entra no terminal (campo escondido) ou no `.env.local`, que está fora do git.
- A cópia aberta do banco do estoque fica só na minha máquina, numa pasta temporária fora do repositório, e é apagada no fim. Para o Supabase vão só os campos do catálogo.

## 0. Antes de começar (só leitura)

1. Me diga em que branch você está, qual commit está no ar (`pnpm deploy:conferir`) e o que do `dia-15` ainda está fora do `main`.
2. Me diga o que do dia 15 já foi feito: a Parte A (apagar os orçamentos) foi executada? A Parte B (visual novo) começou? Hoje o `src/app/globals.css` ainda parece ser o tema antigo, quase vazio.
3. Crie o branch `dia-16` a partir do `dia-15` (ou do `main`, se o `dia-15` já entrou). Não faça merge de nada sem me perguntar.

## Parte A: só o código nos documentos do cliente

Hoje o PDF mostra QTD | CÓDIGO | DESCRIÇÃO | UNIT. | TOTAL, com a categoria embaixo do código, e o XLSX mostra QT | PRODUTO | DESCRIÇÃO | AMBIENTE | UNIT | TOTAL. A loja não quer mais a descrição nos documentos que vão para o cliente.

### A1. PDF e XLSX

- **PDF:** colunas QTD | CÓDIGO | UNIT. | TOTAL, agrupado por ambiente como hoje. Sai a descrição e sai a categoria embaixo do código: fica só o código interno.
- **XLSX:** colunas QT | CÓDIGO | AMBIENTE | UNIT | TOTAL. Ajuste as fórmulas (`ROUND`, `SUM`, desconto à vista, subtotais por ambiente) para as colunas novas e confira os valores calculados.
- Use o espaço que sobrou para o código ficar maior e mais legível. O resto do documento (cabeçalho, cliente, arquiteto, totais, condições, cor cobre, logo) não muda.
- **Item avulso** (sem código, os antigos "A DEFINIR") não tem código para mostrar. Nele, a coluna CÓDIGO mostra o texto curto que a vendedora escreveu. Me avise se você achar uma solução melhor.
- Ponha isso como configuração da loja: `documento_mostrar_descricao` em `configuracoes_loja` (ou na tabela de configurações que já existe), **padrão desligado**, que só a gerência e o dono mudam em Configurações. Assim, se a loja quiser a descrição de volta, é um clique e não um deploy.

### A2. O que não muda

- As telas internas continuam mostrando a descrição comercial: a vendedora precisa dela para achar e conferir o produto.
- A exportação da gerência continua com a descrição. Ela é interna.
- `descricao_congelada` continua sendo gravada no item ao gerar (histórico e conferência).
- PDFs e XLSX já gerados não são refeitos. Só as próximas versões saem no formato novo.

### A3. A IA na geração

A padronização da descrição pela IA (`produtos_descricao_formatada`) existia para o documento. Com a descrição fora do documento:

- quando `documento_mostrar_descricao` estiver desligado, **não chame a IA ao gerar** (fica mais rápido e sem custo);
- não apague a tabela nem o cache, porque a configuração pode ser religada;
- se a mensagem do WhatsApp ou qualquer outro texto que vai para o cliente listar itens com descrição, tire a descrição dali também e me diga onde estava.

### A4. Testes da Parte A

- Unitários do PDF e do XLSX: nenhuma descrição do catálogo de teste aparece no texto dos dois arquivos; todos os códigos aparecem; os totais do PDF e do XLSX são iguais aos de antes; as fórmulas do XLSX calculam certo (abra com o `exceljs`).
- Com a configuração ligada, o documento volta a ter a descrição.
- Gere um PDF e um XLSX de exemplo antes e depois e me mostre os dois.

## Parte B: data de envio sempre registrada

O que já existe (dia 8): o botão **Marquei como enviado** com a data, a função `marcar_enviado(p_orcamento, p_data)`, as colunas `enviado_em` (primeiro envio, usado nas métricas) e `ultimo_envio_em` (de onde contam os follow-ups). A data aparece só na tela do orçamento. O problema é que o envio é fácil de esquecer, e orçamento sem data de envio estraga a conversão e os follow-ups.

### B1. Como está hoje (só leitura, em produção)

Me mostre, por vendedora:

- quantos orçamentos estão `gerado` há mais de 1 dia sem envio registrado;
- quantos estão `enviado`, `followup_d5`, `followup_d10`, `fechado` ou `perdido` com `enviado_em` vazio;
- se algum caminho muda o status sem passar pelo `marcar_enviado` (por exemplo, fechar direto de `gerado`).

Não corrija dados antigos sem me mostrar a lista e eu digitar `SIM`.

### B2. Lembrar de registrar na hora certa

- Depois de **Baixar PDF**, **Baixar XLSX**, **Compartilhar** ou **Abrir WhatsApp** num orçamento `gerado`, aparece uma folha curta: "Você já mandou para o cliente?" com **Enviei agora**, **Enviei em outra data** e **Ainda não**. "Enviei agora" grava com a hora atual; "outra data" usa a regra que já existe (não futura, não antes de `gerado_em`, fuso `America/Maceio`).
- Na lista de orçamentos, o cartão `gerado` mostra um selo **Envio não registrado** com o botão de registrar ali mesmo.
- Em **Para hoje**, uma seção **Registrar envio**, com os gerados há mais de 1 dia sem envio, acima dos follow-ups.
- **Fechar ou perder um orçamento que ainda está `gerado`** pede antes a data do envio (padrão hoje), para a métrica não perder a data. O mesmo vale no banco: ajuste `mudar_status_orcamento` para nunca deixar `fechado` ou `perdido` com `enviado_em` vazio.

### B3. Mostrar a data

- Lista de orçamentos: "Enviado em DD/MM" no cartão, e um filtro por período de envio.
- Ficha do cliente, linha do tempo do orçamento e painel da gerência: a data do primeiro envio e a do último, quando forem diferentes.
- Exportação: confira que as colunas "enviado (primeiro)" e "último envio" estão preenchidas.
- Quando o envio foi hoje, mostre também a hora.

### B4. Testes da Parte B

Unitários da regra da data; `test:rls` (Aline não registra o envio da Kely; a gerência registra o de qualquer uma); e2e em 390 px: gerar, baixar o PDF, ver a folha, tocar em **Enviei agora** e ver "Enviado em" na lista; fechar um orçamento `gerado` e ver que a data foi pedida.

## Parte C: ligar o banco do estoque criptografado

Até hoje o catálogo vem de planilha (`docs/estoque.md`, `src/lib/estoque/importar.ts`) e ainda pode estar com o catálogo provisório de 158 produtos. Agora a loja entregou o banco de dados do próprio sistema de estoque, que vem criptografado.

### C0. O que você precisa de mim

No começo da Parte C, me pergunte:

- o caminho do arquivo do banco na minha máquina;
- o nome do programa de estoque, se eu souber;
- a senha, **só no terminal**, num campo escondido. Não me peça a senha no chat.

Se eu ainda não tiver o arquivo, pule para a Parte D e volte aqui depois.

### C1. Descobrir o que é o arquivo (sem a senha)

1. Faça uma cópia do arquivo para uma pasta temporária fora do repositório (por exemplo `%TEMP%\luz-estoque-<data>`) e trabalhe só na cópia. Guarde o hash do original antes e confira no fim que ele não mudou.
2. Pela extensão, pelo tamanho e pelos primeiros bytes, diga o que é. Os casos mais prováveis num sistema de loja no Brasil:
   - Firebird/InterBase (`.fdb`, `.gdb`), muito comum em ERP de varejo;
   - SQLite criptografado com SQLCipher (`.db`, `.sqlite`, sem o cabeçalho "SQLite format 3");
   - Access com senha (`.mdb`, `.accdb`);
   - backup do SQL Server (`.bak`) ou dump do MySQL/PostgreSQL;
   - um banco comum dentro de um ZIP, 7z ou RAR com senha.
3. Me diga o que você achou e qual ferramenta vai usar para abrir. Se precisar instalar alguma coisa, me diga o que é e por quê antes de instalar.
4. **Não tente adivinhar nem quebrar a senha.** Use só a senha que a loja me deu. Se ela não abrir, pare e me diga.

### C2. Abrir e mapear (só leitura)

1. Abra a cópia **somente para leitura**.
2. Liste as tabelas com a contagem de linhas e ache a de produtos. Procure: código, descrição, preço de venda, estoque disponível, unidade, grupo ou categoria, fabricante, referência do fabricante, custo, ativo e data de alteração.
3. Me mostre as colunas encontradas e 10 linhas de exemplo só da tabela de produtos.
4. Se o banco tiver clientes, notas fiscais ou dados financeiros, **não leia o conteúdo dessas tabelas**: só os nomes e as contagens.
5. Compare os códigos com o catálogo atual e com os códigos dos orçamentos já gravados. Diga se a loja usa zeros à esquerda ou outro formato, quantos códigos batem, quantos são novos e quantos dos orçamentos não existem no banco.

### C3. O leitor do banco

1. Crie o leitor em `src/lib/estoque/leitor-banco.ts`. Ele devolve `ProdutoImportacao[]` e chama o `importar()` que já existe, com `origem = 'estoque_banco'`. Prévia, `sync_estoque`, upsert por código, "desativar ausentes" e a separação de fabricante e referência (`produtos_dados_fornecedor`) funcionam igual.
2. **Custo**, se existir, vai só para `produtos_dados_fornecedor`. A vendedora nunca vê.
3. Salve o mapeamento de colunas em `dados/estoque/mapeamento-banco.json`, fora do git.
4. Crie `pnpm estoque:banco <arquivo>`:
   - pede a senha num campo escondido, ou lê `ESTOQUE_BANCO_SENHA` do `.env.local`;
   - sem argumento extra, só simula e mostra a conferência do dia 14: novos, preços que mudam (com a lista dos que mudam mais de 20%), os que somem (ficam inativos, nunca apagados), códigos repetidos e os códigos dos orçamentos que não estão no banco;
   - com `--gravar`, roda o backup, pede `SIM` e grava;
   - apaga a cópia aberta no fim, mesmo se der erro, e nunca escreve a senha em log.
5. As descrições editadas à mão pela gerência continuam tendo prioridade (`descricao_editada_em`).
6. Quando a origem for `estoque_banco`, a faixa de "catálogo provisório" some.

### C4. Rodar contra a produção

1. Rode a simulação contra a produção e me mostre o resultado. **Pare aqui** até eu responder.
2. Depois do meu `SIM`: backup, `pnpm estoque:banco <arquivo> --gravar`, backup de novo e a conferência: busca de produtos na tela com a conta de teste da gerência, preço certo num orçamento de teste (apague-o no fim) e a faixa provisória sumida.

### C5. Atualização daqui para frente

Escreva em `docs/estoque.md` o passo da loja para atualizar o catálogo: "copiar o arquivo do banco → `pnpm estoque:banco` → conferir → `--gravar`". Me diga se dá para ler o banco direto no computador da loja de tempos em tempos (por exemplo, toda noite), o que isso exigiria e o risco. **Não monte isso hoje**, só me explique.

Testes: unitários do leitor com um banco de exemplo pequeno, criptografado com uma senha de teste e criado pelo próprio teste (nada do banco real no repositório); teste de que a senha não aparece em nenhuma saída; `test:rls` de que a vendedora não lê custo, fabricante nem referência.

## Parte D: o visual novo

Se a Parte B do dia 15 ainda não foi feita, faça agora **exatamente como está em `docs/prompts/dia-15-limpeza-redesign.md`, itens B1 a B7**: tokens branco, amarelo, marrom e cobre; Montserrat nos títulos e San Francisco pela pilha do sistema; vidro como utilitário único (`.vidro`, `.vidro-forte`) e nunca em cada linha de lista; movimento entre 150 e 300 ms, só `transform` e `opacity`, desligado com `prefers-reduced-motion`; contraste WCAG AA; capturas antes e depois em 390 px e 1280 px. Se ela já foi feita, use o que foi feito como base e faça só o que falta abaixo.

A única diferença em relação ao dia 15: o PDF e o XLSX agora mudam, mas **só** o que a Parte A pede. O visual cobre do documento continua.

Além do dia 15, para o sistema ficar melhor de usar e não só mais bonito:

1. **Componentes base**, usados em todas as telas, em `src/components/ui/`: Botão (principal, secundário, perigo, fantasma), Cartão, Campo, Selo de status, Folha (sobe de baixo no celular), Lista vazia e Esqueleto. Nenhuma tela monta botão ou cartão "na mão".
2. **Espaçamento e hierarquia:** uma escala única (4, 8, 12, 16, 24, 32 px), um título por tela, ações principais sempre no mesmo lugar (no celular, fixas embaixo, acima da barra de navegação), e alvos de toque de 44 px no mínimo.
3. **O código em destaque**, já que ele agora é o que vai para o cliente: na busca, na seleção de produtos, no Colar lista e na revisão, o código aparece primeiro, maior e em `tabular-nums`; a descrição vem abaixo, menor.
4. **Telas vazias que ajudam:** lista sem orçamentos, busca sem resultado e Para hoje sem nada mostram uma frase curta e o próximo passo (por exemplo, "Nenhum orçamento ainda" e o botão **Novo orçamento**).
5. **Ícones:** use a biblioteca de ícones que o projeto já tiver; se não tiver nenhuma, use SVG em linha. Não adicione biblioteca de interface nova.
6. **Mensagens de sucesso e erro** num aviso único (toast) no topo, com o mesmo visual, em vez de textos soltos em cada tela.

As telas são as mesmas da lista do dia 15 (B5), mais a folha "Você já mandou para o cliente?" da Parte B e a tela de importação do banco da Parte C.

Não quebrar nada: os mesmos passos do dia 15 (B6): os testes e2e procuram por texto e papel, então mantenha os textos dos botões e dos campos; `tsc`, `lint`, `pnpm test` e o e2e local de Android, iPhone e Chromium; Lighthouse no celular com acessibilidade 95 ou mais e o desempenho sem cair mais de 5 pontos. Um commit por bloco.

## Fechamento

1. Um commit por item, no branch `dia-16`.
2. Rode `tsc`, `lint`, `pnpm test` e o e2e local. Se algum teste falhar, rode de novo só os que falharam enquanto corrige.
3. Faça o deploy de preview na Vercel e me mande o link, com as capturas antes e depois lado a lado, em 390 px, e o PDF e o XLSX de exemplo no formato novo.
4. **Espere eu aprovar.** Depois do ok e das 18:00: `pnpm backup`, migrations, merge no `main`, deploy, `pnpm deploy:conferir` e `pnpm backup` de novo.
5. Se algo der errado no ar, volte para o deploy anterior na Vercel e só depois investigue.
6. Atualize `docs/estoque.md`, `docs/modelo-de-dados.md`, `docs/seguranca.md` (senha e cópia do banco do estoque), `docs/guia-vendedora.md` (registrar o envio) e `docs/plano.md`.

## Ao terminar, me mostre

- o branch, o commit no ar e o que do dia 15 estava feito ou pendente;
- Parte A: o PDF e o XLSX antes e depois, onde mais a descrição aparecia para o cliente e a configuração nova;
- Parte B: os números do levantamento B1, o que mudou nas telas e a regra nova do fechamento sem envio;
- Parte C: o tipo do arquivo, a ferramenta usada, as tabelas e colunas achadas, a comparação de códigos, a simulação e, se eu aprovar, as contagens depois da gravação. Nunca a senha;
- Parte D: a paleta com os contrastes, os componentes base, o link do preview, as capturas antes e depois, o Lighthouse e a saída dos testes;
- o que ficou de fora e por quê.
