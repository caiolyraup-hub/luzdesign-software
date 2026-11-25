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

## Catálogo protegido (dia 11C): fabricante, referência e modelo

**O pedido do Seu Filipe:** o cliente não pode levar a referência para comprar o mesmo produto em outra loja ou na internet.

**Por que não é criptografia:** criptografar as colunas não resolve. O servidor precisa da chave para mostrar o dado a quem pode, então ela está sempre à mão; quem tem acesso à tela continuaria vendo; e a busca deixaria de funcionar. A proteção é **separar o dado e controlar quem lê, no banco**, e **nunca imprimi-lo nos documentos do cliente**:

1. `produtos_dados_fornecedor` (codigo, fabricante, referencia_fabricante, modelo, descricao_fornecedor, atributos_fornecedor) é lida e escrita **só pela gerência** (RLS com `eh_gerente()`). A vendedora não tem política de leitura: nem pela tabela, nem por embed (`produtos(...)`), nem por função, nem pela exportação. A coluna `produtos.marca` foi **apagada**.
2. `produtos.descricao` (que todos leem) é a **descrição comercial limpa**, sem fabricante, linha/modelo nem referência (`src/lib/catalogo/limpar.ts`, determinístico). O texto original fica em `descricao_fornecedor`. O cache `produtos_descricao_formatada` foi apagado e a IA recebeu a instrução de nunca incluir marca, fabricante, modelo ou referência; o servidor ainda rejeita a descrição formatada que tenha qualquer um deles.
3. **Busca da vendedora:** por código interno, descrição comercial e apelidos (também limpos). Para traduzir o pedido do arquiteto, `buscar_por_referencia(texto)` (`security definer`): igualdade **exata** após normalizar (maiúsculas, sem espaço, hífen, barra ou ponto), nunca parcial, devolve **só código e descrição comercial** e aceita 30 consultas por minuto por usuário (`consultas_referencia`). Vale na busca de produto e no **Colar lista** (linha com referência vira o código interno).
4. **Documento do cliente (PDF):** só o código interno e o tipo (categoria) do produto; nunca descrição, tamanho, voltagem, fabricante nem referência. Testado por busca de texto no PDF (`src/lib/catalogo/documentos.test.ts`, `src/lib/pdf/documentos-cliente-estoque.test.ts`).

**Planilha do estoque (XLSX), decisão do dono em 25/11/2026:** traz descrição, fabricante, referência, modelo, tamanho e voltagem, e **a vendedora que gera o orçamento pode baixá-la**. É a única exceção à regra de que ela não vê fabricante e referência. As telas e a RLS continuam iguais: o servidor lê `produtos_dados_fornecedor` com a service role, só para os códigos daquele orçamento, ao gerar ou renovar. Custo não entra.
5. **IA:** não recebe a marca; o que ela escreve em resumo, motivo e observações passa por `censurarFornecedor` (troca fabricantes, modelos e referências por "…").
6. **Gerência:** vê fabricante e referência em `/produtos`, busca por eles e recebe as colunas Fabricante e Referência na aba Itens da exportação. A exportação da vendedora não tem essas colunas.

Testes: `src/lib/catalogo/*` (limpador com 26 descrições reais, RLS e busca em PGlite, documentos) e `pnpm test:rls` (`scripts/testar-catalogo.mts`, banco real).

## Comissões (dia 11D)

Perfil `dono`: `eh_gerente()` passou a valer para gerente ou dono (todas as políticas antigas aceitam o dono) e `eh_dono()` é exclusivo. As tabelas `configuracoes_comissao`, `comissoes_arquiteto_percentual`, `comissoes_vendedora_percentual` e `comissoes` só têm política para o dono: nem a gerente lê. Quem grava ao fechar o orçamento é o gatilho `orcamentos_comissao` (security definer), então a vendedora gera a comissão sem poder lê-la; as funções `comissao_linhas`, `recalcular_comissao` e `calcular_fechamentos_anteriores` não executam para os outros perfis. `/comissoes` responde 404 (proxy) fora do dono. Testado em `pnpm test:rls` (`scripts/testar-comissoes.mts`), no PGlite e no e2e.

## Dia 12C: matriz de permissões e o achado do cadastro público

- **Matriz** (`scripts/testar-matriz.mts`, parte do `pnpm test:rls`; resultado em `docs/permissoes.md`): 37 recursos × 5 perfis (Aline, Kely, gerente, dono e uma conta logada **sem papel**), cada célula testada com o token real, direto pela API do Supabase: tabelas, funções e Storage (anexos, PDFs e fotos de arquitetos, inclusive com o caminho exato do arquivo).
- **Achado:** o cadastro público do Supabase Auth está **ligado** (`disable_signup = false`; a confirmação de e-mail está exigida). Quem criasse uma conta e confirmasse o e-mail ficava "logado sem papel", e várias políticas liberavam leitura a **qualquer logado** (`using (true)`): produtos e preços, apelidos, descrições formatadas, configurações da loja e arquitetos (com WhatsApp e aniversário). **Corrigido** na migration `20261114000300_somente_usuarios.sql`: essas políticas e `buscar_por_referencia` agora exigem uma linha em `usuarios` (`eh_usuario()`), e a matriz tem a coluna "Sem papel" para impedir a volta do problema. **Falta uma ação no painel do Supabase** (não dá pela CLI sem risco para as outras configurações): _Authentication > Providers > Email > desligar "Allow new users to sign up"_.
- **`erros_app`**: erros do servidor e das telas, sem dado de cliente (e-mails e números longos são trocados por `[e-mail]` e `[número]`, a rota perde a query string), só a gerência e o dono leem; contagem do dia em Ajustes.

## Dia 16: documentos do cliente e banco do estoque

- O PDF do orçamento mostra só código e tipo do produto; a planilha do estoque traz fabricante e referência (ver Catálogo protegido). Custo fica fora dos dois, e comissões continuam só do dono.
- **Banco do estoque criptografado (parte C, ainda não iniciada):** a senha nunca vai para o chat, o git, os logs, os relatórios nem o Supabase; ela só entra no terminal (campo escondido) ou no `.env.local` (fora do git). A cópia aberta do banco fica só numa pasta temporária fora do repositório, é apagada no fim (mesmo com erro) e para o Supabase vão apenas os campos do catálogo.
- `pnpm orcamentos:apagar-todos` só executa com backup conferido da última hora, decisões explícitas e confirmação digitada; a função SQL só é chamável pelo service role.
