# Permissões por perfil

Gerada por `pnpm test:rls -- --docs` a partir da matriz real (`scripts/testar-matriz.mts`): cada célula foi testada com o token de cada perfil, direto pela API do Supabase. **pode** = consegue; **—** = é barrado (a consulta volta vazia ou com erro).

Perfis: **Aline/Kely** = vendedoras; **Gerente**; **Dono** (Seu Filipe: tudo da gerência + comissões); **Sem papel** = conta criada no Auth sem linha em `usuarios` (o que um cadastro público conseguiria).

| Recurso                           | Ação                                           | Aline | Kely | Gerente | Dono | Sem papel |
| --------------------------------- | ---------------------------------------------- | ----- | ---- | ------- | ---- | --------- |
| orcamentos                        | ler o orçamento da Aline                       | pode  | —    | pode    | pode | —         |
| orcamentos                        | ler o orçamento da Kely                        | —     | pode | pode    | pode | —         |
| orcamento_itens                   | ler item do orçamento da Aline                 | pode  | —    | pode    | pode | —         |
| orcamento_itens                   | ler item do orçamento da Kely                  | —     | pode | pode    | pode | —         |
| clientes                          | ler cliente da Aline                           | pode  | —    | pode    | pode | —         |
| clientes                          | ler cliente da Kely                            | —     | pode | pode    | pode | —         |
| indicacoes_ia                     | ler indicação da Aline                         | pode  | —    | pode    | pode | —         |
| indicacoes_ia                     | ler indicação da Kely                          | —     | pode | pode    | pode | —         |
| produtos                          | ler produto (preço)                            | pode  | pode | pode    | pode | —         |
| produtos_dados_fornecedor         | ler fabricante e referência                    | —     | —    | pode    | pode | —         |
| produtos                          | editar a descrição                             | —     | —    | pode    | pode | —         |
| buscar_por_referencia()           | traduzir referência em código                  | pode  | pode | pode    | pode | —         |
| arquitetos                        | ler arquiteto ativo                            | pode  | pode | pode    | pode | —         |
| arquitetos                        | ler arquiteto desativado                       | —     | —    | pode    | pode | —         |
| arquitetos                        | cadastrar arquiteto (em nome próprio)          | pode  | pode | pode    | pode | —         |
| arquitetos                        | editar arquiteto                               | —     | —    | pode    | pode | —         |
| juntar_arquitetos()               | juntar duplicados                              | —     | —    | pode    | pode | —         |
| juntar_clientes()                 | juntar clientes                                | —     | —    | pode    | pode | —         |
| comissoes                         | ler comissão                                   | —     | —    | —       | pode | —         |
| configuracoes_comissao            | ler percentuais                                | —     | —    | —       | pode | —         |
| configuracoes_comissao            | alterar percentuais                            | —     | —    | —       | pode | —         |
| comissoes_*_percentual            | ler percentuais próprios                       | —     | —    | —       | pode | —         |
| calcular_fechamentos_anteriores() | calcular comissões anteriores                  | —     | —    | —       | pode | —         |
| usuarios                          | ler as contas dos outros                       | —     | —    | pode    | pode | —         |
| configuracoes_loja                | ler configurações                              | pode  | pode | pode    | pode | —         |
| configuracoes_loja                | alterar configurações                          | —     | —    | pode    | pode | —         |
| uso_ia                            | ler uso e custo da IA                          | —     | —    | pode    | pode | —         |
| sync_estoque                      | ler cargas do estoque                          | —     | —    | pode    | pode | —         |
| eventos_exportacao                | ler auditoria de exportações (a da Aline)      | pode  | —    | pode    | pode | —         |
| custo_ia_orcamentos()             | custo da IA no período                         | —     | —    | pode    | pode | —         |
| erros_app                         | ler registro de erros                          | —     | —    | pode    | pode | —         |
| relatos_piloto                    | ler relato da Aline                            | pode  | —    | pode    | pode | —         |
| relatos_piloto                    | ler relato da Kely                             | —     | pode | pode    | pode | —         |
| relatos_piloto                    | enviar relato (em nome próprio)                | pode  | pode | pode    | pode | —         |
| relatos_piloto                    | enviar relato em nome de outra pessoa          | —     | —    | —       | —    | —         |
| relatos_piloto                    | marcar relato como resolvido                   | —     | —    | pode    | pode | —         |
| Storage: relatos                  | baixar foto de relato da Aline (caminho exato) | pode  | —    | pode    | pode | —         |
| mudar_status_orcamento()          | mudar status do orçamento da Aline             | pode  | —    | pode    | pode | —         |
| marcar_enviado()                  | marcar enviado o orçamento da Kely             | —     | pode | pode    | pode | —         |
| renovar_validade()                | renovar validade do orçamento da Aline         | pode  | —    | pode    | pode | —         |
| Storage: anexos                   | baixar anexo da Aline (caminho exato)          | pode  | —    | pode    | pode | —         |
| Storage: pdfs                     | baixar PDF/XLSX da Aline (caminho exato)       | pode  | —    | pode    | pode | —         |
| Storage: arquitetos (fotos)       | baixar foto direto do bucket                   | —     | —    | —       | —    | —         |

## Rotas do Next (testadas no e2e)

| Rota                                                          | Aline/Kely                                      | Gerente                                               | Dono             |
| ------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- | ---------------- |
| `/comissoes`, `/comissoes/ajustes`, `/comissoes/exportar`     | 404                                             | 404                                                   | pode             |
| `/gerencia/*` (Equipe, Estoque, Ajustes)                      | redireciona para `/`                            | pode                                                  | pode             |
| `/exportar` (base)                                            | só os próprios dados, sem fabricante/referência | tudo, com Eventos, Arquitetos e fabricante/referência | igual à gerência |
| `/orcamentos/[id]` e downloads de PDF/XLSX de outra vendedora | não encontrado                                  | pode                                                  | pode             |

Comissão nunca aparece no PDF, no XLSX, nos painéis, na exportação da base, na Indicação da IA nem em logs.
