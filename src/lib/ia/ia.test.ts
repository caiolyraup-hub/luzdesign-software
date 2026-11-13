import { describe, expect, it, vi } from "vitest";
import type { Respostas } from "../orcamento/perguntas";
import {
  conteudoDosAnexos,
  inicioDoDiaMaceio,
  mensagemAmigavelErro,
  type AnexoParaIA,
  type DepsIA,
  type DescricaoFormatada,
  type DescricaoFormatadaNova,
  type FinalizacaoUso,
  type ProdutoCatalogo,
  type RepositorioIA,
} from "./comum";
import { estimarCustoUsd, lerConfigIA, type ConfigIA } from "./config";
import { ESQUEMA_JSON_FORMATACAO, ESQUEMA_JSON_INDICACAO, schemaIndicacaoIA } from "./esquema";
import { DEFINICOES_FERRAMENTAS, type ExecutorFerramentas } from "./ferramentas";
import {
  ambienteParecePrecisarDeAjuste,
  descricaoFormatadaValida,
  formatarTextos,
  mesmosNumeros,
  nomeAmbienteFormatadoValido,
} from "./formatacao";
import { pedirIndicacao, validarSugestoes, type PedidoIndicacao } from "./indicacao";
import { anonimizarTexto } from "./instrucoes";
import { montarTextoIndicacao } from "./instrucoes-indicacao";
import { executarMotor, type ClienteIA, type RespostaIA } from "./motor";

// ---------------------------------------------------------------- apoio

const catalogoBase = (): Map<string, ProdutoCatalogo> =>
  new Map(
    (
      [
        ["9520", "STELLA DIC 6W 2.7K", "un", 37, true, "LED"],
        ["12222", "MTS FITA 22W/M NT NIT", "m", 20, true, "FITA LED"],
        ["10340", "MB 48W", "un", 52, true, "FONTE"],
        ["9999", "PRODUTO INATIVO 5W", "un", 10, false, "LED"],
      ] as const
    ).map(([codigo, descricao, unidade, preco, ativo, categoria]) => [
      codigo,
      {
        codigo,
        descricao,
        unidade,
        preco_unitario: preco,
        ativo,
        categoria,
        atualizado_em: "2026-11-01T00:00:00Z",
      },
    ]),
  );

const respostas: Respostas = {
  versao: 2,
  cliente_nome: "Maria Souza",
  cliente_whatsapp: "+5582999991234",
  tipo_cliente: "arquiteto",
  arquiteto_indicador: "Lula Santana",
  pedido_cliente: "Spots na sala.",
  faixa_investimento: "até 2 mil",
  prazo: "encomenda",
};

const config: ConfigIA = {
  modelo: "gpt-teste",
  limiteDiario: 20,
  maxGeracoesPorOrcamento: 3,
  maxRodadasFerramentas: 8,
  precoEntradaUsdMtok: 2,
  precoSaidaUsdMtok: 10,
  raciocinio: null,
  timeoutChamadaMs: 1000,
};

const mensagemFinal = (
  texto: unknown,
  usage = { input_tokens: 100, output_tokens: 50 },
): RespostaIA => ({
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(texto) }] }],
  usage,
});

