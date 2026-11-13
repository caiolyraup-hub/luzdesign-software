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

## Estoque (dia 3)

- `estoque_mapeamentos`: só a gerente lê e escreve (RLS). Vendedora e visitante não veem nada.
- A importação escreve em `produtos` e `sync_estoque` com a service role, **no servidor**, e só depois de conferir que quem chamou é gerente (`exigirGerente` em cada ação). O navegador nunca recebe a service role.
- `buscar_produtos` é `security invoker`: respeita a RLS de quem chama. Visitante sem login não executa a função.
- `/gerencia/*` agora também é barrado no `proxy.ts` com redirect HTTP 307 para quem não é gerente (antes só o layout redirecionava, o que chega como 200 durante o streaming). A barreira real continua sendo a RLS.

## Formulário e anexos (dia 4)

- Criar orçamento e cliente: só em nome próprio (`vendedora_id = auth.uid()`), mesmo para a gerente. O cliente do orçamento tem de ser da mesma vendedora.
- Envio de anexos: o servidor cria uma **URL assinada de envio** com a sessão da própria vendedora, então a política do Storage vale já na criação. Ela não consegue gerar URL para a pasta de outra pessoa nem para orçamento alheio. O navegador envia o arquivo direto ao Storage com essa URL e depois o servidor confere o arquivo e grava a linha em `anexos`.
- Leitura de anexos: URLs assinadas de 1 hora geradas no servidor com a sessão da usuária (vendedora só os dela; gerente lê todos, não envia).
- O limite de 4 anexos e os tipos de arquivo valem no banco e no bucket, não só na tela.
- `mesclar_respostas` e as ações de editar só funcionam em orçamento `rascunho` da própria vendedora.
- Testes: `pnpm test:rls` cobre criar em nome da Kely, enviar/ler/apagar arquivo da Kely, 5º anexo, WhatsApp igual em duas vendedoras e tipo de arquivo inválido.

## Motor de IA (dia 5)

- A IA **não define preço**: ela só escolhe códigos e quantidades; o servidor relê o preço e a descrição em `produtos` e congela no item.
- As ferramentas da IA (`buscar_produtos`, `detalhar_produto`) rodam com o cliente Supabase da **própria vendedora**, então a RLS vale: a IA nunca enxerga mais do que ela enxergaria.
- Só o service role escreve e conta em `uso_ia` (a vendedora não lê nem apaga). A service role não monta telas nem grava itens: a gravação dos itens usa a sessão da vendedora.
- Privacidade: nome, WhatsApp e nome do arquiteto não vão para a OpenAI; telefones, e-mails e o nome do cliente digitados no texto livre são removidos antes do envio. As chamadas usam `store: false` (a resposta não fica guardada na conta; a OpenAI ainda pode reter dados por um período curto para monitoramento de abuso, conforme a política da conta). Anexos (fotos, plantas, PDFs) **são enviados** à OpenAI para leitura.
- A chave `OPENAI_API_KEY` só existe no servidor (`.env.local` e variáveis da Vercel); nunca vai ao navegador nem ao repositório.
- Os limites (diário por vendedora e por orçamento) valem no servidor e protegem o custo.

## Revisão e PDF (dia 6)

- Só a **dona** edita itens e gera o PDF (a RLS de `orcamento_itens` e a função `gerar_orcamento` conferem o dono). A gerente **não** gera nem edita orçamento de outra pessoa, mesmo podendo reatribuir (falha encontrada pelos testes e corrigida em `20261109000200`).
- O preço de item com código nunca vem do navegador: ao gerar, o banco sobrescreve com o de `produtos`, e o total do PDF precisa bater com o calculado no banco (`TOTAL_DIVERGENTE` se um preço mudou no meio).
- Bucket `pdfs` privado: a vendedora lê e grava na própria pasta (sem apagar versões); a gerente só lê; ninguém mais. Os links de leitura e de download são URLs assinadas de 1 hora geradas no servidor.
- `configuracoes_loja`: todos leem (o PDF usa); só a gerente edita (RLS) e a tabela só tem uma linha.

## Dia 7

- `orcamento_ambientes` tem a mesma RLS dos itens (testada em `pnpm test:rls`: outra vendedora não lê nem edita; a gerente só lê).
- Análise e motivos são enviados ao cliente no PDF; o prompt proíbe preço, dados do cliente e afirmações sem base. A vendedora revisa tudo antes de gerar.
- A avaliação (`pnpm ia:avaliar`) usa o login da Aline e dados de teste, e apaga tudo no fim.

## Arquitetos (dia 11B)

- Leitura aberta a todo usuário logado (as duas vendedoras atendem os mesmos arquitetos); criação só em nome próprio; edição, desativação e fusão só da gerência (RLS e função com `eh_gerente()`). Testado em `pnpm test:rls` (`scripts/testar-arquitetos.mts`) e no PGlite.
- A foto e a data de aniversário são dados pessoais (LGPD): bucket privado sem política para o cliente, URL assinada de 5 minutos gerada no servidor, aviso "use a foto só com autorização do arquiteto" no cadastro. Nenhum dado de arquiteto (nome, foto, aniversário, WhatsApp) vai para a OpenAI.
- Os números do arquiteto para a vendedora vêm de `listar_arquitetos` em `security invoker`: a RLS de `orcamentos` limita ao que é dela, mesmo com o mesmo arquiteto e o mesmo nome de cliente na outra vendedora.
