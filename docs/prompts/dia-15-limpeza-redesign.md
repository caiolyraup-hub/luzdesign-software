# Prompt do dia 15 (23/11/2026, véspera do go-live): apagar os orçamentos e novo visual

Mande para o Claude Code: **"Leia docs/prompts/dia-15-limpeza-redesign.md e execute tudo."** Antes, copie este arquivo para `docs/prompts/` no repositório, ou cole o texto inteiro.

---

Amanhã, 24/11, é o go-live. Hoje são duas tarefas, nesta ordem:

- **Parte A:** apagar todos os orçamentos que existem no sistema, para a loja começar do zero;
- **Parte B:** um visual novo para o sistema inteiro, com branco, amarelo e marrom, glassmorfismo, Montserrat e San Francisco, efeitos, transições e movimento.

## Regras de hoje

- **Nada é apagado sem backup conferido antes e sem eu digitar `SIM`.**
- Apagar orçamentos **não** apaga o catálogo (`produtos`, apelidos, descrições formatadas, dados de fornecedor), o estoque e seus mapeamentos, os usuários e as contas, os arquitetos, as comissões configuradas (percentuais), as configurações da loja, os relatos e os erros.
- O visual novo não pode mudar regra nenhuma, nem o que cada perfil vê (vendedora, gerência, dono). Fabricante, referência e comissões continuam escondidos de quem não pode ver.
- O **PDF e o XLSX do orçamento não mudam**. São o documento que vai para o cliente.
- Nenhum teste roda contra a produção. A trava continua como está.
- Nada vai para o `main` da Parte B sem eu aprovar o preview.

## 0. Antes de começar (só leitura)

1. Me diga em que branch você está, se o `dia-14` já está no `main` e qual commit está no ar (`pnpm deploy:conferir`).
2. Se ainda houver trabalho do dia 14 fora do `main`, me diga o que é. Não faça o merge sem me perguntar.
3. Crie o branch `dia-15` a partir do commit que está no ar.

## Parte A: apagar todos os orçamentos

### A1. Mapa do que sai e do que fica

Leia as migrations e monte a lista de tudo que depende de um orçamento. Pelo menos:

- `orcamentos`, `orcamento_itens`, `orcamento_ambientes`;
- `anexos` e os arquivos no Storage (anexos, PDFs e XLSX gerados);
- `eventos` ligados a orçamento (status, envio, D+5, D+10, fechado, perdido, follow-up);
- `eventos_exportacao`, `indicacoes_ia`, `comissoes` (os valores calculados, não os percentuais);
- `uso_ia` ligado a orçamento, se tiver a ligação.

Para cada tabela, diga se sai inteira, se sai só o que está ligado a orçamento ou se fica. Confira as chaves estrangeiras e os `on delete`, para nada ficar órfão nem nada de fora ser levado junto em cascata.

Duas tabelas pedem decisão minha, e você só pergunta, não decide:

- **`clientes`**: liste os clientes que ficariam sem nenhum orçamento. Pergunte se eu quero apagar todos eles ou manter.
- **`orcamento_contador`**: pergunte se a numeração volta para `2026-0001` ou continua de onde está. Avise que, se algum PDF do piloto já foi para um cliente, voltar o número pode gerar dois documentos com o mesmo número.

### A2. Simulação

Crie `pnpm orcamentos:apagar-todos`. Se o `golive:limpar` real já existe, reaproveite o código dele. Sem argumento, ele só simula e mostra:

- quantos orçamentos saem, por status e por vendedora, e o valor total;
- **quantos são do piloto** (`piloto = true`), numa linha separada. Esses eram clientes de verdade. Eles também saem, mas só se eu confirmar à parte;
- quantas linhas saem de cada tabela dependente e quantos arquivos saem do Storage, com o tamanho;
- as contagens do que fica (produtos, arquitetos, usuários, configurações), que não podem mudar.

