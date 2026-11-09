# Modelo de dados

Somente documentação; o SQL entra no dia 2 (05/11). Nomes em português sem acento. RLS por `vendedora_id` em tudo que for de vendedora.

| Tabela             | Campos                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usuarios`         | id, nome, email, perfil (`vendedora` \| `gerente`)                                                                                                                                                      |
| `produtos`         | codigo (texto, 5 dígitos, PK), categoria, marca, descricao, unidade (`un` \| `m`), preco_unitario, estoque_disponivel (nulo se desconhecido), atributos jsonb (W, K, comprimento), ativo, atualizado_em |
| `produto_apelidos` | codigo, texto                                                                                                                                                                                           |
| `sync_estoque`     | id, iniciado_em, terminado_em, origem, linhas_lidas, linhas_gravadas, erros jsonb                                                                                                                       |
| `clientes`         | id, nome, whatsapp, tipo (`final` \| `arquiteto` \| `eletricista` \| `construtora` \| `empresa`), arquiteto_indicador                                                                                   |
| `orcamentos`       | id, numero, vendedora_id, cliente_id, respostas jsonb, status, valor_total, valor_fechado, validade, gerado_em, enviado_em, fechado_em, perdido_em, motivo_perda                                        |
| `orcamento_itens`  | id, orcamento_id, codigo (nulo se avulso), descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso (bool)                                                                           |
| `anexos`           | id, orcamento_id, caminho_storage, tipo                                                                                                                                                                 |
| `eventos`          | id, orcamento_id, usuario_id, de_status, para_status, criado_em                                                                                                                                         |
| `uso_ia`           | id, orcamento_id, tokens_entrada, tokens_saida, custo_estimado, duracao_ms                                                                                                                              |

## Valores

- `orcamentos.status`: rascunho, gerado, enviado, followup_d5, followup_d10, fechado, perdido.
- `orcamentos.motivo_perda` (obrigatório quando perdido): preco, prazo_pronta_entrega, comprou_em_outra_loja, desistiu, sem_resposta.
- `clientes.tipo`: final, arquiteto, eletricista, construtora, empresa.

## Notas

- `orcamento_itens`: com `avulso = true`, `codigo` é nulo e o preço é digitado manualmente. Preço e descrição são congelados ao gerar o PDF.
- `valor_fechado` pode diferir de `valor_total` (negociação); as métricas de "vendido" usam `valor_fechado`.
- `uso_ia` alimenta o controle de custo (teste de custo em 18/11).

## Ajustes do dia 2 (implementado em `supabase/migrations/`)

- Enums no banco: `perfil`, `status_orcamento`, `motivo_perda`, `tipo_cliente`, `unidade` (`un`, `m`), com os mesmos valores de `src/lib/dominio.ts`.
- `usuarios.id` referencia `auth.users(id)`.
- `clientes.vendedora_id` (novo): o cliente pertence à vendedora que o cadastrou.
- `orcamentos.numero` é texto sequencial por ano (`2026-0001`), gerado por gatilho (tabela de apoio `orcamento_contador`).
- Dinheiro em `numeric(12,2)`; quantidade e estoque em `numeric(10,2)` (fita LED é vendida por metro).
- `atualizado_em` com gatilho em `usuarios`, `produtos`, `clientes` e `orcamentos`.
- Gatilho grava em `eventos` a cada mudança de status (e na criação, com `de_status` nulo); também carimba `gerado_em`, `enviado_em`, `fechado_em` e `perdido_em`.
- Restrições: `motivo_perda` obrigatório quando `status = perdido`; item precisa de `codigo` ou ser `avulso`; `produtos.codigo` com 5 dígitos.
- Índices: `orcamentos(vendedora_id, status)`, `orcamento_itens(orcamento_id)` e busca por texto (pg_trgm) em `produtos.descricao` e `produto_apelidos.texto`.
- Regras de acesso: ver `docs/seguranca.md`.

## Ajustes do dia 3 (`20261106000100_estoque.sql`)

- `produtos.codigo`: de 1 a 5 dígitos (antes exatamente 5), porque os códigos reais têm 4 e 5 dígitos (`9520`, `12389`). Sem zeros à esquerda.
- Nova tabela `estoque_mapeamentos` (id, nome, colunas jsonb, criado_em): mapeamento coluna da planilha -> campo, só a gerente lê e escreve. O mais recente pré-preenche a próxima importação.
- Nova função `buscar_produtos(p_texto, p_categoria, p_marca, p_limite)` (security invoker): busca em código, descrição, marca, categoria e `produto_apelidos` (pg_trgm), só produtos ativos. Ver `docs/estoque.md`.

## Ajustes do dia 4 (`20261107000100_formulario.sql`)

- `clientes`: índice único parcial `(vendedora_id, whatsapp) where whatsapp is not null`. O mesmo número pode existir para Aline e para Kely; repetido na mesma vendedora dá erro `23505`. O cliente nasce só com o nome (rascunho) e ganha o WhatsApp na pergunta 2.
- `anexos`: novas colunas `nome_original` e `mime_type`; `tipo` obrigatório e restrito a `foto`, `pdf`, `planta` ou `print`.
- Gatilho `anexos_limite` (antes de inserir): barra o 5º anexo do mesmo orçamento (`Limite de 4 anexos por orçamento.`), com lock para envios simultâneos.
- Função `mesclar_respostas(p_orcamento, p_patch)` (security invoker): mescla respostas parciais em `orcamentos.respostas` de forma atômica, só em orçamento `rascunho` da própria vendedora.
- `orcamentos.respostas` ganha a chave `versao` (hoje `1`). Formato completo em `docs/perguntas.md`.
- Bucket `anexos`: limite de 10 MB por arquivo e só `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif` e `application/pdf`. Caminho `{vendedora_id}/{orcamento_id}/{uuid}.{ext}`.

## Cores dos status (proposta do dia 4)

O `docs/` não definia cores; estas estão em `src/lib/orcamento/status.ts` e valem para o selo de status nas listas:

| Status              | Cor           |
| ------------------- | ------------- |
| `rascunho` Rascunho | cinza         |
| `gerado` Gerado     | azul-céu      |
| `enviado` Enviado   | índigo        |
| `followup_d5` D+5   | âmbar         |
| `followup_d10` D+10 | laranja       |
| `fechado` Fechado   | verde         |
| `perdido` Perdido   | rosa/vermelho |

## Ajustes do dia 5 (`20261108000100_ia.sql`)

- `orcamentos.montado_em` (quando a IA montou os itens pela última vez) e `orcamentos.montagem` jsonb (`geracoes`, `pendencias`, `avisos`, `resumo`, `modelo`).
- `orcamento_itens.justificativa` (por que a IA escolheu o item) e `orcamento_itens.ordem` (ordem de exibição, ambientes na ordem montada).
- `uso_ia`: novas colunas `vendedora_id`, `modelo`, `chamadas_ferramenta`, `status` (`em_andamento`, `ok`, `erro`), `erro` e `detalhes` jsonb (anexos enviados, avisos, ferramentas chamadas). Só o service role escreve; só a gerente lê. Os limites diário e por orçamento contam as linhas `ok` (e as `em_andamento` recentes).
- Função `substituir_itens_orcamento(p_orcamento, p_itens, p_valor_total, p_montagem)` (security invoker): troca os itens de uma vez, numa transação, só em rascunho da própria vendedora.

## Ajustes do dia 6 (`20261109000100_revisao_pdf.sql` e `20261109000200_gerar_somente_dona.sql`)

- Nova tabela `configuracoes_loja` (uma linha só, `id = true`): nome_fantasia, razao_social, cnpj, endereco, telefone, whatsapp, instagram, site, `validade_dias` (padrão 7), `desconto_avista_pct` (padrão 10) e `linhas_rodape` (uma condição por linha; aceita `{desconto}` e `{validade_dias}`). Todos os logados leem; só a gerente edita (tela `/gerencia/configuracoes`). Telefone, WhatsApp, Instagram e site começam vazios.
- `orcamentos.pdf_caminho`, `pdf_versao` (0 = ainda sem PDF) e `pdf_versoes` jsonb (`versao`, `caminho`, `gerado_em`, `valor_total` de cada versão). As versões anteriores ficam no Storage.
- `orcamentos.montagem.ambientes_extras`: ambientes acrescentados à mão na revisão (ficam mesmo sem itens).
- Função `recalcular_total_orcamento(p_orcamento)`: soma `preço × quantidade` (arredondado por item) e grava `valor_total`; só a dona e só em rascunho ou gerado.
- Função `gerar_orcamento(p_orcamento, p_pdf_caminho, p_versao, p_total_esperado, p_validade)`: numa transação, relê preço e descrição de `produtos` para os itens com código (item avulso mantém o preço manual), confere que o total é o do PDF, marca `status = 'gerado'`, `gerado_em`, `validade` e guarda o PDF. Recusa: sem itens, avulso com preço 0, produto inativo, versão repetida, caminho fora da pasta da dona e quem não é a dona (inclusive a gerente).
- Bucket privado `pdfs`, caminho `{vendedora_id}/{orcamento_id}/{numero}-v{versao}.pdf`: a vendedora lê, grava e atualiza na própria pasta (sem apagar); a gerente só lê.

## Revisão: quem pode mudar o quê

Item com código tem preço e descrição **sempre do catálogo**: a tela não edita o preço, e ao gerar o PDF o servidor sobrescreve qualquer valor com o de `produtos`. Só o **item avulso** tem preço e descrição editáveis, e precisa de preço maior que 0 para gerar o PDF. A edição fica liberada em `rascunho` e `gerado`; a partir de `enviado` (dia 8) será bloqueada.

## Ajustes do dia 7 (`20261110000100_status.sql` e `20261110000200_analise.sql`)

- `orcamentos.status_em` (quando o status mudou) e a função `mudar_status_orcamento` (a dona muda; transições e motivo de perda obrigatório validados no banco; cada mudança gera evento). Status: rascunho, gerado, enviado, followup_d5, followup_d10, fechado, perdido.
- Nova tabela `orcamento_ambientes` (`orcamento_id`, `nome`, `ordem`, `analise`, `anexos_usados`, único por orçamento e nome sem diferenciar maiúsculas). RLS como `orcamento_itens`: a dona lê e escreve; a gerente só lê; visitante nada.
- `orcamento_itens.motivo_cliente` (texto para o cliente; a `justificativa` continua interna) e `orcamentos.mostrar_analise_pdf` (padrão verdadeiro).
- `uso_ia.tipo` (montagem ou reescrita de análise) e nova versão de `substituir_itens_orcamento`, que também grava os ambientes e as análises.