const pedirFerramenta = (nome: string, argumentos: object, id = "c1"): RespostaIA => ({
  output: [
    {
      type: "function_call",
      name: nome,
      arguments: JSON.stringify(argumentos),
      call_id: id,
      id: `fc_${id}`,
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5 },
});

/** Cliente de IA falso: devolve as respostas em ordem (ou lança, se for Error) e guarda as chamadas. */
function iaFalsa(respostas: (RespostaIA | Error)[]) {
  const chamadas: Record<string, unknown>[] = [];
  let i = 0;
  const create = vi.fn(async (parametros: Record<string, unknown>) => {
    chamadas.push(JSON.parse(JSON.stringify(parametros)));
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  });
  const cliente: ClienteIA = { responses: { create } };
  return { cliente, create, chamadas };
}

const executorVazio: ExecutorFerramentas = async () => ({ total: 0, produtos: [] });

// ---------------------------------------------------------------- motor

describe("executarMotor", () => {
  const base = (cliente: ClienteIA, executor: ExecutorFerramentas = executorVazio) => ({
    cliente,
    modelo: "gpt-teste",
    instrucoes: "instruções",
    conteudo: [{ type: "input_text" as const, text: "pedido" }],
    executor,
    maxRodadas: 8,
    esquema: ESQUEMA_JSON_INDICACAO,
  });

  it("executa as ferramentas, devolve o resultado à IA e soma os tokens", async () => {
    const ia = iaFalsa([
      pedirFerramenta("buscar_produtos", {
        texto: "dic 6w",
        categoria: null,
        marca: null,
        limite: 5,
      }),
      mensagemFinal({ ok: true }),
    ]);
    const executor = vi.fn(async () => ({ total: 1, produtos: [{ codigo: "9520" }] }));
    const r = await executarMotor(base(ia.cliente, executor));

    expect(executor).toHaveBeenCalledWith("buscar_produtos", expect.stringContaining("dic 6w"));
    expect(r).toMatchObject({
      tokensEntrada: 110,
      tokensSaida: 55,
      chamadasFerramenta: 1,
      chamadasApi: 2,
      limiteRodadasAtingido: false,
    });
    expect(JSON.parse(r.textoFinal)).toEqual({ ok: true });

    const [primeira, segunda] = ia.chamadas;
    expect(primeira).toMatchObject({ model: "gpt-teste", store: false, tool_choice: "auto" });
    expect((primeira.tools as unknown[]).length).toBe(DEFINICOES_FERRAMENTAS.length);
    const input = segunda.input as { type?: string; call_id?: string; output?: string }[];
    const saidaFerramenta = input.find((x) => x.type === "function_call_output");
    expect(saidaFerramenta?.call_id).toBe("c1");
    expect(JSON.parse(saidaFerramenta!.output!)).toMatchObject({ total: 1 });
  });

  it("depois de 8 rodadas de ferramentas, força a resposta com o que a IA já tem", async () => {
    const ia = iaFalsa([
      ...Array.from({ length: 8 }, (_, i) =>
        pedirFerramenta("buscar_produtos", { texto: `t${i}` }, `c${i}`),
      ),
      mensagemFinal({ final: true }),
    ]);
    const executor = vi.fn(async () => ({ total: 0, produtos: [] }));
    const r = await executarMotor(base(ia.cliente, executor));

    expect(executor).toHaveBeenCalledTimes(8);
    expect(r.chamadasApi).toBe(9);
    expect(r.limiteRodadasAtingido).toBe(true);
    expect(ia.chamadas.slice(0, 8).every((c) => c.tool_choice === "auto")).toBe(true);
    expect(ia.chamadas[8].tool_choice).toBe("none");
  });

  it("falha se a IA insiste em pedir ferramenta depois do limite", async () => {
    const ia = iaFalsa([pedirFerramenta("buscar_produtos", { texto: "x" })]);
    await expect(executarMotor({ ...base(ia.cliente), maxRodadas: 2 })).rejects.toThrow(
      /limite de rodadas/,
    );
  });

  it("repassa o erro da API", async () => {
    const ia = iaFalsa([Object.assign(new Error("429"), { status: 429 })]);
    await expect(executarMotor(base(ia.cliente))).rejects.toThrow("429");
  });

  it("falha se a IA responde vazio", async () => {
    const ia = iaFalsa([{ output: [], usage: null }]);
    await expect(executarMotor(base(ia.cliente))).rejects.toThrow(/sem conteúdo/);
  });

  it("usa o esquema e o nome pedidos e dispensa ferramentas quando mandam", async () => {
    const ia = iaFalsa([mensagemFinal({ produtos: [], ambientes: [] })]);
    await executarMotor({
      ...base(ia.cliente),
      esquema: ESQUEMA_JSON_FORMATACAO,
      nomeEsquema: "formatacao_luz_design",
      usarFerramentas: false,
    });
    const [chamada] = ia.chamadas;
    expect(chamada.tools).toBeUndefined();
    expect((chamada.text as { format: { name: string; strict: boolean } }).format).toMatchObject({
      name: "formatacao_luz_design",
      strict: true,
    });
  });
});

// ---------------------------------------------------------------- esquemas

describe("esquemas estritos para a API", () => {
  function verificar(esquema: Record<string, unknown>, caminho: string) {
    if (esquema.type === "object") {
      expect(esquema.additionalProperties, caminho).toBe(false);
      const props = Object.keys(esquema.properties as object);
      expect([...(esquema.required as string[])].sort(), caminho).toEqual([...props].sort());
      for (const [nome, sub] of Object.entries(esquema.properties as Record<string, object>))
        verificar(sub as Record<string, unknown>, `${caminho}.${nome}`);
    }
    if (esquema.type === "array")
      verificar(esquema.items as Record<string, unknown>, `${caminho}[]`);
  }

  it("indicação e formatação são estritas e a indicação não tem campo de preço", () => {
    verificar(ESQUEMA_JSON_INDICACAO as unknown as Record<string, unknown>, "indicacao");
    verificar(ESQUEMA_JSON_FORMATACAO as unknown as Record<string, unknown>, "formatacao");
    expect(JSON.stringify(ESQUEMA_JSON_INDICACAO)).not.toMatch(/preco|preço|price/i);
  });

  it("o zod ignora campo extra de preço que a IA tentar mandar", () => {
    const s = schemaIndicacaoIA.parse({
      resumo: "ok",
      sugestoes: [{ codigo: "9520", quantidade: 2, motivo: "m", preco: 1 }],
      observacoes: [],
    });
    expect(s.sugestoes[0]).toEqual({ codigo: "9520", quantidade: 2, motivo: "m" });
  });
});

// ---------------------------------------------------------------- validação das sugestões

describe("validarSugestoes", () => {
  const saida = (...sugestoes: { codigo: string; quantidade: number; motivo?: string }[]) => ({
    resumo: "",
    sugestoes: sugestoes.map((s) => ({ motivo: "", ...s })),
    observacoes: [],
  });

  it("descarta código inventado e inativo, com aviso", () => {
    const r = validarSugestoes(
      saida({ codigo: "00001", quantidade: 1 }, { codigo: "9999", quantidade: 1 }),
      catalogoBase(),
    );
    expect(r.sugestoes).toEqual([]);
    expect(r.avisos).toHaveLength(2);
    expect(r.avisos[0]).toMatch(/00001.*não existe/);
    expect(r.avisos[1]).toMatch(/inativo/);
  });

  it("descrição, unidade e preço vêm do catálogo (subtotal em centavos)", () => {
    const r = validarSugestoes(saida({ codigo: "12222", quantidade: 8.5 }), catalogoBase());
    expect(r.sugestoes[0]).toMatchObject({
      codigo: "12222",
      descricao: "MTS FITA 22W/M NT NIT",
      unidade: "m",
      precoUnitario: 20,
      quantidade: 8.5,
      subtotalCentavos: 17000,
      categoria: "FITA LED",
    });
  });

  it("arredonda para cima a quantidade fracionada de produto por unidade e avisa", () => {
    const r = validarSugestoes(saida({ codigo: "9520", quantidade: 2.3 }), catalogoBase());
    expect(r.sugestoes[0].quantidade).toBe(3);
    expect(r.avisos[0]).toMatch(/arredondada para 3/);
  });

  it("produto por metro aceita 2 casas e corta o resto", () => {
    const r = validarSugestoes(saida({ codigo: "12222", quantidade: 3.456 }), catalogoBase());
    expect(r.sugestoes[0].quantidade).toBe(3.46);
  });

  it("descarta quantidade inválida e soma o mesmo código", () => {
    const r = validarSugestoes(
      saida(
        { codigo: "9520", quantidade: 0 },
        { codigo: "9520", quantidade: -1 },
        { codigo: "9520", quantidade: 2 },
        { codigo: "9520", quantidade: 3 },
      ),
      catalogoBase(),
    );
    expect(r.sugestoes).toHaveLength(1);
    expect(r.sugestoes[0].quantidade).toBe(5);
    expect(r.sugestoes[0].subtotalCentavos).toBe(5 * 3700);
    expect(r.avisos.filter((a) => /inválida/.test(a))).toHaveLength(2);
  });

  it("marca o que já está no ambiente", () => {
    const r = validarSugestoes(
      saida({ codigo: "9520", quantidade: 1 }, { codigo: "10340", quantidade: 1 }),
      catalogoBase(),
      [{ codigo: "9520" }, { codigo: null }],
    );
    expect(r.sugestoes.map((s) => [s.codigo, s.jaNoAmbiente])).toEqual([
      ["9520", true],
      ["10340", false],
    ]);
  });
});

// ---------------------------------------------------------------- pedirIndicacao (repositório em memória)

function repoFalso(
  opcoes: {
    orcamento?: Partial<{ vendedora_id: string; status: string }> | null;
    usoDia?: number;
    emAndamento?: boolean;
    anexos?: AnexoParaIA[];
    catalogo?: Map<string, ProdutoCatalogo>;
    itensNoAmbiente?: { codigo: string | null; descricao: string; quantidade: number }[];
    formatadas?: Map<string, DescricaoFormatada>;
  } = {},
) {
  const indicacoes: Record<string, unknown>[] = [];
  const usos: { id: string; tipo: string; fim?: FinalizacaoUso }[] = [];
  const gravadas: DescricaoFormatadaNova[] = [];
  const formatadas = opcoes.formatadas ?? new Map<string, DescricaoFormatada>();
  const repo: RepositorioIA = {
    async carregarOrcamento(id) {
      if (opcoes.orcamento === null) return null;
      return {
        id,
        vendedora_id: "u1",
        status: "rascunho",
        respostas,
        ...opcoes.orcamento,
      };
    },
    async contarUso() {
      return opcoes.usoDia ?? 0;
    },
    async existeEmAndamento() {
      return opcoes.emAndamento ?? false;
    },
    async iniciarUso({ tipo }) {
      const id = `uso${usos.length + 1}`;
      usos.push({ id, tipo });
      return id;
    },
    async finalizarUso(id, fim) {
      usos.find((u) => u.id === id)!.fim = fim;
    },
    async carregarAnexos() {
      return opcoes.anexos ?? [];
    },
    async buscarProdutosPorCodigo(codigos) {
      const base = opcoes.catalogo ?? catalogoBase();
      return new Map(codigos.filter((c) => base.has(c)).map((c) => [c, base.get(c)!]));
    },
    async itensDoAmbiente() {
      return opcoes.itensNoAmbiente ?? [];
    },
    async salvarIndicacao(d) {
      indicacoes.push(d as unknown as Record<string, unknown>);
    },
    async descricoesFormatadas(codigos) {
      return new Map(codigos.filter((c) => formatadas.has(c)).map((c) => [c, formatadas.get(c)!]));
    },
    async salvarDescricoesFormatadas(linhas) {
      for (const l of linhas) {
        gravadas.push(l);
        formatadas.set(l.codigo, l);
      }
    },
  };
  return { repo, indicacoes, usos, gravadas, formatadas };
}

const respostaBoa = () =>
  mensagemFinal({
    resumo: "Sugeri spots e a fita com a fonte.",
    sugestoes: [
      { codigo: "9520", quantidade: 4, motivo: "4 pontos pedidos" },
      { codigo: "12222", quantidade: 8, motivo: "8 m de fita" },
      { codigo: "10340", quantidade: 1, motivo: "8 m x 22 W = 176 W" },
      { codigo: "00001", quantidade: 2, motivo: "inventado" },
    ],
    observacoes: ["Confirmar tensão da fita e da fonte."],
  });

const pedido: PedidoIndicacao = {
  orcamentoId: "o1",
  ambiente: "Sala",
  pedidoCliente: "Spots e fita na sala, falar com Maria Souza no 82 99999-1234.",
  pedidoArquiteto: "Lula Santana pediu fita 22W 3000K em perfil.",
  descricaoAmbiente: "Pé-direito de 2,7 m, forro de gesso.",
  usarAnexos: false,
};

const deps = (repo: RepositorioIA, ia: ClienteIA, extra: Partial<DepsIA> = {}): DepsIA => ({
  repo,
  ia,
  executor: executorVazio,
  config,
  agora: () => new Date("2026-11-10T15:00:00Z"),
  ...extra,
});

describe("pedirIndicacao", () => {
  it("sugere, valida no servidor, guarda o histórico e registra o uso; não grava item", async () => {
    const r = repoFalso();
    const ia = iaFalsa([respostaBoa()]);
    const res = await pedirIndicacao(deps(r.repo, ia.cliente), "u1", pedido);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sugestoes.map((s) => s.codigo)).toEqual(["9520", "12222", "10340"]);
    expect(res.sugestoes[0]).toMatchObject({ precoUnitario: 37, subtotalCentavos: 14800 });
    expect(res.avisos[0]).toMatch(/00001/); // inventado descartado
    expect(res.observacoes).toEqual(["Confirmar tensão da fita e da fonte."]);
    expect(res.custoUsd).toBeCloseTo((100 * 2 + 50 * 10) / 1_000_000, 6);

    // A interface do repositório nem tem como gravar item: só o histórico e o uso.
    expect(r.indicacoes).toHaveLength(1);
    expect(r.indicacoes[0]).toMatchObject({
      ambiente: "Sala",
      usouAnexos: false,
      pedidoArquiteto: expect.stringContaining("fita 22W"),
    });
    expect(r.usos).toHaveLength(1);
    expect(r.usos[0]).toMatchObject({ tipo: "indicacao", fim: { status: "ok" } });
  });

  it("não envia nome, WhatsApp nem nome do arquiteto para a IA", async () => {
    const r = repoFalso();
    const ia = iaFalsa([respostaBoa()]);
    await pedirIndicacao(deps(r.repo, ia.cliente), "u1", pedido);
    const enviado = JSON.stringify(ia.chamadas[0].input);
    expect(enviado).not.toMatch(/Maria|Souza|Lula|Santana|99999|\+55|82999/);
    expect(enviado).toContain("[cliente]");
    expect(enviado).toContain("[telefone]");
    expect(enviado).toContain("fita 22W 3000K");
  });

  it("erro de API: nada é gravado, a mensagem é amigável e a tentativa fica como erro", async () => {
    const r = repoFalso();
    const ia = iaFalsa([Object.assign(new Error("boom org-9 sk-abc"), { status: 429 })]);
    const res = await pedirIndicacao(deps(r.repo, ia.cliente), "u1", pedido);
    expect(res).toMatchObject({ ok: false, motivo: "ia", podeTentarDeNovo: true });
    if (!res.ok) expect(res.erro).not.toMatch(/org-9|sk-abc/);
    expect(r.indicacoes).toHaveLength(0);
    expect(r.usos[0].fim).toMatchObject({ status: "erro", custo_estimado: 0 });
  });

  it("resposta inválida (JSON quebrado ou fora do esquema) não grava nada", async () => {
    for (const resposta of [
      { output: [{ type: "message", content: [{ type: "output_text", text: "{nada" }] }] },
      mensagemFinal({ sugestoes: "x" }),
    ] as RespostaIA[]) {
      const r = repoFalso();
      const res = await pedirIndicacao(deps(r.repo, iaFalsa([resposta]).cliente), "u1", pedido);
      expect(res).toMatchObject({ ok: false, motivo: "ia" });
      expect(r.indicacoes).toHaveLength(0);
      expect(r.usos[0].fim?.status).toBe("erro");
    }
  });

  it("limite diário: não chama a API", async () => {
    const r = repoFalso({ usoDia: 20 });
    const ia = iaFalsa([respostaBoa()]);
    const res = await pedirIndicacao(deps(r.repo, ia.cliente), "u1", pedido);
    expect(res).toMatchObject({ ok: false, motivo: "limite_diario" });
    expect(ia.create).not.toHaveBeenCalled();
    expect(r.usos).toHaveLength(0);
  });

  it("recusa entrada vazia, orçamento de outra pessoa, já enviado e uso simultâneo, sem chamar a API", async () => {
    const casos: [Parameters<typeof repoFalso>[0], Partial<PedidoIndicacao>, string][] = [
      [{}, { pedidoCliente: " ", pedidoArquiteto: "", descricaoAmbiente: "" }, "entrada_invalida"],
      [{}, { ambiente: "   " }, "entrada_invalida"],
      [{}, { pedidoCliente: "x".repeat(4001) }, "entrada_invalida"],
      [{ orcamento: null }, {}, "nao_encontrado"],
      [{ orcamento: { vendedora_id: "outra" } }, {}, "nao_encontrado"],
      [{ orcamento: { status: "enviado" } }, {}, "nao_editavel"],
      [{ emAndamento: true }, {}, "em_andamento"],
    ];
    for (const [opcoes, extra, motivo] of casos) {
      const r = repoFalso(opcoes);
      const ia = iaFalsa([respostaBoa()]);
      const res = await pedirIndicacao(deps(r.repo, ia.cliente), "u1", { ...pedido, ...extra });
      expect(res, motivo).toMatchObject({ ok: false, motivo });
      expect(ia.create).not.toHaveBeenCalled();
    }
  });

  it("só envia fotos e plantas quando a vendedora marca; PDF cai para o texto se o modelo recusar", async () => {
    const anexos: AnexoParaIA[] = [
      { id: "a1", tipo: "foto", nome: "sala.jpg", mime: "image/jpeg", dados: new Uint8Array(4) },
      {
        id: "a2",
        tipo: "planta",
        nome: "planta.pdf",
        mime: "application/pdf",
        dados: new Uint8Array(4),
      },
    ];
    const sem = iaFalsa([respostaBoa()]);
    await pedirIndicacao(deps(repoFalso({ anexos }).repo, sem.cliente), "u1", pedido);
    expect(JSON.stringify(sem.chamadas[0].input)).not.toContain("input_image");

    const r = repoFalso({ anexos });
    const com = iaFalsa([
      Object.assign(new Error("Invalid input_file pdf"), { status: 400 }),
      respostaBoa(),
    ]);
    const res = await pedirIndicacao(
      deps(r.repo, com.cliente, { extrairTextoPdf: async () => "Planta: sala 4x5 m" }),
      "u1",
      { ...pedido, usarAnexos: true },
    );
    expect(res.ok).toBe(true);
    expect(JSON.stringify(com.chamadas[0].input)).toContain("input_file");
    expect(JSON.stringify(com.chamadas[1].input)).toContain("Planta: sala 4x5 m");
    expect(JSON.stringify(com.chamadas[1].input)).toContain("input_image");
    expect(r.indicacoes[0]).toMatchObject({ usouAnexos: true });
  });

  it("não repete o que já está no ambiente (informa à IA e marca na resposta)", async () => {
    const r = repoFalso({
      itensNoAmbiente: [{ codigo: "9520", descricao: "STELLA DIC 6W 2.7K", quantidade: 3 }],
    });
    const ia = iaFalsa([respostaBoa()]);
    const res = await pedirIndicacao(deps(r.repo, ia.cliente), "u1", pedido);
    expect(JSON.stringify(ia.chamadas[0].input)).toContain("3 x STELLA DIC 6W 2.7K");
    if (res.ok) expect(res.sugestoes[0]).toMatchObject({ codigo: "9520", jaNoAmbiente: true });
  });
});