Teste o comando no PGlite com o seed, inclusive a conferência de que o que fica não mudou. Me mostre a simulação contra a produção e **pare aqui** até eu responder.

### A3. Execução (só depois do meu `SIM`)

1. `pnpm backup` e `pnpm backup:conferir` na pasta nova. Me mostre o manifesto. Sem backup conferido, não continue.
2. Rode `pnpm orcamentos:apagar-todos --executar`. Ele pede que eu digite `SIM`, e mais um `SIM PILOTO` se for apagar os orçamentos do piloto. Tudo do banco numa transação só; se qualquer passo falhar, nada é apagado. Os arquivos do Storage saem depois que a transação deu certo, e o que falhar fica listado.
3. Grave um registro em `dados/limpeza-2026-11-23.md`, fora do git, com as contagens antes e depois e a pasta do backup.

### A4. Conferência depois

1. Rode a simulação de novo: ela precisa dar zero orçamentos.
2. Confira que produtos, arquitetos, usuários e configurações têm as mesmas contagens de antes.
3. Abra o site no ar em 390 px com a conta de teste da gerência. Os painéis e os números precisam mostrar zero sem erro na tela, e criar um orçamento de teste precisa funcionar. Apague esse orçamento de teste com o próprio comando no fim.
4. Rode `pnpm backup` de novo e me mostre o manifesto.
5. Atualize `docs/go-live.md`: a limpeza dos orçamentos já foi feita em 23/11. Diga o que muda no `pnpm golive` de amanhã, por exemplo o `contas:transferir`, se os orçamentos do piloto saíram.

## Parte B: o visual novo

Trabalhe no branch `dia-15`. Hoje o tema é quase vazio (`src/app/globals.css` com fundo branco e fonte do sistema), então o trabalho é criar o tema e aplicar nos componentes. Use Tailwind 4 com `@theme`. Não troque de biblioteca de interface.

### B1. Cores

Crie os tokens em `globals.css` e use só eles nos componentes. Nenhuma cor solta no código:

| Token     | Uso                                                 | Sugestão                                          |
| --------- | --------------------------------------------------- | ------------------------------------------------- |
| `branco`  | fundo, cartões                                      | `#FFFDF8` (branco quente) e `#FFFFFF`             |
| `amarelo` | destaque, botão principal, foco, item ativo do menu | `#F2B705`, com um tom claro `#FDF1C7` para fundos |
| `marrom`  | texto, títulos, ícones, botão secundário            | `#3E2A1E` para texto, `#6B4A35` para títulos      |
| `cobre`   | a cor do logo, para ligar com o PDF                 | `#9F5F47`                                         |

Regras:

- **Texto nunca vai em amarelo sobre branco**, porque não dá para ler. No botão amarelo, o texto é marrom escuro.
- Todo texto precisa de contraste WCAG AA (4,5:1; 3:1 para títulos grandes). Rode uma checagem e me mostre os pares.
- Os status (Rascunho, Gerado, Enviado, D+5, D+10, Fechado, Perdido) continuam diferentes entre si. Fechado e Perdido precisam se distinguir também sem a cor, pelo ícone ou pelo texto.
- Sem modo escuro hoje.

### B2. Tipografia

