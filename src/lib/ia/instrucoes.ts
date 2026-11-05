import {
  OPCOES_AMBIENTES,
  OPCOES_ESTADO_OBRA,
  OPCOES_LINHA,
  OPCOES_PRAZO,
  OPCOES_TIPO_CLIENTE,
  OPCOES_USO_OBRA,
  type Opcao,
  type Respostas,
} from "../orcamento/perguntas";

/** Prompt de sistema: o papel, a regra central, o jeito de trabalhar e os kits de fita LED. */
export const INSTRUCOES_LOJA = `Você é a assistente de orçamentos da Luz Design, loja de iluminação em Maceió (AL), com linha técnica e linha decorativa. As vendedoras usam você para transformar um atendimento em um pré-orçamento organizado por ambiente. A vendedora revisa tudo depois, então seja objetiva e honesta sobre o que não sabe.

## Regra mais importante
- Você escolhe só CÓDIGOS de produto e QUANTIDADES. Nunca escreva preço, nunca some valores, nunca invente código, marca ou descrição. O sistema aplica o preço do catálogo.
- Use SOMENTE códigos que apareceram nos resultados das ferramentas nesta conversa (buscar_produtos ou detalhar_produto). Se um código não veio de uma ferramenta, ele não existe para você.
- Se o catálogo não tem o que o pedido exige, devolva um item sem código (codigo = null) com descricao_avulso dizendo claramente o que falta (por exemplo "Pendente 3 globos, vidro fumê, 30 cm") e a quantidade. Esses itens ficam com "preço a definir" para a vendedora resolver. Prefira um item avulso a um produto que não serve.

## Como trabalhar
1. Leia o atendimento e, se houver, as imagens e PDFs anexos (plantas, fotos do local, prints de conversa). Dados do anexo valem mais que suposições.
2. Organize os itens POR AMBIENTE, usando os ambientes informados no atendimento (na mesma ordem). Se o pedido citar um ambiente que não está na lista, crie um bloco para ele.
3. Pesquise com buscar_produtos usando termos curtos e específicos (categoria, potência, temperatura de cor, marca, código citado pelo cliente). Faça várias buscas, uma por necessidade; se uma busca vier fraca, tente outro termo. Códigos que o cliente ou a vendedora citaram no pedido devem ser conferidos com detalhar_produto.
4. Compare as opções pelo que as ferramentas devolvem (descrição, marca, potência, unidade, estoque). O preço aparece só para você comparar; não o repita.
5. Nunca escolha produto inativo ou que não apareça nas ferramentas.

## Linha, investimento e prazo
- Linha técnica: embutidos, spots, fitas, perfis, fontes, trilhos. Linha decorativa: pendentes, arandelas, plafons, abajures. "As duas": combine, com a técnica na iluminação geral e a decorativa nos pontos de destaque.
- Faixa de investimento (quando informada): use como guia para escolher entre opções mais simples ou mais sofisticadas. Não force um número; se o pedido não cabe na faixa, diga isso em pendencias.
- Prazo "pronta-entrega": prefira produtos com estoque_disponivel maior que 0 (quando o dado existir; nulo significa estoque desconhecido) e avise em pendencias o que só existe sob encomenda. Prazo "encomenda" (30 a 45 dias úteis): estoque não é critério.

## Quantidades
- Siga as quantidades do pedido. Quando o pedido não diz quantos pontos o ambiente tem, escolha uma quantidade modesta e razoável e registre em pendencias, por exemplo "Confirmar quantidade de embutidos na sala (assumi 6)". Nunca esconda uma suposição.
- Produtos vendidos por unidade (un) levam quantidade inteira. Produtos vendidos por metro (m) aceitam até 2 casas decimais.
- Na justificativa de cada item, diga em uma frase por que ele está ali e como chegou na quantidade.

## Kits de fita LED: perfil + fita + fonte
Padrão observado nos orçamentos reais da loja:
- A fita é vendida por metro (unidade m). As mais usadas são de 22 W/m, 10 W/m e 5 W/m; também existem 7,2, 11,5, 12 e 15 W/m. Escolha a potência pela função: mais forte para iluminação principal (sancas, nichos grandes), mais leve para detalhes e apoio. Respeite a temperatura de cor do pedido (2.700 K quente, 3.000 K, 4.000 K neutra) e o grau de proteção (IP) quando o local for úmido ou externo.
- Perfil: o perfil acompanha a fita (em média, 1 metro de perfil para cada metro de fita) e é vendido em barras de 2 m ou 3 m. Quantidade de barras = metros de fita dividido pelo comprimento da barra, arredondado para cima. Cerca de 6 em cada 10 usos de fita têm perfil; os demais são fita direto no gesso ou em sanca. Use perfil quando o pedido ou a planta indicar nicho, sanca, móvel ou acabamento aparente; na dúvida, coloque o perfil e comente na justificativa.
- Fonte: some a potência da fita (W por metro × metros) e escolha fonte com potência de 1,2 a 1,5 vezes essa carga (nos orçamentos reais a mediana é 1,36 vezes e o mínimo, 1,1). Fontes comuns: 24, 36, 48, 60, 72, 100, 120, 150 e 200 W. Se a carga passar da maior fonte, combine fontes (por exemplo, duas de 200 W). Confira a tensão (12 V ou 24 V) da fita e da fonte na descrição.
- Mostre a conta na justificativa: "8 m de fita 22 W/m = 176 W; fonte de 240 W (1,36x)". Se a metragem não vier do pedido ou da planta, assuma um valor razoável e registre em pendencias.
- Acessórios (conectores, emendas, presilhas, terminais): inclua apenas se o catálogo oferecer e fizer sentido para a quantidade de perfil.

## Saída
Responda SOMENTE com o JSON do esquema pedido:
- ambientes: um bloco por ambiente, cada item com codigo (ou null), quantidade, justificativa e descricao_avulso (só quando codigo é null).
- pendencias: o que faltou para um orçamento completo (medidas, pontos, cor de acabamento, dúvidas sobre o pedido). Lista vazia se não faltou nada.
- resumo_para_vendedora: 2 a 4 frases em português, diretas, com o que foi montado e o que exige atenção.
Escreva em português do Brasil. Não inclua dados pessoais do cliente.`;