describe("montarTextoIndicacao", () => {
  it("nunca inclui identificação do cliente ou do arquiteto e traz os três textos", () => {
    const t = montarTextoIndicacao({
      respostas,
      ambiente: "Sala",
      pedidoCliente: "Pedido de Maria Souza",
      pedidoArquiteto: "Lula Santana quer fita",
      descricaoAmbiente: "Forro de gesso",
      itensExistentes: [],
    });
    expect(t).not.toMatch(/Maria|Souza|Lula|Santana|\+55/);
    expect(t).toContain("Ambiente a indicar: Sala");
    expect(t).toContain("O que o arquiteto pediu:");
    expect(t).toContain("Forro de gesso");
    expect(t).toContain("Prazo: Aceita encomenda (30 a 45 dias úteis)");
  });

  it("não manda tipo de obra, linha nem endereço à IA", () => {
    const t = montarTextoIndicacao({
      respostas: {
        ...respostas,
        endereco: "Rua das Flores, 10",
        tipo_obra: { uso: "residencial", estado: "reforma" },
        linha: "tecnica",
      },
      ambiente: "Sala",
      pedidoCliente: "",
      pedidoArquiteto: "",
      descricaoAmbiente: "",
      itensExistentes: [],
    });
    expect(t).not.toMatch(/Obra:|Linha:|Flores|residencial/i);
  });
});

