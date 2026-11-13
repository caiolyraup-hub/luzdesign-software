# As 8 perguntas do orçamento (versão 2, desde 13/11/2026)

Definidas como dados em `src/lib/orcamento/perguntas.ts` (ids, rótulos, tipo, obrigatoriedade e validação com zod). O fluxo é uma pergunta por tela em `/orcamentos/novo` (pergunta 1) e `/orcamentos/[id]/editar?passo=N` (2 a 8, anexos no passo 9 e resumo no 10).

**O que mudou em 13/11 (pedido do Seu Filipe):** saíram as perguntas de tipo de obra, ambientes e linha (técnica/decorativa); entrou o **endereço da obra** (opcional). Os ambientes agora são criados na tela **Produtos do orçamento**, que abre com "Geral" e tem sugestões rápidas.

| #   | Id técnico            | Pergunta                                     | Tipo        | Obrigatória | Opções (valor gravado)                                                                                  |
| --- | --------------------- | -------------------------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `cliente_nome`        | Nome do cliente                              | texto curto | sim         | 2 a 120 caracteres                                                                                      |
| 2   | `cliente_whatsapp`    | WhatsApp do cliente                          | telefone    | sim         | aceita formatos brasileiros com DDD; gravado como `+55DDDNÚMERO`                                        |
| 3   | `tipo_cliente`        | Tipo de cliente                              | cards       | sim         | `final`, `arquiteto`, `eletricista`, `construtora`, `empresa`                                           |
| 3   | `indicacao_arquiteto` | Veio indicado por arquiteto? (não arquiteto) | sim/não     | não         | `true` / `false`                                                                                        |
| 3   | `arquiteto_indicador` | Nome do arquiteto(a)                         | texto curto | condicional | obrigatório quando `tipo_cliente = arquiteto` **ou** `indicacao_arquiteto = true`                       |
| 4   | `endereco`            | Endereço da obra                             | texto curto | não         | até 200 caracteres ("Rua, número, bairro"); pré-preenchido com o último endereço do cliente já cadastrado |
| 5   | `pedido_cliente`      | O que o cliente pediu                        | texto longo | não         | pode colar a mensagem do WhatsApp; serve de ponto de partida da Indicação da IA                          |
| 6   | `faixa_investimento`  | Faixa de investimento indicada pelo cliente  | texto curto | não         | texto livre                                                                                             |
| 7   | `prazo`               | Prazo                                        | cards       | sim         | `pronta_entrega`, `encomenda` (30 a 45 dias úteis)                                                      |
| 8   | `observacoes`         | Observações e condições especiais            | texto longo | não         | desconto, forma de pagamento                                                                            |

Obrigatórias: 1, 2, 3 (e o arquiteto quando exigido) e 7.

## Como as respostas ficam guardadas

Em `orcamentos.respostas` (jsonb), com `versao: 2` (constante `VERSAO_RESPOSTAS`). O endereço também é gravado na coluna `orcamentos.endereco` (PDF, XLSX e exportação leem dela) e, como "último informado", em `clientes.endereco`.

**Orçamentos com `versao: 1`** continuam válidos: as perguntas removidas não são exigidas e os valores antigos (`tipo_obra`, `ambientes`, `ambiente_outro`, `linha`) aparecem no resumo em "Respostas antigas (só leitura)". Os `ambientes` antigos seguem como ambientes iniciais da tela de produtos. Nada disso vai para a IA.

```json
{
  "versao": 2,
  "cliente_nome": "Ana Bastos",
  "cliente_whatsapp": "+5582999991234",
  "tipo_cliente": "arquiteto",
  "arquiteto_indicador": "Lula Santana",
  "endereco": "Rua das Flores, 10, Ponta Verde",
  "pedido_cliente": "…",
  "prazo": "encomenda"
}
```

Os orçamentos do seed têm `{"teste": true}` e abrem o formulário na primeira pergunta pendente.

## Cliente

O nome, o WhatsApp, o tipo e o arquiteto também vão para a tabela `clientes`. O cliente é encontrado pelo WhatsApp normalizado, **dentro da mesma vendedora** (índice único `clientes(vendedora_id, whatsapp)`). Se já existir, o orçamento passa a ser dele. Cliente reaproveitado por outros orçamentos não é alterado por edições deste.

## Anexos

Até 4 por orçamento (limite no banco), JPG, PNG, WEBP, HEIC ou PDF, 10 MB cada. Tipo escolhido pela vendedora: `foto`, `pdf`, `planta` ou `print`. Fotos são reduzidas no navegador (lado maior 2000 px, JPEG 0,8) antes do envio.
