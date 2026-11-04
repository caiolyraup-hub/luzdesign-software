import { describe, expect, it } from "vitest";
import {
  importar,
  previa,
  type LinhaProduto,
  type ProdutoExistente,
  type RepositorioEstoque,
} from "./importar";
import { lerPlanilha } from "./lerPlanilha";
import {
  aplicarMapeamento,
  parsePreco,
  prepararCarga,
  sugerirMapeamento,
  validar,
} from "./mapeamento";
import { extrairCatalogo, lerLinha } from "./provisorio";
import type { Mapeamento, ProdutoImportacao } from "./tipos";

const codificar = (texto: string, codificacao: "utf8" | "latin1" = "utf8") =>
  new Uint8Array(Buffer.from(texto, codificacao));

describe("lerPlanilha (CSV)", () => {
  it("lê CSV com separador ';' em Latin-1 e preserva os acentos", async () => {
    const csv =
      "Código;Descrição;Preço\r\n9520;Spot embutido LÂMPADA;1.234,56\r\n9521;Pendente;37,00\r\n";
    const planilha = await lerPlanilha({ nome: "estoque.csv", dados: codificar(csv, "latin1") });
    expect(planilha.colunas).toEqual(["Código", "Descrição", "Preço"]);
    expect(planilha.linhas).toHaveLength(2);
    expect(planilha.linhas[0]).toEqual({
      Código: "9520",
      Descrição: "Spot embutido LÂMPADA",
      Preço: "1.234,56",
    });
  });

  it("lê CSV com ',' em UTF-8, com aspas e BOM", async () => {
    const csv = '﻿codigo,descricao,preco\n12389,"MB LOYO, DIC BR","23.5"\n';
    const planilha = await lerPlanilha({ nome: "x.CSV", dados: codificar(csv) });
    expect(planilha.colunas).toEqual(["codigo", "descricao", "preco"]);
    expect(planilha.linhas[0].descricao).toBe("MB LOYO, DIC BR");
  });

  it("recusa formatos desconhecidos", async () => {
    await expect(lerPlanilha({ nome: "estoque.xls", dados: new Uint8Array() })).rejects.toThrow(
      /\.xlsx ou \.csv/,
    );
  });
});

describe("preço brasileiro", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["R$ 37,00", 37],
    ["37,5", 37.5],
    ["37.5", 37.5],
    ["1.234", 1234],
    ["0", 0],
  ])("converte %s", (bruto, esperado) => {
    expect(parsePreco(bruto)).toBe(esperado);
  });

  it("rejeita texto", () => {
    expect(parsePreco("abc")).toBeNull();
    expect(parsePreco("")).toBeNull();
  });
});

describe("mapeamento e validação", () => {
  const mapeamento: Mapeamento = {
    codigo: "Cód",
    descricao: "Descrição",
    preco_unitario: "Preço",
    unidade: "Un",
    w: "W",
  };

  it("mapeia colunas, converte preço e atributos", () => {
    const [item] = aplicarMapeamento(
      [{ Cód: "9520.0", Descrição: "DIC 6W", Preço: "1.234,56", Un: "MTS", W: "6" }],
      mapeamento,
    );
    expect(item.produto).toMatchObject({
      codigo: "9520",
      descricao: "DIC 6W",
      preco_unitario: 1234.56,
      unidade: "m",
      atributos: { w: 6 },
    });
  });

  it("valida código, descrição e preço sem parar a carga", () => {
    const linhas = [
      { Cód: "9520", Descrição: "OK", Preço: "10,00", Un: "", W: "" },
      { Cód: "", Descrição: "Sem código", Preço: "10,00", Un: "", W: "" },
      { Cód: "123456", Descrição: "Código longo", Preço: "10,00", Un: "", W: "" },
      { Cód: "9521", Descrição: "", Preço: "10,00", Un: "", W: "" },
      { Cód: "9522", Descrição: "Preço ruim", Preço: "abc", Un: "", W: "" },
      { Cód: "9523", Descrição: "Preço negativo", Preço: "-5", Un: "", W: "" },
      { Cód: "9524", Descrição: "Preço zero é válido", Preço: "0", Un: "", W: "" },
    ];
    const carga = prepararCarga(linhas, mapeamento);
    expect(carga.produtos.map((p) => p.codigo)).toEqual(["9520", "9524"]);
    expect(carga.erros.map((e) => e.linha)).toEqual([2, 3, 4, 5, 6]);
    expect(carga.erros[0].mensagem).toMatch(/Código obrigatório/);
    expect(carga.erros[3].mensagem).toMatch(/Preço inválido/);
    expect(carga.codigosVistos).toContain("9521");
    expect(carga.linhasLidas).toBe(7);
  });

  it("exige os campos obrigatórios no mapeamento", () => {
    expect(() => prepararCarga([], { codigo: "Cód" })).toThrow(/obrigatórios/);
  });

  it("validar devolve vazio para linha boa", () => {
    const [item] = aplicarMapeamento([{ Cód: "1", Descrição: "x", Preço: "1" }], mapeamento);
    expect(validar(item)).toEqual([]);
  });
});