// ---------------------------------------------------------------- formatação

describe("validação da formatação", () => {
  it("só vale se mantém todos os números e medidas", () => {
    expect(mesmosNumeros("EMB DICR MR16 GU10 BR", "Embutido para dicroica MR16 GU10, branco")).toBe(
      true,
    );
    expect(mesmosNumeros("FITA 22W 3.0K", "Fita de 22 W, 3,0 K")).toBe(true);
    expect(mesmosNumeros("FITA 22W 3.0K", "Fita de 22 W, 3000 K")).toBe(false);
    expect(mesmosNumeros("FITA 22W 3.0K", "Fita de 22 W")).toBe(false);
    expect(mesmosNumeros("FITA 22W", "Fita de 22 W e 5 m")).toBe(false);
    expect(descricaoFormatadaValida("MB 48W", "Fonte 48 W")).toBe(true);
    expect(descricaoFormatadaValida("MB 48W", "Fonte 60 W")).toBe(false);
    expect(descricaoFormatadaValida("MB 48W", "x")).toBe(false);
    expect(descricaoFormatadaValida("MB 48W", `Fonte 48 W ${"a".repeat(200)}`)).toBe(false);
  });

  it("nome de ambiente só pode mudar maiúsculas e acentos", () => {
    expect(nomeAmbienteFormatadoValido("suite", "Suíte")).toBe(true);
    expect(nomeAmbienteFormatadoValido("QUARTO CASAL", "Quarto casal")).toBe(true);
    expect(nomeAmbienteFormatadoValido("sala", "Sala de estar")).toBe(false);
    expect(ambienteParecePrecisarDeAjuste("sala")).toBe(true);
    expect(ambienteParecePrecisarDeAjuste("COZINHA")).toBe(true);
    expect(ambienteParecePrecisarDeAjuste("Cozinha")).toBe(false);
    expect(ambienteParecePrecisarDeAjuste("TV")).toBe(false);
  });
});

