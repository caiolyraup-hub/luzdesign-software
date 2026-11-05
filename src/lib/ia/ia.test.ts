import { describe, expect, it, vi } from "vitest";
import type { Respostas } from "../orcamento/perguntas";
import { estimarCustoUsd, lerConfigIA, type ConfigIA } from "./config";
import { schemaSaidaIA } from "./esquema";
import { DEFINICOES_FERRAMENTAS, type ExecutorFerramentas } from "./ferramentas";
import { anonimizarTexto, montarTextoAtendimento } from "./instrucoes";
import {
  conteudoDosAnexos,
  inicioDoDiaMaceio,
  mensagemAmigavelErro,
  montarOrcamento,
  type AnexoParaIA,
  type FinalizacaoUso,
  type MontagemGravada,
  type RepositorioIA,
} from "./montar";
import { executarMotor, type ClienteIA, type RespostaIA } from "./motor";
import {
  normalizarSaida,
  subtotalCentavos,
  type ItemMontado,
  type ProdutoCatalogo,
} from "./normalizar";

// ---------------------------------------------------------------- apoio

const catalogoBase = (): Map<string, ProdutoCatalogo> =>
  new Map(
    [
      {
        codigo: "9520",
        descricao: "STELLA DIC 6W 2.7K",
        unidade: "un",
        preco_unitario: 37,
        ativo: true,
      },
      {
        codigo: "12222",
        descricao: "MTS FITA 22W/M NT NIT",
        unidade: "m",
        preco_unitario: 20,
        ativo: true,
      },
      {
        codigo: "12615",
        descricao: "4290 FUSY 2M BR MB",
        unidade: "un",
        preco_unitario: 311,
        ativo: true,
      },
      { codigo: "10340", descricao: "MB 48W", unidade: "un", preco_unitario: 52, ativo: true },
      {
        codigo: "7777",
        descricao: "PRODUTO INATIVO",
        unidade: "un",
        preco_unitario: 10,
        ativo: false,
      },
    ].map((p) => [p.codigo, p as ProdutoCatalogo]),
  );

const saida = (...itens: Record<string, unknown>[]) =>
  schemaSaidaIA.parse({
    ambientes: [{ nome: "Sala", itens }],
    pendencias: ["Confirmar medida da sanca"],
    resumo_para_vendedora: "Montei a sala.",
  });

const item = (codigo: string | null, quantidade: number, extra: Record<string, unknown> = {}) => ({
  codigo,
  quantidade,
  justificativa: "porque sim",
  descricao_avulso: null,
  ...extra,
});

