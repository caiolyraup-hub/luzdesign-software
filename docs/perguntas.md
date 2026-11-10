# As 10 perguntas do orçamento (aprovadas)

Definidas como dados em `src/lib/orcamento/perguntas.ts` (ids, rótulos, tipo, obrigatoriedade e validação com zod). O fluxo é uma pergunta por tela em `/orcamentos/novo` (pergunta 1) e `/orcamentos/[id]/editar?passo=N` (2 a 10, anexos e resumo).

| #   | Id técnico            | Pergunta                                     | Tipo              | Obrigatória | Opções (valor gravado)                                                                                  |
| --- | --------------------- | -------------------------------------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `cliente_nome`        | Nome do cliente                              | texto curto       | sim         | 2 a 120 caracteres                                                                                      |
| 2   | `cliente_whatsapp`    | WhatsApp do cliente                          | telefone          | sim         | aceita formatos brasileiros com DDD; gravado como `+55DDDNÚMERO`                                        |
| 3   | `tipo_cliente`        | Tipo de cliente                              | cards             | sim         | `final`, `arquiteto`, `eletricista`, `construtora`, `empresa`                                           |
| 3   | `indicacao_arquiteto` | Veio indicado por arquiteto? (não arquiteto) | sim/não           | não         | `true` / `false`                                                                                        |
| 3   | `arquiteto_indicador` | Nome do arquiteto(a)                         | texto curto       | condicional | obrigatório quando `tipo_cliente = arquiteto` **ou** `indicacao_arquiteto = true`                       |
| 4   | `tipo_obra`           | Tipo de obra                                 | 2 grupos de cards | sim         | `uso`: `residencial`, `comercial`; `estado`: `nova`, `reforma`                                          |
| 5   | `ambientes`           | Ambientes                                    | múltipla escolha  | sim (1+)    | `sala`, `cozinha`, `quartos`, `banheiros`, `varanda`, `fachada`, `loja`, `outro` (+ `ambiente_outro`)   |
| 6   | `pedido_cliente`      | O que o cliente pediu                        | texto longo       | não         | opcional desde o dia 8: pode colar a mensagem do WhatsApp; serve de ponto de partida da Indicação da IA |
| 7   | `linha`               | Linha                                        | cards             | sim         | `tecnica`, `decorativa`, `ambas`                                                                        |
| 8   | `faixa_investimento`  | Faixa de investimento indicada pelo cliente  | texto curto       | não         | texto livre                                                                                             |
| 9   | `prazo`               | Prazo                                        | cards             | sim         | `pronta_entrega`, `encomenda` (30 a 45 dias úteis)                                                      |
| 10  | `observacoes`         | Observações e condições especiais            | texto longo       | não         | desconto, forma de pagamento                                                                            |

`ambiente_outro` é obrigatório quando `ambientes` contém `outro`.

## Como as respostas ficam guardadas

Em `orcamentos.respostas` (jsonb), com `versao: 1` (constante `VERSAO_RESPOSTAS`). Para mudar as perguntas no futuro, aumente a versão e trate as antigas na leitura; orçamentos antigos não quebram.

```json
{
  "versao": 1,
  "cliente_nome": "Ana Bastos",
  "cliente_whatsapp": "+5582999991234",
  "tipo_cliente": "arquiteto",
  "arquiteto_indicador": "Lula Santana",
  "tipo_obra": { "uso": "residencial", "estado": "reforma" },
  "ambientes": ["sala", "outro"],
  "ambiente_outro": "Escritório",
  "pedido_cliente": "…",
  "linha": "tecnica",
  "prazo": "encomenda"
}
```

Os orçamentos do seed têm `{"teste": true}` e abrem o formulário na primeira pergunta pendente.

## Cliente

O nome, o WhatsApp, o tipo e o arquiteto também vão para a tabela `clientes`. O cliente é encontrado pelo WhatsApp normalizado, **dentro da mesma vendedora** (índice único `clientes(vendedora_id, whatsapp)`). Se já existir, o orçamento passa a ser dele. Cliente reaproveitado por outros orçamentos não é alterado por edições deste.

## Anexos

Até 4 por orçamento (limite no banco), JPG, PNG, WEBP, HEIC ou PDF, 10 MB cada. Tipo escolhido pela vendedora: `foto`, `pdf`, `planta` ou `print`. Fotos são reduzidas no navegador (lado maior 2000 px, JPEG 0,8) antes do envio.