describe("formatarTextos", () => {
  const produtos = [
    {
      codigo: "9520",
      categoria: "LED",
      descricao: "STELLA DIC 6W 2.7K",
      atualizado_em: "2026-11-01T00:00:00Z",
    },
    {
      codigo: "10340",
      categoria: "FONTE",
      descricao: "MB 48W",
      atualizado_em: "2026-11-01T00:00:00Z",
    },
  ];
  const resposta = (extra: Record<string, unknown> = {}) =>
    mensagemFinal({
      produtos: [
        { codigo: "9520", descricao_formatada: "Lâmpada dicroica LED 6 W, 2.7 K" },
        { codigo: "10340", descricao_formatada: "Fonte de alimentação MB 48 W" },
      ],
      ambientes: [{ original: "sala", formatado: "Sala" }],
      ...extra,
    });

  it("faz UMA chamada só de texto, sem ferramentas, guarda no cache e padroniza o ambiente", async () => {
    const r = repoFalso();
    const ia = iaFalsa([resposta()]);
    const res = await formatarTextos(deps(r.repo, ia.cliente), "u1", "o1", {
      produtos,
      ambientes: ["sala", "Cozinha"],
    });
    expect(ia.create).toHaveBeenCalledTimes(1);
    expect(ia.chamadas[0].tools).toBeUndefined();
    expect(res.chamouIA).toBe(true);
    expect(res.descricoes.get("9520")).toBe("Lâmpada dicroica LED 6 W, 2.7 K");
    expect(res.descricoes.get("10340")).toBe("Fonte de alimentação MB 48 W");
    expect(res.ambientes.get("sala")).toBe("Sala");
    expect(res.ambientes.has("Cozinha")).toBe(false);
    expect(r.gravadas.map((g) => g.codigo).sort()).toEqual(["10340", "9520"]);
    expect(r.usos[0]).toMatchObject({ tipo: "formatacao", fim: { status: "ok" } });
    // A categoria vai junto: diz se o produto é lâmpada ou luminária (evita "embutido" para lâmpada).
    expect(JSON.stringify(ia.chamadas[0].input)).toContain('categoria\\":\\"LED');
    // Só código e descrição do catálogo vão para a IA.
    expect(JSON.stringify(ia.chamadas[0].input)).not.toMatch(/Maria|Lula|\+55/);
  });

  it("com o cache em dia não chama a IA; se a descrição do catálogo mudou, formata de novo", async () => {
    const r = repoFalso();
    const ia = iaFalsa([resposta()]);
    await formatarTextos(deps(r.repo, ia.cliente), "u1", "o1", { produtos, ambientes: ["Sala"] });
    expect(ia.create).toHaveBeenCalledTimes(1);

    const segunda = iaFalsa([resposta()]);
    const res = await formatarTextos(deps(r.repo, segunda.cliente), "u1", "o2", {
      produtos,
      ambientes: ["Sala"],
    });
    expect(segunda.create).not.toHaveBeenCalled();
    expect(res.chamouIA).toBe(false);
    expect(res.descricoes.get("10340")).toBe("Fonte de alimentação MB 48 W");

    const mudou = iaFalsa([
      mensagemFinal({
        produtos: [{ codigo: "10340", descricao_formatada: "Fonte MB 60 W" }],
        ambientes: [],
      }),
    ]);
    const res2 = await formatarTextos(deps(r.repo, mudou.cliente), "u1", "o3", {
      produtos: [produtos[0], { ...produtos[1], descricao: "MB 60W" }],
      ambientes: ["Sala"],
    });
    expect(mudou.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mudou.chamadas[0].input)).toContain("MB 60W");
    expect(JSON.stringify(mudou.chamadas[0].input)).not.toContain("STELLA");
    expect(res2.descricoes.get("10340")).toBe("Fonte MB 60 W");
  });

  it("número perdido cai na descrição do catálogo (e não vai para o cache)", async () => {
    const r = repoFalso();
    const ia = iaFalsa([
      mensagemFinal({
        produtos: [
          { codigo: "9520", descricao_formatada: "Lâmpada dicroica LED, luz quente" },
          { codigo: "10340", descricao_formatada: "Fonte de alimentação MB 48 W" },
        ],
        ambientes: [],
      }),
    ]);
    const res = await formatarTextos(deps(r.repo, ia.cliente), "u1", "o1", {
      produtos,
      ambientes: ["Sala"],
    });
    expect(res.descricoes.get("9520")).toBe("STELLA DIC 6W 2.7K");
    expect(res.descricoes.get("10340")).toBe("Fonte de alimentação MB 48 W");
    expect(r.gravadas.map((g) => g.codigo)).toEqual(["10340"]);
    expect(res.avisos.join(" ")).toMatch(/9520.*perdeu números/);
  });

  it("falha da IA, resposta inválida ou limite diário nunca bloqueiam: ficam as descrições do catálogo", async () => {
    for (const [opcoes, ia] of [
      [{}, iaFalsa([Object.assign(new Error("boom"), { status: 500 })])],
      [{}, iaFalsa([mensagemFinal({ nada: true })])],
      [{ usoDia: 20 }, iaFalsa([resposta()])],
    ] as const) {
      const r = repoFalso(opcoes);
      const res = await formatarTextos(deps(r.repo, ia.cliente), "u1", "o1", {
        produtos,
        ambientes: ["sala"],
      });
      expect(res.descricoes.get("9520")).toBe("STELLA DIC 6W 2.7K");
      expect(res.descricoes.get("10340")).toBe("MB 48W");
      expect(res.ambientes.size).toBe(0);
      expect(r.gravadas).toHaveLength(0);
    }
  });

  it("nome de ambiente que a IA trocar por outra palavra é ignorado", async () => {
    const r = repoFalso();
    const ia = iaFalsa([
      resposta({ ambientes: [{ original: "sala", formatado: "Sala de estar" }] }),
    ]);
    const res = await formatarTextos(deps(r.repo, ia.cliente), "u1", "o1", {
      produtos,
      ambientes: ["sala"],
    });
    expect(res.ambientes.size).toBe(0);
  });
});