- **Títulos:** Montserrat com `next/font/google` (pesos 500, 600 e 700, `display: swap`). O Next guarda a fonte junto com o site, sem chamar o Google no navegador.
- **Texto:** San Francisco pela pilha do sistema: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif`. Não baixe nem embuta arquivos da SF, porque a licença da Apple não permite. No iPhone e no Mac aparece a SF; no Android e no Windows aparecem Roboto e Segoe.
- Mantenha 16 px no mínimo nos campos, para o iPhone não dar zoom.
- Números de dinheiro com `tabular-nums`, para as colunas alinharem.

### B3. Glassmorfismo

- Fundo do app: um gradiente suave de branco quente com manchas de amarelo claro e cobre bem leves, fixo atrás de tudo.
- Vidro na barra de navegação, nos cartões e nos painéis, nos modais e nas folhas que sobem no celular: fundo branco semitransparente, `backdrop-filter: blur()`, borda fina clara e sombra leve.
- Crie isso como utilitário único (`.vidro`, `.vidro-forte`), não repetido em cada componente.
- **Desempenho no celular:** as vendedoras usam Android simples. Nada de blur em cada linha de lista longa (itens do orçamento, catálogo, histórico). Nas listas, a linha fica opaca e só o cartão de fora tem vidro.
- Fallback com `@supports not (backdrop-filter: blur(1px))`: fundo quase opaco. O texto continua legível em qualquer caso.

### B4. Efeitos, transições e movimento

- Botões e cartões: hover e toque com leve elevação ou escala, e foco visível em amarelo com contorno marrom, para quem usa teclado.
- Troca de página: aparecer com fade e um leve deslize. Use a View Transitions API onde o Next 16 suportar e CSS onde não suportar. Nada pode atrasar a navegação.
- Listas e cartões: entrada em cascata curta.
- Modais e folhas: abrir e fechar com escala e fade, e no celular a folha sobe de baixo.
- Status mudou (Enviado, Fechado, Perdido): uma animação curta no selo. Fechado pode ter um brilho amarelo discreto.
- Carregamento: esqueletos com brilho em vez de "Carregando...".
- Números dos painéis contando até o valor na primeira vez.
- Durações entre 150 e 300 ms, curvas suaves, só `transform` e `opacity`.
- **`prefers-reduced-motion: reduce` desliga tudo isso** e deixa só trocas instantâneas.
- Prefira CSS. Se precisar de biblioteca, use a `motion` (só ela) e me diga por quê.

### B5. Onde aplicar

Todas as telas, nos três perfis: login, trocar senha, lista e filtros de orçamentos, formulário, seleção de produtos e "Colar lista", Indicação da IA, revisão, envio e follow-up, ficha do cliente, arquitetos, produtos e Pendências do catálogo, importação do estoque, números e painéis, comissões, relatos, `/ajuda`, e as telas de erro. Também o PWA (`theme_color` e fundo do manifest) e o logo na barra.

O PDF e o XLSX **não** mudam.

### B6. Não quebrar nada

1. Antes de mexer, tire capturas de todas as telas acima em 390 px e em 1280 px, com a IA simulada e o servidor local, para comparar depois.
2. Os testes e2e procuram por texto e por papel; mantenha os textos dos botões e dos campos. Se algum seletor depender de classe, troque-o por papel ou `data-testid`, sem mudar o que o teste confere.
3. Rode `tsc`, `lint`, `pnpm test` e o e2e local de Android, iPhone e Chromium que não toca a produção. Corrija o que falhar.
4. Gere um PDF e um XLSX antes e depois e confira que são iguais.
5. Lighthouse no celular da tela de orçamentos e do formulário: acessibilidade 95 ou mais, e o desempenho não pode cair mais de 5 pontos.
6. Um commit por bloco: tokens e fontes; vidro; movimento; cada grupo de telas.

### B7. Preview e publicação

1. Faça o deploy de preview na Vercel e me mande o link, com as capturas antes e depois lado a lado das telas principais, em 390 px.
2. **Espere eu aprovar.** Depois do ok: `pnpm backup`, merge no `main`, deploy e `pnpm deploy:conferir`.
3. Se algo der errado no ar, volte para o deploy anterior na Vercel e só depois investigue.

## Ao terminar, me mostre

- o branch, o commit no ar e o que do dia 14 estava fora do `main`;
- Parte A: o mapa das tabelas, a simulação, o manifesto dos backups antes e depois, as contagens antes e depois e o que muda no go-live de amanhã;
- Parte B: a paleta com os contrastes, o link do preview, as capturas antes e depois, a saída dos testes, o Lighthouse e a conferência do PDF e do XLSX;
- o que ficou de fora e por quê.