/** Banco em memória: mesma interface do Supabase. */
function repositorioEmMemoria(
  inicial: Record<string, Partial<ProdutoExistente> & { descricao: string }> = {},
) {
  const produtos = new Map<string, ProdutoExistente>();
  for (const [codigo, p] of Object.entries(inicial)) {
    produtos.set(codigo, {
      preco_unitario: 10,
      categoria: null,
      marca: null,
      unidade: "un",
      estoque_disponivel: null,
      ativo: true,
      ...p,
    });
  }
  const sync: {
    origem: string;
    fim?: { linhas_lidas: number; linhas_gravadas: number; erros: unknown[] };
  }[] = [];
  const gravadosEmLote: string[] = [];
  const apelidos: { codigo: string; texto: string }[] = [];

  const repo: RepositorioEstoque = {
    async listarExistentes() {
      return new Map(produtos);
    },
    async gravarProdutos(linhas: LinhaProduto[]) {
      for (const l of linhas) {
        gravadosEmLote.push(l.codigo);
        const antigo = produtos.get(l.codigo);
        produtos.set(l.codigo, {
          preco_unitario: 0,
          categoria: null,
          marca: null,
          unidade: "un",
          estoque_disponivel: null,
          ...antigo,
          ...(l as Partial<ProdutoExistente>),
          descricao: l.descricao as string,
          ativo: true,
        });
      }
    },
    async gravarApelidos(linhas) {
      apelidos.push(...linhas);
    },
    async desativar(codigos) {
      for (const c of codigos) produtos.set(c, { ...produtos.get(c)!, ativo: false });
    },
    async iniciarSync(origem) {
      sync.push({ origem });
      return String(sync.length);
    },
    async finalizarSync(id, dados) {
      sync[Number(id) - 1].fim = dados;
    },
  };
  return { repo, produtos, sync, gravadosEmLote, apelidos };
}

const prod = (
  codigo: string,
  descricao: string,
  preco: number,
  extra: Partial<ProdutoImportacao> = {},
): ProdutoImportacao => ({
  codigo,
  descricao,
  preco_unitario: preco,
  ...extra,
});

describe("importar", () => {
  it("faz upsert por código e registra a carga em sync_estoque", async () => {
    const { repo, produtos, sync } = repositorioEmMemoria({
      "100": { descricao: "ANTIGO", preco_unitario: 5 },
    });
    const resumo = await importar(repo, [prod("100", "NOVO NOME", 6), prod("200", "OUTRO", 7)], {
      origem: "teste",
      linhasLidas: 2,
    });
    expect(resumo).toMatchObject({
      novos: 1,
      alterados: 1,
      iguais: 0,
      linhasGravadas: 2,
      desativados: 0,
    });
    expect(produtos.get("100")).toMatchObject({ descricao: "NOVO NOME", preco_unitario: 6 });
    expect(produtos.has("200")).toBe(true);
    expect(sync).toHaveLength(1);
    expect(sync[0].origem).toBe("teste");
    expect(sync[0].fim).toMatchObject({ linhas_lidas: 2, linhas_gravadas: 2 });
  });

  it("não apaga nem desativa o que ficou de fora da planilha (padrão)", async () => {
    const { repo, produtos } = repositorioEmMemoria({
      "100": { descricao: "A" },
      "300": { descricao: "FORA DA PLANILHA" },
    });
    const resumo = await importar(repo, [prod("100", "A", 10)], {
      origem: "teste",
      linhasLidas: 1,
    });
    expect(produtos.get("300")?.ativo).toBe(true);
    expect(resumo.desativados).toBe(0);
  });

  it('"desativar ausentes" marca ativo=false, nunca remove, e poupa códigos de linhas inválidas', async () => {
    const { repo, produtos } = repositorioEmMemoria({
      "100": { descricao: "A" },
      "300": { descricao: "AUSENTE" },
      "400": { descricao: "LINHA INVÁLIDA NA PLANILHA" },
    });
    const resumo = await importar(repo, [prod("100", "A", 10)], {
      origem: "teste",
      linhasLidas: 2,
      desativarAusentes: true,
      codigosVistos: ["100", "400"],
    });
    expect(resumo.desativados).toBe(1);
    expect(produtos.get("300")?.ativo).toBe(false);
    expect(produtos.get("400")?.ativo).toBe(true);
    expect(produtos.has("300")).toBe(true);
  });

  it("reativa produto que volta e não regrava os que não mudaram", async () => {
    const { repo, produtos, gravadosEmLote } = repositorioEmMemoria({
      "100": { descricao: "IGUAL", preco_unitario: 10 },
      "200": { descricao: "VOLTOU", preco_unitario: 10, ativo: false },
    });
    const p = await previa(repo, [
      prod("100", "IGUAL", 10),
      prod("200", "VOLTOU", 10),
      prod("300", "NOVO", 1),
    ]);
    expect(p).toMatchObject({ novos: 1, alterados: 1, iguais: 1, reativados: 1 });
    await importar(repo, [prod("100", "IGUAL", 10), prod("200", "VOLTOU", 10)], {
      origem: "t",
      linhasLidas: 2,
    });
    expect(gravadosEmLote).toEqual(["200"]);
    expect(produtos.get("200")?.ativo).toBe(true);
  });

  it("junta códigos repetidos (vale o último), grava apelidos e registra o aviso", async () => {
    const { repo, produtos, apelidos } = repositorioEmMemoria();
    const resumo = await importar(
      repo,
      [
        prod("100", "PRIMEIRO", 1),
        prod("100", "SEGUNDO", 2, { apelidos: ["SEGUNDO", "OUTRO NOME"] }),
      ],
      { origem: "teste", linhasLidas: 2, erros: [{ linha: 3, mensagem: "preço inválido" }] },
    );
    expect(produtos.get("100")?.descricao).toBe("SEGUNDO");
    expect(apelidos).toEqual([{ codigo: "100", texto: "OUTRO NOME" }]);
    expect(resumo.erros).toHaveLength(2);
  });

  it("registra a falha na carga e relança o erro", async () => {
    const { repo, sync } = repositorioEmMemoria();
    repo.gravarProdutos = async () => {
      throw new Error("banco fora do ar");
    };
    await expect(
      importar(repo, [prod("100", "A", 1)], { origem: "teste", linhasLidas: 1 }),
    ).rejects.toThrow("banco fora do ar");
    expect(JSON.stringify(sync[0].fim?.erros)).toContain("banco fora do ar");
  });
});