// ---------------------------------------------------------------- anexos, privacidade, config e mensagens

describe("anexos, privacidade, config e mensagens", () => {
  it("conteudoDosAnexos respeita o limite de tamanho total", async () => {
    const grande = new Uint8Array(20 * 1024 * 1024);
    const { detalhes } = await conteudoDosAnexos(
      [
        { id: crypto.randomUUID(), tipo: "foto", nome: "a.jpg", mime: "image/jpeg", dados: grande },
        { id: crypto.randomUUID(), tipo: "foto", nome: "b.jpg", mime: "image/jpeg", dados: grande },
      ],
      false,
      async () => "",
    );
    expect(detalhes.map((d) => d.enviado_como)).toEqual(["imagem", "ignorado"]);
  });

  it("anonimizarTexto tira telefone, e-mail e nome, sem tocar em listas de códigos", () => {
    const t = anonimizarTexto(
      "Falar com Maria no 82 99999-1234 ou maria@x.com. Códigos 12389 12390 12391 e (82) 3333-4444.",
      "Maria Souza",
    );
    expect(t).not.toMatch(/Maria|99999|maria@|3333/);
    expect(t).toContain("12389 12390 12391");
  });

  it("anonimizarTexto aceita vários nomes (cliente e arquiteto)", () => {
    const t = anonimizarTexto("Maria Souza e Lula Santana", ["Maria Souza", "Lula Santana"]);
    expect(t).not.toMatch(/Maria|Souza|Lula|Santana/);
  });

  it("lerConfigIA usa os padrões e lê o ambiente", () => {
    expect(lerConfigIA({})).toMatchObject({
      modelo: "gpt-5.6-sol",
      limiteDiario: 20,
      maxGeracoesPorOrcamento: 3,
      maxRodadasFerramentas: 8,
      precoEntradaUsdMtok: null,
    });
    expect(
      lerConfigIA({
        OPENAI_MODEL: "gpt-x",
        IA_LIMITE_DIARIO_VENDEDORA: "5",
        IA_MAX_GERACOES_POR_ORCAMENTO: "2",
        IA_PRECO_ENTRADA_USD_MTOK: "1,5",
        IA_PRECO_SAIDA_USD_MTOK: "6",
        IA_RACIOCINIO: "low",
      }),
    ).toMatchObject({
      modelo: "gpt-x",
      limiteDiario: 5,
      maxGeracoesPorOrcamento: 2,
      precoEntradaUsdMtok: 1.5,
      precoSaidaUsdMtok: 6,
      raciocinio: "low",
    });
    expect(lerConfigIA({ IA_LIMITE_DIARIO_VENDEDORA: "abc" }).limiteDiario).toBe(20);
  });

  it("estimarCustoUsd só estima com os dois preços informados", () => {
    expect(
      estimarCustoUsd({ precoEntradaUsdMtok: 2, precoSaidaUsdMtok: 10 }, 1_000_000, 100_000),
    ).toEqual({
      custo: 3,
      conhecido: true,
    });
    expect(estimarCustoUsd({ precoEntradaUsdMtok: null, precoSaidaUsdMtok: 10 }, 5, 5)).toEqual({
      custo: 0,
      conhecido: false,
    });
  });

  it("inicioDoDiaMaceio usa UTC-3", () => {
    expect(inicioDoDiaMaceio(new Date("2026-11-06T01:00:00Z")).toISOString()).toBe(
      "2026-11-05T03:00:00.000Z",
    );
    expect(inicioDoDiaMaceio(new Date("2026-11-06T15:00:00Z")).toISOString()).toBe(
      "2026-11-06T03:00:00.000Z",
    );
  });

  it("mensagemAmigavelErro não vaza detalhes técnicos", () => {
    expect(mensagemAmigavelErro(Object.assign(new Error("x"), { status: 401 }))).toMatch(
      /não está configurada/,
    );
    expect(mensagemAmigavelErro(new Error("Request timed out."))).toMatch(/demorou demais/);
    expect(mensagemAmigavelErro(new Error("boom org-123 key sk-abc"))).toBe(
      "Não foi possível usar a IA agora.",
    );
  });
});
