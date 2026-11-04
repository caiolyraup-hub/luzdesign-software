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
