# Segurança e RLS

Em linguagem simples: **quem pode ver e mexer em quê é decidido pelo banco de dados**, não pela tela. Mesmo que alguém altere o app ou chame a API direto, o Postgres só devolve o que a política permite. A RLS (Row Level Security) fica ligada em **todas** as tabelas; nunca é desligada para "fazer funcionar".

Quem é quem: o banco sabe quem está logada por `auth.uid()`. A função `eh_gerente()` consulta o perfil dessa pessoa em `usuarios`.

## Regras por tabela

| Tabela                         | Vendedora                                                                   | Gerente                                               | Service role (servidor)    |
| ------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------- |
| `usuarios`                     | Lê só a própria linha. Não escreve (não dá para trocar o próprio perfil).   | Lê todas.                                             | Cria/edita.                |
| `clientes`                     | Lê, cria, edita e apaga só os que têm `vendedora_id` dela.                  | Lê todos; pode reatribuir (mudar `vendedora_id`).     | Tudo.                      |
| `orcamentos`                   | Lê, edita e apaga só os dela. Só cria em nome próprio, com cliente dela.    | Lê todos; pode reatribuir. Não cria em nome de outra. | Tudo.                      |
| `orcamento_itens`, `anexos`    | Seguem o dono do orçamento: lê e escreve só nos orçamentos dela.            | Só leitura de todos.                                  | Tudo.                      |
| `eventos`                      | Lê os dos orçamentos dela. Não escreve: o gatilho do banco é quem registra. | Lê todos.                                             | Tudo.                      |
| `produtos`, `produto_apelidos` | Lê (catálogo é aberto a quem está logada). Não escreve.                     | Lê e escreve.                                         | Tudo.                      |
| `sync_estoque`, `uso_ia`       | Sem acesso.                                                                 | Só leitura.                                           | Escreve (única que grava). |
| `orcamento_contador`           | Sem acesso (RLS ligada, sem políticas). Só o gatilho de numeração mexe.     | Sem acesso.                                           | Tudo.                      |

Visitante sem login (`anon`) não tem acesso a nenhuma tabela.

## Storage

Bucket privado `anexos`, caminho `{vendedora_id}/{orcamento_id}/{arquivo}`. A vendedora só lê e grava em arquivos cuja pasta é o id dela **e** cujo orçamento é dela. A gerente só lê.

## Pontos de atenção

- A **service role key** ignora a RLS. Ela só existe no servidor (`src/lib/supabase/admin.ts` usa `server-only`) e em scripts. Nunca vai para o navegador nem monta telas.
- As telas buscam dados com o cliente da própria usuária (cookies), então a RLS vale sempre. A tela `/orcamentos` não filtra por vendedora de propósito: o banco é quem limita.
- `/gerencia/*` também é protegido na aplicação (redireciona vendedora para `/`), mas isso é só conforto: a barreira real são as políticas.
- Teste automatizado: `pnpm test:rls` (`scripts/testar-isolamento.mts`) entra como Aline, Kely, Gerência e sem login, e confere tudo acima contra o banco real.