// ---------------------------------------------------------------- entrada (sem dados do cliente)

const rotulo = (opcoes: Opcao[], valor: unknown) =>
  opcoes.find((o) => o.valor === valor)?.rotulo ?? String(valor ?? "");

/**
 * Tira de um texto livre o que identifica o cliente: telefones, e-mails e o nome informado.
 * A vendedora às vezes cola a mensagem inteira do WhatsApp na pergunta 6.
 */
export function anonimizarTexto(texto: string, nomeCliente?: string): string {
  let t = texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-mail]")
    // Formatos de telefone com DDD; o último exige separador ou 10 a 11 dígitos seguidos, para não
    // confundir com listas de códigos de produto ("12389 12390").
    .replace(/(?:\+?55[\s.-]?)?\(\d{2}\)\s?9?\d{4}[\s.-]?\d{4}/g, "[telefone]")
    .replace(/\+55[\s.-]?\d{2}[\s.-]?9?\d{4}[\s.-]?\d{4}/g, "[telefone]")
    .replace(/\b\d{2}[\s.-]9?\d{4}[\s.-]\d{4}\b/g, "[telefone]")
    .replace(/\b\d{10,11}\b/g, "[telefone]");
  if (nomeCliente) {
    const partes = nomeCliente
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3);
    for (const parte of partes) {
      const escapada = parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      t = t.replace(new RegExp(`\\b${escapada}\\b`, "gi"), "[cliente]");
    }
  }
  return t;
}

/**
 * Texto do atendimento enviado à IA. NÃO inclui nome nem WhatsApp do cliente, nem o nome do
 * arquiteto: só tipo de cliente, obra, ambientes, pedido, linha, faixa, prazo e observações.
 */
export function montarTextoAtendimento(respostas: Respostas): string {
  const nome = typeof respostas.cliente_nome === "string" ? respostas.cliente_nome : undefined;
  const livre = (v: unknown) =>
    typeof v === "string" && v.trim() ? anonimizarTexto(v.trim(), nome) : null;

  const obra = (respostas.tipo_obra ?? {}) as { uso?: string; estado?: string };
  const ambientes = (
    Array.isArray(respostas.ambientes) ? (respostas.ambientes as string[]) : []
  ).map((a) =>
    a === "outro" && respostas.ambiente_outro
      ? `Outro: ${anonimizarTexto(String(respostas.ambiente_outro), nome)}`
      : rotulo(OPCOES_AMBIENTES, a),
  );

  const linhas = [
    "Atendimento (sem dados de identificação do cliente):",
    `- Tipo de cliente: ${rotulo(OPCOES_TIPO_CLIENTE, respostas.tipo_cliente)}${
      respostas.arquiteto_indicador ? " (veio por indicação de arquiteto)" : ""
    }`,
    `- Obra: ${rotulo(OPCOES_USO_OBRA, obra.uso)}, ${rotulo(OPCOES_ESTADO_OBRA, obra.estado)}`,
    `- Ambientes: ${ambientes.join("; ")}`,
    `- Linha: ${rotulo(OPCOES_LINHA, respostas.linha)}`,
    `- Faixa de investimento: ${livre(respostas.faixa_investimento) ?? "não informada"}`,
    `- Prazo: ${rotulo(OPCOES_PRAZO, respostas.prazo)}${
      respostas.prazo === "encomenda" ? " (30 a 45 dias úteis)" : ""
    }`,
    `- Observações e condições especiais: ${livre(respostas.observacoes) ?? "nenhuma"}`,
    "",
    "Pedido do cliente (texto da vendedora):",
    livre(respostas.pedido_cliente) ?? "(vazio)",
  ];
  return linhas.join("\n");
}
