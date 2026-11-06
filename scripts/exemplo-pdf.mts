// Gera dados/exemplo-orcamento.pdf com dados fictícios (cliente "TESTE") para conferir o visual.
// Uso: pnpm pdf:exemplo   (não usa o banco; o arquivo fica fora do git)
import { mkdirSync, writeFileSync } from "node:fs";
import type { ItemRevisao } from "../src/lib/orcamento/itens";
import { montarDadosPdf } from "../src/lib/pdf/dados";
import { renderizarPdf } from "../src/lib/pdf/renderizar";

const item = (
  n: number,
  ambiente: string,
  codigo: string | null,
  descricao: string,
  marca: string | null,
  preco: number,
  quantidade: number,
  unidade: "un" | "m" = "un",
): ItemRevisao => ({
  id: `x${n}`,
  codigo,
  descricao,
  preco,
  quantidade,
  ambiente,
  avulso: codigo === null,
  justificativa: null,
  ordem: n,
  marca,
  unidade,
  produtoAtivo: codigo === null ? null : true,
  precoCatalogo: codigo === null ? null : preco,
});

const itens: ItemRevisao[] = [
  item(1, "Sala", "9520", "STELLA DIC 6W 2.7K", "STELLA", 37, 6),
  item(2, "Sala", "11500", "NIT. 12W 3.0K", "NIT", 29, 4),
  item(3, "Sala", null, "Pendente 3 globos, vidro fumê, 30 cm", null, 890, 1),
  item(4, "Cozinha", "12222", "MTS FITA 22W/M NT NIT", "NIT", 20, 8.5, "m"),
  item(5, "Cozinha", "12615", "4290 FUSY 2M BR MB", "MB", 311, 5),
  item(6, "Cozinha", "10340", "MB 48W", "MB", 52, 4),
  item(7, "Quarto de casal", "9520", "STELLA DIC 6W 2.7K", "STELLA", 37, 4),
  item(8, "Quarto de casal", "10338", "MB 24W", "MB", 32, 1),
];

const dados = montarDadosPdf({
  loja: {
    nome_fantasia: "Luz Design",
    razao_social: "Luz Design LTDA",
    cnpj: "04.487.554/0001-16",
    endereco: "Av. Dr. Júlio Marques Luz, 753-C, Jatiúca, Maceió-AL",
    telefone: null,
    whatsapp: null,
    instagram: null,
    site: null,
  },
  config: {
    validade_dias: 7,
    desconto_avista_pct: 10,
    linhas_rodape:
      "À vista, desconto de 10%\nOrçamento válido por 7 dias\nPrazo de entrega: 30 a 45 dias úteis após o pagamento\nNão fazemos trocas de peças por encomenda\nMercadoria frágil",
  },
  numero: "2026-0005",
  versao: 1,
  cliente: {
    nome: "TESTE Cliente Exemplo",
    whatsapp: "(82) 99999-1234",
    arquiteto: "Arquiteta de Teste",
  },
  vendedora: "Aline",
  itens,
  ambientes: ["Sala", "Cozinha", "Quarto de casal"],
});

mkdirSync("dados", { recursive: true });
const pdf = await renderizarPdf(dados);
writeFileSync("dados/exemplo-orcamento.pdf", pdf);
console.log(`dados/exemplo-orcamento.pdf (${(pdf.length / 1024).toFixed(1)} KB)`);
