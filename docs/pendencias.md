# Pendências e melhorias anotadas

Itens que **não** são erro e não entram no piloto; ficam aqui para decisão (regra do dia 12: sem função nova).

## Para a gerência decidir

- **Descrições repetidas (9 grupos)**: depois da limpeza (e da revisão do dia 12), 9 grupos de produtos ainda têm a mesma descrição comercial, porque só a referência do fabricante os diferenciava. Lista completa e sugestão por grupo em `dados/revisao-descricoes.xlsx` (`pnpm catalogo:revisar`). Dois grupos são códigos **duplicados** no catálogo (mesma descrição também no fornecedor): 10364 e 12943 (perfil 3 m) e 11200 e 11500 (embutido 12 W 3.0 K). A gerência pode editar o texto em **Produtos > Editar descrição**; a edição é prioritária (a importação e o limpador não a sobrescrevem).
- **Frete e serviços na comissão**: a base é só o valor fechado; a loja não marca frete e serviços como itens à parte.
- **Percentuais de comissão**: todos vazios até o Seu Filipe definir.

## Ação sua no painel do Supabase

- **Desligar o cadastro público**: Authentication > Providers > Email > "Allow new users to sign up" = desligado. O banco já bloqueia contas sem papel (migration do dia 12C), mas não há motivo para deixar o cadastro aberto.

## Melhorias (depois do piloto)

- Cópia de segurança/aviso quando a mesma referência identifica dois produtos diferentes.
- Código interno 4321 coincide com a referência do fabricante do mesmo produto: não dá para esconder (o código é público).