const respostasCompletas: Respostas = {
  versao: 1,
  cliente_nome: "Maria Souza",
  cliente_whatsapp: "+5582999991234",
  tipo_cliente: "final",
  tipo_obra: { uso: "residencial", estado: "reforma" },
  ambientes: ["sala", "cozinha"],
  pedido_cliente: "Spots na sala e fita LED na sanca da cozinha.",
  linha: "tecnica",
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

// ---------------------------------------------------------------- normalizar

describe("normalizarSaida", () => {
  it("descarta código inventado e inativo, com aviso", () => {
    const r = normalizarSaida(
      saida(item("99999", 1), item("7777", 1), item("9520", 2)),
      catalogoBase(),
    );
    expect(r.itens.map((i) => i.codigo)).toEqual(["9520"]);
    expect(r.avisos).toHaveLength(2);
    expect(r.avisos[0]).toMatch(/99999.*não existe no catálogo/);
    expect(r.avisos[1]).toMatch(/7777.*inativo/);
  });

  it("o preço e a descrição vêm do catálogo, mesmo que a IA 'sugira' outros", () => {
    const comPreco = schemaSaidaIA.parse({
      ambientes: [
        {
          nome: "Sala",
          itens: [
            {
              codigo: "9520",
              quantidade: 2,
              justificativa: "ok",
              descricao_avulso: null,
              preco_unitario: 0.01,
              preco: 1,
              descricao: "OUTRA COISA",
            },
          ],
        },
      ],
      pendencias: [],
      resumo_para_vendedora: "",
    });
    const r = normalizarSaida(comPreco, catalogoBase());
    expect(r.itens[0]).toMatchObject({
      codigo: "9520",
      descricao_congelada: "STELLA DIC 6W 2.7K",
      preco_unitario_congelado: 37,
      quantidade: 2,
      avulso: false,
    });
    expect(r.totalCentavos).toBe(7400);
  });

  it("arredonda para cima a quantidade fracionada de produto por unidade e avisa", () => {
    const r = normalizarSaida(saida(item("9520", 2.3)), catalogoBase());
    expect(r.itens[0].quantidade).toBe(3);
    expect(r.avisos[0]).toMatch(/arredondada de 2,3 para 3/);
  });

  it("produto por metro aceita 2 casas decimais", () => {
    const r = normalizarSaida(saida(item("12222", 3.456)), catalogoBase());
    expect(r.itens[0].quantidade).toBe(3.46);
    expect(r.totalCentavos).toBe(6920);
    expect(r.avisos).toEqual([]);
  });

  it("item sem código vira avulso: preço 0, destaque e quantidade inteira", () => {
    const r = normalizarSaida(
      saida(item(null, 3, { descricao_avulso: "Pendente 3 globos vidro fumê" })),
      catalogoBase(),
    );
    expect(r.itens[0]).toMatchObject({
      codigo: null,
      avulso: true,
      preco_unitario_congelado: 0,
      descricao_congelada: "Pendente 3 globos vidro fumê",
      quantidade: 3,
    });
    expect(r.totalCentavos).toBe(0);
  });

  it("descarta quantidade inválida e avulso sem descrição", () => {
    const r = normalizarSaida(
      saida(item("9520", 0), item("9520", -2), item(null, 1)),
      catalogoBase(),
    );
    expect(r.itens).toEqual([]);
    expect(r.avisos).toHaveLength(3);
  });

  it("soma o total em centavos, junta o mesmo código no mesmo ambiente e preserva a ordem", () => {
    const r = normalizarSaida(
      {
        ambientes: [
          { nome: "Sala", itens: [item("9520", 4), item("12615", 1), item("9520", 2)] },
          { nome: "Cozinha", itens: [item("12222", 8), item("10340", 1)] },
        ],
        pendencias: [],
        resumo_para_vendedora: "",
      },
      catalogoBase(),
    );
    expect(r.itens.map((i) => [i.ambiente, i.codigo, i.quantidade])).toEqual([
      ["Sala", "9520", 6],
      ["Sala", "12615", 1],
      ["Cozinha", "12222", 8],
      ["Cozinha", "10340", 1],
    ]);
    expect(r.itens.map((i) => i.ordem)).toEqual([0, 1, 2, 3]);
    // 6x37 + 311 + 8x20 + 52 = 222 + 311 + 160 + 52 = 745
    expect(r.totalCentavos).toBe(74500);
  });

  it("subtotal evita erro de ponto flutuante", () => {
    expect(subtotalCentavos(0.1, 3)).toBe(30);
    expect(subtotalCentavos(19.9, 3)).toBe(5970);
    expect(subtotalCentavos(20, 3.46)).toBe(6920);
  });
});

// ---------------------------------------------------------------- motor

describe("executarMotor", () => {
  const base = (cliente: ClienteIA, executor: ExecutorFerramentas = executorVazio) => ({
    cliente,
    modelo: "gpt-teste",
    instrucoes: "instruções",
    conteudo: [{ type: "input_text" as const, text: "pedido" }],
    executor,
    maxRodadas: 8,
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
});

// ---------------------------------------------------------------- montar (repositório em memória)

function repositorioFalso(
  opcoes: {
    orcamento?: Partial<{ vendedora_id: string; status: string; respostas: Respostas }> | null;
    usoDia?: number;
    usoOrcamento?: number;
    emAndamento?: boolean;
    anexos?: AnexoParaIA[];
    catalogo?: Map<string, ProdutoCatalogo>;
  } = {},
) {
  const gravacoes: { itens: ItemMontado[]; total: number; montagem: MontagemGravada }[] = [];
  const usos: { id: string; fim?: FinalizacaoUso }[] = [];
  const repo: RepositorioIA = {
    async carregarOrcamento(id) {
      if (opcoes.orcamento === null) return null;
      return {
        id,
        vendedora_id: "vend-1",
        status: "rascunho",
        respostas: respostasCompletas,
        ...opcoes.orcamento,
      };
    },
    async contarUso({ vendedoraId }) {
      return vendedoraId ? (opcoes.usoDia ?? 0) : (opcoes.usoOrcamento ?? 0);
    },
    async existeEmAndamento() {
      return opcoes.emAndamento ?? false;
    },
    async iniciarUso() {
      usos.push({ id: `uso-${usos.length + 1}` });
      return `uso-${usos.length}`;
    },
    async finalizarUso(id, dados) {
      usos.find((u) => u.id === id)!.fim = dados;
    },
    async carregarAnexos() {
      return opcoes.anexos ?? [];
    },
    async buscarProdutosPorCodigo(codigos) {
      const todos = opcoes.catalogo ?? catalogoBase();
      return new Map([...todos].filter(([c]) => codigos.includes(c)));
    },
    async substituirItens(_id, itens, total, montagem) {
      gravacoes.push({ itens, total, montagem });
    },
  };
  return { repo, gravacoes, usos };
}

const respostaBoa = () =>
  mensagemFinal({
    ambientes: [
      { nome: "Sala", itens: [item("9520", 4), item("99999", 1)] },
      {
        nome: "Cozinha",
        itens: [item("12222", 5.5), item(null, 2, { descricao_avulso: "Pendente 3 globos" })],
      },
    ],
    pendencias: ["Confirmar a medida da sanca"],
    resumo_para_vendedora: "Montei sala e cozinha.",
  });

describe("montarOrcamento", () => {
  const rodar = (
    r: ReturnType<typeof repositorioFalso>,
    ia: ReturnType<typeof iaFalsa>,
    extra = {},
  ) =>
    montarOrcamento(
      { repo: r.repo, ia: ia.cliente, executor: executorVazio, config, ...extra },
      "vend-1",
      "orc-1",
    );

  it("monta, aplica o preço do catálogo, grava o total e registra o uso", async () => {
    const r = repositorioFalso();
    const ia = iaFalsa([respostaBoa()]);
    const res = await rodar(r, ia);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 4 x 37 + 5,5 x 20 + avulso (0) = 148 + 110 = 258
    expect(res.totalCentavos).toBe(25800);
    expect(res.itens).toBe(3);
    expect(res.avisos.join(" ")).toMatch(/99999.*não existe/);
    expect(res.pendencias).toEqual(["Confirmar a medida da sanca"]);
    expect(res.geracoes).toBe(1);
    expect(res.geracoesRestantes).toBe(2);

    expect(r.gravacoes).toHaveLength(1);
    expect(r.gravacoes[0].total).toBe(258);
    expect(r.gravacoes[0].itens.map((i) => i.preco_unitario_congelado)).toEqual([37, 20, 0]);
    expect(r.gravacoes[0].montagem).toMatchObject({ geracoes: 1, modelo: "gpt-teste" });

    expect(r.usos[0].fim).toMatchObject({
      status: "ok",
      tokens_entrada: 100,
      tokens_saida: 50,
      chamadas_ferramenta: 0,
    });
    // 100 x 2/1e6 + 50 x 10/1e6 = 0,0007
    expect(r.usos[0].fim?.custo_estimado).toBeCloseTo(0.0007, 6);
  });

  it("erro da API: nada é gravado, a mensagem é amigável e a tentativa não conta", async () => {
    const r = repositorioFalso();
    const ia = iaFalsa([Object.assign(new Error("Rate limit exceeded: org-xyz"), { status: 429 })]);
    const res = await rodar(r, ia);

    expect(res).toEqual({
      ok: false,
      motivo: "ia",
      erro: "A IA está com muitas solicitações agora. Tente de novo em instantes.",
      podeTentarDeNovo: true,
    });
    expect(r.gravacoes).toEqual([]);
    expect(r.usos[0].fim).toMatchObject({ status: "erro", custo_estimado: 0 });
    expect(r.usos[0].fim?.erro).toContain("Rate limit");
  });

  it("resposta inválida (JSON quebrado ou sem itens aproveitáveis) não grava nada", async () => {
    for (const resposta of [
      {
        output: [{ type: "message", content: [{ type: "output_text", text: "isto não é JSON" }] }],
      },
      mensagemFinal({
        ambientes: [{ nome: "Sala", itens: [item("99999", 1)] }],
        pendencias: [],
        resumo_para_vendedora: "",
      }),
      mensagemFinal({ qualquer: "coisa" }),
    ] as RespostaIA[]) {
      const r = repositorioFalso();
      const res = await rodar(r, iaFalsa([resposta]));
      expect(res.ok).toBe(false);
      expect(r.gravacoes).toEqual([]);
      expect(r.usos[0].fim?.status).toBe("erro");
    }
  });

  it("limite diário: não chama a API", async () => {
    const r = repositorioFalso({ usoDia: 20 });
    const ia = iaFalsa([respostaBoa()]);
    const res = await rodar(r, ia);
    expect(res).toMatchObject({ ok: false, motivo: "limite_diario", podeTentarDeNovo: false });
    expect((res as { erro: string }).erro).toMatch(/limite de 20 montagens/);
    expect(ia.create).not.toHaveBeenCalled();
    expect(r.usos).toEqual([]);
  });

  it("limite por orçamento: não chama a API", async () => {
    const r = repositorioFalso({ usoOrcamento: 3 });
    const ia = iaFalsa([respostaBoa()]);
    const res = await rodar(r, ia);
    expect(res).toMatchObject({ ok: false, motivo: "limite_orcamento" });
    expect(ia.create).not.toHaveBeenCalled();
  });

  it("a terceira montagem ainda passa; geracoesRestantes chega a 0", async () => {
    const r = repositorioFalso({ usoOrcamento: 2 });
    const res = await rodar(r, iaFalsa([respostaBoa()]));
    expect(res).toMatchObject({ ok: true, geracoes: 3, geracoesRestantes: 0 });
  });

  it("recusa montagem simultânea, orçamento de outra pessoa, fora de rascunho e respostas incompletas", async () => {
    const ia = iaFalsa([respostaBoa()]);
    expect(await rodar(repositorioFalso({ emAndamento: true }), ia)).toMatchObject({
      motivo: "em_andamento",
    });
    expect(
      await rodar(repositorioFalso({ orcamento: { vendedora_id: "kely" } }), ia),
    ).toMatchObject({
      motivo: "nao_encontrado",
    });
    expect(await rodar(repositorioFalso({ orcamento: null }), ia)).toMatchObject({
      motivo: "nao_encontrado",
    });
    expect(await rodar(repositorioFalso({ orcamento: { status: "gerado" } }), ia)).toMatchObject({
      motivo: "nao_rascunho",
    });
    expect(
      await rodar(repositorioFalso({ orcamento: { respostas: { cliente_nome: "Ana" } } }), ia),
    ).toMatchObject({
      motivo: "respostas_incompletas",
    });
    expect(ia.create).not.toHaveBeenCalled();
  });

  it("não envia nome nem WhatsApp do cliente para a IA", async () => {
    const r = repositorioFalso({
      orcamento: {
        respostas: {
          ...respostasCompletas,
          pedido_cliente: "Oi, sou a Maria Souza, meu zap é (82) 99999-1234. Quero spots na sala.",
        },
      },
    });
    const ia = iaFalsa([respostaBoa()]);
    await rodar(r, ia);
    const enviado = JSON.stringify(ia.chamadas[0].input);
    expect(enviado).not.toMatch(/Maria|Souza|99999-1234|999991234|\+55/);
    expect(enviado).toContain("[telefone]");
    expect(enviado).toContain("[cliente]");
    expect(enviado).toContain("Quero spots na sala");
  });

  it("imagens vão como imagem; formatos que a IA não lê ficam de fora e são registrados", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const r = repositorioFalso({
      anexos: [
        { tipo: "foto", nome: "sala.jpg", mime: "image/jpeg", dados: png },
        { tipo: "foto", nome: "iphone.heic", mime: "image/heic", dados: png },
      ],
    });
    const ia = iaFalsa([respostaBoa()]);
    await rodar(r, ia);
    const input = JSON.stringify(ia.chamadas[0].input);
    expect(input).toContain("input_image");
    expect(input).toContain("data:image/jpeg;base64,");
    expect(input).not.toContain("iphone.heic");
    const detalhes = (
      r.usos[0].fim?.detalhes as { anexos: { nome: string; enviado_como: string }[] }
    ).anexos;
    expect(detalhes).toEqual([
      expect.objectContaining({ nome: "sala.jpg", enviado_como: "imagem" }),
      expect.objectContaining({ nome: "iphone.heic", enviado_como: "ignorado" }),
    ]);
  });

  it("PDF vai como arquivo; se o modelo recusar, tenta de novo com o texto extraído", async () => {
    const r = repositorioFalso({
      anexos: [
        {
          tipo: "planta",
          nome: "planta.pdf",
          mime: "application/pdf",
          dados: new Uint8Array([37, 80, 68, 70]),
        },
      ],
    });
    const recusa = Object.assign(new Error("400 Invalid input_file: unsupported"), { status: 400 });
    const ia = iaFalsa([recusa, respostaBoa()]);
    const res = await rodar(r, ia, { extrairTextoPdf: async () => "Sala 20 m2, pé direito 2,7 m" });

    expect(res.ok).toBe(true);
    expect(JSON.stringify(ia.chamadas[0].input)).toContain("input_file");
    expect(JSON.stringify(ia.chamadas[1].input)).not.toContain("input_file");
    expect(JSON.stringify(ia.chamadas[1].input)).toContain("Sala 20 m2");
    const detalhes = (r.usos[0].fim?.detalhes as { anexos: { enviado_como: string }[] }).anexos;
    expect(detalhes[0].enviado_como).toBe("pdf_texto");
  });
});

// ---------------------------------------------------------------- apoio

describe("anexos, privacidade, config e mensagens", () => {
  it("conteudoDosAnexos respeita o limite de tamanho total", async () => {
    const grande = new Uint8Array(20 * 1024 * 1024);
    const { detalhes } = await conteudoDosAnexos(
      [
        { tipo: "foto", nome: "a.jpg", mime: "image/jpeg", dados: grande },
        { tipo: "foto", nome: "b.jpg", mime: "image/jpeg", dados: grande },
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

  it("montarTextoAtendimento nunca inclui identificação do cliente", () => {
    const t = montarTextoAtendimento({
      ...respostasCompletas,
      tipo_cliente: "arquiteto",
      arquiteto_indicador: "Lula Santana",
    });
    expect(t).not.toMatch(/Maria|Souza|Lula|Santana|\+55/);
    expect(t).toContain("Ambientes: Sala; Cozinha");
    expect(t).toContain("Prazo: Aceita encomenda (30 a 45 dias úteis)");
  });

  it("lerConfigIA usa os padrões e lê o ambiente", () => {
    expect(lerConfigIA({})).toMatchObject({
      modelo: "gpt-5.6",
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
      "Não foi possível montar o orçamento agora.",
    );
  });
});
