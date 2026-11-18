# Pendências e melhorias anotadas

Itens que **não** são erro e não entram no piloto; ficam aqui para decisão (regra do dia 12: sem função nova).

## Para a gerência decidir

> Códigos e descrições do catálogo provisório (158 produtos). As três decisões abaixo dependem da loja.

- **Descrições repetidas (9 grupos)**: depois da limpeza (e da revisão do dia 12), 9 grupos de produtos ainda têm a mesma descrição comercial, porque só a referência do fabricante os diferenciava. Lista completa e sugestão por grupo em `dados/revisao-descricoes.xlsx` (`pnpm catalogo:revisar`). Dois grupos são códigos **duplicados** no catálogo (mesma descrição também no fornecedor): 10364 e 12943 (perfil 3 m) e 11200 e 11500 (embutido 12 W 3.0 K). A gerência pode editar o texto em **Produtos > Editar descrição**; a edição é prioritária (a importação e o limpador não a sobrescrevem).
- **Os 9 grupos de descrições iguais** (lista em `dados/revisao-descricoes.xlsx`): PERFIL 3MTS E. BR (10364, 12943); PERFIL 200 BR (11077, 12199, 12327); EMBUTIDO 12W 3.0K (11200, 11500); PERFIL 200 PT (11685, 12245); PERFIL 300 BT S. (11687, 12542, 12545); PLAFON BR (11873, 12454); PERFIL 2MTS BR (12085, 12208); PERFIL 2MTS PT (12481, 12930); PERFIL S. 2MTS BR (12655, 4321).
- **Códigos duplicados** (mesma descrição também no fornecedor): **10364 e 12943** (perfil 3 m) e **11200 e 11500** (embutido 12 W 3.0 K). Verificar se um de cada par pode ser desativado.
- **Código 4321**: o código interno é igual à referência do fabricante do mesmo produto (4321 AXIS). O código é público (aparece no PDF), então não há como esconder essa coincidência.
- **Frete e serviços na comissão**: a base é só o valor fechado; a loja não marca frete e serviços como itens à parte.
- **Percentuais de comissão**: todos vazios até o Seu Filipe definir.

## Ação sua no painel do Supabase

- **Desligar o cadastro público**: Authentication > Providers > Email > "Allow new users to sign up" = desligado. O banco já bloqueia contas sem papel (migration do dia 12C), mas não há motivo para deixar o cadastro aberto.

## Melhorias (depois do piloto)

- Cópia de segurança/aviso quando a mesma referência identifica dois produtos diferentes.
- Código interno 4321 coincide com a referência do fabricante do mesmo produto: não dá para esconder (o código é público).

## Aviso de segurança do Next.js

`next build` e `next dev` avisam que o Next.js 16.4.4 tem uma vulnerabilidade conhecida (npm advisory). O aviso **interrompe o primeiro comando** e deixa passar na repetição. Recomenda-se `next upgrade --agent=security`, mas atualizar o framework a dois dias do piloto é uma decisão sua: não foi feito.

## Testes e banco de produção (dia 13)

- Os testes (e2e e `test:rls`) usam o `.env.local`, que aponta para o Supabase de produção. Caminho adotado hoje: **(c)** marcar os dados de teste e apagar no fim de cada teste; o cache de descrições dos e2e agora é guardado e **restaurado** (nada de produto real é apagado); exportações e uso da IA simulada são apagados no teardown.
- Trava: a partir de 19/11/2026 00:00 (Maceió) todo teste recusa rodar contra a produção, salvo `PERMITIR_TESTE_EM_PRODUCAO=1`. E2E também recusa servidor sem `IA_SIMULADA=1` ou `NODE_ENV=production` (nunca chama a OpenAI de verdade).
- Pendente (pós-piloto): banco de testes separado (segundo projeto Supabase gratuito ou `supabase start`, que exige Docker, não instalado). Auditoria: `pnpm testes:sobras`.
- Next atualizado para 16.4.6 (aviso de segurança resolvido).

## Go-live: lacunas conhecidas (dia 13B)

- Backup completo do Postgres antes e depois do go-live: não há `pg_dump` nem Docker nesta máquina e o plano gratuito do Supabase não guarda backup diário. Instalar o cliente PostgreSQL (ou Docker) antes do dia 24; até lá, só a exportação XLSX pela tela.
- `golive:limpar` e `contas:transferir` só existem em modo simulação. A execução real (incluindo mover arquivos no Storage) será ligada no dia, com o ok do dono.
- Marcar/desmarcar piloto à mão existe como função (`marcar_piloto`), mas ainda sem botão na tela.
- O kit de fita grava os itens com origem `manual`; o resumo do piloto não separa o kit.
