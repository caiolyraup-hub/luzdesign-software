// Monta um catálogo provisório a partir dos 37 orçamentos reais e grava em produtos.
// Uso: pnpm catalogo:provisorio [--sem-gravar]   (lê .env.local)
// A planilha real do estoque substitui estes dados depois (origem diferente em sync_estoque).
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { importar } from "../src/lib/estoque/importar";
import { criarRepositorioSupabase } from "../src/lib/estoque/repositorio-supabase";
import {
  extrairCatalogo,
  type OrcamentoExtraido,
  type ResultadoProvisorio,
} from "../src/lib/estoque/provisorio";

const ORIGEM = "provisorio-37-orcamentos";
const ENTRADA = "dados/orcamentos-37-extraidos.json";
const SAIDA = "dados/relatorio-catalogo-provisorio.md";
const semGravar = process.argv.includes("--sem-gravar");

const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const contar = <T,>(itens: T[], chave: (i: T) => string) => {
  const m = new Map<string, number>();
  itens.forEach((i) => m.set(chave(i), (m.get(chave(i)) ?? 0) + 1));
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
const tabela = (linhas: [string, number][]) =>
  ["| Item | Produtos |", "| --- | ---: |", ...linhas.map(([k, v]) => `| ${k} | ${v} |`)].join(
    "\n",
  );

function relatorio(
  r: ResultadoProvisorio,
  resumo?: { novos: number; alterados: number; iguais: number },
) {
  const porMotivo = contar(r.ignoradas, (i) => i.motivo);
  const possiveis = r.ignoradas.filter((i) => i.codigoPossivel).length;
  const partes = [
    "# Catálogo provisório (37 orçamentos)",
    "",
    `Gerado em ${new Date().toLocaleString("pt-BR")}. Origem em \`sync_estoque\`: \`${ORIGEM}\`.`,
    "Os códigos e preços vêm só dos orçamentos; nada foi inventado. A planilha real do estoque substitui estes dados.",
    "",
    "## Resumo",
    "",
    `- Linhas de produto lidas: **${r.totalLinhas}**`,
    `- Produtos distintos (por código): **${r.produtos.length}**`,
    `- Linhas ignoradas: **${r.ignoradas.length}**`,
    resumo
      ? `- Gravação: ${resumo.novos} novos, ${resumo.alterados} alterados, ${resumo.iguais} sem mudança`
      : "- Gravação: não executada (--sem-gravar)",
    "",
    "## Produtos por categoria",
    "",
    tabela(contar(r.produtos, (p) => p.categoria ?? "(sem categoria)")),
    "",
    "## Produtos por marca",
    "",
    tabela(contar(r.produtos, (p) => p.marca ?? "(sem marca detectada)")),
    "",
    "Marcas reconhecidas: MB, NIT, STELLA, ASTRA, USINA, OPUS, ZIBO, MOLDI. Códigos sem marca na descrição ficam sem marca.",
    "",
    `## Preços divergentes (${r.divergencias.length} códigos)`,
    "",
    "Usado o preço do orçamento mais recente.",
    "",
    ...(r.divergencias.length === 0
      ? ["Nenhum."]
      : [
          "| Código | Descrição | Preços (datas) | Usado |",
          "| --- | --- | --- | ---: |",
          ...r.divergencias.map(
            (d) =>
              `| ${d.codigo} | ${d.descricao} | ${d.precos.map((p) => `${moeda(p.preco)} (${p.datas.join(", ")})`).join("; ")} | ${moeda(d.usado)} |`,
          ),
        ]),
    "",
    `## Linhas ignoradas (${r.ignoradas.length})`,
    "",
    tabela(porMotivo),
    "",
    `Em ${possiveis} linha(s) sem código há um número de 4-5 dígitos no começo da descrição que provavelmente é o modelo do fabricante, não o código da loja; revisar com a planilha real.`,
    "",
    `## Dúvidas de unidade (${r.duvidasUnidade.length})`,
    "",
    ...(() => {
      const perfis = r.duvidasUnidade.filter((d) => d.motivo.startsWith("perfil"));
      const outras = r.duvidasUnidade.filter((d) => !d.motivo.startsWith("perfil"));
      return [
        `- **${perfis.length} perfis** foram assumidos como \`un\` (preço por barra de 2 ou 3 m, como aparece nos orçamentos). Se a loja vender por metro, ajustar na planilha real.`,
        ...(outras.length === 0
          ? ["- Nenhuma outra dúvida."]
          : [
              "",
              "| Código | Descrição | Motivo |",
              "| --- | --- | --- |",
              ...outras.map((d) => `| ${d.codigo} | ${d.descricao} | ${d.motivo} |`),
            ]),
      ];
    })(),
    "",
    `## Códigos com mais de uma marca na descrição (${r.marcasMultiplas.length})`,
    "",
    r.marcasMultiplas.length === 0
      ? "Nenhum."
      : r.marcasMultiplas
          .map((m) => `- ${m.codigo}: ${m.marcas.join(", ")} (usada a primeira)`)
          .join("\n"),
    "",
    "## Comparação com a planilha real",
    "",
    "Ainda não há planilha em `dados/estoque/`. Quando chegar, importar pela tela e comparar.",
    "",
  ];
  return partes.join("\n");
}

const orcamentos = JSON.parse(readFileSync(ENTRADA, "utf8")) as OrcamentoExtraido[];
const resultado = extrairCatalogo(orcamentos);
console.log(
  `${resultado.totalLinhas} linhas -> ${resultado.produtos.length} produtos, ${resultado.ignoradas.length} ignoradas`,
);

let resumo: { novos: number; alterados: number; iguais: number } | undefined;
if (!semGravar) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias no .env.local",
    );
  const admin = createClient(url, chave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const r = await importar(criarRepositorioSupabase(admin), resultado.produtos, {
    origem: ORIGEM,
    linhasLidas: resultado.totalLinhas,
    desativarAusentes: false,
  });
  resumo = r;
  console.log(
    `Gravado: ${r.novos} novos, ${r.alterados} alterados, ${r.iguais} sem mudança (sync ${r.syncId})`,
  );
}

writeFileSync(SAIDA, relatorio(resultado, resumo));
console.log(`Relatório: ${SAIDA}`);
