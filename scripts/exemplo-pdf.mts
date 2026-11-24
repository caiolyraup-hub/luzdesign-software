// Gera dados/exemplo-orcamento.pdf e dados/exemplo-orcamento.xlsx com dados fictícios (cliente "TESTE")
// para conferir o visual. Uso: pnpm pdf:exemplo   (não usa o banco; os arquivos ficam fora do git)
import { mkdirSync, writeFileSync } from "node:fs";
import type { ItemRevisao } from "../src/lib/orcamento/itens";
import { montarDadosPdf } from "../src/lib/pdf/dados";
import { carregarLogo, renderizarPdf } from "../src/lib/pdf/renderizar";
import { gerarPlanilhaOrcamento } from "../src/lib/planilha/orcamento";

const item = (
  n: number,
  ambiente: string,
  codigo: string | null,
  categoria: string | null,
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
  categoria,
  unidade,
  produtoAtivo: codigo === null ? null : true,
  precoCatalogo: codigo === null ? null : preco,
});

const itens: ItemRevisao[] = [
  item(1, "Sala", "9520", "LED", "Lâmpada dicroica LED 6 W, 2.7 K", null, 37, 6),
  item(2, "Sala", "11500", "EMBUTIDO", "Embutido redondo para dicroica, branco", null, 29, 4),
  item(3, "Sala", null, null, "Pendente 3 globos, vidro fumê, 30 cm", null, 890, 1),
  item(
    4,
    "Cozinha",
    "12222",
    "FITA LED",
    "Fita LED 22 W por metro, luz neutra",
    null,
    20,
    8.5,
    "m",
  ),
  item(5, "Cozinha", "12615", "PERFIL", "Perfil de alumínio 2 m, branco", null, 311, 5),
  item(6, "Cozinha", "10340", "FONTE", "Fonte de alimentação 48 W", null, 52, 4),
  item(7, "Quarto de casal", "9520", "LED", "Lâmpada dicroica LED 6 W, 2.7 K", null, 37, 4),
  item(8, "Quarto de casal", "10338", "FONTE", "Fonte de alimentação 24 W", null, 32, 1),
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
    // --com-descricao: o formato ANTIGO (com a descrição), para comparar; o padrão é só o código.
    mostrar_descricao: process.argv.includes("--com-descricao"),
    linhas_rodape:
      "À vista, desconto de 10%\nOrçamento válido por 7 dias\nPrazo de entrega: 30 a 45 dias úteis após o pagamento\nNão fazemos trocas de peças por encomenda\nMercadoria frágil",
  },
  numero: "2026-0005",
  versao: 1,
  cliente: {
    nome: "TESTE Cliente Exemplo",
    whatsapp: "(82) 99999-1234",
    arquiteto: "Arquiteta de Teste",
    endereco: "Rua das Flores, 10, Ponta Verde",
  },
  vendedora: "Aline",
  itens,
  ambientes: ["Sala", "Cozinha", "Quarto de casal"],
});

mkdirSync("dados", { recursive: true });
const logo = await carregarLogo();
const pdf = await renderizarPdf(dados, logo);
const sufixo = process.argv.includes("--com-descricao") ? "-com-descricao" : "";
writeFileSync(`dados/exemplo-orcamento${sufixo}.pdf`, pdf);
console.log(`dados/exemplo-orcamento${sufixo}.pdf (${(pdf.length / 1024).toFixed(1)} KB)`);

const planilha = await gerarPlanilhaOrcamento(dados, logo);
writeFileSync(`dados/exemplo-orcamento${sufixo}.xlsx`, planilha);
console.log(`dados/exemplo-orcamento${sufixo}.xlsx (${(planilha.length / 1024).toFixed(1)} KB)`);