describe("catálogo provisório", () => {
  it("lê códigos de 4 e 5 dígitos e ignora números de temperatura/medida", () => {
    const ok = (campo1: string) => {
      const r = lerLinha(["1.0", campo1, ".X", "10.0", "10.0"], "2026-10-01", 0);
      return "ocorrencia" in r ? r.ocorrencia.codigo : null;
    };
    expect(ok("LED 9520")).toBe("9520");
    expect(ok("EMBUT.11500")).toBe("11500");
    expect(ok("EMBUTIDO 12599 PAR20")).toBe("12599");
    expect(ok("EMBUTIDO 1 FOCO 12674")).toBe("12674");
    expect(ok("ESPETO 7W 3.000K")).toBeNull();
    expect(ok("PERFIL 2,50MTS")).toBeNull();
    expect(ok("EMBUTIDO")).toBeNull();
  });

  it("escolhe a descrição mais frequente, o preço mais recente e guarda as outras como apelidos", () => {
    const orc = (date: string, desc: string, preco: string) => ({
      date,
      items: [["1.0", "LED 9520", desc, "AMB", preco, preco]],
    });
    const r = extrairCatalogo([
      orc("01.10.26", ".STELLA DIC 6W 2.7K", "37.0"),
      orc("05.10.26", ".STELLA DIC 6W 2.7K", "37.0"),
      orc("2026-10-30", ".DIC 6W STELLA", "40.0"),
    ]);
    const p = r.produtos[0];
    expect(p).toMatchObject({
      codigo: "9520",
      descricao: "STELLA DIC 6W 2.7K",
      preco_unitario: 40,
      marca: "STELLA",
      unidade: "un",
      atributos: { w: 6, k: 2700 },
      apelidos: ["DIC 6W STELLA"],
    });
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].usado).toBe(40);
  });

  it("fita vendida por metro vira unidade m e linhas sem código são contadas", () => {
    const r = extrairCatalogo([
      {
        date: "01.10.26",
        items: [
          ["3.0", "LED 12222", "MTS FITA 22W/M NT NIT", "TETO", "20.0", "60.0"],
          ["1.0", "PLAFON ( A DEFINIR )", "HALL"],
          ["1.0", "EMBUTIDO", ".MB LOYO 6819 MINI PT", "23.0", "23.0"],
        ],
      },
    ]);
    expect(r.produtos[0]).toMatchObject({
      codigo: "12222",
      categoria: "FITA LED",
      unidade: "m",
      marca: "NIT",
    });
    expect(r.ignoradas.map((i) => i.motivo)).toEqual(["a definir", "sem código"]);
  });
});

describe("sugerirMapeamento", () => {
  it("completa pelo nome do cabeçalho e respeita o mapeamento salvo", () => {
    const colunas = ["Cód.", "Descrição", "Preço Venda", "Marca", "Saldo", "Obs"];
    const s = sugerirMapeamento(colunas, { codigo: "Cód.", marca: "Coluna que sumiu" });
    expect(s).toEqual({
      codigo: "Cód.",
      descricao: "Descrição",
      preco_unitario: "Preço Venda",
      marca: "Marca",
      estoque_disponivel: "Saldo",
    });
  });
});
