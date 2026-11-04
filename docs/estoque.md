# Estoque e catálogo de produtos

`produtos` é a **única fonte de preço** do sistema. A IA só escolhe códigos desta tabela; o servidor aplica o preço. Ver `CLAUDE.md`.

## Como importar a planilha (gerência)

1. Entre como gerente e abra **Estoque** (`/gerencia/estoque`).
2. **Importar planilha**: escolha o arquivo `.xlsx` ou `.csv` (até 4 MB). Arquivo `.xls` antigo: abra no Excel e salve como `.xlsx`.
3. **Mapeamento**: para cada campo do sistema, escolha a coluna da planilha. Código, descrição e preço são obrigatórios. O sistema sugere pelo nome do cabeçalho e, nas próximas vezes, já vem com o último mapeamento salvo.
4. **Prévia**: mostra quantos produtos são novos, alterados, sem mudança e com erro. Linhas com erro não entram; as demais seguem.
5. **Confirmar**. Marque **Desativar ausentes** só se a planilha for o estoque completo: produtos ativos que não vieram ficam `ativo = false` (nunca são apagados).

Cada carga grava uma linha em `sync_estoque` (início, fim, origem, linhas lidas e gravadas, erros por linha), exibida no card **Última carga**.

## Formato esperado

| Campo do sistema   | Obrigatório | Observações                                                                     |
| ------------------ | ----------- | ------------------------------------------------------------------------------- |
| Código             | sim         | 1 a 5 dígitos, como texto, **sem** completar com zeros (`9520`, `12389`).       |
| Descrição          | sim         |                                                                                 |
| Preço unitário     | sim         | Aceita `1.234,56`, `R$ 37,00` e `37.5`. Zero é válido; negativo não.            |
| Categoria, Marca   | não         | Se a coluna não for mapeada, o valor existente é mantido.                       |
| Unidade            | não         | `m`, `mt`, `mts`, `metro` viram `m` (fita LED); qualquer outra coisa vira `un`. |
| Estoque disponível | não         | Vazio = desconhecido (nulo).                                                    |
| W, K, Comprimento  | não         | Vão para `atributos` (`w`, `k`, `comprimento`).                                 |

Regras da carga:

- **Upsert por código.** Produto igual não é regravado (preserva `atualizado_em`).
- Campos opcionais que não foram mapeados **não sobrescrevem** o que já existe.
- Código repetido na planilha: vale a última linha, e o aviso aparece nos erros da carga.
- CSV: separador `;`, `,` ou tabulação e codificação UTF-8 ou Latin-1 são detectados sozinhos.

## Catálogo provisório (enquanto a planilha real não chega)

`pnpm catalogo:provisorio` monta o catálogo a partir de `dados/orcamentos-37-extraidos.json` e grava com `origem = 'provisorio-37-orcamentos'`. Gera `dados/relatorio-catalogo-provisorio.md`. É idempotente (rodar de novo não altera nada). Opção `--sem-gravar` só gera o relatório.

Como lê cada linha `[qt, "CATEGORIA CODIGO", ".DESCRICAO", (ambiente,) unitário, total]`:

- O código é o número de 4 ou 5 dígitos em "CATEGORIA CODIGO". Números do modelo do fabricante na descrição (ex.: `MB LOYO 6819`) **não** são código da loja; linhas sem código, e "A DEFINIR", são ignoradas e contadas.
- Descrição mais frequente vira `descricao`; as outras viram `produto_apelidos`. Preço: o do orçamento mais recente (divergências listadas no relatório).
- Fita com "FITA" na descrição vira categoria `FITA LED` e unidade `m`. Perfil é assumido `un` (preço por barra).
- Marca detectada pela descrição (MB, NIT, STELLA, ASTRA, USINA, OPUS, ZIBO, MOLDI).

Os arquivos de `dados/` com nomes de clientes (`orcamentos-37-extraidos.json`, `dados/estoque/`) estão no `.gitignore`.

## Busca

Função SQL `buscar_produtos(p_texto, p_categoria, p_marca, p_limite)` (security invoker, só produtos ativos). Procura em código, descrição, marca, categoria e apelidos: todas as palavras digitadas precisam aparecer, ou a descrição precisa ser parecida o bastante (pg_trgm, tolera erro de digitação). Ordena por semelhança; código exato vem primeiro. Cliente em `src/lib/estoque/buscar.ts`; tela em `/produtos`.

## Quando a loja trocar de sistema (ou a planilha for substituída)

A tabela `produtos` não muda. Só muda a **origem**:

- Outra planilha: importe pela mesma tela e salve o novo mapeamento.
- Integração direta (API ou banco do sistema da loja): escreva um leitor que devolva `ProdutoImportacao[]` e chame `importar()` (`src/lib/estoque/importar.ts`) com `origem` próprio. Prévia, `sync_estoque`, upsert e "desativar ausentes" funcionam igual.
- Ao importar a planilha real pela primeira vez, compare com o provisório (códigos presentes, preços diferentes, códigos que sumiram) antes de desativar o que veio dos orçamentos. Se a loja usar códigos com zeros à esquerda ou outro formato, é preciso reconciliar os códigos do provisório.

## Arquivos

- `src/lib/estoque/`: `lerPlanilha`, `mapeamento` (aplicar, validar, sugerir), `importar`, `repositorio-supabase`, `buscar`, `provisorio`.
- `src/app/(app)/gerencia/estoque/`: tela e ações do servidor (conferem que quem chama é gerente).
- `supabase/migrations/20261106000100_estoque.sql`.
